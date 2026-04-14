//! Setup wizard module for guided onboarding and readiness checking.
//!
//! Provides unified setup orchestration logic shared by CLI and desktop:
//! - Dependency readiness scanning with one-click fix actions
//! - Provider connection validation via test requests
//! - Workspace auto-detection (repo health, test commands, language, target files)
//! - Saved environment profiles (local-only, mixed, research-heavy)

use serde::{Deserialize, Serialize};
use secrecy::ExposeSecret;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::error::SecretError;
use crate::llm::{anthropic, gemini};
use crate::secrets::{ApiKeyStore, SecretStore};

const OPENAI_COMPATIBLE_PROVIDER_IDS: &[&str] = &[
    "openai",
    "custom",
    "deepseek",
    "groq",
    "openrouter",
    "xai",
];

const NATIVE_PROVIDER_IDS: &[&str] = &["anthropic", "gemini"];
const DEFAULT_PROVIDER_VALIDATION_TIMEOUT_SECS: u64 = 10;
const CUSTOM_PROVIDER_VALIDATION_TIMEOUT_SECS: u64 = 30;

fn is_openai_compatible_provider(provider_id: &str) -> bool {
    OPENAI_COMPATIBLE_PROVIDER_IDS.contains(&provider_id)
}

fn is_native_provider(provider_id: &str) -> bool {
    NATIVE_PROVIDER_IDS.contains(&provider_id)
}

fn provider_validation_timeout(provider_id: &str) -> Duration {
    Duration::from_secs(match provider_id {
        "custom" => CUSTOM_PROVIDER_VALIDATION_TIMEOUT_SECS,
        _ => DEFAULT_PROVIDER_VALIDATION_TIMEOUT_SECS,
    })
}

fn model_list_contains_model(models: &[serde_json::Value], target_model: &str) -> bool {
    let target_model = target_model.trim();
    if target_model.is_empty() {
        return false;
    }

    models.iter().any(|model| {
        model
            .get("id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|model_id| model_id == target_model)
    })
}

fn configured_supported_remote_providers(secret_store: &SecretStore) -> Vec<&'static str> {
    OPENAI_COMPATIBLE_PROVIDER_IDS
        .iter()
        .chain(NATIVE_PROVIDER_IDS.iter())
        .copied()
        .filter(|provider_id| {
            secret_store
                .get_api_key(provider_id)
                .ok()
                .is_some_and(|key| key.is_some())
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Readiness scanning
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessLevel {
    Ready,
    NeedsAction,
    Optional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessItem {
    pub id: String,
    pub title: String,
    pub status: ReadinessLevel,
    pub summary: String,
    pub fix_label: Option<String>,
    pub fix_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReport {
    pub items: Vec<ReadinessItem>,
}

impl ReadinessReport {
    pub fn is_ready(&self) -> bool {
        self.items.iter().all(|item| {
            item.status == ReadinessLevel::Ready || item.status == ReadinessLevel::Optional
        })
    }

    pub fn needs_attention(&self) -> Vec<&ReadinessItem> {
        self.items
            .iter()
            .filter(|item| item.status == ReadinessLevel::NeedsAction)
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixTarget {
    Git,
    OllamaInstall,
    OllamaStart,
    ProviderValidation { provider_id: String },
    WorkspaceDetect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixOutcome {
    pub target: FixTarget,
    pub success: bool,
    pub message: String,
}

pub struct ReadinessScanner;

impl ReadinessScanner {
    pub fn scan(workspace: Option<&str>, runtime_strategy: Option<&str>) -> ReadinessReport {
        let mut items = Vec::new();

        // 1. Git
        items.push(Self::check_git());

        // 2. Workspace
        items.push(Self::check_workspace(workspace));

        // 3. Local runtime (Ollama)
        let is_remote_only = runtime_strategy == Some("remote");
        items.push(Self::check_local_runtime(is_remote_only));

        // 4. Remote providers
        items.push(Self::check_remote_providers(runtime_strategy));

        // 5. Models
        items.push(Self::check_models(runtime_strategy));

        // 6. Database & logs
        items.push(Self::check_diagnostics());

        ReadinessReport { items }
    }

    fn check_git() -> ReadinessItem {
        let status = crate::runtime_dependencies::git_dependency_status();
        let level = if status.installed {
            ReadinessLevel::Ready
        } else {
            ReadinessLevel::NeedsAction
        };
        let fix_label = if status.installed {
            None
        } else if status.auto_install_supported {
            Some("Install Git".to_owned())
        } else {
            Some("Install Manually".to_owned())
        };
        ReadinessItem {
            id: "git".to_owned(),
            title: "Git".to_owned(),
            status: level,
            summary: status.status_detail,
            fix_label,
            fix_hint: status.install_command,
        }
    }

    fn check_workspace(workspace: Option<&str>) -> ReadinessItem {
        let path = workspace
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);

        let exists = path.as_ref().is_some_and(|p| p.exists());
        let level = if exists {
            ReadinessLevel::Ready
        } else {
            ReadinessLevel::NeedsAction
        };
        let summary = match &path {
            Some(p) if exists => format!("Workspace: {}", p.display()),
            Some(p) => format!("Workspace path does not exist: {}", p.display()),
            None => "No workspace selected. Choose a repository or project directory.".to_owned(),
        };
        ReadinessItem {
            id: "workspace".to_owned(),
            title: "Workspace".to_owned(),
            status: level,
            summary,
            fix_label: if exists {
                None
            } else {
                Some("Choose Workspace".to_owned())
            },
            fix_hint: None,
        }
    }

    fn check_local_runtime(is_remote_only: bool) -> ReadinessItem {
        let ollama = crate::setup_wizard::ollama_status();
        let level = if is_remote_only {
            ReadinessLevel::Optional
        } else if ollama.installed && ollama.running {
            ReadinessLevel::Ready
        } else {
            ReadinessLevel::NeedsAction
        };
        let fix_label = if level == ReadinessLevel::Optional || level == ReadinessLevel::Ready {
            None
        } else if !ollama.installed {
            Some("Install Ollama".to_owned())
        } else {
            Some("Start Ollama".to_owned())
        };
        ReadinessItem {
            id: "local_runtime".to_owned(),
            title: "Local Runtime (Ollama)".to_owned(),
            status: level,
            summary: ollama.status_detail,
            fix_label,
            fix_hint: ollama.install_command,
        }
    }

    fn check_remote_providers(runtime_strategy: Option<&str>) -> ReadinessItem {
        let secret_store = SecretStore::new();
        let configured = configured_supported_remote_providers(&secret_store);

        let level = match runtime_strategy {
            Some("local") => ReadinessLevel::Optional,
            Some("remote") | Some("mixed") if configured.is_empty() => ReadinessLevel::NeedsAction,
            Some("remote") | Some("mixed") => ReadinessLevel::Ready,
            _ => {
                if configured.is_empty() {
                    ReadinessLevel::NeedsAction
                } else {
                    ReadinessLevel::Ready
                }
            }
        };

        let summary = if configured.is_empty() {
            "No remote provider API keys found in the OS keychain.".to_owned()
        } else {
            format!("Configured providers: {}", configured.join(", "))
        };

        ReadinessItem {
            id: "remote_providers".to_owned(),
            title: "Remote Providers".to_owned(),
            status: level,
            summary,
            fix_label: if level == ReadinessLevel::NeedsAction {
                Some("Configure Provider".to_owned())
            } else {
                None
            },
            fix_hint: None,
        }
    }

    fn check_models(runtime_strategy: Option<&str>) -> ReadinessItem {
        let ollama = ollama_status();
        let has_local = !ollama.models.is_empty();

        let secret_store = SecretStore::new();
        let has_remote = !configured_supported_remote_providers(&secret_store).is_empty();

        let level = match runtime_strategy {
            Some("local") if !has_local => ReadinessLevel::NeedsAction,
            Some("local") => ReadinessLevel::Ready,
            Some("remote") if !has_remote => ReadinessLevel::NeedsAction,
            Some("remote") => ReadinessLevel::Ready,
            Some("mixed") if !has_local && !has_remote => ReadinessLevel::NeedsAction,
            Some("mixed") => ReadinessLevel::Ready,
            _ => {
                if has_local || has_remote {
                    ReadinessLevel::Ready
                } else {
                    ReadinessLevel::NeedsAction
                }
            }
        };

        let mut parts = Vec::new();
        if has_local {
            parts.push(format!("{} local model(s)", ollama.models.len()));
        }
        if has_remote {
            parts.push("remote API models available".to_owned());
        }
        let summary = if parts.is_empty() {
            "No models detected. Install Ollama models or configure a remote provider.".to_owned()
        } else {
            parts.join(", ")
        };

        ReadinessItem {
            id: "models".to_owned(),
            title: "Models".to_owned(),
            status: level,
            summary,
            fix_label: if level == ReadinessLevel::NeedsAction {
                Some("Choose Models".to_owned())
            } else {
                None
            },
            fix_hint: None,
        }
    }

    fn check_diagnostics() -> ReadinessItem {
        let db_path = crate::persistence::default_db_path();
        let log_path = crate::logging::default_log_path();
        let db_ok = db_path.parent().is_some_and(|p| p.exists());
        let log_ok = log_path.parent().is_some_and(|p| p.exists());

        ReadinessItem {
            id: "diagnostics".to_owned(),
            title: "Diagnostics".to_owned(),
            status: if db_ok && log_ok {
                ReadinessLevel::Ready
            } else {
                ReadinessLevel::NeedsAction
            },
            summary: format!(
                "DB: {} | Log: {}",
                db_path.display(),
                log_path.display()
            ),
            fix_label: None,
            fix_hint: None,
        }
    }
}

// ---------------------------------------------------------------------------
// One-click fix actions
// ---------------------------------------------------------------------------

pub fn apply_git_fix() -> Result<FixOutcome, String> {
    match crate::runtime_dependencies::ensure_git_dependency() {
        Ok(crate::runtime_dependencies::GitDependencyEnsureOutcome::AlreadyInstalled) => {
            Ok(FixOutcome {
                target: FixTarget::Git,
                success: true,
                message: "Git is already installed.".to_owned(),
            })
        }
        Ok(crate::runtime_dependencies::GitDependencyEnsureOutcome::Installed { installer }) => {
            Ok(FixOutcome {
                target: FixTarget::Git,
                success: true,
                message: format!("Git installed via {}.", installer.label()),
            })
        }
        Ok(crate::runtime_dependencies::GitDependencyEnsureOutcome::InstallationStarted {
            message,
            ..
        }) => Ok(FixOutcome {
            target: FixTarget::Git,
            success: false,
            message,
        }),
        Err(e) => Ok(FixOutcome {
            target: FixTarget::Git,
            success: false,
            message: e,
        }),
    }
}

pub fn apply_all_fixes(_workspace: Option<&str>) -> Vec<FixOutcome> {
    let mut outcomes = Vec::new();

    // Git
    if let Ok(outcome) = apply_git_fix() {
        outcomes.push(outcome);
    }

    // Ollama install
    let ollama = ollama_status();
    if !ollama.installed {
        match install_ollama() {
            Ok(()) => outcomes.push(FixOutcome {
                target: FixTarget::OllamaInstall,
                success: true,
                message: "Ollama installed successfully.".to_owned(),
            }),
            Err(e) => outcomes.push(FixOutcome {
                target: FixTarget::OllamaInstall,
                success: false,
                message: e,
            }),
        }
    }

    // Ollama start
    if ollama.installed && !ollama.running {
        match start_ollama() {
            Ok(()) => outcomes.push(FixOutcome {
                target: FixTarget::OllamaStart,
                success: true,
                message: "Ollama started.".to_owned(),
            }),
            Err(e) => outcomes.push(FixOutcome {
                target: FixTarget::OllamaStart,
                success: false,
                message: e,
            }),
        }
    }

    if let Some(workspace_path) = _workspace.map(str::trim).filter(|path| !path.is_empty()) {
        let analysis = analyze_workspace(workspace_path);
        outcomes.push(FixOutcome {
            target: FixTarget::WorkspaceDetect,
            success: analysis.exists,
            message: if analysis.exists {
                format!("Workspace analysis: {}", analysis.project_summary)
            } else {
                format!("Workspace analysis failed: {}", analysis.project_summary)
            },
        });
    }

    outcomes
}

// ---------------------------------------------------------------------------
// Ollama status helpers (lightweight, avoids desktop dependency)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub command_available: bool,
    pub install_command: Option<String>,
    pub start_command: Option<String>,
    pub status_detail: String,
    pub models: Vec<String>,
}

pub fn ollama_status() -> OllamaStatus {
    let command_path = find_ollama_command();
    let installed = command_path.is_some() || ollama_app_installed();
    let running = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 11434)),
        Duration::from_millis(300),
    )
    .is_ok();

    let models = if running {
        command_path
            .as_ref()
            .map(|p| read_ollama_model_names(p))
            .unwrap_or_default()
    } else {
        Vec::new()
    };

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

    let status_detail = if !installed {
        "Ollama is not installed.".to_owned()
    } else if !running {
        "Ollama is installed but not running on port 11434.".to_owned()
    } else if models.is_empty() {
        "Ollama is running, but no models detected.".to_owned()
    } else {
        format!("Ollama is running with {} model(s).", models.len())
    };

    OllamaStatus {
        installed,
        running,
        command_available: command_path.is_some(),
        install_command,
        start_command,
        status_detail,
        models,
    }
}

fn find_ollama_command() -> Option<PathBuf> {
    find_command("ollama").or_else(ollama_app_command)
}

fn find_command(name: &str) -> Option<PathBuf> {
    let path_value = std::env::var_os("PATH")?;
    std::env::split_paths(&path_value).find_map(|dir| {
        let candidate = dir.join(name);
        if candidate.is_file() {
            Some(candidate)
        } else {
            None
        }
    })
}

fn ollama_app_installed() -> bool {
    cfg!(target_os = "macos") && Path::new("/Applications/Ollama.app").exists()
}

fn ollama_app_command() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    [
        "/Applications/Ollama.app/Contents/Resources/ollama",
        "/Applications/Ollama.app/Contents/MacOS/Ollama",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|candidate| candidate.exists())
}

fn read_ollama_model_names(command_path: &Path) -> Vec<String> {
    let Ok(output) = Command::new(command_path).arg("list").output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .skip_while(|line| line.trim_start().starts_with("NAME"))
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.split_whitespace().next().map(str::to_owned)
        })
        .collect()
}

pub fn install_ollama() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Guided Ollama installation is currently macOS only.".to_owned());
    }
    let brew = find_command("brew").ok_or_else(|| {
        "Homebrew is required. Install it first: https://brew.sh".to_owned()
    })?;
    let status = Command::new(brew)
        .args(["install", "--cask", "ollama"])
        .status()
        .map_err(|e| format!("Failed to launch Homebrew: {e}"))?;
    if !status.success() {
        return Err(format!("Ollama install exited with status {status}"));
    }
    Ok(())
}

pub fn start_ollama() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let status = Command::new("open")
            .args(["-a", "Ollama"])
            .status()
            .map_err(|e| format!("Failed to launch Ollama: {e}"))?;
        if !status.success() {
            return Err(format!("Launching Ollama exited with status {status}"));
        }
        return Ok(());
    }
    Err("Starting Ollama is currently macOS only.".to_owned())
}

// ---------------------------------------------------------------------------
// Provider validation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidationResult {
    pub provider_id: String,
    pub success: bool,
    pub latency_ms: u64,
    pub model_count: Option<usize>,
    #[serde(default)]
    pub available_models: Vec<String>,
    pub error: Option<String>,
    pub diagnosis: Option<String>,
}

pub async fn validate_provider_connection(
    provider_id: &str,
    endpoint: &str,
    api_key: Option<&str>,
    test_model: Option<&str>,
) -> ProviderValidationResult {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if provider_id.is_empty() {
        return ProviderValidationResult {
            provider_id,
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("Provider id is required.".to_owned()),
            diagnosis: Some("Choose a provider preset before validating.".to_owned()),
        };
    }

    if endpoint.trim().is_empty() {
        return ProviderValidationResult {
            provider_id,
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("Provider endpoint is required.".to_owned()),
            diagnosis: Some("Enter the provider base URL before validating.".to_owned()),
        };
    }

    if !is_openai_compatible_provider(&provider_id) && !is_native_provider(&provider_id) {
        return ProviderValidationResult {
            provider_id,
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("Unsupported provider preset.".to_owned()),
            diagnosis: Some(
                "Use one of the supported OpenAI-compatible providers or Ollama.".to_owned(),
            ),
        };
    }

    let resolved_api_key = match api_key.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(value.to_owned()),
        None => match SecretStore::new().get_api_key(&provider_id) {
            Ok(Some(secret)) => Some(secret.expose_secret().to_owned()),
            Ok(None) => None,
            Err(error) => return ProviderValidationResult::from(error),
        },
    };

    if provider_id != "custom" && resolved_api_key.is_none() {
        return ProviderValidationResult {
            provider_id,
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("API key is missing.".to_owned()),
            diagnosis: Some(
                "Store the provider API key in setup before validating this connection."
                    .to_owned(),
            ),
        };
    }

    let client = reqwest::Client::builder()
        .timeout(provider_validation_timeout(&provider_id))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    if is_native_provider(&provider_id) {
        let test_model = test_model.map(str::trim).filter(|value| !value.is_empty());
        return match provider_id.as_str() {
            "anthropic" => {
                validate_anthropic_connection(
                    &client,
                    &provider_id,
                    endpoint,
                    resolved_api_key.as_deref(),
                    test_model,
                )
                .await
            }
            "gemini" => {
                validate_gemini_connection(
                    &client,
                    &provider_id,
                    endpoint,
                    resolved_api_key.as_deref(),
                    test_model,
                )
                .await
            }
            _ => unreachable!("native provider guard should be exhaustive"),
        };
    }

    let start = Instant::now();
    let endpoint = endpoint.trim_end_matches('/');

    #[derive(Deserialize)]
    struct OpenAIModelsResponse {
        #[serde(default)]
        data: Vec<serde_json::Value>,
    }

    let mut model_count = None;
    let mut available_models = Vec::new();
    let mut list_request = client.get(format!("{endpoint}/models"));
    if let Some(key) = resolved_api_key.as_deref() {
        list_request = list_request.bearer_auth(key);
    }
    match list_request.send().await {
        Ok(resp) if resp.status().is_success() => {
            let model_response = resp.json::<OpenAIModelsResponse>().await.ok();
            let listed_models = model_response.as_ref().map(|response| &response.data);
            model_count = model_response.as_ref().map(|response| response.data.len());
            available_models = listed_models
                .map(|models| {
                    models
                        .iter()
                        .filter_map(|model| {
                            model
                                .get("id")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_owned)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if let Some(model) = test_model
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .filter(|model| {
                    listed_models.is_some_and(|models| model_list_contains_model(models, model))
                })
            {
                let latency = start.elapsed().as_millis() as u64;
                let diagnosis = match model_count {
                    Some(count) => format!(
                        "Validated endpoint, found model '{model}', and listed {count} model(s)."
                    ),
                    None => format!("Validated endpoint and found model '{model}'."),
                };
                return ProviderValidationResult {
                    provider_id,
                    success: true,
                    latency_ms: latency,
                    model_count,
                    available_models,
                    error: None,
                    diagnosis: Some(diagnosis),
                };
            }
            if test_model.is_none() {
                let latency = start.elapsed().as_millis() as u64;
                let diagnosis = match model_count {
                    Some(count) => format!("Validated endpoint and listed {count} model(s)."),
                    None => format!("Validated endpoint in {latency}ms."),
                };
                return ProviderValidationResult {
                    provider_id,
                    success: true,
                    latency_ms: latency,
                    model_count,
                    available_models,
                    error: None,
                    diagnosis: Some(diagnosis),
                };
            }
        }
        Ok(resp) if matches!(resp.status().as_u16(), 404 | 405) => {}
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return ProviderValidationResult {
                provider_id,
                success: false,
                latency_ms: latency,
                model_count: None,
                available_models: Vec::new(),
                error: Some(format!("HTTP {status}: {text}")),
                diagnosis: Some(match status.as_u16() {
                    401 => {
                        "API key is invalid or missing. Check your key in the provider dashboard."
                            .to_owned()
                    }
                    404 => "Endpoint not found. Verify the provider base URL.".to_owned(),
                    429 => {
                        "Rate limited. The key works but has hit a quota or rate limit."
                            .to_owned()
                    }
                    _ => format!("Provider returned HTTP {status} while listing models."),
                }),
            };
        }
        Err(error) if error.is_timeout() || error.is_connect() => {
            let latency = start.elapsed().as_millis() as u64;
            return ProviderValidationResult {
                provider_id,
                success: false,
                latency_ms: latency,
                model_count: None,
                available_models,
                error: Some(format!("{error}")),
                diagnosis: Some(if error.is_timeout() {
                    "Connection timed out while checking the provider endpoint."
                } else {
                    "Could not connect to the provider endpoint. Verify the URL and network access."
                }
                .to_owned()),
            };
        }
        Err(_) => {}
    }

    // Try a minimal completion request
    let model = test_model.unwrap_or("gpt-4o-mini");
    let url = format!("{endpoint}/chat/completions");

    #[derive(Serialize)]
    struct TestRequest {
        model: String,
        messages: Vec<TestMessage>,
        max_tokens: u32,
    }

    #[derive(Serialize)]
    struct TestMessage {
        role: String,
        content: String,
    }

    let body = TestRequest {
        model: model.to_owned(),
        messages: vec![TestMessage {
            role: "user".into(),
            content: "Say OK".into(),
        }],
        max_tokens: 5,
    };

    let mut req = client.post(&url).json(&body);
    if let Some(key) = resolved_api_key.as_deref() {
        req = req.bearer_auth(key);
    }

    match req.send().await {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            if resp.status().is_success() {
                ProviderValidationResult {
                    provider_id,
                    success: true,
                    latency_ms: latency,
                    model_count,
                    available_models,
                    error: None,
                    diagnosis: Some(match model_count {
                        Some(count) => format!(
                            "Connected in {latency}ms and listed {count} model(s)."
                        ),
                        None => format!("Connected in {latency}ms"),
                    }),
                }
            } else {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                let diagnosis = if status.as_u16() == 401 {
                    "API key is invalid or missing. Check your key in the provider dashboard."
                        .to_owned()
                } else if status.as_u16() == 404 {
                    format!(
                        "Endpoint not found. Verify the URL is correct. Model '{model}' may not be available."
                    )
                } else if status.as_u16() == 429 {
                    "Rate limited. The key works but has hit a quota or rate limit.".to_owned()
                } else {
                    format!("Provider returned HTTP {status}")
                };
                ProviderValidationResult {
                    provider_id,
                    success: false,
                    latency_ms: latency,
                    model_count,
                    available_models,
                    error: Some(format!("HTTP {status}: {text}")),
                    diagnosis: Some(diagnosis),
                }
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            let diagnosis = if e.is_timeout() {
                "Connection timed out. Check the endpoint URL and network.".to_owned()
            } else if e.is_connect() {
                "Could not connect to the endpoint. Verify the URL and that the service is available.".to_owned()
            } else {
                format!("Request failed: {e}")
            };
            ProviderValidationResult {
                provider_id,
                success: false,
                latency_ms: latency,
                model_count: None,
                available_models,
                error: Some(format!("{e}")),
                diagnosis: Some(diagnosis),
            }
        }
    }
}

async fn validate_anthropic_connection(
    client: &reqwest::Client,
    provider_id: &str,
    endpoint: &str,
    api_key: Option<&str>,
    test_model: Option<&str>,
) -> ProviderValidationResult {
    let Some(api_key) = api_key else {
        return ProviderValidationResult {
            provider_id: provider_id.to_owned(),
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("API key is missing.".to_owned()),
            diagnosis: Some(
                "Store the provider API key in setup before validating this connection."
                    .to_owned(),
            ),
        };
    };
    let model = test_model.unwrap_or("claude-sonnet-4-5");
    let start = Instant::now();

    #[derive(Serialize)]
    struct TestRequest {
        model: String,
        max_tokens: u32,
        system: String,
        messages: Vec<TestMessage>,
    }

    #[derive(Serialize)]
    struct TestMessage {
        role: String,
        content: String,
    }

    let body = TestRequest {
        model: model.to_owned(),
        max_tokens: 8,
        system: "Reply with OK.".to_owned(),
        messages: vec![TestMessage {
            role: "user".to_owned(),
            content: "Say OK".to_owned(),
        }],
    };

    match client
        .post(anthropic::messages_url(endpoint))
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            if resp.status().is_success() {
                ProviderValidationResult {
                    provider_id: provider_id.to_owned(),
                    success: true,
                    latency_ms: latency,
                    model_count: None,
                    available_models: Vec::new(),
                    error: None,
                    diagnosis: Some(format!(
                        "Connected to Anthropic in {latency}ms using model '{model}'."
                    )),
                }
            } else {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                ProviderValidationResult {
                    provider_id: provider_id.to_owned(),
                    success: false,
                    latency_ms: latency,
                    model_count: None,
                    available_models: Vec::new(),
                    error: Some(format!("HTTP {status}: {text}")),
                    diagnosis: Some(match status.as_u16() {
                        400 => format!(
                            "Anthropic rejected the request. Verify the model name '{model}' and endpoint."
                        ),
                        401 | 403 => {
                            "API key is invalid or missing. Check your Anthropic key.".to_owned()
                        }
                        404 => "Endpoint not found. Verify the Anthropic base URL.".to_owned(),
                        429 => {
                            "Rate limited. The Anthropic key works but has hit a quota or rate limit."
                                .to_owned()
                        }
                        _ => format!("Anthropic returned HTTP {status}."),
                    }),
                }
            }
        }
        Err(error) => network_validation_error(provider_id, start, error),
    }
}

async fn validate_gemini_connection(
    client: &reqwest::Client,
    provider_id: &str,
    endpoint: &str,
    api_key: Option<&str>,
    test_model: Option<&str>,
) -> ProviderValidationResult {
    let Some(api_key) = api_key else {
        return ProviderValidationResult {
            provider_id: provider_id.to_owned(),
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some("API key is missing.".to_owned()),
            diagnosis: Some(
                "Store the provider API key in setup before validating this connection."
                    .to_owned(),
            ),
        };
    };
    let model = test_model.unwrap_or("gemini-2.5-flash");
    let start = Instant::now();

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TestRequest {
        contents: Vec<TestContent>,
        system_instruction: TestContent,
        generation_config: TestGenerationConfig,
    }

    #[derive(Serialize)]
    struct TestContent {
        #[serde(skip_serializing_if = "Option::is_none")]
        role: Option<String>,
        parts: Vec<TestPart>,
    }

    #[derive(Serialize)]
    struct TestPart {
        text: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TestGenerationConfig {
        temperature: f32,
        max_output_tokens: u32,
    }

    let body = TestRequest {
        contents: vec![TestContent {
            role: Some("user".to_owned()),
            parts: vec![TestPart {
                text: "Say OK".to_owned(),
            }],
        }],
        system_instruction: TestContent {
            role: None,
            parts: vec![TestPart {
                text: "Reply with OK.".to_owned(),
            }],
        },
        generation_config: TestGenerationConfig {
            temperature: 0.0,
            max_output_tokens: 8,
        },
    };

    match client
        .post(gemini::generate_content_url(endpoint, model))
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            if resp.status().is_success() {
                ProviderValidationResult {
                    provider_id: provider_id.to_owned(),
                    success: true,
                    latency_ms: latency,
                    model_count: None,
                    available_models: Vec::new(),
                    error: None,
                    diagnosis: Some(format!(
                        "Connected to Gemini in {latency}ms using model '{model}'."
                    )),
                }
            } else {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                ProviderValidationResult {
                    provider_id: provider_id.to_owned(),
                    success: false,
                    latency_ms: latency,
                    model_count: None,
                    available_models: Vec::new(),
                    error: Some(format!("HTTP {status}: {text}")),
                    diagnosis: Some(match status.as_u16() {
                        400 => format!(
                            "Gemini rejected the request. Verify the model name '{model}' and endpoint."
                        ),
                        401 | 403 => {
                            "API key is invalid or missing. Check your Gemini key.".to_owned()
                        }
                        404 => "Endpoint not found. Verify the Gemini base URL.".to_owned(),
                        429 => {
                            "Rate limited. The Gemini key works but has hit a quota or rate limit."
                                .to_owned()
                        }
                        _ => format!("Gemini returned HTTP {status}."),
                    }),
                }
            }
        }
        Err(error) => network_validation_error(provider_id, start, error),
    }
}

fn network_validation_error(
    provider_id: &str,
    start: Instant,
    error: reqwest::Error,
) -> ProviderValidationResult {
    let latency = start.elapsed().as_millis() as u64;
    let diagnosis = if error.is_timeout() {
        "Connection timed out. Check the endpoint URL and network.".to_owned()
    } else if error.is_connect() {
        "Could not connect to the endpoint. Verify the URL and that the service is available."
            .to_owned()
    } else {
        format!("Request failed: {error}")
    };

    ProviderValidationResult {
        provider_id: provider_id.to_owned(),
        success: false,
        latency_ms: latency,
        model_count: None,
        available_models: Vec::new(),
        error: Some(format!("{error}")),
        diagnosis: Some(diagnosis),
    }
}

pub async fn validate_ollama_connection(endpoint: &str) -> ProviderValidationResult {
    let client = reqwest::Client::new();
    let start = Instant::now();
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let latency = start.elapsed().as_millis() as u64;
            #[derive(Deserialize)]
            struct TagsResponse {
                models: Vec<TagModel>,
            }
            #[allow(dead_code)]
            #[derive(Deserialize)]
            struct TagModel {
                name: String,
            }
            let model_count = resp
                .json::<TagsResponse>()
                .await
                .ok()
                .map(|r| r.models.len());
            ProviderValidationResult {
                provider_id: "ollama".to_owned(),
                success: true,
                latency_ms: latency,
                model_count,
                available_models: Vec::new(),
                error: None,
                diagnosis: model_count.map(|n| format!("{n} model(s) available")),
            }
        }
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = resp.status();
            ProviderValidationResult {
                provider_id: "ollama".to_owned(),
                success: false,
                latency_ms: latency,
                model_count: None,
                available_models: Vec::new(),
                error: Some(format!("HTTP {status}")),
                diagnosis: Some("Ollama responded but with an error. Is it fully started?".to_owned()),
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            ProviderValidationResult {
                provider_id: "ollama".to_owned(),
                success: false,
                latency_ms: latency,
                model_count: None,
                available_models: Vec::new(),
                error: Some(format!("{e}")),
                diagnosis: Some(
                    "Cannot reach Ollama. Ensure it is installed and running on port 11434."
                        .to_owned(),
                ),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Workspace auto-detection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAnalysis {
    pub path: String,
    pub exists: bool,
    pub is_git_repo: bool,
    pub language: Option<String>,
    pub test_command: Option<String>,
    pub suggested_target_files: Vec<String>,
    pub has_ci_config: bool,
    pub project_summary: String,
}

pub fn analyze_workspace(path: &str) -> WorkspaceAnalysis {
    let dir = Path::new(path);
    if !dir.exists() || !dir.is_dir() {
        return WorkspaceAnalysis {
            path: path.to_owned(),
            exists: false,
            is_git_repo: false,
            language: None,
            test_command: None,
            suggested_target_files: Vec::new(),
            has_ci_config: false,
            project_summary: "Path does not exist or is not a directory.".to_owned(),
        };
    }

    let is_git_repo = dir.join(".git").exists();
    let has_cargo = dir.join("Cargo.toml").exists();
    let has_package_json = dir.join("package.json").exists();
    let has_pyproject = dir.join("pyproject.toml").exists() || dir.join("setup.py").exists();
    let has_go_mod = dir.join("go.mod").exists();

    let (language, test_command, target_files) = if has_cargo {
        (
            Some("rust".to_owned()),
            Some("cargo test".to_owned()),
            vec!["src/**/*.rs".to_owned()],
        )
    } else if has_package_json {
        let cmd = if dir.join("yarn.lock").exists() {
            "yarn test"
        } else if dir.join("pnpm-lock.yaml").exists() {
            "pnpm test"
        } else {
            "npm test"
        };
        (
            Some("javascript".to_owned()),
            Some(cmd.to_owned()),
            vec!["src/**/*.{js,ts,jsx,tsx}".to_owned()],
        )
    } else if has_pyproject {
        (
            Some("python".to_owned()),
            Some("pytest".to_owned()),
            vec!["**/*.py".to_owned()],
        )
    } else if has_go_mod {
        (
            Some("go".to_owned()),
            Some("go test ./...".to_owned()),
            vec!["**/*.go".to_owned()],
        )
    } else {
        (None, None, Vec::new())
    };

    let has_ci_config = dir.join(".github/workflows").exists()
        || dir.join(".gitlab-ci.yml").exists()
        || dir.join("Jenkinsfile").exists();

    let mut summary_parts = Vec::new();
    if is_git_repo {
        summary_parts.push("Git repository");
    } else {
        summary_parts.push("Not a git repository");
    }
    if let Some(lang) = &language {
        summary_parts.push(Box::leak(format!("detected language: {lang}").into_boxed_str()));
    }
    if has_ci_config {
        summary_parts.push("CI config found");
    }

    WorkspaceAnalysis {
        path: path.to_owned(),
        exists: true,
        is_git_repo,
        language,
        test_command,
        suggested_target_files: target_files,
        has_ci_config,
        project_summary: summary_parts.join(" | "),
    }
}

// ---------------------------------------------------------------------------
// Environment profiles
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvironmentProfile {
    LocalOnly,
    Mixed,
    ResearchHeavy,
}

impl EnvironmentProfile {
    pub fn label(self) -> &'static str {
        match self {
            Self::LocalOnly => "Local Only",
            Self::Mixed => "Mixed (Local + Remote)",
            Self::ResearchHeavy => "Research Heavy",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::LocalOnly => {
                "Uses only local Ollama models. No API keys required. Best for privacy and offline use."
            }
            Self::Mixed => {
                "Combines local Ollama models with remote API providers for stronger models when needed."
            }
            Self::ResearchHeavy => {
                "Prioritizes remote providers for research quality. Requires API keys for at least one provider."
            }
        }
    }

    pub fn runtime_strategy_label(self) -> &'static str {
        match self {
            Self::LocalOnly => "local",
            Self::Mixed => "mixed",
            Self::ResearchHeavy => "remote",
        }
    }
}

/// Detect the best profile based on available system resources.
pub fn detect_recommended_profile() -> EnvironmentProfile {
    let ollama = ollama_status();
    let has_local_models = ollama.installed && ollama.running && !ollama.models.is_empty();

    let secret_store = SecretStore::new();
    let has_remote = !configured_supported_remote_providers(&secret_store).is_empty();

    if has_local_models && has_remote {
        EnvironmentProfile::Mixed
    } else if has_remote {
        EnvironmentProfile::ResearchHeavy
    } else {
        EnvironmentProfile::LocalOnly
    }
}

/// Apply a profile to get default runtime strategy and research mode.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileConfig {
    pub runtime_strategy: String,
    pub research_search_mode: String,
    pub recommended_models: Vec<String>,
}

pub fn apply_profile(profile: EnvironmentProfile) -> ProfileConfig {
    match profile {
        EnvironmentProfile::LocalOnly => ProfileConfig {
            runtime_strategy: "local".to_owned(),
            research_search_mode: "duckduckgo_scrape".to_owned(),
            recommended_models: vec![
                "qwen2.5-coder:7b".to_owned(),
                "llama3.1:8b".to_owned(),
                "mistral:7b".to_owned(),
            ],
        },
        EnvironmentProfile::Mixed => ProfileConfig {
            runtime_strategy: "mixed".to_owned(),
            research_search_mode: "duckduckgo_scrape".to_owned(),
            recommended_models: vec![
                "qwen2.5-coder:7b".to_owned(),
                "llama3.1:8b".to_owned(),
            ],
        },
        EnvironmentProfile::ResearchHeavy => ProfileConfig {
            runtime_strategy: "remote".to_owned(),
            research_search_mode: "duckduckgo_scrape".to_owned(),
            recommended_models: Vec::new(),
        },
    }
}

// ---------------------------------------------------------------------------
// SecretError helper for provider validation
// ---------------------------------------------------------------------------

impl From<SecretError> for ProviderValidationResult {
    fn from(err: SecretError) -> Self {
        ProviderValidationResult {
            provider_id: "unknown".to_owned(),
            success: false,
            latency_ms: 0,
            model_count: None,
            available_models: Vec::new(),
            error: Some(format!("{err}")),
            diagnosis: Some("Could not read API key from keychain.".to_owned()),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_http_server(responses: Vec<&'static str>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer);
                stream.write_all(response.as_bytes()).unwrap();
                stream.flush().unwrap();
            }
        });
        format!("http://{}", address)
    }

    #[test]
    fn readiness_report_is_ready_when_all_ready_or_optional() {
        let report = ReadinessReport {
            items: vec![
                ReadinessItem {
                    id: "a".into(),
                    title: "A".into(),
                    status: ReadinessLevel::Ready,
                    summary: "ok".into(),
                    fix_label: None,
                    fix_hint: None,
                },
                ReadinessItem {
                    id: "b".into(),
                    title: "B".into(),
                    status: ReadinessLevel::Optional,
                    summary: "optional".into(),
                    fix_label: None,
                    fix_hint: None,
                },
            ],
        };
        assert!(report.is_ready());
        assert!(report.needs_attention().is_empty());
    }

    #[test]
    fn readiness_report_not_ready_when_needs_action() {
        let report = ReadinessReport {
            items: vec![
                ReadinessItem {
                    id: "a".into(),
                    title: "A".into(),
                    status: ReadinessLevel::Ready,
                    summary: "ok".into(),
                    fix_label: None,
                    fix_hint: None,
                },
                ReadinessItem {
                    id: "b".into(),
                    title: "B".into(),
                    status: ReadinessLevel::NeedsAction,
                    summary: "broken".into(),
                    fix_label: Some("Fix".into()),
                    fix_hint: None,
                },
            ],
        };
        assert!(!report.is_ready());
        assert_eq!(report.needs_attention().len(), 1);
    }

    #[test]
    fn workspace_analysis_detects_rust_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"test\"\n").unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();

        let analysis = analyze_workspace(root.to_str().unwrap());
        assert!(analysis.exists);
        assert_eq!(analysis.language.as_deref(), Some("rust"));
        assert_eq!(analysis.test_command.as_deref(), Some("cargo test"));
        assert_eq!(analysis.suggested_target_files, vec!["src/**/*.rs"]);
    }

    #[test]
    fn workspace_analysis_detects_python_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("pyproject.toml"), "[project]\nname = \"test\"\n").unwrap();

        let analysis = analyze_workspace(root.to_str().unwrap());
        assert!(analysis.exists);
        assert_eq!(analysis.language.as_deref(), Some("python"));
        assert_eq!(analysis.test_command.as_deref(), Some("pytest"));
    }

    #[test]
    fn workspace_analysis_detects_nonexistent_path() {
        let analysis = analyze_workspace("/nonexistent/path/xyz");
        assert!(!analysis.exists);
        assert!(analysis.language.is_none());
    }

    #[test]
    fn workspace_analysis_detects_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"test\"\n").unwrap();

        let analysis = analyze_workspace(root.to_str().unwrap());
        assert!(analysis.is_git_repo);
    }

    #[test]
    fn workspace_analysis_detects_ci_config() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".github/workflows")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"test\"\n").unwrap();

        let analysis = analyze_workspace(root.to_str().unwrap());
        assert!(analysis.has_ci_config);
    }

    #[test]
    fn profile_labels_are_nonempty() {
        for profile in [
            EnvironmentProfile::LocalOnly,
            EnvironmentProfile::Mixed,
            EnvironmentProfile::ResearchHeavy,
        ] {
            assert!(!profile.label().is_empty());
            assert!(!profile.description().is_empty());
            assert!(!profile.runtime_strategy_label().is_empty());
        }
    }

    #[test]
    fn apply_profile_local_only_gives_local_strategy() {
        let config = apply_profile(EnvironmentProfile::LocalOnly);
        assert_eq!(config.runtime_strategy, "local");
        assert!(!config.recommended_models.is_empty());
    }

    #[test]
    fn apply_profile_research_heavy_gives_remote_strategy() {
        let config = apply_profile(EnvironmentProfile::ResearchHeavy);
        assert_eq!(config.runtime_strategy, "remote");
        assert_eq!(config.research_search_mode, "duckduckgo_scrape");
    }

    #[test]
    fn readiness_item_ids_are_stable() {
        let ids = [
            ReadinessScanner::check_git().id,
            ReadinessScanner::check_workspace(None).id,
            ReadinessScanner::check_local_runtime(false).id,
            "remote_providers".to_owned(),
            "models".to_owned(),
            ReadinessScanner::check_diagnostics().id,
        ];

        assert!(ids.contains(&"git".to_owned()));
        assert!(ids.contains(&"workspace".to_owned()));
        assert!(ids.contains(&"local_runtime".to_owned()));
        assert!(ids.contains(&"remote_providers".to_owned()));
        assert!(ids.contains(&"models".to_owned()));
        assert!(ids.contains(&"diagnostics".to_owned()));
    }

    #[test]
    fn custom_provider_validation_timeout_is_longer_than_default() {
        assert_eq!(
            provider_validation_timeout("custom"),
            Duration::from_secs(CUSTOM_PROVIDER_VALIDATION_TIMEOUT_SECS)
        );
        assert_eq!(
            provider_validation_timeout("openai"),
            Duration::from_secs(DEFAULT_PROVIDER_VALIDATION_TIMEOUT_SECS)
        );
    }

    #[tokio::test]
    async fn provider_validation_supports_anthropic_native_test_requests() {
        let endpoint = spawn_http_server(vec![
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 84\r\n\r\n{\"content\":[{\"type\":\"text\",\"text\":\"OK\"}],\"usage\":{\"input_tokens\":4,\"output_tokens\":1}}",
        ]);

        let result =
            validate_provider_connection("anthropic", &endpoint, Some("test-key"), Some("claude-sonnet-4"))
                .await;

        assert!(result.success);
        assert!(result
            .diagnosis
            .as_deref()
            .unwrap_or_default()
            .contains("Connected to Anthropic"));
    }

    #[tokio::test]
    async fn provider_validation_supports_openai_compatible_test_requests() {
        let endpoint = spawn_http_server(vec![
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 25\r\n\r\n{\"data\":[{\"id\":\"model\"}]}",
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 45\r\n\r\n{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}",
        ]);

        let result = validate_provider_connection(
            "openai",
            &endpoint,
            Some("test-key"),
            Some("gpt-4o-mini"),
        )
        .await;

        assert!(result.success);
        assert_eq!(result.model_count, Some(1));
        assert_eq!(result.available_models, vec!["model".to_owned()]);
    }

    #[tokio::test]
    async fn provider_validation_succeeds_from_model_list_when_selected_model_exists() {
        let endpoint = spawn_http_server(vec![
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 41\r\n\r\n{\"data\":[{\"id\":\"google/gemma-3-27b-it\"}]}",
        ]);

        let result = validate_provider_connection(
            "custom",
            &endpoint,
            Some("test-key"),
            Some("google/gemma-3-27b-it"),
        )
        .await;

        assert!(result.success);
        assert_eq!(result.model_count, Some(1));
        assert_eq!(
            result.available_models,
            vec!["google/gemma-3-27b-it".to_owned()]
        );
        assert!(result
            .diagnosis
            .as_deref()
            .unwrap_or_default()
            .contains("found model 'google/gemma-3-27b-it'"));
    }

    #[tokio::test]
    async fn provider_validation_supports_gemini_native_test_requests() {
        let endpoint = spawn_http_server(vec![
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 129\r\n\r\n{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"OK\"}]}}],\"usageMetadata\":{\"totalTokenCount\":5}}",
        ]);

        let result = validate_provider_connection(
            "gemini",
            &endpoint,
            Some("test-key"),
            Some("gemini-2.5-flash"),
        )
        .await;

        assert!(result.success);
        assert!(result
            .diagnosis
            .as_deref()
            .unwrap_or_default()
            .contains("Connected to Gemini"));
    }
}
