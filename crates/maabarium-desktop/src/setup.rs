use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use maabarium_core::{GitDependencyStatus, ReadinessLevel, ReadinessScanner};

const SUPPORTED_UPDATE_CHANNELS: &[&str] = &["stable", "beta"];
const OLLAMA_MACOS_APP_PATH: &str = "/Applications/Ollama.app";
const OLLAMA_MACOS_RESOURCE_CLI_PATH: &str =
    "/Applications/Ollama.app/Contents/Resources/ollama";
const OLLAMA_MACOS_APP_BINARY_PATH: &str = "/Applications/Ollama.app/Contents/MacOS/Ollama";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStrategy {
    Local,
    Remote,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchSearchMode {
    BraveApi,
    DuckduckgoScrape,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProviderSetup {
    pub provider_id: String,
    pub label: String,
    pub endpoint: Option<String>,
    pub model_name: Option<String>,
    #[serde(default)]
    pub available_model_names: Vec<String>,
    pub fallback_only: bool,
    pub configured: bool,
    #[serde(default = "default_provider_supported")]
    pub supported: bool,
    #[serde(default)]
    pub support_summary: Option<String>,
}

fn default_provider_supported() -> bool {
    true
}

fn provider_support(provider_id: &str) -> (bool, Option<&'static str>) {
    match provider_id {
        "anthropic" => (true, Some("Uses Anthropic's native Messages API.")),
        "gemini" => (true, Some("Uses Gemini's native generateContent API.")),
        _ => (true, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptedRunNotice {
    pub blueprint_name: String,
    pub workspace_path: String,
    pub interrupted_at: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSetupState {
    pub guided_mode: bool,
    pub onboarding_completed: bool,
    pub runtime_strategy: Option<RuntimeStrategy>,
    pub research_search_mode: ResearchSearchMode,
    #[serde(default)]
    pub brave_search_configured: bool,
    pub workspace_path: Option<String>,
    pub selected_blueprint_path: Option<String>,
    pub selected_local_models: Vec<String>,
    pub remote_providers: Vec<RemoteProviderSetup>,
    pub preferred_update_channel: Option<String>,
    pub remind_later_until: Option<String>,
    pub remind_later_version: Option<String>,
    pub last_setup_completed_at: Option<String>,
    pub interrupted_run_notice: Option<InterruptedRunNotice>,
    #[serde(default)]
    pub environment_profile: Option<String>,
}

impl Default for DesktopSetupState {
    fn default() -> Self {
        Self {
            guided_mode: true,
            onboarding_completed: false,
            runtime_strategy: None,
            research_search_mode: ResearchSearchMode::DuckduckgoScrape,
            brave_search_configured: false,
            workspace_path: None,
            selected_blueprint_path: None,
            selected_local_models: Vec::new(),
            remote_providers: default_remote_provider_setups(),
            preferred_update_channel: None,
            remind_later_until: None,
            remind_later_version: None,
            last_setup_completed_at: None,
            interrupted_run_notice: None,
            environment_profile: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelInfo {
    pub name: String,
    pub size_label: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub command_available: bool,
    pub launch_at_login_supported: bool,
    pub install_command: Option<String>,
    pub start_command: Option<String>,
    pub status_detail: String,
    pub models: Vec<OllamaModelInfo>,
    pub recommended_models: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessStatus {
    Ready,
    NeedsAttention,
    Optional,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessItem {
    pub id: String,
    pub title: String,
    pub status: ReadinessStatus,
    pub summary: String,
    pub action_label: String,
    pub last_checked_at_epoch_ms: u64,
}

pub fn default_remote_provider_setups() -> Vec<RemoteProviderSetup> {
    vec![
        RemoteProviderSetup {
            provider_id: "openai".to_owned(),
            label: "OpenAI".to_owned(),
            endpoint: Some("https://api.openai.com/v1".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: None,
        },
        RemoteProviderSetup {
            provider_id: "anthropic".to_owned(),
            label: "Anthropic".to_owned(),
            endpoint: Some("https://api.anthropic.com".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: Some("Uses Anthropic's native Messages API.".to_owned()),
        },
        RemoteProviderSetup {
            provider_id: "gemini".to_owned(),
            label: "Gemini".to_owned(),
            endpoint: Some("https://generativelanguage.googleapis.com".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: Some("Uses Gemini's native generateContent API.".to_owned()),
        },
        RemoteProviderSetup {
            provider_id: "groq".to_owned(),
            label: "Groq".to_owned(),
            endpoint: Some("https://api.groq.com/openai/v1".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: None,
        },
        RemoteProviderSetup {
            provider_id: "openrouter".to_owned(),
            label: "OpenRouter".to_owned(),
            endpoint: Some("https://openrouter.ai/api/v1".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: None,
        },
        RemoteProviderSetup {
            provider_id: "deepseek".to_owned(),
            label: "DeepSeek".to_owned(),
            endpoint: Some("https://api.deepseek.com".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: None,
        },
        RemoteProviderSetup {
            provider_id: "xai".to_owned(),
            label: "xAI".to_owned(),
            endpoint: Some("https://api.x.ai/v1".to_owned()),
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: None,
        },
        RemoteProviderSetup {
            provider_id: "custom".to_owned(),
            label: "OpenAI-Compatible Custom".to_owned(),
            endpoint: None,
            model_name: None,
            available_model_names: Vec::new(),
            fallback_only: false,
            configured: false,
            supported: true,
            support_summary: Some(
                "Use this when your provider exposes an OpenAI-compatible /chat/completions API."
                    .to_owned(),
            ),
        },
    ]
}

pub fn load_desktop_setup(path: &Path) -> DesktopSetupState {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<DesktopSetupState>(&content).ok())
        .map(normalize_desktop_setup)
        .unwrap_or_default()
}

pub fn save_desktop_setup(
    path: &Path,
    setup: &DesktopSetupState,
) -> Result<DesktopSetupState, String> {
    let normalized = normalize_desktop_setup(setup.clone());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create setup directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|error| format!("Failed to serialize desktop setup state: {error}"))?;
    fs::write(path, content).map_err(|error| {
        format!(
            "Failed to write desktop setup state to {}: {error}",
            path.display()
        )
    })?;

    Ok(normalized)
}

pub fn build_ollama_status() -> OllamaStatus {
    let recommended_models = recommended_ollama_models();
    let install_command = if cfg!(target_os = "macos") {
        Some("brew install --cask ollama".to_owned())
    } else {
        None
    };
    let start_command = if cfg!(target_os = "macos") {
        Some("open -a Ollama".to_owned())
    } else {
        None
    };
    let command_path = find_ollama_command();
    let app_installed = ollama_app_installed();
    let installed = command_path.is_some() || app_installed;
    let running = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 11434)),
        Duration::from_millis(300),
    )
    .is_ok();
    let (models, model_discovery_error) = if !running {
        (Vec::new(), None)
    } else {
        match command_path.as_ref() {
            Some(path) => match read_ollama_models(path) {
                Ok(models) => (models, None),
                Err(error) => (Vec::new(), Some(error)),
            },
            None => (
                Vec::new(),
                Some(
                    "Maabarium could not locate the Ollama CLI binary to inspect installed models."
                        .to_owned(),
                ),
            ),
        }
    };

    let status_detail = if !installed {
        "Ollama is not installed on this machine yet.".to_owned()
    } else if !running {
        "Ollama appears to be installed, but the local service is not responding on port 11434."
            .to_owned()
    } else if let Some(error) = model_discovery_error {
        format!(
            "Ollama is running, but Maabarium could not inspect local models yet: {error}"
        )
    } else if models.is_empty() {
        "Ollama is running, but no local models were detected yet.".to_owned()
    } else {
        format!(
            "Ollama is running with {} installed local model(s).",
            models.len()
        )
    };

    OllamaStatus {
        installed,
        running,
        command_available: command_path.is_some(),
        launch_at_login_supported: cfg!(target_os = "macos"),
        install_command,
        start_command,
        status_detail,
        models,
        recommended_models,
    }
}

pub fn install_ollama() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err(
            "Guided Ollama installation is currently implemented only for macOS.".to_owned(),
        );
    }

    let brew = find_command("brew").ok_or_else(|| {
        "Homebrew is required for guided Ollama installation. Install Homebrew first, then retry."
            .to_owned()
    })?;
    let status = Command::new(brew)
        .args(["install", "--cask", "ollama"])
        .status()
        .map_err(|error| format!("Failed to launch Homebrew for Ollama installation: {error}"))?;

    if !status.success() {
        return Err(format!("Ollama installation exited with status {status}"));
    }

    Ok(())
}

pub fn start_ollama() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let status = Command::new("open")
            .args(["-a", "Ollama"])
            .status()
            .map_err(|error| format!("Failed to launch Ollama: {error}"))?;
        if !status.success() {
            return Err(format!("Launching Ollama exited with status {status}"));
        }
        return Ok(());
    }

    Err("Starting Ollama is currently implemented only for macOS desktop builds.".to_owned())
}

pub fn pull_recommended_ollama_models() -> Result<(), String> {
    let command_path = find_ollama_command().ok_or_else(|| {
        if ollama_app_installed() {
            "Ollama appears to be installed, but Maabarium could not locate the CLI binary needed to pull models."
                .to_owned()
        } else {
            "Ollama is not installed on this machine yet.".to_owned()
        }
    })?;

    let running = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 11434)),
        Duration::from_millis(300),
    )
    .is_ok();

    if !running {
        return Err(
            "Ollama must be running before recommended models can be pulled.".to_owned(),
        );
    }

    let installed_models = read_ollama_models(&command_path).map_err(|error| {
        format!(
            "Failed to inspect installed Ollama models before pulling recommendations: {error}"
        )
    })?;
    let missing_models = recommended_ollama_models()
        .into_iter()
        .filter(|model_name| {
            !installed_models
                .iter()
                .any(|installed_model| installed_model.name == *model_name)
        })
        .collect::<Vec<_>>();

    if missing_models.is_empty() {
        return Ok(());
    }

    for model_name in missing_models {
        let status = Command::new(&command_path)
            .args(["pull", model_name.as_str()])
            .status()
            .map_err(|error| format!("Failed to launch Ollama model pull for '{model_name}': {error}"))?;

        if !status.success() {
            return Err(format!(
                "Ollama model pull for '{model_name}' exited with status {status}"
            ));
        }
    }

    Ok(())
}

pub fn build_readiness_items(
    setup: &DesktopSetupState,
    fallback_workspace: Option<&str>,
    _git_status: &GitDependencyStatus,
    _ollama: &OllamaStatus,
    updater_configured: bool,
    brave_search_configured: bool,
    active_research_workflow: bool,
    db_path: &Path,
    log_path: &Path,
) -> Vec<ReadinessItem> {
    let now = current_epoch_ms();
    let runtime_strategy = setup.runtime_strategy;
    let workspace_path = setup
        .workspace_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(fallback_workspace.filter(|value| !value.trim().is_empty()));
    let strategy_label = runtime_strategy.map(|strategy| match strategy {
        RuntimeStrategy::Local => "local",
        RuntimeStrategy::Remote => "remote",
        RuntimeStrategy::Mixed => "mixed",
    });
    let shared_report = ReadinessScanner::scan(workspace_path, strategy_label);
    let mut items = shared_report
        .items
        .into_iter()
        .map(|item| ReadinessItem {
            id: item.id,
            title: item.title,
            status: match item.status {
                ReadinessLevel::Ready => ReadinessStatus::Ready,
                ReadinessLevel::NeedsAction => ReadinessStatus::NeedsAttention,
                ReadinessLevel::Optional => ReadinessStatus::Optional,
            },
            summary: item.summary,
            action_label: item.fix_label.unwrap_or_else(|| "Inspect".to_owned()),
            last_checked_at_epoch_ms: now,
        })
        .collect::<Vec<_>>();

    let research_search_item = ReadinessItem {
        id: "research_search".to_owned(),
        title: "Research Search".to_owned(),
        status: if matches!(setup.research_search_mode, ResearchSearchMode::DuckduckgoScrape) {
            ReadinessStatus::Ready
        } else if brave_search_configured {
            ReadinessStatus::Ready
        } else if active_research_workflow {
            ReadinessStatus::NeedsAttention
        } else {
            ReadinessStatus::Optional
        },
        summary: if matches!(setup.research_search_mode, ResearchSearchMode::DuckduckgoScrape) {
            "Free DuckDuckGo scraping is enabled for research discovery. It works out of the box, but it is unofficial and can be slower, less stable, or blocked without warning."
                .to_owned()
        } else if brave_search_configured {
            "Brave Search discovery is configured in the OS keychain for research workflows."
                .to_owned()
        } else if active_research_workflow {
            "No Brave Search API key is configured. General Research workflows can still run, but discovery-backed searches will fail until BRAVE_SEARCH_API_KEY is stored in setup."
                .to_owned()
        } else {
            "Optional for internet-backed research workflows. Add a Brave Search API key if you want automatic discovery queries and source harvesting."
                .to_owned()
        },
        action_label: "Configure Search".to_owned(),
        last_checked_at_epoch_ms: now,
    };

    let updates_item = ReadinessItem {
        id: "updates".to_owned(),
        title: "Updates".to_owned(),
        status: if updater_configured {
            ReadinessStatus::Ready
        } else {
            ReadinessStatus::NeedsAttention
        },
        summary: if updater_configured {
            "Desktop updater manifest and public key are configured.".to_owned()
        } else {
            "Updater environment is not configured for this session.".to_owned()
        },
        action_label: "Review Updates".to_owned(),
        last_checked_at_epoch_ms: now,
    };

    if let Some(models_index) = items.iter().position(|item| item.id == "models") {
        items.insert(models_index, research_search_item);
    } else {
        items.push(research_search_item);
    }

    if let Some(diagnostics_index) = items.iter().position(|item| item.id == "diagnostics") {
        items.insert(diagnostics_index, updates_item);
        if let Some(diagnostics) = items.iter_mut().find(|item| item.id == "diagnostics") {
            diagnostics.summary = format!(
                "Database: {} | Logs: {}",
                db_path.display(),
                log_path.display()
            );
            diagnostics.status = if parent_directory_available(db_path)
                && parent_directory_available(log_path)
            {
                ReadinessStatus::Ready
            } else {
                ReadinessStatus::NeedsAttention
            };
            diagnostics.action_label = "Inspect Paths".to_owned();
        }
    } else {
        items.push(updates_item);
        items.push(ReadinessItem {
            id: "diagnostics".to_owned(),
            title: "Diagnostics".to_owned(),
            status: if parent_directory_available(db_path) && parent_directory_available(log_path)
            {
                ReadinessStatus::Ready
            } else {
                ReadinessStatus::NeedsAttention
            },
            summary: format!(
                "Database: {} | Logs: {}",
                db_path.display(),
                log_path.display()
            ),
            action_label: "Inspect Paths".to_owned(),
            last_checked_at_epoch_ms: now,
        });
    }

    items
}

fn normalize_desktop_setup(mut setup: DesktopSetupState) -> DesktopSetupState {
    setup.workspace_path = setup
        .workspace_path
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup.selected_blueprint_path = setup
        .selected_blueprint_path
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup.selected_local_models = setup
        .selected_local_models
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect();

    let defaults = default_remote_provider_setups();
    let mut merged = Vec::with_capacity(defaults.len());
    for mut provider in defaults {
        if let Some(existing) = setup
            .remote_providers
            .iter()
            .find(|candidate| candidate.provider_id == provider.provider_id)
        {
            provider.endpoint = existing.endpoint.clone().or(provider.endpoint);
            provider.model_name = existing.model_name.clone();
            provider.available_model_names = existing.available_model_names.clone();
            provider.fallback_only = existing.fallback_only;
            provider.configured = existing.configured;
        }

        let (supported, support_summary) = provider_support(&provider.provider_id);
        provider.supported = supported;
        provider.support_summary = support_summary.map(str::to_owned);

        provider.endpoint = provider
            .endpoint
            .take()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        provider.model_name = provider
            .model_name
            .take()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        provider.available_model_names = provider
            .available_model_names
            .into_iter()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .fold(Vec::new(), |mut names, value| {
                if !names.iter().any(|existing| existing == &value) {
                    names.push(value);
                }
                names
            });
        merged.push(provider);
    }
    setup.remote_providers = merged;
    setup.preferred_update_channel = setup
        .preferred_update_channel
        .take()
        .and_then(|value| normalize_update_channel(&value));
    setup.remind_later_until = setup
        .remind_later_until
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup.remind_later_version = setup
        .remind_later_version
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup.last_setup_completed_at = setup
        .last_setup_completed_at
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup.interrupted_run_notice = setup.interrupted_run_notice.take().and_then(|notice| {
        let blueprint_name = notice.blueprint_name.trim().to_owned();
        let workspace_path = notice.workspace_path.trim().to_owned();
        let interrupted_at = notice.interrupted_at.trim().to_owned();
        let reason = notice
            .reason
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());

        if blueprint_name.is_empty() || workspace_path.is_empty() || interrupted_at.is_empty() {
            None
        } else {
            Some(InterruptedRunNotice {
                blueprint_name,
                workspace_path,
                interrupted_at,
                reason,
            })
        }
    });
    setup.environment_profile = setup
        .environment_profile
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    setup
}

fn normalize_update_channel(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if SUPPORTED_UPDATE_CHANNELS.contains(&normalized.as_str()) {
        Some(normalized)
    } else {
        None
    }
}

fn recommended_ollama_models() -> Vec<String> {
    vec![
        "qwen2.5-coder:7b".to_owned(),
        "llama3.1:8b".to_owned(),
        "mistral:7b".to_owned(),
    ]
}

fn find_command(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|directory| {
            let candidate = directory.join(name);
            if candidate.exists() {
                Some(candidate)
            } else {
                None
            }
        })
    })
}

fn find_ollama_command() -> Option<PathBuf> {
    find_command("ollama").or_else(ollama_app_command)
}

fn ollama_app_installed() -> bool {
    cfg!(target_os = "macos") && Path::new(OLLAMA_MACOS_APP_PATH).exists()
}

fn ollama_app_command() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }

    [OLLAMA_MACOS_RESOURCE_CLI_PATH, OLLAMA_MACOS_APP_BINARY_PATH]
        .into_iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}

fn read_ollama_models(command_path: &Path) -> Result<Vec<OllamaModelInfo>, String> {
    let output = Command::new(command_path)
        .arg("list")
        .output()
        .map_err(|error| {
            format!(
                "failed to launch '{}' for model discovery: {error}",
                command_path.display()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        return Err(format!(
            "'{} list' did not succeed: {detail}",
            command_path.display()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    Ok(stdout
        .lines()
        .skip_while(|line| line.trim_start().starts_with("NAME"))
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }

            let parts = trimmed.split_whitespace().collect::<Vec<_>>();
            let name = parts.first()?.to_string();
            let size_label = parts
                .iter()
                .rev()
                .find(|part| part.ends_with('B'))
                .map(|part| (*part).to_string());

            Some(OllamaModelInfo {
                name,
                size_label,
                modified_at: None,
            })
        })
        .collect())
}

fn parent_directory_available(path: &Path) -> bool {
    path.parent().is_some_and(|parent| parent.exists())
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
