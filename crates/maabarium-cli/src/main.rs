use clap::{Parser, Subcommand, ValueEnum};
use maabarium_core::{
    BlueprintFile, CodeEvaluator, Engine, EngineConfig, ExportFormat, LoraEvaluator, Persistence,
};
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;

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
        #[arg(long, default_value = "maabarium.db")]
        db: String,
    },
    /// Show current status
    Status {
        #[arg(long, default_value = "maabarium.db")]
        db: String,
    },
    /// Export experiment history
    Export {
        #[arg(long, default_value = "maabarium.db")]
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
}

#[derive(Subcommand)]
enum KeysAction {
    /// Set an API key for a provider
    Set { provider: String },
}

#[derive(Clone, Debug, ValueEnum)]
enum CliExportFormat {
    Json,
    Csv,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("maabarium=info".parse()?),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Run { blueprint_path, db } => {
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

            let evaluator = select_evaluator(&blueprint);
            let config = EngineConfig {
                blueprint,
                db_path: db,
            };
            let engine = Engine::new(config, evaluator, cancel)
                .map_err(|e| anyhow::anyhow!("Engine init error: {e}"))?;
            engine
                .run()
                .await
                .map_err(|e| anyhow::anyhow!("Engine error: {e}"))?;
        }
        Commands::Status { db } => {
            let persistence = Persistence::open(&db)?;
            let experiments = persistence.recent_experiments(5)?;
            if experiments.is_empty() {
                println!("No experiments recorded in {db}");
            } else {
                println!("Recent experiments from {db}:");
                for experiment in experiments {
                    println!(
                        "- iter={} blueprint={} score={:.3} duration={}ms error={}",
                        experiment.iteration,
                        experiment.blueprint_name,
                        experiment.weighted_total,
                        experiment.duration_ms,
                        experiment.error.unwrap_or_else(|| "none".into())
                    );
                }
            }
        }
        Commands::Export { db, format, output } => {
            let persistence = Persistence::open(&db)?;
            let export_format = match format {
                CliExportFormat::Json => ExportFormat::Json,
                CliExportFormat::Csv => ExportFormat::Csv,
            };
            persistence.export(export_format, &output)?;
            println!("Exported experiment history to {}", output.display());
        }
        Commands::Keys { action } => match action {
            KeysAction::Set { provider } => {
                println!("Setting key for provider: {provider}");
                println!("(Key management not yet implemented)");
            }
        },
    }

    Ok(())
}

fn select_evaluator(blueprint: &BlueprintFile) -> Arc<dyn maabarium_core::evaluator::Evaluator> {
    if is_lora_blueprint(blueprint) {
        Arc::new(LoraEvaluator::new(blueprint.metrics.metrics.clone()))
    } else {
        Arc::new(CodeEvaluator::new(
            blueprint.metrics.metrics.clone(),
            blueprint.domain.target_files.clone(),
            blueprint.constraints.require_tests_pass,
        ))
    }
}

fn is_lora_blueprint(blueprint: &BlueprintFile) -> bool {
    blueprint
        .blueprint
        .name
        .to_ascii_lowercase()
        .contains("lora")
        || blueprint.domain.language.eq_ignore_ascii_case("lora")
        || blueprint
            .domain
            .target_files
            .iter()
            .any(|pattern| pattern.ends_with(".safetensors") || pattern.contains("adapter"))
}
