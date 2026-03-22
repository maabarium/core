use clap::{Parser, Subcommand, ValueEnum};
use maabarium_core::{
    default_db_path, default_log_path, ApiKeyStore, BlueprintFile, CodeEvaluator, Engine, EngineConfig,
    ExportFormat, LoraEvaluator, Persistence, PromptEvaluator, SecretStore,
};
use maabarium_core::llm::provider_from_models;
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
    Delete {
        provider: String,
    },
}

#[derive(Clone, Debug, ValueEnum)]
enum CliExportFormat {
    Json,
    Csv,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _log_guard = init_tracing()?;

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

            let evaluator = select_evaluator(&blueprint)?;
            let config = EngineConfig {
                blueprint,
                db_path: normalize_db_path(&db),
            };
            let engine = Engine::new(config, evaluator, cancel)
                .map_err(|e| anyhow::anyhow!("Engine init error: {e}"))?;
            engine
                .run()
                .await
                .map_err(|e| anyhow::anyhow!("Engine error: {e}"))?;
        }
        Commands::Status { db } => {
            let persistence = Persistence::open(&normalize_db_path(&db))?;
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
                println!("{}", render_get_key_message(&secret_store, &provider, reveal)?);
            }
            KeysAction::Delete { provider } => {
                let secret_store = SecretStore::new();
                println!("{}", render_delete_key_message(&secret_store, &provider)?);
            }
        },
    }

    Ok(())
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
    let env_filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive("maabarium=info".parse()?);

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
    if is_lora_blueprint(blueprint) {
        Ok(Arc::new(LoraEvaluator::new(blueprint.metrics.metrics.clone())))
    } else if is_prompt_blueprint(blueprint) {
        let provider = provider_from_models(&blueprint.models, None)?;
        Ok(Arc::new(PromptEvaluator::new(
            provider,
            blueprint.metrics.metrics.clone(),
        )))
    } else {
        Ok(Arc::new(CodeEvaluator::new(
            blueprint.metrics.metrics.clone(),
            blueprint.domain.target_files.clone(),
            blueprint.constraints.require_tests_pass,
            blueprint.domain.repo_path.clone(),
        )))
    }
}

fn normalize_db_path(db: &str) -> String {
    if db.trim().is_empty() || db == "data/maabarium.db" {
        default_db_path().display().to_string()
    } else {
        db.to_owned()
    }
}

fn is_prompt_blueprint(blueprint: &BlueprintFile) -> bool {
    blueprint.domain.language.eq_ignore_ascii_case("markdown")
        || blueprint.domain.language.eq_ignore_ascii_case("prompt")
        || blueprint
            .blueprint
            .name
            .to_ascii_lowercase()
            .contains("prompt")
        || blueprint
            .domain
            .target_files
            .iter()
            .any(|pattern| pattern.ends_with(".md") || pattern.contains(".md"))
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

fn mask_secret(value: &str) -> String {
    let visible = value.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<String>();
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
    use maabarium_core::error::SecretError;
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

        let rendered = render_get_key_message(&store, "openai", false).expect("message should render");
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
}
