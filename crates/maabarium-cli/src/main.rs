use clap::{Parser, Subcommand, ValueEnum};
use maabarium_core::error::UpdaterError;
use maabarium_core::telegram::TelegramConfig;
use maabarium_core::{
    ApiKeyStore, BlueprintFile, Engine, EngineConfig, EngineTimingSummary, EvaluatorRegistry,
    ExportFormat, GitDependencyEnsureOutcome, Persistence, PromotionOutcome, ReadinessLevel,
    ReadinessScanner, SecretStore, UpdaterConfiguration, analyze_workspace, apply_all_fixes,
    check_for_cli_update, default_db_path, default_log_path, detect_recommended_profile,
    ensure_git_dependency, install_cli_update,
};
use secrecy::{ExposeSecret, SecretString};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;

mod render;
use tracing_subscriber::prelude::*;

#[derive(Parser)]
#[command(name = "maabarium", about = "AI-driven continuous improvement engine")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the engine with a blueprint
    Run {
        #[arg(value_name = "BLUEPRINT_PATH")]
        blueprint_path: PathBuf,
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
    },
    /// Show current status
    Status {
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
    },
    /// Export experiment history
    Export {
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
        #[arg(long, value_enum, default_value_t = CliExportFormat::Json)]
        format: CliExportFormat,
        #[arg(long)]
        output: PathBuf,
    },
    /// Manage API keys
    Keys {
        #[command(subcommand)]
        action: KeysAction,
    },
    /// Check and fix setup readiness
    Setup {
        /// Non-interactive readiness check (exit 0 = ready, 1 = needs attention)
        #[arg(long)]
        check: bool,
        /// Output readiness report as JSON
        #[arg(long)]
        json: bool,
        /// Workspace path to analyze
        #[arg(long)]
        workspace: Option<String>,
        /// Runtime strategy hint: local, mixed, remote
        #[arg(long)]
        strategy: Option<String>,
    },
    /// Inspect and update the CLI binary itself
    #[command(name = "self")]
    SelfManage {
        #[command(subcommand)]
        action: SelfAction,
    },
    /// Manage workflow run groups
    #[command(subcommand)]
    Group(GroupCommands),
    /// Configure Telegram notifications
    #[command(subcommand)]
    Telegram(TelegramCommands),
}

#[derive(Subcommand)]
enum KeysAction {
    /// Set an API key for a provider
    Set {
        provider: String,
        #[arg(long)]
        value: Option<String>,
    },
    /// Get an API key for a provider
    Get {
        provider: String,
        #[arg(long)]
        reveal: bool,
    },
    /// Delete an API key for a provider
    Delete { provider: String },
}

#[derive(Subcommand)]
enum SelfAction {
    /// Print the current CLI version and update channel configuration
    Version,
    /// Check for a newer CLI release in the configured channel
    Check,
    /// Download and install the newest CLI release for this platform
    Update,
}

#[derive(Subcommand)]
enum GroupCommands {
    /// Create a new workflow run group
    Create {
        name: String,
        #[arg(long)]
        description: Option<String>,
    },
    /// Add a blueprint to a group
    Add {
        name: String,
        #[arg(value_name = "BLUEPRINT_PATH")]
        blueprint_path: PathBuf,
        #[arg(long)]
        blueprint_name: Option<String>,
    },
    /// List all run groups
    List,
    /// Show details for a group
    Show { name: String },
    /// Remove a group (or a blueprint from a group)
    Remove {
        name: String,
        #[arg(long)]
        blueprint: Option<String>,
    },
    /// Run all workflows in a group
    Run {
        name: String,
        #[arg(long)]
        db: Option<String>,
        #[arg(long)]
        mode: Option<String>,
        #[arg(long)]
        yes: bool,
    },
    /// Run every configured group
    RunAll {
        #[arg(long)]
        db: Option<String>,
        #[arg(long)]
        mode: Option<String>,
        #[arg(long)]
        yes: bool,
    },
    /// Run groups whose schedules are currently due
    RunDue {
        #[arg(long)]
        db: Option<String>,
        #[arg(long)]
        yes: bool,
    },
    /// Show latest status for a group
    Status {
        name: String,
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
    },
    /// Show group run results
    Results {
        name: String,
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
        #[arg(long)]
        run: Option<String>,
        #[arg(long)]
        live: bool,
    },
    /// Inspect a specific group run in detail
    Inspect {
        name: String,
        #[arg(long, default_value = "data/maabarium.db")]
        db: String,
        #[arg(long)]
        run: Option<String>,
    },
    /// Set or update a group's schedule
    Schedule {
        name: String,
        #[arg(long)]
        cron: Option<String>,
        #[arg(long)]
        at: Option<String>,
        #[arg(long)]
        enable: bool,
        #[arg(long)]
        disable: bool,
    },
}

#[derive(Subcommand)]
enum TelegramCommands {
    /// Configure Telegram bot token and chat ID
    Setup {
        #[arg(long)]
        chat_id: String,
    },
    /// Send a test notification
    Test,
    /// Show current Telegram configuration
    Status,
    /// Disable all Telegram notifications
    Disable,
    /// Enable all Telegram notifications
    Enable,
}

#[derive(Clone, Debug, ValueEnum)]
enum CliExportFormat {
    Json,
    Csv,
}

fn cli_updater_configuration() -> Result<UpdaterConfiguration, UpdaterError> {
    UpdaterConfiguration::from_sources(
        std::env::var("MAABARIUM_UPDATE_CHANNEL").ok(),
        std::env::var("MAABARIUM_UPDATE_MANIFEST_URL").ok(),
        std::env::var("MAABARIUM_UPDATE_BASE_URL").ok(),
        option_env!("MAABARIUM_COMPILED_UPDATE_CHANNEL"),
        option_env!("MAABARIUM_COMPILED_UPDATE_MANIFEST_URL"),
        option_env!("MAABARIUM_COMPILED_UPDATE_BASE_URL"),
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _log_guard = init_tracing()?;

    let cli = Cli::parse();

    match cli.command {
        Commands::Run { blueprint_path, db } => {
            ensure_git_runtime_dependency()?;
            info!("Loading blueprint from {:?}", blueprint_path);
            let blueprint = BlueprintFile::load(&blueprint_path)
                .map_err(|e| anyhow::anyhow!("Blueprint error: {e}"))?;
            info!("Blueprint '{}' loaded", blueprint.blueprint.name);

            let cancel = CancellationToken::new();
            let cancel_clone = cancel.clone();
            tokio::spawn(async move {
                if let Ok(()) = tokio::signal::ctrl_c().await {
                    info!("Received Ctrl-C, shutting down...");
                    cancel_clone.cancel();
                }
            });

            let evaluator = select_evaluator(&blueprint)?;
            let config = EngineConfig {
                blueprint,
                db_path: normalize_db_path(&db),
                progress_reporter: None,
            };
            let engine = Engine::new(config, evaluator, cancel)
                .map_err(|e| anyhow::anyhow!("Engine init error: {e}"))?;
            engine
                .run()
                .await
                .map_err(|e| anyhow::anyhow!("Engine error: {e}"))?;
            println!("{}", render_timing_summary(&engine.timing_summary()));
        }
        Commands::Status { db } => {
            let persistence = Persistence::open(&normalize_db_path(&db))?;
            let experiments = persistence.recent_experiments(5)?;
            if experiments.is_empty() {
                println!("No experiments recorded in {db}");
            } else {
                println!("Recent experiments from {db}:");
                for experiment in experiments {
                    println!("{}", render_experiment_status_line(&experiment));
                }
            }
        }
        Commands::Export { db, format, output } => {
            let persistence = Persistence::open(&normalize_db_path(&db))?;
            let export_format = match format {
                CliExportFormat::Json => ExportFormat::Json,
                CliExportFormat::Csv => ExportFormat::Csv,
            };
            persistence.export(export_format, &output)?;
            println!("Exported experiment history to {}", output.display());
        }
        Commands::Keys { action } => match action {
            KeysAction::Set { provider, value } => {
                let api_key = match value {
                    Some(value) => value,
                    None => prompt_for_api_key(&provider)?,
                };
                let secret_store = SecretStore::new();
                secret_store.set_api_key(&provider, SecretString::from(api_key))?;
                println!("Stored API key for provider: {provider}");
            }
            KeysAction::Get { provider, reveal } => {
                let secret_store = SecretStore::new();
                println!(
                    "{}",
                    render_get_key_message(&secret_store, &provider, reveal)?
                );
            }
            KeysAction::Delete { provider } => {
                let secret_store = SecretStore::new();
                println!("{}", render_delete_key_message(&secret_store, &provider)?);
            }
        },
        Commands::Setup {
            check,
            json,
            workspace,
            strategy,
        } => {
            let workspace_ref = workspace.as_deref();
            let strategy_ref = strategy.as_deref();
            let report = ReadinessScanner::scan(workspace_ref, strategy_ref);

            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                render_readiness_report(&report, workspace_ref);
            }

            if check {
                if !report.is_ready() {
                    std::process::exit(1);
                }
            } else {
                // Interactive: attempt fixes for items needing attention
                let needs_fix = report.needs_attention();
                if needs_fix.is_empty() {
                    println!("\nAll checks passed. Maabarium is ready to run.");
                } else {
                    println!("\nAttempting one-click fixes...");
                    let outcomes = apply_all_fixes(workspace_ref);
                    for outcome in &outcomes {
                        let icon = if outcome.success { "[OK]" } else { "[!!]" };
                        println!("  {icon} {}", outcome.message);
                    }
                    if outcomes.iter().any(|o| !o.success) {
                        println!("\nSome fixes require manual intervention. See messages above.");
                    } else {
                        println!("\nAll automatic fixes applied successfully.");
                    }
                }

                // Show workspace analysis if workspace provided
                if let Some(ws) = workspace_ref {
                    let analysis = analyze_workspace(ws);
                    render_workspace_analysis(&analysis);
                }

                // Show recommended profile
                let recommended = detect_recommended_profile();
                println!(
                    "\nRecommended environment profile: {} - {}",
                    recommended.label(),
                    recommended.description()
                );
            }
        }
        Commands::SelfManage { action } => match action {
            SelfAction::Version => {
                println!("maabarium {}", env!("CARGO_PKG_VERSION"));
                match cli_updater_configuration() {
                    Ok(config) => {
                        println!("channel: {}", config.channel);
                        println!("manifest: {}", config.manifest_url);
                    }
                    Err(error) => {
                        println!("update configuration unavailable: {error}");
                    }
                }
            }
            SelfAction::Check => {
                let config = cli_updater_configuration()?;
                match check_for_cli_update(env!("CARGO_PKG_VERSION"), &config).await? {
                    Some(plan) => {
                        println!(
                            "Update available: {} -> {} ({})",
                            env!("CARGO_PKG_VERSION"),
                            plan.manifest.version,
                            plan.platform_key,
                        );
                        if let Some(notes) = plan.manifest.notes.as_deref() {
                            if !notes.trim().is_empty() {
                                println!("notes: {}", notes.trim());
                            }
                        }
                    }
                    None => {
                        println!(
                            "CLI is already up to date at version {}",
                            env!("CARGO_PKG_VERSION")
                        );
                    }
                }
            }
            SelfAction::Update => {
                let config = cli_updater_configuration()?;
                let Some(plan) = check_for_cli_update(env!("CARGO_PKG_VERSION"), &config).await?
                else {
                    println!(
                        "CLI is already up to date at version {}",
                        env!("CARGO_PKG_VERSION")
                    );
                    return Ok(());
                };

                let executable_path = std::env::current_exe()?;
                install_cli_update(&executable_path, &plan.artifact).await?;
                println!(
                    "Updated maabarium CLI from {} to {}",
                    env!("CARGO_PKG_VERSION"),
                    plan.manifest.version,
                );
            }
        },
        Commands::Group(ref cmd) => handle_group_command(cmd).await?,
        Commands::Telegram(ref cmd) => handle_telegram_command(cmd).await?,
    }

    Ok(())
}

fn ensure_git_runtime_dependency() -> anyhow::Result<()> {
    match ensure_git_dependency().map_err(anyhow::Error::msg)? {
        GitDependencyEnsureOutcome::AlreadyInstalled => Ok(()),
        GitDependencyEnsureOutcome::Installed { installer } => {
            eprintln!(
                "Git was missing. Maabarium installed it automatically via {}.",
                installer.label()
            );
            Ok(())
        }
        GitDependencyEnsureOutcome::InstallationStarted { message, .. } => {
            anyhow::bail!(message)
        }
    }
}

fn init_tracing() -> anyhow::Result<tracing_appender::non_blocking::WorkerGuard> {
    let log_path = default_log_path();
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let log_directory = log_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Log path is missing a parent directory"))?;
    let log_file_name = log_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("Log path is missing a file name"))?;

    let file_appender = tracing_appender::rolling::never(log_directory, log_file_name);
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let env_filter =
        tracing_subscriber::EnvFilter::from_default_env().add_directive("maabarium=info".parse()?);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_writer(std::io::stdout),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(true)
                .with_writer(file_writer),
        )
        .init();

    info!(log_path = %log_path.display(), "Tracing initialized");
    Ok(guard)
}

fn select_evaluator(
    blueprint: &BlueprintFile,
) -> anyhow::Result<Arc<dyn maabarium_core::evaluator::Evaluator>> {
    EvaluatorRegistry::build(blueprint).map_err(Into::into)
}

fn normalize_db_path(db: &str) -> String {
    if db.trim().is_empty() || db == "data/maabarium.db" {
        default_db_path().display().to_string()
    } else {
        db.to_owned()
    }
}

fn prompt_for_api_key(provider: &str) -> anyhow::Result<String> {
    print!("Enter API key for {provider}: ");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let value = input.trim().to_owned();
    if value.is_empty() {
        anyhow::bail!("API key cannot be empty");
    }
    Ok(value)
}

fn render_experiment_status_line(
    experiment: &maabarium_core::persistence::PersistedExperiment,
) -> String {
    format!(
        "- iter={} blueprint={} score={:.3} duration={}ms outcome={} error={}",
        experiment.iteration,
        experiment.blueprint_name,
        experiment.weighted_total,
        experiment.duration_ms,
        format_promotion_outcome(experiment.promotion_outcome),
        experiment.error.clone().unwrap_or_else(|| "none".into())
    )
}

fn format_promotion_outcome(outcome: PromotionOutcome) -> &'static str {
    match outcome {
        PromotionOutcome::Unknown => "unknown",
        PromotionOutcome::Promoted => "promoted",
        PromotionOutcome::Rejected => "rejected",
        PromotionOutcome::Cancelled => "cancelled",
        PromotionOutcome::PromotionFailed => "promotion_failed",
    }
}

fn render_timing_summary(summary: &EngineTimingSummary) -> String {
    if summary.phase_totals.is_empty() && summary.proposal_failure_counters.is_empty() {
        return "Run timing summary: unavailable".to_owned();
    }

    let mut lines = vec![format!(
        "Run timing summary (run_id={}, iterations={})",
        summary.run_id, summary.completed_iterations,
    )];

    for (phase, timing) in &summary.phase_totals {
        let average_ms = if timing.count == 0 {
            0
        } else {
            timing.total_ms / timing.count
        };
        lines.push(format!(
            "- phase={} total={}ms avg={}ms max={}ms count={}",
            phase, timing.total_ms, average_ms, timing.max_ms, timing.count,
        ));
    }

    if !summary.iteration_durations_ms.is_empty() {
        let total_iterations_ms: u64 = summary.iteration_durations_ms.iter().sum();
        let average_iteration_ms =
            total_iterations_ms / summary.iteration_durations_ms.len() as u64;
        let max_iteration_ms = summary
            .iteration_durations_ms
            .iter()
            .copied()
            .max()
            .unwrap_or(0);
        lines.push(format!(
            "- iterations total={}ms avg={}ms max={}ms",
            total_iterations_ms, average_iteration_ms, max_iteration_ms,
        ));
    }

    if !summary.proposal_failure_counters.is_empty() {
        let total_failures = summary.proposal_failure_counters.values().sum::<u64>();
        lines.push(format!("- proposal_failures total={}", total_failures));
        for (counter_key, count) in &summary.proposal_failure_counters {
            lines.push(format!(
                "- proposal_failure counter={} count={}",
                counter_key, count
            ));
        }
    }

    lines.join("\n")
}

fn mask_secret(value: &str) -> String {
    let visible = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    if visible.is_empty() {
        return "[empty]".to_owned();
    }

    format!("****{}", visible)
}

// ============== Group Command Handlers ==============

/// Close group runs left active by a process that no longer exists.
fn reconcile_interrupted_runs(persistence: &Persistence) {
    let none_here = std::collections::HashSet::new();
    match persistence.reconcile_interrupted_group_runs(
        &none_here,
        &maabarium_core::group_runner::process_is_alive,
    ) {
        Ok(0) => {}
        Ok(closed) => eprintln!("Marked {closed} interrupted group run(s) as failed."),
        Err(error) => eprintln!("Could not check for interrupted group runs: {error}"),
    }
}

async fn handle_group_command(cmd: &GroupCommands) -> anyhow::Result<()> {
    match cmd {
        GroupCommands::Create { name, description } => {
            if name.trim().is_empty() {
                anyhow::bail!("Group name cannot be empty");
            }
            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            let now = chrono::Utc::now().to_rfc3339();
            let group = maabarium_core::run_groups::RunGroup {
                name: name.clone(),
                description: description.clone().unwrap_or_default(),
                created_at: now,
                blueprints: vec![],
                execution_mode: maabarium_core::run_groups::ExecutionMode::Sequential,
                schedule: None,
                telegram_enabled: true,
            };
            persistence.create_group(&group)?;
            println!("Created run group: {name}");
            println!("{}", crate::render::render_group_card(&group));
            Ok(())
        }
        GroupCommands::Add {
            name,
            blueprint_path,
            blueprint_name,
        } => {
            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            let group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;

            // Derive blueprint name from path or use provided name
            let bp_name = blueprint_name.clone().unwrap_or_else(|| {
                blueprint_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("blueprint")
                    .to_owned()
            });

            let next_order = group.blueprints.len() as u32;
            let entry = maabarium_core::run_groups::GroupBlueprintEntry {
                blueprint_name: bp_name.clone(),
                blueprint_path: blueprint_path.display().to_string(),
                sort_order: next_order,
                notifications_enabled: true,
            };
            persistence.add_blueprint_to_group(name, &entry)?;
            println!(
                "Added '{}' -> {} (order: {})",
                bp_name,
                blueprint_path.display(),
                next_order
            );
            Ok(())
        }
        GroupCommands::List => {
            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            let groups = persistence.list_groups()?;
            if groups.is_empty() {
                println!("No run groups configured.");
                println!("  Create one with: maabarium group create <name>");
                return Ok(());
            }
            for group in &groups {
                println!("{}", crate::render::render_group_card(group));
                println!();
            }
            Ok(())
        }
        GroupCommands::Show { name } => {
            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            let group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;
            println!("{}", crate::render::render_group_card(&group));

            // Show recent runs
            let runs = persistence.list_group_runs(name, 5)?;
            if !runs.is_empty() {
                println!("\nRecent runs:");
                println!("{}", crate::render::render_recent_group_runs(&runs));
            }
            Ok(())
        }
        GroupCommands::Remove { name, blueprint } => {
            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            reconcile_interrupted_runs(&persistence);
            if let Some(bp_name) = blueprint {
                persistence.remove_blueprint_from_group(name, bp_name)?;
                println!("Removed blueprint '{bp_name}' from group '{name}'");
            } else {
                persistence.delete_group(name)?;
                println!("Deleted group '{name}'");
            }
            Ok(())
        }
        GroupCommands::Run {
            name,
            db,
            mode,
            yes,
        } => {
            let db_path = db
                .clone()
                .unwrap_or_else(|| default_db_path().display().to_string());
            let persistence = Arc::new(Persistence::open(&db_path)?);
            let group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;

            let cancel = CancellationToken::new();
            let cancel_clone = cancel.clone();
            tokio::spawn(async move {
                if let Ok(()) = tokio::signal::ctrl_c().await {
                    eprintln!("\nReceived Ctrl-C, shutting down...");
                    cancel_clone.cancel();
                }
            });

            // Determine execution mode
            let mut force_mode = mode
                .as_deref()
                .map(maabarium_core::run_groups::ExecutionMode::from_str)
                .flatten();

            if force_mode.is_none() {
                let hp = maabarium_core::run_groups::HardwareProfile::detect();
                if hp.parallel_feasible(group.blueprints.len()) {
                    println!("Hardware profile suggests parallel execution is feasible.");
                    println!(
                        "  CPUs: {} | Memory: {:.1} GB | GPU: {}",
                        hp.logical_cpus,
                        hp.total_memory_gb,
                        if hp.gpu_available { "yes" } else { "no" }
                    );
                    if !yes {
                        eprint!("Run in parallel mode? [y/N]: ");
                        std::io::stdout().flush()?;
                        let mut input = String::new();
                        std::io::stdin().read_line(&mut input)?;
                        if input.trim().eq_ignore_ascii_case("y") {
                            println!("Running in parallel mode.");
                            force_mode = Some(maabarium_core::run_groups::ExecutionMode::Parallel);
                        } else {
                            println!("Falling back to sequential mode.");
                            force_mode =
                                Some(maabarium_core::run_groups::ExecutionMode::Sequential);
                        }
                    } else {
                        println!("Running in parallel mode (auto-confirmed).");
                        force_mode = Some(maabarium_core::run_groups::ExecutionMode::Parallel);
                    }
                } else {
                    println!(
                        "Running in sequential mode (parallel not feasible on this hardware)."
                    );
                    force_mode = Some(maabarium_core::run_groups::ExecutionMode::Sequential);
                }
            }

            let runner = maabarium_core::group_runner::GroupRunner::new(
                persistence.clone(),
                db_path,
                cancel,
            );

            match runner.run_group(&group, force_mode).await {
                Ok(run) => {
                    println!("\nGroup run completed:");
                    println!("  Run ID: {}", run.id);
                    println!("  Status: {:?}", run.status);
                    if let Some(summary) = &run.summary {
                        println!("  Summary: {summary}");
                    }
                }
                Err(e) => {
                    eprintln!("Group run failed: {e}");
                }
            }
            Ok(())
        }
        GroupCommands::RunAll { db, mode, yes: _ } => {
            let db_path = db
                .clone()
                .unwrap_or_else(|| default_db_path().display().to_string());
            let persistence = Arc::new(Persistence::open(&db_path)?);
            let groups = persistence.list_groups()?;
            if groups.is_empty() {
                println!("No run groups configured.");
                return Ok(());
            }
            let force_mode = mode
                .as_deref()
                .and_then(maabarium_core::run_groups::ExecutionMode::from_str);
            for group in groups {
                if group.blueprints.is_empty() {
                    println!("Skipping '{}' because it has no blueprints.", group.name);
                    continue;
                }
                let runner = maabarium_core::group_runner::GroupRunner::new(
                    persistence.clone(),
                    db_path.clone(),
                    CancellationToken::new(),
                );
                let run = runner
                    .run_group(&group, force_mode)
                    .await
                    .map_err(|e| anyhow::anyhow!("{e}"))?;
                println!(
                    "Ran '{}' -> {:?}{}",
                    group.name,
                    run.status,
                    run.summary
                        .as_ref()
                        .map(|summary| format!(" ({summary})"))
                        .unwrap_or_default()
                );
            }
            Ok(())
        }
        GroupCommands::RunDue { db, yes: _ } => {
            let db_path = db
                .clone()
                .unwrap_or_else(|| default_db_path().display().to_string());
            let persistence = Arc::new(Persistence::open(&db_path)?);
            reconcile_interrupted_runs(&persistence);
            let now = chrono::Utc::now();
            let due_groups = persistence
                .list_groups()?
                .into_iter()
                .filter(|group| {
                    group
                        .schedule
                        .as_ref()
                        .is_some_and(|schedule| schedule.is_due(&now))
                })
                .collect::<Vec<_>>();
            if due_groups.is_empty() {
                println!("No scheduled run groups are due.");
                return Ok(());
            }
            for group in due_groups {
                if group.blueprints.is_empty() {
                    println!(
                        "Skipping due group '{}' because it has no blueprints.",
                        group.name
                    );
                    continue;
                }
                let runner = maabarium_core::group_runner::GroupRunner::new(
                    persistence.clone(),
                    db_path.clone(),
                    CancellationToken::new(),
                );
                let run = runner
                    .triggered_by_schedule()
                    .run_group(&group, None)
                    .await
                    .map_err(|e| anyhow::anyhow!("{e}"))?;
                println!(
                    "Ran due group '{}' -> {:?}{}",
                    group.name,
                    run.status,
                    run.summary
                        .as_ref()
                        .map(|summary| format!(" ({summary})"))
                        .unwrap_or_default()
                );
            }
            Ok(())
        }
        GroupCommands::Status { name, db } => {
            let persistence = Persistence::open(db)?;
            reconcile_interrupted_runs(&persistence);
            let group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;
            println!("{}", crate::render::render_group_card(&group));
            let runs = persistence.list_group_runs(name, 1)?;
            if let Some(run) = runs.first() {
                let experiments = persistence.list_group_run_experiments(&run.id)?;
                println!("\nLatest run:");
                println!(
                    "{}",
                    crate::render::render_group_run_details(run, &experiments)
                );
            } else {
                println!("\nNo runs recorded yet.");
            }
            Ok(())
        }
        GroupCommands::Results {
            name,
            db,
            run,
            live: _,
        } => {
            let persistence = Persistence::open(db)?;
            let _group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;

            let runs = if let Some(run_id) = run {
                vec![
                    persistence
                        .get_group_run(run_id)?
                        .ok_or_else(|| anyhow::anyhow!("Run '{run_id}' not found"))?,
                ]
            } else {
                persistence.list_group_runs(name, 5)?
            };

            for run_entry in &runs {
                let experiments = persistence.list_group_run_experiments(&run_entry.id)?;
                println!(
                    "{}",
                    crate::render::render_group_run_details(run_entry, &experiments)
                );
                println!();
            }
            Ok(())
        }
        GroupCommands::Inspect { name, db, run } => {
            let persistence = Persistence::open(db)?;
            let group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;

            let runs = if let Some(run_id) = run {
                vec![
                    persistence
                        .get_group_run(run_id)?
                        .ok_or_else(|| anyhow::anyhow!("Run '{run_id}' not found"))?,
                ]
            } else {
                persistence.list_group_runs(name, 3)?
            };

            println!("{}", crate::render::header(&group.name));
            for run_entry in &runs {
                let experiments = persistence.list_group_run_experiments(&run_entry.id)?;
                println!(
                    "{}",
                    crate::render::render_group_run_details(run_entry, &experiments)
                );
                println!();

                // Show detailed experiment info for each completed experiment
                for exp in &experiments {
                    if let Some(exp_id) = exp.experiment_id {
                        if let Some(persisted) = persistence.experiment_by_id(exp_id)? {
                            println!(
                                "  Experiment #{}: score={:.3} duration={}ms outcome={:?}",
                                persisted.id,
                                persisted.weighted_total,
                                persisted.duration_ms,
                                persisted.promotion_outcome,
                            );
                            for metric in &persisted.metrics {
                                println!(
                                    "    {} = {:.3} (w={})",
                                    metric.name, metric.value, metric.weight
                                );
                            }
                            if let Some(branch) = &persisted.promoted_branch_name {
                                println!("    Branch: {branch}");
                            }
                            println!();
                        }
                    }
                }
            }
            Ok(())
        }
        GroupCommands::Schedule {
            name,
            cron,
            enable: _,
            disable,
            at,
        } => {
            use maabarium_core::run_groups::{ScheduleKind, ScheduledRun};

            let persistence = Persistence::open(&default_db_path().display().to_string())?;
            let _group = persistence
                .get_group(name)?
                .ok_or_else(|| anyhow::anyhow!("Group '{name}' not found"))?;
            let enabled = if *disable { false } else { true };

            let kind = if let Some(cron_expr) = cron {
                ScheduleKind::Cron {
                    expression: cron_expr.trim().to_owned(),
                }
            } else if let Some(dt) = at {
                ScheduleKind::OneShot {
                    datetime: dt.trim().to_owned(),
                }
            } else {
                anyhow::bail!("Must specify --cron <expr> or --at <datetime>");
            };
            let schedule = ScheduledRun::new_validated(kind, enabled, &chrono::Utc::now())
                .map_err(|e| anyhow::anyhow!(e))?;
            persistence.update_group_schedule(name, &schedule)?;
            println!(
                "Updated schedule for group '{name}': {}",
                schedule.kind.describe()
            );
            Ok(())
        }
    }
}

async fn handle_telegram_command(cmd: &TelegramCommands) -> anyhow::Result<()> {
    let persistence = Persistence::open(&default_db_path().display().to_string())?;
    match cmd {
        TelegramCommands::Setup { chat_id } => {
            let mut token = String::new();
            io::stdin().take(4096).read_to_string(&mut token)?;
            let bot_token = token.trim();
            if bot_token.trim().is_empty() || chat_id.trim().is_empty() {
                anyhow::bail!("Bot token and chat ID cannot be empty");
            }
            let config = TelegramConfig {
                bot_token: bot_token.to_owned(),
                chat_id: chat_id.clone(),
                enabled: true,
                notify_on_start: true,
                notify_on_complete: true,
                notify_on_error: true,
                notify_on_promotion: true,
                updated_at: chrono::Utc::now().to_rfc3339(),
            };
            persistence.telegram_set_config(&config)?;
            println!("Telegram notifications configured.");
            println!("  Chat ID: {chat_id}");
            println!("  Notifications are enabled.");
            println!("  Use 'maabarium telegram test' to send a test message.");
            Ok(())
        }
        TelegramCommands::Test => {
            let config = persistence.telegram_get_config()?.ok_or_else(|| {
                anyhow::anyhow!("Telegram not configured. Use 'maabarium telegram setup' first.")
            })?;
            let notifier = maabarium_core::telegram::TelegramNotifier::new(&config);
            match notifier
                .send_message("Hello from Maabarium! This is a test notification.")
                .await
            {
                Ok(true) => println!("Test notification sent successfully!"),
                Ok(false) => eprintln!("Telegram notifier is not enabled."),
                Err(e) => eprintln!("Failed to send test notification: {e}"),
            }
            Ok(())
        }
        TelegramCommands::Status => {
            match persistence.telegram_get_config()? {
                Some(config) => {
                    println!("Telegram Configuration:");
                    println!("  Chat ID: {}", config.chat_id);
                    println!("  Enabled: {}", config.enabled);
                    println!("  Notify on start: {}", config.notify_on_start);
                    println!("  Notify on complete: {}", config.notify_on_complete);
                    println!("  Notify on error: {}", config.notify_on_error);
                    println!("  Notify on promotion: {}", config.notify_on_promotion);
                    println!("  Last updated: {}", config.updated_at);
                }
                None => {
                    println!("Telegram is not configured.");
                    println!(
                        "  Pipe the token into 'maabarium telegram setup --chat-id <id>' to configure."
                    );
                }
            }
            Ok(())
        }
        TelegramCommands::Disable => {
            let mut config = persistence
                .telegram_get_config()?
                .ok_or_else(|| anyhow::anyhow!("Telegram not configured."))?;
            config.enabled = false;
            config.updated_at = chrono::Utc::now().to_rfc3339();
            persistence.telegram_set_config(&config)?;
            println!("Telegram notifications disabled.");
            Ok(())
        }
        TelegramCommands::Enable => {
            let mut config = persistence
                .telegram_get_config()?
                .ok_or_else(|| anyhow::anyhow!("Telegram not configured."))?;
            config.enabled = true;
            config.updated_at = chrono::Utc::now().to_rfc3339();
            persistence.telegram_set_config(&config)?;
            println!("Telegram notifications enabled.");
            Ok(())
        }
    }
}

fn render_get_key_message(
    store: &dyn ApiKeyStore,
    provider: &str,
    reveal: bool,
) -> Result<String, maabarium_core::error::SecretError> {
    match store.get_api_key(provider)? {
        Some(secret) if reveal => Ok(secret.expose_secret().to_owned()),
        Some(secret) => Ok(mask_secret(secret.expose_secret())),
        None => Ok(format!("No API key stored for provider: {provider}")),
    }
}

fn render_delete_key_message(
    store: &dyn ApiKeyStore,
    provider: &str,
) -> Result<String, maabarium_core::error::SecretError> {
    if store.delete_api_key(provider)? {
        Ok(format!("Deleted API key for provider: {provider}"))
    } else {
        Ok(format!("No API key stored for provider: {provider}"))
    }
}

fn render_readiness_report(report: &maabarium_core::ReadinessReport, workspace: Option<&str>) {
    println!("Maabarium Setup Readiness Report");
    println!("===============================");
    if let Some(ws) = workspace {
        println!("Workspace: {ws}");
    }
    println!();

    for item in &report.items {
        let icon = match item.status {
            ReadinessLevel::Ready => "[OK]",
            ReadinessLevel::Optional => "[--]",
            ReadinessLevel::NeedsAction => "[!!]",
        };
        println!("{} {}", icon, item.title);
        println!("   {}", item.summary);
        if let Some(fix) = &item.fix_label {
            println!("   Action: {fix}");
        }
        if let Some(hint) = &item.fix_hint {
            println!("   Hint: {hint}");
        }
        println!();
    }

    if report.is_ready() {
        println!("Status: READY - All checks passed.");
    } else {
        let count = report.needs_attention().len();
        println!("Status: NEEDS ATTENTION - {count} item(s) require fixes.");
    }
}

fn render_workspace_analysis(analysis: &maabarium_core::WorkspaceAnalysis) {
    println!("\nWorkspace Analysis: {}", analysis.path);
    println!("  {}", analysis.project_summary);
    if let Some(lang) = &analysis.language {
        println!("  Language: {lang}");
    }
    if let Some(cmd) = &analysis.test_command {
        println!("  Test command: {cmd}");
    }
    if !analysis.suggested_target_files.is_empty() {
        println!(
            "  Suggested targets: {}",
            analysis.suggested_target_files.join(", ")
        );
    }
    if analysis.has_ci_config {
        println!("  CI configuration detected");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maabarium_core::{
        error::SecretError,
        evaluator::MetricScore,
        persistence::{PersistedExperiment, PromotionOutcome},
    };
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MockStore {
        entries: RefCell<HashMap<String, String>>,
    }

    impl ApiKeyStore for MockStore {
        fn set_api_key(&self, provider: &str, api_key: SecretString) -> Result<(), SecretError> {
            self.entries
                .borrow_mut()
                .insert(provider.to_owned(), api_key.expose_secret().to_owned());
            Ok(())
        }

        fn get_api_key(&self, provider: &str) -> Result<Option<SecretString>, SecretError> {
            Ok(self
                .entries
                .borrow()
                .get(provider)
                .cloned()
                .map(SecretString::from))
        }

        fn delete_api_key(&self, provider: &str) -> Result<bool, SecretError> {
            Ok(self.entries.borrow_mut().remove(provider).is_some())
        }
    }

    #[test]
    fn keys_get_uses_masking_by_default() {
        let store = MockStore::default();
        store
            .set_api_key("openai", SecretString::from("secret-1234".to_owned()))
            .expect("secret should be stored");

        let rendered =
            render_get_key_message(&store, "openai", false).expect("message should render");
        assert_eq!(rendered, "****1234");
    }

    #[test]
    fn keys_delete_reports_missing_or_deleted_entries() {
        let store = MockStore::default();
        let missing = render_delete_key_message(&store, "openai").expect("message should render");
        assert_eq!(missing, "No API key stored for provider: openai");

        store
            .set_api_key("openai", SecretString::from("secret-1234".to_owned()))
            .expect("secret should be stored");
        let deleted = render_delete_key_message(&store, "openai").expect("message should render");
        assert_eq!(deleted, "Deleted API key for provider: openai");
    }

    #[test]
    fn renders_status_lines_with_promotion_outcome() {
        let line = render_experiment_status_line(&PersistedExperiment {
            id: 42,
            iteration: 7,
            blueprint_name: "status-demo".into(),
            proposal_summary: "summary".into(),
            weighted_total: 0.912,
            duration_ms: 14,
            error: None,
            promotion_outcome: PromotionOutcome::Promoted,
            promoted_branch_name: None,
            promoted_commit_oid: None,
            promoted_target_branch_name: None,
            created_at: "2026-03-25T00:00:00Z".into(),
            metrics: vec![MetricScore {
                name: "quality".into(),
                value: 0.912,
                weight: 1.0,
            }],
            research: None,
            lora: None,
        });

        assert!(line.contains("outcome=promoted"));
        assert!(line.contains("error=none"));
    }

    #[test]
    fn formats_all_known_promotion_outcomes() {
        assert_eq!(
            format_promotion_outcome(PromotionOutcome::Unknown),
            "unknown"
        );
        assert_eq!(
            format_promotion_outcome(PromotionOutcome::Promoted),
            "promoted"
        );
        assert_eq!(
            format_promotion_outcome(PromotionOutcome::Rejected),
            "rejected"
        );
        assert_eq!(
            format_promotion_outcome(PromotionOutcome::Cancelled),
            "cancelled"
        );
        assert_eq!(
            format_promotion_outcome(PromotionOutcome::PromotionFailed),
            "promotion_failed"
        );
    }

    #[test]
    fn renders_timing_summary_for_cli_output() {
        let mut summary = EngineTimingSummary {
            run_id: "abc12345".into(),
            completed_iterations: 2,
            ..EngineTimingSummary::default()
        };
        summary.phase_totals.insert(
            "applying".into(),
            maabarium_core::EnginePhaseTiming {
                count: 2,
                total_ms: 120,
                max_ms: 80,
            },
        );
        summary.iteration_durations_ms = vec![99, 83];
        summary.proposal_failure_counters.insert(
            "ollama:invalid_response.unified_diff.context_mismatch".into(),
            2,
        );

        let rendered = render_timing_summary(&summary);
        assert!(rendered.contains("run_id=abc12345"));
        assert!(rendered.contains("phase=applying total=120ms avg=60ms max=80ms count=2"));
        assert!(rendered.contains("iterations total=182ms avg=91ms max=99ms"));
        assert!(rendered.contains("proposal_failures total=2"));
        assert!(rendered.contains(
            "proposal_failure counter=ollama:invalid_response.unified_diff.context_mismatch count=2"
        ));
    }
}
