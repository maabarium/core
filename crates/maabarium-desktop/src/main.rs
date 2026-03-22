use anyhow::Context;
use chrono::{DateTime, Datelike, Duration as ChronoDuration, NaiveDate, Utc};
use maabarium_core::blueprint::{
    AgentDef, AgentsConfig, BlueprintLibraryKind, BlueprintLibraryMeta, BlueprintMeta,
    BlueprintTemplateKind, ConstraintsConfig, DomainConfig, MetricDef, MetricsConfig,
    ModelAssignment, ModelDef, ModelsConfig,
};
use maabarium_core::{
    default_db_path, default_log_path, read_recent_log_lines, BlueprintFile, Engine,
    EngineConfig, EvaluatorRegistry, Persistence, PersistedProposal,
};
use maabarium_core::persistence::PersistedExperiment;
use serde::{Deserialize, Serialize};
use tauri_plugin_updater::UpdaterExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use tracing_subscriber::prelude::*;
use url::Url;

struct AppState {
    blueprint_path: Mutex<PathBuf>,
    hardware_sampler: Mutex<HardwareTelemetrySampler>,
    db_path: PathBuf,
    log_path: PathBuf,
    engine_cancel: Mutex<Option<CancellationToken>>,
    engine_running: Arc<AtomicBool>,
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

#[derive(Debug, Clone)]
struct UpdateRuntimeConfig {
    channel: String,
    endpoint: String,
    pubkey: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleState {
    engine_running: bool,
    blueprint_path: String,
    db_path: String,
    log_path: String,
    hardware_telemetry: HardwareTelemetry,
    blueprint: Option<BlueprintFile>,
    blueprint_error: Option<String>,
    evaluator_kind: Option<String>,
    available_blueprints: Vec<BlueprintOption>,
    run_analytics: RunAnalytics,
    updater: UpdaterConfigurationState,
    experiments: Vec<PersistedExperiment>,
    proposals: Vec<PersistedProposal>,
    logs: Vec<String>,
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
    #[serde(rename = "template")]
    _template: BlueprintWizardTemplate,
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

fn main() {
    let _log_guard = init_tracing().expect("failed to initialize tracing");

    let state = AppState {
        blueprint_path: Mutex::new(default_blueprint_path()),
        hardware_sampler: Mutex::new(HardwareTelemetrySampler::default()),
        db_path: default_db_path(),
        log_path: default_log_path(),
        engine_cancel: Mutex::new(None),
        engine_running: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_console_state,
            start_engine,
            stop_engine,
            open_log_file,
            open_blueprint_file,
            open_blueprint_directory,
            create_blueprint_from_wizard,
            set_blueprint_path,
            check_for_updates,
            install_available_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn default_blueprint_path() -> PathBuf {
    default_blueprints_directory().join("example.toml")
}

fn default_blueprints_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../blueprints")
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

    info!(log_path = %log_path.display(), "Desktop tracing initialized");
    Ok(guard)
}

fn build_console_state(state: &AppState) -> ConsoleState {
    let blueprint_path = current_blueprint_path(state);
    let hardware_telemetry = sample_hardware_telemetry(state);
    let blueprint_result = BlueprintFile::load(&blueprint_path);
    let available_blueprints = discover_available_blueprints(&blueprint_path);
    let evaluator_kind = blueprint_result
        .as_ref()
        .ok()
        .map(EvaluatorRegistry::resolve_builtin)
        .map(|kind| kind.as_str().to_owned());
    let (experiments, run_analytics, proposals) = Persistence::open(&state.db_path.display().to_string())
        .map(|persistence| {
            let recent_experiments = persistence.recent_experiments(400).unwrap_or_default();
            let console_experiments = recent_experiments.iter().take(12).cloned().collect::<Vec<_>>();
            let run_analytics = build_run_analytics(&recent_experiments, &state.log_path);
            let proposals = persistence.recent_proposals(5).unwrap_or_default();
            (console_experiments, run_analytics, proposals)
        })
        .unwrap_or_else(|_| {
            (
                Vec::new(),
                empty_run_analytics(),
                Vec::new(),
            )
        });
    let logs = read_recent_log_lines(40).unwrap_or_default();
    let updater = describe_updater_configuration();

    match blueprint_result {
        Ok(blueprint) => ConsoleState {
            engine_running: state.engine_running.load(Ordering::SeqCst),
            blueprint_path: blueprint_path.display().to_string(),
            db_path: state.db_path.display().to_string(),
            log_path: state.log_path.display().to_string(),
            hardware_telemetry,
            blueprint: Some(blueprint),
            blueprint_error: None,
            evaluator_kind,
            available_blueprints,
            run_analytics,
            updater,
            experiments,
            proposals,
            logs,
        },
        Err(error) => ConsoleState {
            engine_running: state.engine_running.load(Ordering::SeqCst),
            blueprint_path: blueprint_path.display().to_string(),
            db_path: state.db_path.display().to_string(),
            log_path: state.log_path.display().to_string(),
            hardware_telemetry,
            blueprint: None,
            blueprint_error: Some(error.to_string()),
            evaluator_kind,
            available_blueprints,
            run_analytics,
            updater,
            experiments,
            proposals,
            logs,
        },
    }
}

fn discover_available_blueprints(active_path: &Path) -> Vec<BlueprintOption> {
    let blueprint_directory = active_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_blueprints_directory);

    let mut blueprints = std::fs::read_dir(&blueprint_directory)
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
        .map(|path| blueprint_option_from_path(&path, active_path))
        .collect::<Vec<_>>();

    if !blueprints.iter().any(|blueprint| blueprint.path == active_path.display().to_string()) {
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
    let language = blueprint.as_ref().map(|loaded| loaded.domain.language.clone());
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
    let today = Utc::now().date_naive();
    let experiment_dates = experiments
        .iter()
        .filter_map(|experiment| parse_timestamp(&experiment.created_at).map(|date| date.date_naive()))
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
    token_events: &[(DateTime<Utc>, u64)],
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
    token_events: &[(DateTime<Utc>, u64)],
) -> Vec<AnalyticsBucket> {
    let current_week_start = today - ChronoDuration::days(i64::from(today.weekday().num_days_from_monday()));

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
    token_events: &[(DateTime<Utc>, u64)],
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

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn read_token_usage_events(log_path: &Path) -> Vec<(DateTime<Utc>, u64)> {
    let content = std::fs::read_to_string(log_path).unwrap_or_default();
    content
        .lines()
        .filter_map(parse_token_usage_event)
        .collect()
}

fn parse_token_usage_event(line: &str) -> Option<(DateTime<Utc>, u64)> {
    let timestamp = parse_timestamp(line.split_whitespace().next()?)?;
    let marker = "tokens_used=";
    let start = line.find(marker)? + marker.len();
    let digits = line[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    let token_usage = digits.parse::<u64>().ok()?;
    Some((timestamp, token_usage))
}

fn update_channel_from_env() -> String {
    std::env::var("MAABARIUM_UPDATE_CHANNEL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "stable".to_owned())
}

fn update_endpoint_from_env(channel: &str) -> Option<String> {
    if let Ok(endpoint) = std::env::var("MAABARIUM_UPDATE_MANIFEST_URL") {
        let endpoint = endpoint.trim().to_owned();
        if !endpoint.is_empty() {
            return Some(endpoint);
        }
    }

    std::env::var("MAABARIUM_UPDATE_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .map(|base_url| format!("{base_url}/{channel}/latest.json"))
}

fn update_pubkey_from_env() -> Option<String> {
    std::env::var("MAABARIUM_UPDATE_PUBKEY")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn describe_updater_configuration() -> UpdaterConfigurationState {
    let channel = update_channel_from_env();
    let endpoint = update_endpoint_from_env(&channel);
    let configured = endpoint.is_some() && update_pubkey_from_env().is_some();

    UpdaterConfigurationState {
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
        channel,
        endpoint,
        configured,
    }
}

fn update_runtime_configuration() -> Result<UpdateRuntimeConfig, String> {
    let channel = update_channel_from_env();
    let endpoint = update_endpoint_from_env(&channel)
        .ok_or_else(|| "Set MAABARIUM_UPDATE_MANIFEST_URL or MAABARIUM_UPDATE_BASE_URL to enable desktop updates".to_owned())?;
    let pubkey = update_pubkey_from_env()
        .ok_or_else(|| "Set MAABARIUM_UPDATE_PUBKEY to enable desktop updates".to_owned())?;

    Ok(UpdateRuntimeConfig {
        channel,
        endpoint,
        pubkey,
    })
}

fn configured_updater(app: &tauri::AppHandle) -> Result<(tauri_plugin_updater::Updater, UpdateRuntimeConfig), String> {
    let config = update_runtime_configuration()?;
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
    let blueprint_path = current_blueprint_path(&state);
    let directory = blueprint_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_blueprints_directory);
    open_path_in_system_viewer(&directory)
}

#[tauri::command]
fn set_blueprint_path(state: tauri::State<'_, AppState>, path: String) -> Result<ConsoleState, String> {
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

    BlueprintFile::load(&selected_path)
        .map_err(|error| format!("Failed to load blueprint {}: {error}", selected_path.display()))?;

    update_blueprint_path(&state, selected_path, |state| Ok(build_console_state(state)))
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let channel = update_channel_from_env();
    let endpoint = update_endpoint_from_env(&channel);
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

    let (updater, config) = configured_updater(&app)?;
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
async fn install_available_update(app: tauri::AppHandle) -> Result<InstallUpdateResult, String> {
    let (updater, _) = configured_updater(&app)?;
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
fn create_blueprint_from_wizard(
    state: tauri::State<'_, AppState>,
    request: CreateBlueprintWizardRequest,
) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("Stop the engine before creating a blueprint".to_owned());
    }

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
    if metrics.iter().any(|metric| metric.name.is_empty() || metric.description.is_empty()) {
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
    if models
        .iter()
        .any(|model| model.name.is_empty() || model.provider.is_empty() || model.endpoint.is_empty())
    {
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
    if agents
        .iter()
        .any(|agent| agent.name.is_empty() || agent.role.is_empty() || agent.system_prompt.is_empty())
    {
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
            library: Some(BlueprintLibraryMeta {
                kind: BlueprintLibraryKind::Workflow,
                setup_required: false,
                template: None,
            }),
    };

    blueprint
        .validate()
        .map_err(|error| format!("Failed to validate blueprint: {error}"))?;

    let blueprint_directory = default_blueprints_directory();
    std::fs::create_dir_all(&blueprint_directory)
        .map_err(|error| format!("Failed to create blueprint directory: {error}"))?;

    let blueprint_path = next_blueprint_path(&blueprint_directory, normalized_name);
    let toml = toml::to_string_pretty(&blueprint)
        .map_err(|error| format!("Failed to serialize blueprint: {error}"))?;
    std::fs::write(&blueprint_path, toml)
        .map_err(|error| format!("Failed to write blueprint file: {error}"))?;

    update_blueprint_path(&state, blueprint_path, |state| Ok(build_console_state(state)))
}

#[tauri::command]
fn start_engine(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    if state.engine_running.load(Ordering::SeqCst) {
        return Err("The engine is already running".to_owned());
    }

    let blueprint_path = current_blueprint_path(&state);
    let db_path = state.db_path.clone();
    let running_flag = state.engine_running.clone();
    let cancel = CancellationToken::new();
    let cancel_for_thread = cancel.clone();

    {
        let mut engine_cancel = state
            .engine_cancel
            .lock()
            .map_err(|_| "Failed to acquire engine state lock".to_owned())?;
        *engine_cancel = Some(cancel);
    }

    running_flag.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                error!(?error, "Failed to create desktop runtime");
                running_flag.store(false, Ordering::SeqCst);
                return;
            }
        };

        runtime.block_on(async move {
            let outcome = async {
                let blueprint = BlueprintFile::load(&blueprint_path)
                    .with_context(|| format!("Failed to load blueprint {}", blueprint_path.display()))?;
                let evaluator = EvaluatorRegistry::build_builtin(&blueprint)
                    .context("Failed to build evaluator")?;
                let engine = Engine::new(
                    EngineConfig {
                        blueprint,
                        db_path: db_path.display().to_string(),
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
        });
    });

    Ok(build_console_state(&state))
}

#[tauri::command]
fn stop_engine(state: tauri::State<'_, AppState>) -> Result<ConsoleState, String> {
    if let Ok(mut engine_cancel) = state.engine_cancel.lock() {
        if let Some(cancel) = engine_cancel.take() {
            cancel.cancel();
        }
    }
    state.engine_running.store(false, Ordering::SeqCst);
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

    fn test_app_state() -> AppState {
        AppState {
            blueprint_path: Mutex::new(PathBuf::from("blueprints/example.toml")),
            hardware_sampler: Mutex::new(HardwareTelemetrySampler::default()),
            db_path: PathBuf::from("data/maabarium.db"),
            log_path: PathBuf::from("data/maabarium.log"),
            engine_cancel: Mutex::new(None),
            engine_running: Arc::new(AtomicBool::new(false)),
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

        assert_eq!(observed_path, PathBuf::from("blueprints/rust-code-quality.toml"));
    }

    #[test]
    fn hardware_sampler_reports_live_cpu_and_explicit_unavailable_accelerators() {
        let mut sampler = HardwareTelemetrySampler::default();

        let telemetry = sampler.sample();

        assert!(telemetry.sampled_at_epoch_ms > 0);
        assert!(matches!(telemetry.cpu.status, HardwareSensorStatus::Partial));
        assert!(telemetry.cpu.utilization_percent.is_some());
        assert!(matches!(telemetry.gpu.status, HardwareSensorStatus::Unavailable));
        assert!(telemetry.gpu.utilization_percent.is_none());
        assert!(matches!(telemetry.npu.status, HardwareSensorStatus::Unavailable));
    }
}