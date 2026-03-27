use anyhow::Context;
use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, NaiveDate};
use git2::{IndexAddOption, Repository, Signature};
use maabarium_core::blueprint::{
    AgentDef, AgentsConfig, BlueprintLibraryKind, BlueprintLibraryMeta, BlueprintMeta,
    BlueprintTemplateKind, ConstraintsConfig, DomainConfig, EvaluatorKind, MetricDef,
    MetricsConfig, ModelAssignment, ModelDef, ModelsConfig,
};
use maabarium_core::persistence::PersistedExperiment;
use maabarium_core::{
    default_db_path, default_log_path, read_recent_log_lines_from_path, ApiKeyStore, BlueprintFile,
    Engine, EngineConfig, EnginePhase, EngineProgressUpdate, EvaluatorRegistry,
    GitDependencyEnsureOutcome, PersistedProposal, Persistence, ProcessPluginManifest,
    SecretStore, ensure_git_dependency, git_dependency_status,
};
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::menu::{Menu, MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tracing_subscriber::prelude::*;
use url::Url;

mod maintenance;
mod setup;

use crate::maintenance::{
    cleanup_experiment_branches, inspect_experiment_branch_inventory,
    ExperimentBranchCleanupResult, ExperimentBranchInventory,
};
use crate::setup::{
    build_ollama_status, build_readiness_items, install_ollama as install_ollama_runtime,
    load_desktop_setup, save_desktop_setup as persist_desktop_setup,
    start_ollama as start_ollama_runtime, DesktopSetupState, OllamaStatus, ReadinessItem,
    ResearchSearchMode,
};

const RELEASE_DESKTOP_RUNTIME_ID: &str = "com.maabarium.console";
const DEV_DESKTOP_RUNTIME_ID: &str = "com.maabarium.console.dev";
const SUPPORTED_UPDATE_CHANNELS: &[&str] = &["stable", "beta"];
const BLUEPRINTS_DIR_NAME: &str = "blueprints";
const DEFAULT_BLUEPRINT_FILE_NAME: &str = "example.toml";
const APP_DISPLAY_NAME: &str = "Maabarium";
const ABOUT_MENU_ID: &str = "about_maabarium";
const LICENSE_MENU_ID: &str = "open_repository_license";
const ABOUT_MENU_EVENT: &str = "maabarium://open-about";

struct AppState {
    blueprints_dir: PathBuf,
    blueprint_path: Mutex<PathBuf>,
    settings_path: PathBuf,
    hardware_sampler: Mutex<HardwareTelemetrySampler>,
    db_path: PathBuf,
    log_path: PathBuf,
    engine_cancel: Mutex<Option<CancellationToken>>,
    engine_running: Arc<AtomicBool>,
    run_state: Arc<Mutex<MutableRunState>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum RunStatus {
    Idle,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveRunState {
    status: RunStatus,
    blueprint_name: Option<String>,
    workspace_path: Option<String>,
    current_iteration: Option<u64>,
    max_iterations: Option<u64>,
    phase: Option<String>,
    latest_score: Option<f64>,
    latest_duration_ms: Option<u64>,
    current_iteration_elapsed_ms: Option<u64>,
    started_at_epoch_ms: Option<u64>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct MutableRunState {
    status: RunStatus,
    blueprint_name: Option<String>,
    workspace_path: Option<String>,
    current_iteration: Option<u64>,
    max_iterations: Option<u64>,
    phase: Option<String>,
    latest_score: Option<f64>,
    latest_duration_ms: Option<u64>,
    current_iteration_started_at_epoch_ms: Option<u64>,
    started_at_epoch_ms: Option<u64>,
    message: Option<String>,
}

impl Default for MutableRunState {
    fn default() -> Self {
        Self {
            status: RunStatus::Idle,
            blueprint_name: None,
            workspace_path: None,
            current_iteration: None,
            max_iterations: None,
            phase: None,
            latest_score: None,
            latest_duration_ms: None,
            current_iteration_started_at_epoch_ms: None,
            started_at_epoch_ms: None,
            message: None,
        }
    }
}

impl MutableRunState {
    fn snapshot(&self) -> LiveRunState {
        let now = current_epoch_ms();
        let current_iteration_elapsed_ms = self
            .current_iteration_started_at_epoch_ms
            .map(|started| now.saturating_sub(started));

        LiveRunState {
            status: self.status.clone(),
            blueprint_name: self.blueprint_name.clone(),
            workspace_path: self.workspace_path.clone(),
            current_iteration: self.current_iteration,
            max_iterations: self.max_iterations,
            phase: self.phase.clone(),
            latest_score: self.latest_score,
            latest_duration_ms: self.latest_duration_ms,
            current_iteration_elapsed_ms,
            started_at_epoch_ms: self.started_at_epoch_ms,
            message: self.message.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlueprintOption {
    path: String,
    file_name: String,
    display_name: String,
    description: Option<String>,
    load_error: Option<String>,
    version: Option<String>,
    language: Option<String>,
    repo_path: Option<String>,
    council_size: Option<u32>,
    metric_count: Option<usize>,
    target_file_count: Option<usize>,
    max_iterations: Option<u64>,
    is_loadable: bool,
    is_active: bool,
    library_kind: BlueprintLibraryKind,
    requires_setup: bool,
    wizard_template: Option<BlueprintTemplateKind>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyticsBucket {
    label: String,
    experiments: u32,
    token_usage: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunAnalytics {
    daily: Vec<AnalyticsBucket>,
    weekly: Vec<AnalyticsBucket>,
    monthly: Vec<AnalyticsBucket>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterConfigurationState {
    current_version: String,
    channel: String,
    endpoint: Option<String>,
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    current_version: String,
    channel: String,
    endpoint: Option<String>,
    configured: bool,
    available: bool,
    version: Option<String>,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallUpdateResult {
    installed: bool,
    version: Option<String>,
    should_restart: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginRuntimeState {
    plugin_id: String,
    display_name: Option<String>,
    manifest_path: String,
    command: Option<String>,
    args: Vec<String>,
    working_dir: Option<String>,
    timeout_seconds: Option<u64>,
    environment_keys: Vec<String>,
    status: PluginRuntimeStatus,
    summary: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum PluginRuntimeStatus {
    Ready,
    NeedsAttention,
}

#[derive(Debug, Clone)]
struct UpdateRuntimeConfig {
    channel: String,
    endpoint: String,
    pubkey: String,
}

#[derive(Debug, Clone)]
struct DesktopRuntimePaths {
    db_path: PathBuf,
    log_path: PathBuf,
    cli_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleState {
    engine_running: bool,
    run_state: LiveRunState,
    blueprint_path: String,
    db_path: String,
    log_path: String,
    hardware_telemetry: HardwareTelemetry,
    git_dependency: GitDependencyState,
    blueprint: Option<BlueprintFile>,
    blueprint_error: Option<String>,
    evaluator_kind: Option<String>,
    plugin_runtime: Option<PluginRuntimeState>,
    available_blueprints: Vec<BlueprintOption>,
    run_analytics: RunAnalytics,
    updater: UpdaterConfigurationState,
    desktop_setup: DesktopSetupState,
    readiness_items: Vec<ReadinessItem>,
    experiment_branch_inventory: Option<ExperimentBranchInventory>,
    ollama: OllamaStatus,
    experiments: Vec<PersistedExperiment>,
    proposals: Vec<PersistedProposal>,
    logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDependencyState {
    installed: bool,
    command_path: Option<String>,
    auto_install_supported: bool,
    installer_label: Option<String>,
    install_command: Option<String>,
    status_detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExperimentBranchCleanupResponse {
    snapshot: ConsoleState,
    result: ExperimentBranchCleanupResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareTelemetry {
    sampled_at_epoch_ms: u64,
    platform: String,
    cpu: HardwareSensor,
    gpu: HardwareSensor,
    npu: HardwareSensor,
    notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareSensor {
    status: HardwareSensorStatus,
    utilization_percent: Option<f32>,
    temperature_celsius: Option<f32>,
    logical_cores: Option<usize>,
    status_detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum HardwareSensorStatus {
    Partial,
    Unavailable,
}

struct HardwareTelemetrySampler {
    system: System,
}

impl Default for HardwareTelemetrySampler {
    fn default() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        Self { system }
    }
}

impl HardwareTelemetrySampler {
    fn sample(&mut self) -> HardwareTelemetry {
        self.system.refresh_cpu_usage();

        let cpu_utilization = self.system.global_cpu_usage().clamp(0.0, 100.0);
        let logical_cores = self.system.cpus().len();

        let cpu = HardwareSensor {
            status: HardwareSensorStatus::Partial,
            utilization_percent: Some(cpu_utilization),
            temperature_celsius: None,
            logical_cores: Some(logical_cores),
            status_detail: "Live CPU utilization is sampled locally. CPU temperature is not exposed through a stable unprivileged macOS API in this build.".to_owned(),
        };

        let unavailable_reason = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "Live GPU and NPU utilization or temperature are not exposed through a stable unprivileged macOS API. The public powermetrics path requires sudo."
        } else if cfg!(target_os = "macos") {
            "This desktop build only advertises accelerator telemetry on macOS Apple Silicon. Public unprivileged GPU and NPU metrics are unavailable here."
        } else {
            "This desktop build only wires hardware telemetry for macOS. GPU and NPU metrics are unavailable on this platform."
        };

        let gpu = HardwareSensor {
            status: HardwareSensorStatus::Unavailable,
            utilization_percent: None,
            temperature_celsius: None,
            logical_cores: None,
            status_detail: unavailable_reason.to_owned(),
        };

        let npu = HardwareSensor {
            status: HardwareSensorStatus::Unavailable,
            utilization_percent: None,
            temperature_celsius: None,
            logical_cores: None,
            status_detail: unavailable_reason.to_owned(),
        };

        HardwareTelemetry {
            sampled_at_epoch_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
            platform: format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
            cpu,
            gpu,
            npu,
            notes: vec![
                "CPU utilization is live and local to the desktop app.".to_owned(),
                "GPU and NPU values remain explicit unavailable states until a stable non-privileged macOS source is added.".to_owned(),
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BlueprintWizardTemplate {
    CodeQuality,
    PromptOptimization,
    ProductBuilder,
    GeneralResearch,
    LoraValidation,
    Custom,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBlueprintWizardRequest {
    name: String,
    description: String,
    version: String,
    template: BlueprintWizardTemplate,
    repo_path: String,
    language: String,
    target_files: Vec<String>,
    max_iterations: u64,
    timeout_seconds: u64,
    require_tests_pass: bool,
    min_improvement: f64,
    council_size: u32,
    debate_rounds: u32,
    metrics: Vec<MetricDef>,
    agents: Vec<AgentDef>,
    model_assignment: ModelAssignment,
    models: Vec<ModelDef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartEngineRequest {
    workspace_path: Option<String>,
    initialize_git_if_needed: bool,
    save_workspace_as_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitStatus {
    path: String,
    exists: bool,
    is_directory: bool,
    is_git_repository: bool,
    repository_root: Option<String>,
}

impl From<BlueprintWizardTemplate> for BlueprintTemplateKind {
    fn from(value: BlueprintWizardTemplate) -> Self {
        match value {
            BlueprintWizardTemplate::CodeQuality => BlueprintTemplateKind::CodeQuality,
            BlueprintWizardTemplate::PromptOptimization => {
                BlueprintTemplateKind::PromptOptimization
            }
            BlueprintWizardTemplate::ProductBuilder => BlueprintTemplateKind::ProductBuilder,
            BlueprintWizardTemplate::GeneralResearch => BlueprintTemplateKind::GeneralResearch,
            BlueprintWizardTemplate::LoraValidation => BlueprintTemplateKind::LoraValidation,
            BlueprintWizardTemplate::Custom => BlueprintTemplateKind::Custom,
        }
    }
}

fn main() {
    let runtime_paths =
        prepare_desktop_runtime_paths().expect("failed to prepare desktop runtime paths");
    let _log_guard = init_tracing(&runtime_paths.log_path).expect("failed to initialize tracing");

    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(handle_menu_event)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let state = initialize_app_state(app.handle(), &runtime_paths)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_console_state,
            save_desktop_setup,
            set_provider_api_key,
            install_git,
            install_ollama,
            start_ollama,
            cleanup_experiment_branches_command,
            start_engine,
            stop_engine,
            open_log_file,
            open_blueprint_file,
            open_blueprint_directory,
            open_repository_license,
            inspect_workspace_git_status,
            initialize_workspace_git,
            load_blueprint_for_wizard,
            create_blueprint_from_wizard,
            update_blueprint_from_wizard,
            set_blueprint_path,
            check_for_updates,
            install_available_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, APP_DISPLAY_NAME)
        .text(ABOUT_MENU_ID, "About Maabarium")
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit_with_text("Quit Maabarium")
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File").close_window().build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .text(LICENSE_MENU_ID, "Open LICENSE")
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .close_window()
        .quit_with_text("Quit Maabarium")
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .text(LICENSE_MENU_ID, "Open LICENSE")
        .build()?;

    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        ABOUT_MENU_ID => {
            let _ = app.emit(ABOUT_MENU_EVENT, ());
        }
        LICENSE_MENU_ID => {
            let _ = open_repository_license_path(app);
        }
        _ => {}
    }
}

fn initialize_app_state(
    app: &tauri::AppHandle,
    runtime_paths: &DesktopRuntimePaths,
) -> anyhow::Result<AppState> {
    let blueprints_dir = prepare_desktop_blueprints_directory(app)?;
    seed_bundled_cli(app, &runtime_paths.cli_path)?;
    let settings_path = blueprints_dir
        .parent()
        .unwrap_or(&blueprints_dir)
        .join("desktop-setup.json");
    let blueprint_path = restored_blueprint_path(&blueprints_dir, &settings_path);

    Ok(AppState {
        blueprints_dir,
        blueprint_path: Mutex::new(blueprint_path),
        settings_path,
        hardware_sampler: Mutex::new(HardwareTelemetrySampler::default()),
        db_path: runtime_paths.db_path.clone(),
        log_path: runtime_paths.log_path.clone(),
        engine_cancel: Mutex::new(None),
        engine_running: Arc::new(AtomicBool::new(false)),
        run_state: Arc::new(Mutex::new(MutableRunState::default())),
    })
}

fn restored_blueprint_path(blueprints_dir: &Path, settings_path: &Path) -> PathBuf {
    let stored_path = load_desktop_setup(settings_path)
        .selected_blueprint_path
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .filter(|path| BlueprintFile::load(path).is_ok());

    stored_path.unwrap_or_else(|| default_blueprint_path(blueprints_dir))
}

fn default_blueprint_path(blueprints_dir: &Path) -> PathBuf {
    let default_path = blueprints_dir.join(DEFAULT_BLUEPRINT_FILE_NAME);
    if default_path.exists() {
        return default_path;
    }

    let mut blueprint_paths = list_blueprint_paths(blueprints_dir);
    blueprint_paths.sort();
    blueprint_paths.into_iter().next().unwrap_or(default_path)
}

fn prepare_desktop_blueprints_directory(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let blueprints_dir = desktop_data_directory()?.join(BLUEPRINTS_DIR_NAME);

    std::fs::create_dir_all(&blueprints_dir).with_context(|| {
        format!(
            "Failed to create desktop blueprint directory {}",
            blueprints_dir.display()
        )
    })?;

    let migrated = if desktop_runtime_allows_legacy_migration() {
        copy_blueprint_files_if_missing(&legacy_blueprints_directory(), &blueprints_dir)
            .context("Failed to migrate legacy blueprints into desktop app data")?
    } else {
        0
    };
    let seeded = seed_bundled_blueprints(app, &blueprints_dir)
        .context("Failed to seed bundled blueprints into desktop app data")?;

    info!(
        blueprint_directory = %blueprints_dir.display(),
        migrated,
        seeded,
        "Desktop blueprint library prepared"
    );

    Ok(blueprints_dir)
}

fn legacy_blueprints_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../blueprints")
}

fn bundled_blueprints_directory(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app
        .path()
        .resource_dir()
        .context("Failed to resolve the desktop resource directory")?
        .join(BLUEPRINTS_DIR_NAME))
}

fn bundled_cli_resource_path(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let bundled_path = app
        .path()
        .resource_dir()
        .map(|directory| {
            directory
                .join("cli")
                .join(runtime_platform_key())
                .join(cli_binary_name())
        })
        .unwrap_or_else(|_| dev_bundled_cli_resource_path());

    if bundled_path.exists() {
        Ok(bundled_path)
    } else {
        let dev_path = dev_bundled_cli_resource_path();
        if dev_path.exists() {
            Ok(dev_path)
        } else {
            Ok(bundled_path)
        }
    }
}

fn dev_bundled_cli_resource_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("generated-resources")
        .join("cli")
        .join(runtime_platform_key())
        .join(cli_binary_name())
}

fn seed_bundled_cli(app: &tauri::AppHandle, destination: &Path) -> anyhow::Result<PathBuf> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create bundled CLI directory {}",
                parent.display()
            )
        })?;
    }

    let bundled_cli_path = match bundled_cli_resource_path(app) {
        Ok(path) if path.exists() => path,
        Ok(_) => return Ok(destination.to_path_buf()),
        Err(error) => {
            warn!(?error, "Bundled CLI resource is unavailable");
            return Ok(destination.to_path_buf());
        }
    };

    let should_copy = !destination.exists()
        || std::fs::read(destination).ok() != std::fs::read(&bundled_cli_path).ok();
    if should_copy {
        std::fs::copy(&bundled_cli_path, destination).with_context(|| {
            format!(
                "Failed to copy bundled CLI from {} to {}",
                bundled_cli_path.display(),
                destination.display()
            )
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(destination)?.permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(destination, permissions)?;
        }
    }

    Ok(destination.to_path_buf())
}

fn cli_binary_name() -> &'static str {
    if cfg!(windows) {
        "maabarium.exe"
    } else {
        "maabarium"
    }
}

fn runtime_platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        "x86" => "i686",
        other => other,
    };
    format!("{os}-{arch}")
}

fn seed_bundled_blueprints(
    app: &tauri::AppHandle,
    target_directory: &Path,
) -> anyhow::Result<usize> {
    let bundled_directory = match bundled_blueprints_directory(app) {
        Ok(directory) => directory,
        Err(error) => {
            warn!(
                ?error,
                "Desktop bundled blueprints directory is unavailable"
            );
            return Ok(0);
        }
    };

    copy_blueprint_files_if_missing(&bundled_directory, target_directory)
}

fn copy_blueprint_files_if_missing(
    source_directory: &Path,
    target_directory: &Path,
) -> anyhow::Result<usize> {
    if !source_directory.exists() {
        return Ok(0);
    }

    std::fs::create_dir_all(target_directory).with_context(|| {
        format!(
            "Failed to create target blueprint directory {}",
            target_directory.display()
        )
    })?;

    let mut copied = 0_usize;
    for source_path in list_blueprint_paths(source_directory) {
        let Some(file_name) = source_path.file_name() else {
            continue;
        };

        let target_path = target_directory.join(file_name);
        if target_path.exists() {
            continue;
        }

        std::fs::copy(&source_path, &target_path).with_context(|| {
            format!(
                "Failed to copy blueprint from {} to {}",
                source_path.display(),
                target_path.display()
            )
        })?;
        copied += 1;
    }

    Ok(copied)
}

fn list_blueprint_paths(directory: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(directory)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("toml"))
                    .unwrap_or(false)
        })
        .collect()
}

fn init_tracing(log_path: &Path) -> anyhow::Result<tracing_appender::non_blocking::WorkerGuard> {
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

    info!(log_path = %log_path.display(), "Desktop tracing initialized");
    Ok(guard)
}

fn prepare_desktop_runtime_paths() -> anyhow::Result<DesktopRuntimePaths> {
    let data_dir = desktop_data_directory()?;
    let log_dir = desktop_log_directory()?;

    std::fs::create_dir_all(&data_dir).with_context(|| {
        format!(
            "Failed to create desktop data directory {}",
            data_dir.display()
        )
    })?;
    std::fs::create_dir_all(&log_dir).with_context(|| {
        format!(
            "Failed to create desktop log directory {}",
            log_dir.display()
        )
    })?;

    let db_path = data_dir.join("maabarium.db");
    let log_path = log_dir.join("maabarium.log");
    let cli_path = data_dir.join("bin").join(cli_binary_name());

    if desktop_runtime_allows_legacy_migration() {
        migrate_legacy_runtime_file(&default_db_path(), &db_path)?;
        migrate_legacy_runtime_file(&default_log_path(), &log_path)?;
    }

    Ok(DesktopRuntimePaths {
        db_path,
        log_path,
        cli_path,
    })
}

fn migrate_legacy_runtime_file(legacy_path: &Path, target_path: &Path) -> anyhow::Result<()> {
    if target_path.exists() || !legacy_path.exists() || legacy_path == target_path {
        return Ok(());
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create directory for migrated runtime file {}",
                target_path.display()
            )
        })?;
    }

    std::fs::copy(legacy_path, target_path).with_context(|| {
        format!(
            "Failed to migrate desktop runtime file from {} to {}",
            legacy_path.display(),
            target_path.display()
        )
    })?;

    Ok(())
}

fn desktop_data_directory() -> anyhow::Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = desktop_home_directory()?;
        return Ok(home
            .join("Library")
            .join("Application Support")
            .join(desktop_runtime_id()));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            return Ok(PathBuf::from(app_data).join("Maabarium Console"));
        }
        return Ok(desktop_home_directory()?
            .join("AppData")
            .join("Roaming")
            .join("Maabarium Console"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(xdg_data_home).join("maabarium"));
        }
        return Ok(desktop_home_directory()?
            .join(".local")
            .join("share")
            .join("maabarium"));
    }
}

fn desktop_log_directory() -> anyhow::Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = desktop_home_directory()?;
        return Ok(home
            .join("Library")
            .join("Logs")
            .join(desktop_runtime_id()));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            return Ok(PathBuf::from(local_app_data)
                .join("Maabarium Console")
                .join("Logs"));
        }
        return Ok(desktop_home_directory()?
            .join("AppData")
            .join("Local")
            .join("Maabarium Console")
            .join("Logs"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(xdg_state_home) = std::env::var_os("XDG_STATE_HOME") {
            return Ok(PathBuf::from(xdg_state_home).join("maabarium"));
        }
        return Ok(desktop_home_directory()?
            .join(".local")
            .join("state")
            .join("maabarium"));
    }
}

fn desktop_home_directory() -> anyhow::Result<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("HOME is not set for desktop runtime path resolution"))
}

fn desktop_runtime_id() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_DESKTOP_RUNTIME_ID
    } else {
        RELEASE_DESKTOP_RUNTIME_ID
    }
}

fn desktop_runtime_allows_legacy_migration() -> bool {
    cfg!(debug_assertions)
        || std::env::var_os("MAABARIUM_ENABLE_LEGACY_DESKTOP_MIGRATION").is_some()
}

fn build_console_state(state: &AppState) -> ConsoleState {
    let blueprint_path = current_blueprint_path(state);
    let run_state = current_run_state(state);
    let hardware_telemetry = sample_hardware_telemetry(state);
    let blueprint_result = BlueprintFile::load(&blueprint_path);
    let plugin_runtime = blueprint_result
        .as_ref()
        .ok()
        .and_then(describe_plugin_runtime);
    let available_blueprints =
        discover_available_blueprints(&state.blueprints_dir, &blueprint_path);
    let desktop_setup = hydrated_desktop_setup(state);
    let git_status = git_dependency_status();
    let git_dependency = GitDependencyState {
        installed: git_status.installed,
        command_path: git_status
            .command_path
            .as_ref()
            .map(|path| path.display().to_string()),
        auto_install_supported: git_status.auto_install_supported,
        installer_label: git_status.installer.map(|installer| installer.label().to_owned()),
        install_command: git_status.install_command.clone(),
        status_detail: git_status.status_detail.clone(),
    };
    let mut ollama = build_ollama_status();
    merge_saved_local_models_into_ollama(&desktop_setup, &mut ollama);
    let evaluator_kind = blueprint_result
        .as_ref()
        .ok()
        .map(EvaluatorRegistry::describe);
    let active_blueprint_name = blueprint_result
        .as_ref()
        .ok()
        .map(|blueprint| blueprint.blueprint.name.clone());
    let (experiments, run_analytics, proposals) =
        Persistence::open(&state.db_path.display().to_string())
            .map(|persistence| {
                let recent_experiments = persistence.recent_experiments(400).unwrap_or_default();
                let console_experiments = active_blueprint_name
                    .as_deref()
                    .and_then(|blueprint_name| {
                        persistence
                            .recent_experiments_for_blueprint(blueprint_name, 12)
                            .ok()
                    })
                    .unwrap_or_else(|| {
                        recent_experiments
                            .iter()
                            .take(12)
                            .cloned()
                            .collect::<Vec<_>>()
                    });
                let run_analytics = build_run_analytics(&recent_experiments, &state.log_path);
                let proposals = active_blueprint_name
                    .as_deref()
                    .and_then(|blueprint_name| {
                        persistence
                            .recent_proposals_for_blueprint(blueprint_name, 5)
                            .ok()
                    })
                    .unwrap_or_else(|| persistence.recent_proposals(5).unwrap_or_default());
                (console_experiments, run_analytics, proposals)
            })
            .unwrap_or_else(|_| (Vec::new(), empty_run_analytics(), Vec::new()));
    let logs = read_recent_log_lines_from_path(&state.log_path, 40).unwrap_or_default();
    let updater = describe_updater_configuration(&desktop_setup);
    let brave_search_configured = desktop_setup.brave_search_configured;
    let active_research_workflow = blueprint_result
        .as_ref()
        .ok()
        .map(|blueprint| {
            blueprint
                .library
                .as_ref()
                .and_then(|library| library.template)
                == Some(BlueprintTemplateKind::GeneralResearch)
                || blueprint.domain.language.eq_ignore_ascii_case("research")
        })
        .unwrap_or(false);
    let fallback_workspace = blueprint_result
        .as_ref()
        .ok()
        .map(|blueprint| blueprint.domain.repo_path.as_str())
        .filter(|value| !value.trim().is_empty());
    let readiness_items = build_readiness_items(
        &desktop_setup,
        fallback_workspace,
        &git_status,
        &ollama,
        updater.configured,
        brave_search_configured,
        active_research_workflow,
        &state.db_path,
        &state.log_path,
    );
    let experiment_branch_inventory = resolved_console_workspace_path(
        &run_state,
        blueprint_result.as_ref().ok(),
        &desktop_setup,
    )
    .and_then(|workspace_path| match inspect_experiment_branch_inventory(&workspace_path) {
        Ok(inventory) => Some(inventory),
        Err(error) => {
            warn!(workspace = %workspace_path.display(), %error, "Failed to inspect experiment branch inventory");
            None
        }
    });

    match blueprint_result {
        Ok(blueprint) => ConsoleState {
            engine_running: state.engine_running.load(Ordering::SeqCst),
            run_state,
            blueprint_path: blueprint_path.display().to_string(),
            db_path: state.db_path.display().to_string(),
            log_path: state.log_path.display().to_string(),
            hardware_telemetry,
            git_dependency: git_dependency.clone(),
            blueprint: Some(blueprint),
            blueprint_error: None,
            evaluator_kind,
            plugin_runtime,
            available_blueprints,
            run_analytics,
            updater,
            desktop_setup,
            readiness_items,
            experiment_branch_inventory: experiment_branch_inventory.clone(),
            ollama,
            experiments,
            proposals,
            logs,
        },
        Err(error) => ConsoleState {
            engine_running: state.engine_running.load(Ordering::SeqCst),
            run_state,
            blueprint_path: blueprint_path.display().to_string(),
            db_path: state.db_path.display().to_string(),
            log_path: state.log_path.display().to_string(),
            hardware_telemetry,
            git_dependency,
            blueprint: None,
            blueprint_error: Some(error.to_string()),
            evaluator_kind,
            plugin_runtime,
            available_blueprints,
            run_analytics,
            updater,
            desktop_setup,
            readiness_items,
            experiment_branch_inventory,
            ollama,
            experiments,
            proposals,
            logs,
        },
    }
}

fn merge_saved_local_models_into_ollama(setup: &DesktopSetupState, ollama: &mut OllamaStatus) {
    let mut merged_recommended_models = Vec::with_capacity(
        setup.selected_local_models.len() + ollama.recommended_models.len(),
    );

    for model_name in &setup.selected_local_models {
        if ollama.models.iter().any(|model| model.name == *model_name)
            || merged_recommended_models.iter().any(|name| name == model_name)
        {
            continue;
        }

        merged_recommended_models.push(model_name.clone());
    }

    for model_name in ollama.recommended_models.drain(..) {
        if merged_recommended_models.iter().any(|name| name == &model_name) {
            continue;
        }

        merged_recommended_models.push(model_name);
    }

    ollama.recommended_models = merged_recommended_models;
}

fn hydrated_desktop_setup(state: &AppState) -> DesktopSetupState {
    load_desktop_setup(&state.settings_path)
}

fn describe_plugin_runtime(blueprint: &BlueprintFile) -> Option<PluginRuntimeState> {
    let evaluator = blueprint.evaluator.as_ref()?;
    if evaluator.kind != EvaluatorKind::Process {
        return None;
    }

    let manifest_path = evaluator
        .manifest_path
        .as_deref()
        .map(|path| resolve_relative_path(Path::new(&blueprint.domain.repo_path), path))?;
    let manifest_display = manifest_path.display().to_string();

    let content = match std::fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(error) => {
            return Some(PluginRuntimeState {
                plugin_id: evaluator
                    .plugin_id
                    .clone()
                    .unwrap_or_else(|| "process-plugin".to_owned()),
                display_name: None,
                manifest_path: manifest_display.clone(),
                command: None,
                args: Vec::new(),
                working_dir: None,
                timeout_seconds: None,
                environment_keys: Vec::new(),
                status: PluginRuntimeStatus::NeedsAttention,
                summary: "Plugin manifest could not be loaded.".to_owned(),
                error: Some(format!(
                    "Failed to read plugin manifest {}: {error}",
                    manifest_display
                )),
            });
        }
    };

    let manifest: ProcessPluginManifest = match toml::from_str(&content) {
        Ok(manifest) => manifest,
        Err(error) => {
            return Some(PluginRuntimeState {
                plugin_id: evaluator
                    .plugin_id
                    .clone()
                    .unwrap_or_else(|| "process-plugin".to_owned()),
                display_name: None,
                manifest_path: manifest_display.clone(),
                command: None,
                args: Vec::new(),
                working_dir: None,
                timeout_seconds: None,
                environment_keys: Vec::new(),
                status: PluginRuntimeStatus::NeedsAttention,
                summary: "Plugin manifest is invalid.".to_owned(),
                error: Some(format!(
                    "Invalid plugin manifest {}: {error}",
                    manifest_display
                )),
            });
        }
    };

    let resolved_working_dir =
        manifest.process.working_dir.as_deref().map(|path| {
            resolve_relative_path(manifest_path.parent().unwrap_or(Path::new(".")), path)
        });
    let resolved_command = resolve_plugin_command(
        &manifest.process.command,
        resolved_working_dir
            .as_deref()
            .unwrap_or_else(|| manifest_path.parent().unwrap_or(Path::new("."))),
    );
    let (status, summary, error) = if manifest.process.command.trim().is_empty() {
        (
            PluginRuntimeStatus::NeedsAttention,
            "Plugin command is missing.".to_owned(),
            Some("Plugin process command cannot be empty".to_owned()),
        )
    } else if resolved_command.is_none() {
        (
            PluginRuntimeStatus::NeedsAttention,
            "Plugin command is not available on this machine.".to_owned(),
            Some(format!(
                "Command '{}' was not found from the plugin working directory or PATH.",
                manifest.process.command
            )),
        )
    } else {
        (
            PluginRuntimeStatus::Ready,
            "Plugin manifest and command look ready for execution.".to_owned(),
            None,
        )
    };

    let mut environment_keys = manifest.environment.keys().cloned().collect::<Vec<_>>();
    environment_keys.sort();

    Some(PluginRuntimeState {
        plugin_id: manifest.plugin.id.clone(),
        display_name: manifest.plugin.display_name.clone(),
        manifest_path: manifest_display,
        command: resolved_command
            .map(|command| command.display().to_string())
            .or_else(|| Some(manifest.process.command.clone())),
        args: manifest.process.args.clone(),
        working_dir: resolved_working_dir.map(|path| path.display().to_string()),
        timeout_seconds: Some(manifest.plugin.timeout_seconds),
        environment_keys,
        status,
        summary,
        error,
    })
}

fn resolve_relative_path(base: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

fn resolve_plugin_command(command: &str, base: &Path) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let command_path = Path::new(trimmed);
    if command_path.is_absolute() {
        return command_path.exists().then(|| command_path.to_path_buf());
    }

    if trimmed.contains(std::path::MAIN_SEPARATOR) || trimmed.starts_with('.') {
        let candidate = base.join(command_path);
        return candidate.exists().then_some(candidate);
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|entry| entry.join(trimmed))
            .find(|candidate| candidate.exists())
    })
}

fn discover_available_blueprints(
    blueprint_directory: &Path,
    active_path: &Path,
) -> Vec<BlueprintOption> {
    let mut blueprints = list_blueprint_paths(blueprint_directory)
        .into_iter()
        .map(|path| blueprint_option_from_path(&path, active_path))
        .collect::<Vec<_>>();

    if !blueprints
        .iter()
        .any(|blueprint| blueprint.path == active_path.display().to_string())
    {
        blueprints.push(blueprint_option_from_path(active_path, active_path));
    }

    blueprints.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.file_name.cmp(&right.file_name))
    });

    blueprints
}

fn blueprint_option_from_path(path: &Path, active_path: &Path) -> BlueprintOption {
    let blueprint_result = BlueprintFile::load(path);
    let blueprint = blueprint_result.as_ref().ok();
    let load_error = blueprint_result
        .as_ref()
        .err()
        .map(|error| error.to_string());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.display().to_string());
    let display_name = blueprint
        .as_ref()
        .map(|loaded| loaded.blueprint.name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_owned)
                .unwrap_or_else(|| file_name.clone())
        });
    let description = blueprint
        .as_ref()
        .map(|loaded| loaded.blueprint.description.trim().to_owned())
        .filter(|value| !value.is_empty());
    let version = blueprint
        .as_ref()
        .map(|loaded| loaded.blueprint.version.trim().to_owned())
        .filter(|value| !value.is_empty());
    let language = blueprint
        .as_ref()
        .map(|loaded| loaded.domain.language.clone());
    let repo_path = blueprint
        .as_ref()
        .map(|loaded| loaded.domain.repo_path.trim().to_owned())
        .filter(|value| !value.is_empty());
    let council_size = blueprint.as_ref().map(|loaded| loaded.agents.council_size);
    let metric_count = blueprint
        .as_ref()
        .map(|loaded| loaded.metrics.metrics.len());
    let target_file_count = blueprint
        .as_ref()
        .map(|loaded| loaded.domain.target_files.len());
    let max_iterations = blueprint
        .as_ref()
        .map(|loaded| loaded.constraints.max_iterations);
    let library_kind = blueprint
        .as_ref()
        .map(|loaded| loaded.library_kind())
        .unwrap_or(BlueprintLibraryKind::Workflow);
    let requires_setup = blueprint
        .as_ref()
        .map(|loaded| loaded.requires_setup())
        .unwrap_or(false);
    let wizard_template = blueprint
        .as_ref()
        .and_then(|loaded| loaded.library.as_ref())
        .and_then(|library| library.template);

    BlueprintOption {
        path: path.display().to_string(),
        file_name,
        display_name,
        description,
        load_error,
        version,
        language,
        repo_path,
        council_size,
        metric_count,
        target_file_count,
        max_iterations,
        is_loadable: blueprint.is_some(),
        is_active: path == active_path,
        library_kind,
        requires_setup,
        wizard_template,
    }
}

fn empty_run_analytics() -> RunAnalytics {
    RunAnalytics {
        daily: Vec::new(),
        weekly: Vec::new(),
        monthly: Vec::new(),
    }
}

fn build_run_analytics(experiments: &[PersistedExperiment], log_path: &Path) -> RunAnalytics {
    let today = Local::now().date_naive();
    let experiment_dates = experiments
        .iter()
        .filter_map(|experiment| {
            parse_timestamp_local(&experiment.created_at).map(|date| date.date_naive())
        })
        .collect::<Vec<_>>();
    let token_events = read_token_usage_events(log_path);

    RunAnalytics {
        daily: build_daily_analytics(today, &experiment_dates, &token_events),
        weekly: build_weekly_analytics(today, &experiment_dates, &token_events),
        monthly: build_monthly_analytics(today, &experiment_dates, &token_events),
    }
}

fn build_daily_analytics(
    today: NaiveDate,
    experiment_dates: &[NaiveDate],
    token_events: &[(DateTime<Local>, u64)],
) -> Vec<AnalyticsBucket> {
    (0..7)
        .rev()
        .map(|offset| {
            let bucket_date = today - ChronoDuration::days(i64::from(offset));
            let experiments = experiment_dates
                .iter()
                .filter(|date| **date == bucket_date)
                .count() as u32;
            let token_usage = token_events
                .iter()
                .filter(|(timestamp, _)| timestamp.date_naive() == bucket_date)
                .map(|(_, token_usage)| *token_usage)
                .sum();

            AnalyticsBucket {
                label: bucket_date.format("%b %d").to_string(),
                experiments,
                token_usage,
            }
        })
        .collect()
}

fn build_weekly_analytics(
    today: NaiveDate,
    experiment_dates: &[NaiveDate],
    token_events: &[(DateTime<Local>, u64)],
) -> Vec<AnalyticsBucket> {
    let current_week_start =
        today - ChronoDuration::days(i64::from(today.weekday().num_days_from_monday()));

    (0..8)
        .rev()
        .map(|offset| {
            let start = current_week_start - ChronoDuration::weeks(i64::from(offset));
            let end = start + ChronoDuration::days(6);
            let experiments = experiment_dates
                .iter()
                .filter(|date| **date >= start && **date <= end)
                .count() as u32;
            let token_usage = token_events
                .iter()
                .filter(|(timestamp, _)| {
                    let date = timestamp.date_naive();
                    date >= start && date <= end
                })
                .map(|(_, token_usage)| *token_usage)
                .sum();

            AnalyticsBucket {
                label: start.format("%b %d").to_string(),
                experiments,
                token_usage,
            }
        })
        .collect()
}

fn build_monthly_analytics(
    today: NaiveDate,
    experiment_dates: &[NaiveDate],
    token_events: &[(DateTime<Local>, u64)],
) -> Vec<AnalyticsBucket> {
    let current_month = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .expect("current month should be valid");

    (0..12)
        .rev()
        .filter_map(|offset| {
            let (year, month) = shift_month(current_month.year(), current_month.month(), -offset);
            let start = NaiveDate::from_ymd_opt(year, month, 1)?;
            let (end_year, end_month) = shift_month(year, month, 1);
            let next_month_start = NaiveDate::from_ymd_opt(end_year, end_month, 1)?;
            let end = next_month_start - ChronoDuration::days(1);
            let experiments = experiment_dates
                .iter()
                .filter(|date| **date >= start && **date <= end)
                .count() as u32;
            let token_usage = token_events
                .iter()
                .filter(|(timestamp, _)| {
                    let date = timestamp.date_naive();
                    date >= start && date <= end
                })
                .map(|(_, token_usage)| *token_usage)
                .sum();

            Some(AnalyticsBucket {
                label: start.format("%b").to_string(),
                experiments,
                token_usage,
            })
        })
        .collect()
}

fn shift_month(year: i32, month: u32, delta: i32) -> (i32, u32) {
    let month_index = year * 12 + month as i32 - 1 + delta;
    let shifted_year = month_index.div_euclid(12);
    let shifted_month = month_index.rem_euclid(12) + 1;
    (shifted_year, shifted_month as u32)
}

fn parse_timestamp_local(value: &str) -> Option<DateTime<Local>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Local))
}

fn read_token_usage_events(log_path: &Path) -> Vec<(DateTime<Local>, u64)> {
    let content = std::fs::read_to_string(log_path).unwrap_or_default();
    content
        .lines()
        .filter_map(parse_token_usage_event)
        .collect()
}

fn parse_token_usage_event(line: &str) -> Option<(DateTime<Local>, u64)> {
    let timestamp = parse_timestamp_local(line.split_whitespace().next()?)?;
    let marker = "tokens_used=";
    let start = line.find(marker)? + marker.len();
    let digits = line[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    let token_usage = digits.parse::<u64>().ok()?;
    Some((timestamp, token_usage))
}

fn update_channel_from_env() -> Option<String> {
    std::env::var("MAABARIUM_UPDATE_CHANNEL")
        .ok()
        .and_then(|value| normalize_update_channel(&value))
}

fn compiled_update_channel() -> Option<String> {
    option_env!("MAABARIUM_COMPILED_UPDATE_CHANNEL").and_then(normalize_update_channel)
}

fn resolved_update_channel(setup: Option<&DesktopSetupState>) -> String {
    setup
        .and_then(|value| value.preferred_update_channel.as_deref())
        .and_then(normalize_update_channel)
        .or_else(update_channel_from_env)
        .or_else(compiled_update_channel)
        .unwrap_or_else(|| "stable".to_owned())
}

fn normalize_update_channel(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if SUPPORTED_UPDATE_CHANNELS.contains(&normalized.as_str()) {
        Some(normalized)
    } else {
        None
    }
}

fn normalized_update_manifest_url(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_owned())
    }
}

fn normalized_update_base_url(value: &str) -> Option<String> {
    let normalized = value.trim().trim_end_matches('/');
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_owned())
    }
}

fn resolved_update_endpoint(
    runtime_manifest_url: Option<String>,
    runtime_base_url: Option<String>,
    compiled_manifest_url: Option<&str>,
    compiled_base_url: Option<&str>,
    channel: &str,
) -> Option<String> {
    runtime_manifest_url
        .as_deref()
        .and_then(normalized_update_manifest_url)
        .or_else(|| compiled_manifest_url.and_then(normalized_update_manifest_url))
        .or_else(|| {
            runtime_base_url
                .as_deref()
                .and_then(normalized_update_base_url)
                .or_else(|| compiled_base_url.and_then(normalized_update_base_url))
                .map(|base_url| format!("{base_url}/{channel}/latest.json"))
        })
}

fn update_endpoint_from_environment(channel: &str) -> Option<String> {
    resolved_update_endpoint(
        std::env::var("MAABARIUM_UPDATE_MANIFEST_URL").ok(),
        std::env::var("MAABARIUM_UPDATE_BASE_URL").ok(),
        option_env!("MAABARIUM_COMPILED_UPDATE_MANIFEST_URL"),
        option_env!("MAABARIUM_COMPILED_UPDATE_BASE_URL"),
        channel,
    )
}

fn resolved_update_pubkey(
    runtime_value: Option<String>,
    compiled_value: Option<&str>,
) -> Option<String> {
    runtime_value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            compiled_value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
}

fn update_pubkey_from_env() -> Option<String> {
    resolved_update_pubkey(
        std::env::var("MAABARIUM_UPDATE_PUBKEY").ok(),
        option_env!("MAABARIUM_COMPILED_UPDATE_PUBKEY"),
    )
}

fn describe_updater_configuration(setup: &DesktopSetupState) -> UpdaterConfigurationState {
    let channel = resolved_update_channel(Some(setup));
    let endpoint = update_endpoint_from_environment(&channel);
    let configured = endpoint.is_some() && update_pubkey_from_env().is_some();

    UpdaterConfigurationState {
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
        channel,
        endpoint,
        configured,
    }
}

fn update_runtime_configuration(setup: &DesktopSetupState) -> Result<UpdateRuntimeConfig, String> {
    let channel = resolved_update_channel(Some(setup));
    let endpoint = update_endpoint_from_environment(&channel)
        .ok_or_else(|| "Set MAABARIUM_UPDATE_MANIFEST_URL or MAABARIUM_UPDATE_BASE_URL, or embed one of them at build time, to enable desktop updates".to_owned())?;
    let pubkey = update_pubkey_from_env()
        .ok_or_else(|| "Set MAABARIUM_UPDATE_PUBKEY or embed the updater pubkey at build time to enable desktop updates".to_owned())?;

    Ok(UpdateRuntimeConfig {
        channel,
        endpoint,
        pubkey,
    })
}

fn configured_updater(
    app: &tauri::AppHandle,
    setup: &DesktopSetupState,
) -> Result<(tauri_plugin_updater::Updater, UpdateRuntimeConfig), String> {
    let config = update_runtime_configuration(setup)?;
    let endpoint = Url::parse(&config.endpoint)
        .map_err(|error| format!("Invalid update manifest URL '{}': {error}", config.endpoint))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("Failed to configure update endpoints: {error}"))?
        .pubkey(config.pubkey.clone())
        .build()
        .map_err(|error| format!("Failed to initialize updater: {error}"))?;

    Ok((updater, config))
}

fn current_blueprint_path(state: &AppState) -> PathBuf {
    match state.blueprint_path.lock() {
        Ok(blueprint_path) => blueprint_path.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn current_run_state(state: &AppState) -> LiveRunState {
    match state.run_state.lock() {
        Ok(run_state) => run_state.snapshot(),
        Err(poisoned) => poisoned.into_inner().snapshot(),
    }
}

fn resolved_console_workspace_path(
    run_state: &LiveRunState,
    blueprint: Option<&BlueprintFile>,
    desktop_setup: &DesktopSetupState,
) -> Option<PathBuf> {
    run_state
        .workspace_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            desktop_setup
                .workspace_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            blueprint
                .map(|blueprint| blueprint.domain.repo_path.trim())
                .filter(|value| !value.is_empty() && *value != ".")
        })
        .map(PathBuf::from)
}

fn update_run_state<F>(state: &AppState, updater: F)
where
    F: FnOnce(&mut MutableRunState),
{
    update_run_state_handle(&state.run_state, updater);
}

fn update_run_state_handle<F>(run_state: &Arc<Mutex<MutableRunState>>, updater: F)
where
    F: FnOnce(&mut MutableRunState),
{
    match run_state.lock() {
        Ok(mut run_state) => updater(&mut run_state),
        Err(poisoned) => updater(&mut poisoned.into_inner()),
    }
}

fn reset_run_state_handle(run_state: &Arc<Mutex<MutableRunState>>) {
    update_run_state_handle(run_state, |run_state| {
        *run_state = MutableRunState::default();
    });
}

fn persist_selected_blueprint_path(
    settings_path: &Path,
    blueprint_path: &Path,
) -> Result<(), String> {
    let mut setup = load_desktop_setup(settings_path);
    setup.selected_blueprint_path = Some(blueprint_path.display().to_string());
    persist_desktop_setup(settings_path, &setup)?;
    Ok(())
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn engine_phase_label(phase: EnginePhase) -> &'static str {
    match phase {
        EnginePhase::Starting => "starting",
        EnginePhase::Planning => "planning",
        EnginePhase::Branching => "branching",
        EnginePhase::Applying => "applying",
        EnginePhase::Evaluating => "evaluating",
        EnginePhase::Persisting => "persisting",
        EnginePhase::Promoting => "promoting",
        EnginePhase::CleaningUp => "cleaning_up",
        EnginePhase::Completed => "completed",
        EnginePhase::Cancelled => "cancelled",
    }
}

fn run_workspace_root(path: &Path) -> Result<PathBuf, String> {
    let repo = Repository::discover(path).map_err(|error| {
        format!(
            "Failed to discover git repository from {}: {error}",
            path.display()
        )
    })?;

    if let Some(workdir) = repo.workdir() {
        return Ok(workdir.to_path_buf());
    }

    repo.path()
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Resolved repository root is unavailable".to_owned())
}

fn ensure_repository_has_head(repo: &Repository) -> Result<(), String> {
    let has_head = repo.head().ok().and_then(|head| head.target()).is_some();
    if has_head {
        return Ok(());
    }

    let mut index = repo
        .index()
        .map_err(|error| format!("Failed to open git index: {error}"))?;
    index
        .add_all(["."], IndexAddOption::DEFAULT, None)
        .map_err(|error| format!("Failed to stage workspace files for initial commit: {error}"))?;
    index
        .write()
        .map_err(|error| format!("Failed to write git index: {error}"))?;
    let tree_id = index
        .write_tree()
        .map_err(|error| format!("Failed to create initial tree: {error}"))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|error| format!("Failed to load initial tree: {error}"))?;
    let signature = repo
        .signature()
        .or_else(|_| Signature::now("Maabarium", "maabarium@local.invalid"))
        .map_err(|error| format!("Failed to create git signature: {error}"))?;
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "Initialize workspace for Maabarium",
        &tree,
        &[],
    )
    .map_err(|error| format!("Failed to create initial git commit: {error}"))?;
    Ok(())
}

fn prepare_run_workspace(path: &Path, initialize_git_if_needed: bool) -> Result<PathBuf, String> {
    ensure_git_runtime_dependency()?;

    if !path.exists() {
        return Err(format!(
            "Selected workspace {} does not exist",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "Selected workspace {} is not a directory",
            path.display()
        ));
    }

    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace {}: {error}", path.display()))?;

    match Repository::discover(&canonical) {
        Ok(repo) => {
            ensure_repository_has_head(&repo)?;
            run_workspace_root(&canonical)
        }
        Err(_) if initialize_git_if_needed => {
            let repo = Repository::init(&canonical).map_err(|error| {
                format!("Failed to initialize git repository in {}: {error}", canonical.display())
            })?;
            ensure_repository_has_head(&repo)?;
            Ok(canonical)
        }
        Err(_) => Err(format!(
            "Selected workspace {} is not a git repository. Enable repository initialization before starting the run.",
            canonical.display()
        )),
    }
}

fn ensure_git_runtime_dependency() -> Result<(), String> {
    match ensure_git_dependency() {
        Ok(GitDependencyEnsureOutcome::AlreadyInstalled) => Ok(()),
        Ok(GitDependencyEnsureOutcome::Installed { installer }) => {
            info!(installer = installer.label(), "Git dependency installed automatically");
            Ok(())
        }
        Ok(GitDependencyEnsureOutcome::InstallationStarted { message, .. }) => {
            warn!(message = %message, "Git dependency installation requires follow-up");
            Err(message)
        }
        Err(error) => Err(error),
    }
}

fn resolve_run_workspace(
    state: &AppState,
    blueprint: &BlueprintFile,
    request: &StartEngineRequest,
) -> Result<PathBuf, String> {
    let requested = request
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let blueprint_workspace = blueprint.domain.repo_path.trim();
            (!blueprint_workspace.is_empty()).then(|| PathBuf::from(blueprint_workspace))
        })
        .or_else(|| {
            load_desktop_setup(&state.settings_path)
                .workspace_path
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| PathBuf::from("."));

    prepare_run_workspace(&requested, request.initialize_git_if_needed)
}

#[tauri::command]
fn save_desktop_setup(
    state: tauri::State<'_, AppState>,
    setup: DesktopSetupState,
) -> Result<ConsoleState, String> {
    let existing = load_desktop_setup(&state.settings_path);
    let mut merged = setup;
    if merged.selected_blueprint_path.is_none() {
        merged.selected_blueprint_path = existing.selected_blueprint_path;
    }
    merged.brave_search_configured = existing.brave_search_configured;
    persist_desktop_setup(&state.settings_path, &merged)?;
    Ok(build_console_state(&state))
}

#[tauri::command]
fn initialize_workspace_git(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ConsoleState, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_owned());
    }

    prepare_run_workspace(Path::new(trimmed), true)?;
    Ok(build_console_state(&state))
}

#[tauri::command]
fn set_provider_api_key(
    state: tauri::State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> Result<ConsoleState, String> {
    let provider_id = provider_id.trim().to_owned();
    let has_api_key = !api_key.trim().is_empty();
    if provider_id.is_empty() {
        return Err("Provider id is required".to_owned());
    }

    let secret_store = SecretStore::new();
    if !has_api_key {
        secret_store.delete_api_key(&provider_id).map_err(|error| {
            format!("Failed to clear API key for provider '{provider_id}': {error}")
        })?;
    } else {
        secret_store
            .set_api_key(&provider_id, SecretString::from(api_key))
            .map_err(|error| {
                format!("Failed to store API key for provider '{provider_id}': {error}")
            })?;
    }

    let mut setup = load_desktop_setup(&state.settings_path);
    if provider_id == "brave" {
        setup.brave_search_configured = has_api_key;
    } else if let Some(provider) = setup
        .remote_providers
        .iter_mut()
        .find(|provider| provider.provider_id == provider_id)
    {
        provider.configured = has_api_key && provider.model_name.is_some();
    }
    persist_desktop_setup(&state.settings_path, &setup)?;

    Ok(build_console_state(&state))
}

#[tauri::command]
fn install_ollama(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    install_ollama_runtime()?;
    Ok(build_console_state(&state))
}

#[tauri::command]
fn start_ollama(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    start_ollama_runtime()?;
    Ok(build_console_state(&state))
}

#[tauri::command]
fn cleanup_experiment_branches_command(
    state: tauri::State<'_, AppState>,
    older_than_months: u32,
    dry_run: bool,
) -> Result<ExperimentBranchCleanupResponse, String> {
    let blueprint_path = current_blueprint_path(&state);
    let blueprint = BlueprintFile::load(&blueprint_path).ok();
    let run_state = current_run_state(&state);
    let desktop_setup = hydrated_desktop_setup(&state);
    let workspace_path = resolved_console_workspace_path(&run_state, blueprint.as_ref(), &desktop_setup)
        .ok_or_else(|| "Choose a git-backed workspace before managing experiment branches".to_owned())?;
    let result = cleanup_experiment_branches(&workspace_path, older_than_months, dry_run)?;

    Ok(ExperimentBranchCleanupResponse {
        snapshot: build_console_state(&state),
        result,
    })
}


    #[tauri::command]
    fn install_git(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
        ensure_git_runtime_dependency()?;
        Ok(build_console_state(&state))
    }
fn sample_hardware_telemetry(state: &AppState) -> HardwareTelemetry {
    match state.hardware_sampler.lock() {
        Ok(mut sampler) => sampler.sample(),
        Err(poisoned) => poisoned.into_inner().sample(),
    }
}

fn update_blueprint_path<T, F>(
    state: &AppState,
    next_blueprint_path: PathBuf,
    then: F,
) -> Result<T, String>
where
    F: FnOnce(&AppState) -> Result<T, String>,
{
    {
        let mut blueprint_path = state
            .blueprint_path
            .lock()
            .map_err(|_| "Failed to acquire blueprint state lock".to_owned())?;
        *blueprint_path = next_blueprint_path;
    }

    then(state)
}

#[tauri::command]
fn get_console_state(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    Ok(build_console_state(&state))
}

#[tauri::command]
fn open_log_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    open_path_in_system_viewer(&state.log_path)
}

#[tauri::command]
fn open_blueprint_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    open_path_in_system_viewer(&current_blueprint_path(&state))
}

#[tauri::command]
fn open_blueprint_directory(state: tauri::State<'_, AppState>) -> Result<(), String> {
    open_path_in_system_viewer(&state.blueprints_dir)
}

#[tauri::command]
fn open_repository_license(app: tauri::AppHandle) -> Result<(), String> {
    open_repository_license_path(&app)
}

#[tauri::command]
fn set_blueprint_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("Stop the engine before switching blueprints".to_owned());
    }

    let selected_path = PathBuf::from(path);
    if selected_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("toml"))
        .unwrap_or(true)
    {
        return Err("Blueprint files must use the .toml extension".to_owned());
    }

    BlueprintFile::load(&selected_path).map_err(|error| {
        format!(
            "Failed to load blueprint {}: {error}",
            selected_path.display()
        )
    })?;

    update_blueprint_path(&state, selected_path, |state| {
        persist_selected_blueprint_path(&state.settings_path, &current_blueprint_path(state))?;
        Ok(build_console_state(state))
    })
}

#[tauri::command]
async fn check_for_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateCheckResult, String> {
    let setup = hydrated_desktop_setup(&state);
    let current_version = app.package_info().version.to_string();
    let channel = resolved_update_channel(Some(&setup));
    let endpoint = update_endpoint_from_environment(&channel);
    let configured = endpoint.is_some() && update_pubkey_from_env().is_some();

    if !configured {
        return Ok(UpdateCheckResult {
            current_version,
            channel,
            endpoint,
            configured: false,
            available: false,
            version: None,
            date: None,
            body: None,
        });
    }

    let (updater, config) = configured_updater(&app, &setup)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Failed to check for updates: {error}"))?;

    Ok(UpdateCheckResult {
        current_version,
        channel: config.channel,
        endpoint: Some(config.endpoint),
        configured: true,
        available: update.is_some(),
        version: update.as_ref().map(|release| release.version.clone()),
        date: update
            .as_ref()
            .and_then(|release| release.date.map(|date| date.to_string())),
        body: update.as_ref().and_then(|release| release.body.clone()),
    })
}

#[tauri::command]
async fn install_available_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<InstallUpdateResult, String> {
    let setup = hydrated_desktop_setup(&state);
    let (updater, _) = configured_updater(&app, &setup)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Failed to check for installable update: {error}"))?;

    let Some(update) = update else {
        return Ok(InstallUpdateResult {
            installed: false,
            version: None,
            should_restart: false,
        });
    };

    let version = update.version.clone();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Failed to download and install update: {error}"))?;

    Ok(InstallUpdateResult {
        installed: true,
        version: Some(version),
        should_restart: !cfg!(windows),
    })
}

#[tauri::command]
fn inspect_workspace_git_status(path: String) -> Result<WorkspaceGitStatus, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_owned());
    }

    let candidate = PathBuf::from(trimmed);
    let exists = candidate.exists();
    let is_directory = candidate.is_dir();
    let (is_git_repository, repository_root) = if exists && is_directory {
        match Repository::discover(&candidate) {
            Ok(repo) => {
                let root = if let Some(workdir) = repo.workdir() {
                    Some(workdir.display().to_string())
                } else {
                    repo.path()
                        .parent()
                        .map(|path| path.display().to_string())
                };
                (true, root)
            }
            Err(_) => (false, None),
        }
    } else {
        (false, None)
    };

    Ok(WorkspaceGitStatus {
        path: trimmed.to_owned(),
        exists,
        is_directory,
        is_git_repository,
        repository_root,
    })
}

#[tauri::command]
fn load_blueprint_for_wizard(path: String) -> Result<BlueprintFile, String> {
    let blueprint_path = blueprint_path_from_string(&path)?;
    BlueprintFile::load(&blueprint_path)
        .with_context(|| format!("Failed to load blueprint {}", blueprint_path.display()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_blueprint_from_wizard(
    state: tauri::State<'_, AppState>,
    request: CreateBlueprintWizardRequest,
) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("Stop the engine before creating a blueprint".to_owned());
    }

    let normalized_name = request.name.trim().to_owned();
    let blueprint = build_blueprint_from_wizard_request(request, None)?;

    let blueprint_directory = state.blueprints_dir.clone();
    std::fs::create_dir_all(&blueprint_directory)
        .map_err(|error| format!("Failed to create blueprint directory: {error}"))?;

    let blueprint_path = next_blueprint_path(&blueprint_directory, &normalized_name);
    write_blueprint_file(&blueprint_path, &blueprint)?;

    update_blueprint_path(&state, blueprint_path, |state| {
        persist_selected_blueprint_path(&state.settings_path, &current_blueprint_path(state))?;
        Ok(build_console_state(state))
    })
}

#[tauri::command]
fn update_blueprint_from_wizard(
    state: tauri::State<'_, AppState>,
    path: String,
    request: CreateBlueprintWizardRequest,
) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("Stop the engine before editing a blueprint".to_owned());
    }

    let blueprint_path = blueprint_path_from_string(&path)?;
    let existing_blueprint = BlueprintFile::load(&blueprint_path)
        .with_context(|| format!("Failed to load blueprint {}", blueprint_path.display()))
        .map_err(|error| error.to_string())?;
    let updated_blueprint = build_blueprint_from_wizard_request(request, Some(&existing_blueprint))?;

    write_blueprint_file(&blueprint_path, &updated_blueprint)?;
    Ok(build_console_state(&state))
}

#[tauri::command]
fn start_engine(
    state: tauri::State<'_, AppState>,
    request: StartEngineRequest,
) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("The engine is already running".to_owned());
    }

    let blueprint_path = current_blueprint_path(&state);
    let mut blueprint = BlueprintFile::load(&blueprint_path)
        .with_context(|| format!("Failed to load blueprint {}", blueprint_path.display()))
        .map_err(|error| error.to_string())?;
    let workspace_root = resolve_run_workspace(&state, &blueprint, &request)?;
    blueprint.domain.repo_path = workspace_root.display().to_string();
    {
        let mut setup = load_desktop_setup(&state.settings_path);
        setup.interrupted_run_notice = None;
        let search_provider = match setup.research_search_mode {
            ResearchSearchMode::BraveApi => "brave_api",
            ResearchSearchMode::DuckduckgoScrape => "duckduckgo_scrape",
        };
        unsafe {
            std::env::set_var("MAABARIUM_RESEARCH_SEARCH_PROVIDER", search_provider);
        }
        if request.save_workspace_as_default {
            setup.workspace_path = Some(workspace_root.display().to_string());
        }
        persist_desktop_setup(&state.settings_path, &setup)?;
    }

    let db_path = state.db_path.clone();
    let running_flag = state.engine_running.clone();
    let cancel = CancellationToken::new();
    let cancel_for_thread = cancel.clone();
    let progress_state = state.run_state.clone();

    {
        let mut engine_cancel = state
            .engine_cancel
            .lock()
            .map_err(|_| "Failed to acquire engine state lock".to_owned())?;
        *engine_cancel = Some(cancel);
    }

    running_flag.store(true, Ordering::SeqCst);
    update_run_state(&state, |run_state| {
        *run_state = MutableRunState {
            status: RunStatus::Running,
            blueprint_name: Some(blueprint.blueprint.name.clone()),
            workspace_path: Some(blueprint.domain.repo_path.clone()),
            current_iteration: None,
            max_iterations: Some(blueprint.constraints.max_iterations),
            phase: Some("starting".to_owned()),
            latest_score: None,
            latest_duration_ms: None,
            current_iteration_started_at_epoch_ms: None,
            started_at_epoch_ms: Some(current_epoch_ms()),
            message: Some("Preparing engine run".to_owned()),
        };
    });

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                error!(?error, "Failed to create desktop runtime");
                running_flag.store(false, Ordering::SeqCst);
                reset_run_state_handle(&progress_state);
                return;
            }
        };

        runtime.block_on(async move {
            let outcome = async {
                let evaluator =
                    EvaluatorRegistry::build(&blueprint).context("Failed to build evaluator")?;
                let progress_state_for_events = progress_state.clone();
                let progress_reporter = std::sync::Arc::new(move |update: EngineProgressUpdate| {
                    update_run_state_handle(&progress_state_for_events, |run_state| {
                        if !matches!(run_state.status, RunStatus::Stopping) {
                            run_state.status = RunStatus::Running;
                        }
                        run_state.blueprint_name = Some(update.blueprint_name.clone());
                        run_state.workspace_path = Some(update.workspace_path.clone());
                        run_state.max_iterations = Some(update.max_iterations);
                        if update.iteration != run_state.current_iteration {
                            run_state.current_iteration = update.iteration;
                            run_state.current_iteration_started_at_epoch_ms =
                                update.iteration.map(|_| current_epoch_ms());
                        }
                        run_state.phase = Some(engine_phase_label(update.phase).to_owned());
                        run_state.latest_score = update.latest_score;
                        run_state.latest_duration_ms = update.latest_duration_ms;
                        run_state.message = update.message.clone();
                        if run_state.started_at_epoch_ms.is_none() {
                            run_state.started_at_epoch_ms = Some(current_epoch_ms());
                        }
                    });
                });
                let engine = Engine::new(
                    EngineConfig {
                        blueprint,
                        db_path: db_path.display().to_string(),
                        progress_reporter: Some(progress_reporter),
                    },
                    evaluator,
                    cancel_for_thread,
                )
                .context("Failed to initialize engine")?;
                engine.run().await.context("Engine run failed")
            }
            .await;

            if let Err(error) = outcome {
                error!(?error, "Desktop engine execution failed");
            }
            running_flag.store(false, Ordering::SeqCst);
            reset_run_state_handle(&progress_state);
        });
    });

    Ok(build_console_state(&state))
}

#[tauri::command]
fn stop_engine(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    if let Ok(mut engine_cancel) = state.engine_cancel.lock() {
        if let Some(cancel) = engine_cancel.take() {
            cancel.cancel();
            update_run_state(&state, |run_state| {
                run_state.status = RunStatus::Stopping;
                run_state.phase = Some("stopping".to_owned());
                run_state.message =
                    Some("Waiting for the current engine step to unwind".to_owned());
            });
        }
    }
    Ok(build_console_state(&state))
}

fn open_path_in_system_viewer(path: &Path) -> Result<(), String> {
    let command = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "xdg-open"
    };

    let mut process = Command::new(command);
    if cfg!(target_os = "windows") {
        process.arg("/C").arg("start").arg(path);
    } else {
        process.arg(path);
    }

    process
        .spawn()
        .map_err(|error| error.to_string())
        .map(|_| ())
}

fn open_repository_license_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let license_path = resolved_repository_license_path(app)?;
    open_path_in_system_viewer(&license_path)
}

fn resolved_repository_license_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_license = resource_dir.join("LICENSE");
        if bundled_license.exists() {
            return Ok(bundled_license);
        }
    }

    let repository_license = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../LICENSE");
    if repository_license.exists() {
        return repository_license
            .canonicalize()
            .map_err(|error| format!("Failed to resolve repository LICENSE path: {error}"));
    }

    Err("Could not locate the bundled or repository LICENSE file".to_owned())
}

fn blueprint_path_from_string(path: &str) -> Result<PathBuf, String> {
    let blueprint_path = PathBuf::from(path.trim());
    if blueprint_path.as_os_str().is_empty() {
        return Err("Blueprint path is required".to_owned());
    }

    if blueprint_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("toml"))
        .unwrap_or(true)
    {
        return Err("Blueprint files must use the .toml extension".to_owned());
    }

    Ok(blueprint_path)
}

fn build_blueprint_from_wizard_request(
    request: CreateBlueprintWizardRequest,
    existing_blueprint: Option<&BlueprintFile>,
) -> Result<BlueprintFile, String> {
    let selected_template = BlueprintTemplateKind::from(request.template);
    let normalized_name = request.name.trim();
    if normalized_name.is_empty() {
        return Err("Blueprint name is required".to_owned());
    }

    let normalized_description = request.description.trim();
    if normalized_description.is_empty() {
        return Err("Blueprint description is required".to_owned());
    }

    let normalized_version = request.version.trim();
    if normalized_version.is_empty() {
        return Err("Blueprint version is required".to_owned());
    }

    let normalized_repo_path = request.repo_path.trim();
    if normalized_repo_path.is_empty() {
        return Err("Repository path is required".to_owned());
    }

    let normalized_language = request.language.trim();
    if normalized_language.is_empty() {
        return Err("Language is required".to_owned());
    }

    let target_files = request
        .target_files
        .into_iter()
        .map(|entry| entry.trim().to_owned())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    if target_files.is_empty() {
        return Err("At least one target file pattern is required".to_owned());
    }

    if request.metrics.is_empty() {
        return Err("At least one metric is required".to_owned());
    }

    if request.agents.is_empty() {
        return Err("At least one agent is required".to_owned());
    }

    if request.models.is_empty() {
        return Err("At least one model is required".to_owned());
    }

    let metrics = request
        .metrics
        .into_iter()
        .map(|metric| MetricDef {
            name: metric.name.trim().to_owned(),
            weight: metric.weight,
            direction: metric.direction.trim().to_owned(),
            description: metric.description.trim().to_owned(),
        })
        .collect::<Vec<_>>();
    if metrics
        .iter()
        .any(|metric| metric.name.is_empty() || metric.description.is_empty())
    {
        return Err("Each metric must include a name and description".to_owned());
    }

    let models = request
        .models
        .into_iter()
        .map(|model| ModelDef {
            name: model.name.trim().to_owned(),
            provider: model.provider.trim().to_owned(),
            endpoint: model.endpoint.trim().to_owned(),
            api_key_env: model
                .api_key_env
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            temperature: model.temperature,
            max_tokens: model.max_tokens,
            requests_per_minute: model.requests_per_minute,
        })
        .collect::<Vec<_>>();
    if models.iter().any(|model| {
        model.name.is_empty() || model.provider.is_empty() || model.endpoint.is_empty()
    }) {
        return Err("Each model must include a name, provider, and endpoint".to_owned());
    }

    let model_names = models
        .iter()
        .map(|model| model.name.as_str())
        .collect::<Vec<_>>();

    let agents = request
        .agents
        .into_iter()
        .map(|agent| AgentDef {
            name: agent.name.trim().to_owned(),
            role: agent.role.trim().to_owned(),
            system_prompt: agent.system_prompt.trim().to_owned(),
            model: agent.model.trim().to_owned(),
        })
        .collect::<Vec<_>>();
    if agents.iter().any(|agent| {
        agent.name.is_empty() || agent.role.is_empty() || agent.system_prompt.is_empty()
    }) {
        return Err("Each agent must include a name, role, and system prompt".to_owned());
    }
    if agents
        .iter()
        .any(|agent| !model_names.iter().any(|name| *name == agent.model))
    {
        return Err("Each agent must reference a configured model".to_owned());
    }

    let blueprint = BlueprintFile {
        blueprint: BlueprintMeta {
            name: normalized_name.to_owned(),
            version: normalized_version.to_owned(),
            description: normalized_description.to_owned(),
        },
        domain: DomainConfig {
            repo_path: normalized_repo_path.to_owned(),
            target_files,
            language: normalized_language.to_owned(),
        },
        constraints: ConstraintsConfig {
            max_iterations: request.max_iterations,
            timeout_seconds: request.timeout_seconds,
            require_tests_pass: request.require_tests_pass,
            min_improvement: request.min_improvement,
        },
        metrics: MetricsConfig { metrics },
        agents: AgentsConfig {
            council_size: request.council_size,
            debate_rounds: request.debate_rounds,
            agents,
        },
        models: ModelsConfig {
            assignment: request.model_assignment,
            models,
        },
        evaluator: existing_blueprint.and_then(|blueprint| blueprint.evaluator.clone()),
        library: existing_blueprint
            .and_then(|blueprint| blueprint.library.clone())
            .map(|mut library| {
                library.kind = BlueprintLibraryKind::Workflow;
                library.setup_required = false;
                library.template = Some(selected_template);
                library
            })
            .or_else(|| {
                Some(BlueprintLibraryMeta {
                    kind: BlueprintLibraryKind::Workflow,
                    setup_required: false,
                    template: Some(selected_template),
                })
            }),
    };

    blueprint
        .validate()
        .map_err(|error| format!("Failed to validate blueprint: {error}"))?;

    Ok(blueprint)
}

fn write_blueprint_file(path: &Path, blueprint: &BlueprintFile) -> Result<(), String> {
    let toml = toml::to_string_pretty(blueprint)
        .map_err(|error| format!("Failed to serialize blueprint: {error}"))?;
    std::fs::write(path, toml)
        .map_err(|error| format!("Failed to write blueprint file: {error}"))?;
    Ok(())
}

fn next_blueprint_path(directory: &Path, blueprint_name: &str) -> PathBuf {
    let base_slug = slugify_blueprint_name(blueprint_name);
    let mut candidate = directory.join(format!("{base_slug}.toml"));
    let mut suffix = 2_u32;

    while candidate.exists() {
        candidate = directory.join(format!("{base_slug}-{suffix}.toml"));
        suffix += 1;
    }

    candidate
}

fn slugify_blueprint_name(input: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_dash = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_was_dash = false;
        } else if !previous_was_dash {
            slug.push('-');
            previous_was_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_owned();
    if slug.is_empty() {
        "blueprint".to_owned()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_directory(name: &str) -> PathBuf {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("maabarium-desktop-{name}-{unique_id}"))
    }

    fn test_app_state() -> AppState {
        let blueprints_dir = PathBuf::from("blueprints");
        AppState {
            blueprints_dir: blueprints_dir.clone(),
            blueprint_path: Mutex::new(blueprints_dir.join("example.toml")),
            settings_path: PathBuf::from("data/desktop-setup.json"),
            hardware_sampler: Mutex::new(HardwareTelemetrySampler::default()),
            db_path: PathBuf::from("data/maabarium.db"),
            log_path: PathBuf::from("data/maabarium.log"),
            engine_cancel: Mutex::new(None),
            engine_running: Arc::new(AtomicBool::new(false)),
            run_state: Arc::new(Mutex::new(MutableRunState::default())),
        }
    }

    #[test]
    fn update_blueprint_path_releases_lock_before_follow_up() {
        let state = test_app_state();
        let next_path = PathBuf::from("blueprints/rust-code-quality.toml");

        let observed_path = update_blueprint_path(&state, next_path.clone(), |state| {
            {
                let guard = state
                    .blueprint_path
                    .try_lock()
                    .expect("blueprint path lock should be released before follow-up work");
                assert_eq!(*guard, next_path);
            }
            Ok(current_blueprint_path(state))
        })
        .expect("path update should succeed");

        assert_eq!(
            observed_path,
            PathBuf::from("blueprints/rust-code-quality.toml")
        );
    }

    #[test]
    fn copy_blueprint_files_if_missing_only_adds_missing_toml_files() {
        let source_directory = unique_test_directory("source-blueprints");
        let target_directory = unique_test_directory("target-blueprints");

        std::fs::create_dir_all(&source_directory).expect("source directory should be created");
        std::fs::create_dir_all(&target_directory).expect("target directory should be created");
        std::fs::write(source_directory.join("example.toml"), "name = 'bundled'\n")
            .expect("source example blueprint should be written");
        std::fs::write(source_directory.join("notes.txt"), "ignore me\n")
            .expect("non-blueprint file should be written");
        std::fs::write(target_directory.join("example.toml"), "name = 'existing'\n")
            .expect("existing target blueprint should be written");
        std::fs::write(
            source_directory.join("code-quality.toml"),
            "name = 'quality'\n",
        )
        .expect("source code-quality blueprint should be written");

        let copied = copy_blueprint_files_if_missing(&source_directory, &target_directory)
            .expect("copy should succeed");

        assert_eq!(copied, 1);
        assert_eq!(
            std::fs::read_to_string(target_directory.join("example.toml"))
                .expect("existing blueprint should still exist"),
            "name = 'existing'\n"
        );
        assert_eq!(
            std::fs::read_to_string(target_directory.join("code-quality.toml"))
                .expect("missing blueprint should be copied"),
            "name = 'quality'\n"
        );
        assert!(!target_directory.join("notes.txt").exists());

        std::fs::remove_dir_all(&source_directory).expect("source directory should be removed");
        std::fs::remove_dir_all(&target_directory).expect("target directory should be removed");
    }

    #[test]
    fn hardware_sampler_reports_live_cpu_and_explicit_unavailable_accelerators() {
        let mut sampler = HardwareTelemetrySampler::default();

        let telemetry = sampler.sample();

        assert!(telemetry.sampled_at_epoch_ms > 0);
        assert!(matches!(
            telemetry.cpu.status,
            HardwareSensorStatus::Partial
        ));
        assert!(telemetry.cpu.utilization_percent.is_some());
        assert!(matches!(
            telemetry.gpu.status,
            HardwareSensorStatus::Unavailable
        ));
        assert!(telemetry.gpu.utilization_percent.is_none());
        assert!(matches!(
            telemetry.npu.status,
            HardwareSensorStatus::Unavailable
        ));
    }

    #[test]
    fn resolved_update_channel_uses_saved_desktop_preference() {
        let mut setup = DesktopSetupState::default();
        setup.preferred_update_channel = Some("beta".to_owned());

        assert_eq!(resolved_update_channel(Some(&setup)), "beta");
    }

    #[test]
    fn resolved_update_channel_ignores_unsupported_saved_value() {
        let mut setup = DesktopSetupState::default();
        setup.preferred_update_channel = Some("nightly".to_owned());

        assert_eq!(resolved_update_channel(Some(&setup)), "stable");
    }

    #[test]
    fn resolved_update_endpoint_prefers_compiled_manifest_url() {
        let endpoint = resolved_update_endpoint(
            None,
            None,
            Some(" https://downloads.maabarium.com/beta/latest.json "),
            None,
            "beta",
        );

        assert_eq!(
            endpoint.as_deref(),
            Some("https://downloads.maabarium.com/beta/latest.json")
        );
    }

    #[test]
    fn resolved_update_endpoint_falls_back_to_base_url_and_channel() {
        let endpoint = resolved_update_endpoint(
            None,
            Some(" https://downloads.maabarium.com/ ".to_owned()),
            None,
            None,
            "stable",
        );

        assert_eq!(
            endpoint.as_deref(),
            Some("https://downloads.maabarium.com/stable/latest.json")
        );
    }

    #[test]
    fn resolved_update_pubkey_prefers_runtime_value() {
        let pubkey = resolved_update_pubkey(
            Some(" runtime-pubkey ".to_owned()),
            Some("compiled-pubkey"),
        );

        assert_eq!(pubkey.as_deref(), Some("runtime-pubkey"));
    }

    #[test]
    fn resolved_update_pubkey_falls_back_to_compiled_value() {
        let pubkey = resolved_update_pubkey(Some("   ".to_owned()), Some(" compiled-pubkey "));

        assert_eq!(pubkey.as_deref(), Some("compiled-pubkey"));
    }
}
