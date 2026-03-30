use clap::{Parser, Subcommand, ValueEnum};
use maabarium_core::{
    ApiKeyStore, BlueprintFile, Engine, EngineConfig, EngineTimingSummary, EvaluatorRegistry,
    ExportFormat, GitDependencyEnsureOutcome, Persistence, PromotionOutcome, SecretStore,
    UpdaterConfiguration, check_for_cli_update, default_db_path, default_log_path,
    ensure_git_dependency, install_cli_update,
};
use maabarium_core::error::UpdaterError;
use secrecy::{ExposeSecret, SecretString};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;
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
    /// Inspect and update the CLI binary itself
    #[command(name = "self")]
    SelfManage {
        #[command(subcommand)]
        action: SelfAction,
    },
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
        let average_iteration_ms = total_iterations_ms / summary.iteration_durations_ms.len() as u64;
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
            lines.push(format!("- proposal_failure counter={} count={}", counter_key, count));
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
        assert_eq!(format_promotion_outcome(PromotionOutcome::Unknown), "unknown");
        assert_eq!(format_promotion_outcome(PromotionOutcome::Promoted), "promoted");
        assert_eq!(format_promotion_outcome(PromotionOutcome::Rejected), "rejected");
        assert_eq!(format_promotion_outcome(PromotionOutcome::Cancelled), "cancelled");
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
