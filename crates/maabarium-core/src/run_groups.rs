//! Groups blueprints for scheduled, sequential or parallel execution.
//!
//! A run group collects one or more blueprint workflows that can be executed together.
//! The execution can be sequential (default) or parallel (if hardware permits).

use serde::{Deserialize, Serialize};

/// How workflows in a group should be executed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    /// Run workflows one after another.
    Sequential,
    /// Run workflows simultaneously (user-confirmed or auto-detected feasible).
    Parallel,
}

impl Default for ExecutionMode {
    fn default() -> Self {
        Self::Sequential
    }
}

impl ExecutionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sequential => "sequential",
            Self::Parallel => "parallel",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "sequential" => Some(Self::Sequential),
            "parallel" => Some(Self::Parallel),
            _ => None,
        }
    }
}

/// A single blueprint entry within a run group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupBlueprintEntry {
    /// Display name for this blueprint.
    pub blueprint_name: String,
    /// Path to the blueprint TOML file.
    pub blueprint_path: String,
    /// Sort order within the group (0-based).
    pub sort_order: u32,
    /// Whether Telegram notifications are enabled for this workflow.
    #[serde(default = "default_notifications_enabled")]
    pub notifications_enabled: bool,
}

const fn default_notifications_enabled() -> bool {
    true
}

/// What kind of schedule a run group has.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    /// No schedule; manual execution only.
    None,
    /// Recurring cron schedule (e.g. "0 9 * * 1" = Mondays at 9 AM).
    Cron {
        /// Standard 5-field cron expression.
        expression: String,
    },
    /// One-shot schedule at a specific datetime (ISO 8601).
    OneShot {
        /// ISO 8601 datetime string (e.g. "2026-05-15T14:30:00Z").
        datetime: String,
    },
}

impl Default for ScheduleKind {
    fn default() -> Self {
        Self::None
    }
}

impl ScheduleKind {
    pub fn as_db_type(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Cron { .. } => "cron",
            Self::OneShot { .. } => "one_shot",
        }
    }

    pub fn from_db_type(db_type: &str) -> Self {
        match db_type {
            "cron" => Self::Cron {
                expression: String::new(),
            },
            "one_shot" => Self::OneShot {
                datetime: String::new(),
            },
            _ => Self::None,
        }
    }

    /// Human-readable description of the schedule.
    pub fn describe(&self) -> String {
        match self {
            Self::None => "Not scheduled".to_owned(),
            Self::Cron { expression } => describe_cron(expression),
            Self::OneShot { datetime } => {
                // Try to parse and format nicely
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(datetime) {
                    format!("{} (one-time)", dt.format("%a %Y-%m-%d %H:%M"))
                } else {
                    format!("{} (one-time)", datetime)
                }
            }
        }
    }

    /// Return true if this schedule is due right now.
    /// `last_run_at` is the ISO timestamp of the last execution (None = never run).
    pub fn is_due(&self, last_run_at: Option<&str>, now: &chrono::DateTime<chrono::Utc>) -> bool {
        match self {
            Self::None => false,
            Self::Cron { expression } => {
                if let Some(last) =
                    last_run_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                {
                    // Parse cron and check if we're past the next occurrence
                    match parse_cron_next(expression, &last) {
                        Some(next_run) => *now > next_run,
                        None => false,
                    }
                } else {
                    // Never run: due if now aligns with the cron expression.
                    cron_matches_now(expression, now)
                }
            }
            Self::OneShot { datetime } => {
                if let Ok(scheduled_dt) = chrono::DateTime::parse_from_rfc3339(datetime) {
                    // One-shot is due if the scheduled time has passed and it hasn't run yet
                    let has_run = last_run_at.is_some();
                    *now >= scheduled_dt && !has_run
                } else {
                    false
                }
            }
        }
    }
}

/// Schedule configuration for a run group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledRun {
    /// What kind of schedule this is.
    #[serde(default)]
    pub kind: ScheduleKind,
    /// Whether the schedule is active.
    #[serde(default = "default_schedule_enabled")]
    pub enabled: bool,
    /// ISO timestamp of last execution.
    pub last_run_at: Option<String>,
    /// ISO timestamp of next scheduled execution.
    pub next_run_at: Option<String>,
}

const fn default_schedule_enabled() -> bool {
    true
}

/// Parse a cron expression and compute the next run time after a given timestamp.
/// Returns None if parsing fails.
fn parse_cron_next(
    expression: &str,
    after: &chrono::DateTime<chrono::FixedOffset>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    let parts: Vec<&str> = expression.split_whitespace().collect();
    if parts.len() != 5 {
        return None;
    }

    let minute = parts[0];
    let hour = parts[1];
    let _day_of_month = parts[2];
    let _month = parts[3];
    let day_of_week = parts[4];

    // Simple next-run computation for common patterns
    // "0 9 * * 1" = Mondays at 09:00
    // "0 17 * * *" = Every day at 17:00
    // "*/30 * * * *" = Every 30 minutes

    let after_utc = after.with_timezone(&chrono::Utc);
    let mut candidate = after_utc.checked_add_signed(chrono::Duration::minutes(1))?;

    // Search up to 7 days forward for the next matching time
    for _ in 0..(7 * 24 * 60) {
        let candidate_minute = candidate.format("%M").to_string();
        let candidate_hour = candidate.format("%H").to_string();
        let candidate_dow = candidate.format("%u").to_string(); // 1=Mon..7=Sun

        let minute_match = cron_field_matches(minute, &candidate_minute);
        let hour_match = cron_field_matches(hour, &candidate_hour);
        let dow_match = cron_field_matches(day_of_week, &candidate_dow);

        if minute_match && hour_match && dow_match {
            return Some(candidate);
        }
        candidate = candidate.checked_add_signed(chrono::Duration::minutes(1))?;
    }

    None
}

/// Check if a cron field value matches the current value.
/// Supports: exact match, */step, comma lists, ranges.
/// Numeric values are compared after stripping leading zeros.
fn cron_field_matches(field: &str, current: &str) -> bool {
    if field == "*" {
        return true;
    }

    // Strip leading zeros for numeric comparison
    let current_trimmed = current.trim_start_matches('0');
    let current_stripped = if current_trimmed.is_empty() {
        "0"
    } else {
        current_trimmed
    };
    let field_trimmed = field.trim_start_matches('0');
    let field_stripped = if field_trimmed.is_empty() {
        "0"
    } else {
        field_trimmed
    };

    // Handle */N (step)
    if let Some(step_str) = field.strip_prefix("*/") {
        if let (Ok(step), Ok(curr)) = (step_str.parse::<u32>(), current_stripped.parse::<u32>()) {
            return step > 0 && curr % step == 0;
        }
    }

    // Handle comma-separated lists
    if field.contains(',') {
        return field
            .split(',')
            .any(|part| cron_field_matches(part.trim(), current));
    }

    // Handle N-M ranges
    if let Some((start_str, end_str)) = field.split_once('-') {
        if let (Ok(start), Ok(end), Ok(curr)) = (
            start_str.parse::<u32>(),
            end_str.parse::<u32>(),
            current_stripped.parse::<u32>(),
        ) {
            return curr >= start && curr <= end;
        }
    }

    // Exact match (try both stripped and original)
    field == current || field_stripped == current_stripped
}

/// Check if a cron expression matches the current time (within a 1-minute window).
fn cron_matches_now(expression: &str, now: &chrono::DateTime<chrono::Utc>) -> bool {
    let parts: Vec<&str> = expression.split_whitespace().collect();
    if parts.len() != 5 {
        return false;
    }

    let now_str = now.format("%M %H %u").to_string();
    let now_parts: Vec<&str> = now_str.split_whitespace().collect();

    cron_field_matches(parts[0], now_parts[0])
        && cron_field_matches(parts[1], now_parts[1])
        && cron_field_matches(parts[4], now_parts[2])
}

/// Produce a human-readable description of a cron expression.
fn describe_cron(expression: &str) -> String {
    let parts: Vec<&str> = expression.split_whitespace().collect();
    if parts.len() != 5 {
        return format!("cron: {expression}");
    }

    let minute_str = parts[0];
    let hour_str = parts[1];
    let _dom = parts[2];
    let _month = parts[3];
    let dow = parts[4];

    let minute_val: u32 = minute_str.parse().unwrap_or(0);
    let hour_val: u32 = hour_str.parse().unwrap_or(0);

    let time_desc = if hour_str == "*" && minute_str == "*" {
        "every minute".to_owned()
    } else if hour_str == "*" {
        format!("at minute {minute_str} past every hour")
    } else if minute_str == "0" {
        format!("at {:02}:00", hour_val)
    } else {
        format!("at {:02}:{:02}", hour_val, minute_val)
    };

    let day_desc = match dow {
        "*" => String::new(),
        "0" | "7" => " on Sunday".to_owned(),
        "1" => " on Monday".to_owned(),
        "2" => " on Tuesday".to_owned(),
        "3" => " on Wednesday".to_owned(),
        "4" => " on Thursday".to_owned(),
        "5" => " on Friday".to_owned(),
        "6" => " on Saturday".to_owned(),
        other => format!(" on day {other}"),
    };

    if day_desc.is_empty() {
        time_desc
    } else {
        format!("{time_desc}{day_desc}")
    }
}

/// A workflow run group definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunGroup {
    /// Unique name for this group.
    pub name: String,
    /// Human-readable description.
    #[serde(default)]
    pub description: String,
    /// When this group was created (RFC 3339).
    pub created_at: String,
    /// Ordered list of blueprints in this group.
    #[serde(default)]
    pub blueprints: Vec<GroupBlueprintEntry>,
    /// How to execute the workflows.
    #[serde(default)]
    pub execution_mode: ExecutionMode,
    /// Optional schedule for recurring execution.
    pub schedule: Option<ScheduledRun>,
    /// Whether Telegram notifications are enabled for this group.
    #[serde(default = "default_notifications_enabled")]
    pub telegram_enabled: bool,
}

/// Status of an individual group run.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GroupRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl GroupRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

/// Status of a single workflow within a group run.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunExperimentStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl RunExperimentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "skipped" => Self::Skipped,
            _ => Self::Pending,
        }
    }
}

/// A record of a group execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRun {
    /// Unique run ID (short UUID).
    pub id: String,
    /// Group name this run belongs to.
    pub group_name: String,
    /// Execution mode used for this run.
    pub execution_mode: ExecutionMode,
    /// ISO timestamp when the run started.
    pub started_at: Option<String>,
    /// ISO timestamp when the run completed.
    pub completed_at: Option<String>,
    /// Overall status.
    pub status: GroupRunStatus,
    /// Human-readable summary of outcomes.
    pub summary: Option<String>,
}

/// An experiment record within a group run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRunExperiment {
    /// Database ID.
    pub id: i64,
    /// Group run ID this belongs to.
    pub group_run_id: String,
    /// FK into the experiments table (nullable for failed/skipped).
    pub experiment_id: Option<i64>,
    /// Blueprint name.
    pub blueprint_name: String,
    /// Blueprint path.
    pub blueprint_path: String,
    /// Sort order.
    pub sort_order: u32,
    /// Per-experiment status.
    pub status: RunExperimentStatus,
    /// ISO timestamp when this experiment started.
    pub started_at: Option<String>,
    /// ISO timestamp when this experiment completed.
    pub completed_at: Option<String>,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Hardware resources detected on the current machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareProfile {
    /// Number of logical CPU cores.
    pub logical_cpus: u32,
    /// Total physical memory in GB.
    pub total_memory_gb: f64,
    /// Whether a GPU is available.
    pub gpu_available: bool,
    /// GPU VRAM in GB (if detectable).
    pub gpu_vram_gb: Option<f64>,
}

impl HardwareProfile {
    /// Detect hardware resources on the current machine.
    pub fn detect() -> Self {
        let logical_cpus = num_cpus::get() as u32;
        let total_memory_gb = {
            // Use sys-info or fallback to heuristics
            #[cfg(target_os = "macos")]
            {
                match std::process::Command::new("sysctl")
                    .arg("-n")
                    .arg("hw.memsize")
                    .output()
                {
                    Ok(output) => {
                        let bytes: u64 = String::from_utf8_lossy(&output.stdout)
                            .trim()
                            .parse()
                            .unwrap_or(8_589_934_592); // 8 GB fallback
                        bytes as f64 / 1_073_741_824.0
                    }
                    Err(_) => 8.0,
                }
            }
            #[cfg(target_os = "linux")]
            {
                match std::fs::read_to_string("/proc/meminfo") {
                    Ok(content) => {
                        for line in content.lines() {
                            if line.starts_with("MemTotal:") {
                                if let Some(kb_str) = line.split_whitespace().nth(1) {
                                    let kb: u64 = kb_str.parse().unwrap_or(8_388_608);
                                    return kb as f64 / 1_048_576.0;
                                }
                            }
                        }
                        8.0
                    }
                    Err(_) => 8.0,
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            {
                8.0
            }
        };

        let (gpu_available, gpu_vram_gb) = detect_gpu();

        Self {
            logical_cpus,
            total_memory_gb,
            gpu_available,
            gpu_vram_gb,
        }
    }

    /// Determine if parallel execution of `workflow_count` workflows is feasible.
    ///
    /// Heuristic: needs at least 4 CPUs and 8 GB free per workflow.
    /// GPU availability can relax CPU requirements slightly.
    pub fn parallel_feasible(&self, workflow_count: usize) -> bool {
        if workflow_count <= 1 {
            return false; // no benefit
        }

        let min_cpus_per_workflow = if self.gpu_available { 2 } else { 4 };
        let min_memory_gb_per_workflow = if self.gpu_vram_gb.is_some_and(|vram| vram >= 8.0) {
            4.0
        } else {
            8.0
        };

        let needed_cpus = (workflow_count as u32) * min_cpus_per_workflow;
        let needed_memory = (workflow_count as f64) * min_memory_gb_per_workflow;

        // Use at most 75% of available resources as a safety margin
        let available_cpus = (self.logical_cpus as f64 * 0.75) as u32;
        let available_memory = self.total_memory_gb * 0.75;

        let cpus_ok = available_cpus >= needed_cpus;
        let memory_ok = available_memory >= needed_memory;

        cpus_ok && memory_ok
    }

    /// Suggest an execution mode based on hardware.
    pub fn suggest_execution_mode(&self, workflow_count: usize) -> ExecutionMode {
        if self.parallel_feasible(workflow_count) {
            ExecutionMode::Parallel
        } else {
            ExecutionMode::Sequential
        }
    }
}

/// Detect GPU availability and VRAM.
fn detect_gpu() -> (bool, Option<f64>) {
    // Check NVIDIA GPU
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=memory.total")
        .arg("--format=csv,noheader,nounits")
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(vram_str) = stdout.lines().next() {
            if let Ok(vram_mb) = vram_str.trim().parse::<f64>() {
                return (true, Some(vram_mb / 1024.0));
            }
        }
        return (true, None);
    }

    // Check Apple Metal (macOS)
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("system_profiler")
            .args(["SPDisplaysDataType"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("Metal") || stdout.contains("Apple") || stdout.contains("GPU") {
                // Try to extract VRAM
                for line in stdout.lines() {
                    if line.contains("VRAM") || line.contains("vram") {
                        if let Some(vram_str) = line.split(':').nth(1) {
                            let cleaned = vram_str.trim().to_lowercase();
                            // e.g. "8 GB" or "16384 MB"
                            if cleaned.ends_with("gb") {
                                if let Ok(vram) =
                                    cleaned.trim_end_matches("gb").trim().parse::<f64>()
                                {
                                    return (true, Some(vram));
                                }
                            } else if cleaned.ends_with("mb") {
                                if let Ok(vram_mb) =
                                    cleaned.trim_end_matches("mb").trim().parse::<f64>()
                                {
                                    return (true, Some(vram_mb / 1024.0));
                                }
                            }
                        }
                    }
                }
                return (true, None);
            }
        }
    }

    (false, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_mode_round_trip() {
        assert_eq!(
            ExecutionMode::from_str("sequential"),
            Some(ExecutionMode::Sequential)
        );
        assert_eq!(
            ExecutionMode::from_str("parallel"),
            Some(ExecutionMode::Parallel)
        );
        assert_eq!(ExecutionMode::from_str("unknown"), None);
        assert_eq!(ExecutionMode::Sequential.as_str(), "sequential");
        assert_eq!(ExecutionMode::Parallel.as_str(), "parallel");
    }

    #[test]
    fn group_run_status_round_trip() {
        assert_eq!(GroupRunStatus::from_str("pending"), GroupRunStatus::Pending);
        assert_eq!(GroupRunStatus::from_str("running"), GroupRunStatus::Running);
        assert_eq!(
            GroupRunStatus::from_str("completed"),
            GroupRunStatus::Completed
        );
        assert_eq!(GroupRunStatus::from_str("failed"), GroupRunStatus::Failed);
        assert_eq!(
            GroupRunStatus::from_str("cancelled"),
            GroupRunStatus::Cancelled
        );
        assert_eq!(GroupRunStatus::from_str("unknown"), GroupRunStatus::Pending);
    }

    #[test]
    fn run_experiment_status_round_trip() {
        assert_eq!(
            RunExperimentStatus::from_str("pending"),
            RunExperimentStatus::Pending
        );
        assert_eq!(
            RunExperimentStatus::from_str("running"),
            RunExperimentStatus::Running
        );
        assert_eq!(
            RunExperimentStatus::from_str("completed"),
            RunExperimentStatus::Completed
        );
        assert_eq!(
            RunExperimentStatus::from_str("failed"),
            RunExperimentStatus::Failed
        );
        assert_eq!(
            RunExperimentStatus::from_str("skipped"),
            RunExperimentStatus::Skipped
        );
    }

    #[test]
    fn hardware_profile_detection_succeeds() {
        let hp = HardwareProfile::detect();
        assert!(hp.logical_cpus > 0, "CPU count must be detected");
        assert!(hp.total_memory_gb > 0.0, "Memory must be detected");
    }

    #[test]
    fn parallel_feasible_returns_false_for_single_workflow() {
        let hp = HardwareProfile {
            logical_cpus: 16,
            total_memory_gb: 64.0,
            gpu_available: true,
            gpu_vram_gb: Some(24.0),
        };
        assert!(!hp.parallel_feasible(1));
    }

    #[test]
    fn parallel_feasible_true_for_adequate_hardware() {
        let hp = HardwareProfile {
            logical_cpus: 16,
            total_memory_gb: 64.0,
            gpu_available: true,
            gpu_vram_gb: Some(24.0),
        };
        assert!(hp.parallel_feasible(2));
    }

    #[test]
    fn parallel_feasible_false_for_limited_hardware() {
        let hp = HardwareProfile {
            logical_cpus: 2,
            total_memory_gb: 4.0,
            gpu_available: false,
            gpu_vram_gb: None,
        };
        assert!(!hp.parallel_feasible(2));
    }

    #[test]
    fn suggest_execution_mode_returns_sequential_when_not_feasible() {
        let hp = HardwareProfile {
            logical_cpus: 2,
            total_memory_gb: 4.0,
            gpu_available: false,
            gpu_vram_gb: None,
        };
        assert_eq!(hp.suggest_execution_mode(2), ExecutionMode::Sequential);
    }

    #[test]
    fn run_group_serialization_round_trip() {
        let group = RunGroup {
            name: "test-group".to_owned(),
            description: "A test group".to_owned(),
            created_at: "2026-05-10T00:00:00Z".to_owned(),
            blueprints: vec![GroupBlueprintEntry {
                blueprint_name: "code-quality".to_owned(),
                blueprint_path: "blueprints/code-quality.toml".to_owned(),
                sort_order: 0,
                notifications_enabled: true,
            }],
            execution_mode: ExecutionMode::Sequential,
            schedule: None,
            telegram_enabled: true,
        };

        let json = serde_json::to_string(&group).unwrap();
        let deserialized: RunGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test-group");
        assert_eq!(deserialized.blueprints.len(), 1);
        assert_eq!(deserialized.blueprints[0].blueprint_name, "code-quality");
    }

    // ============== Schedule Tests ==============

    #[test]
    fn schedule_kind_default_is_none() {
        let kind = ScheduleKind::default();
        assert_eq!(kind, ScheduleKind::None);
    }

    #[test]
    fn schedule_kind_db_type_round_trip() {
        assert_eq!(ScheduleKind::None.as_db_type(), "none");
        assert_eq!(
            ScheduleKind::Cron {
                expression: "0 9 * * 1".to_owned()
            }
            .as_db_type(),
            "cron"
        );
        assert_eq!(
            ScheduleKind::OneShot {
                datetime: "2026-05-15T14:30:00Z".to_owned()
            }
            .as_db_type(),
            "one_shot"
        );
    }

    #[test]
    fn schedule_kind_describe_cron() {
        let cron = ScheduleKind::Cron {
            expression: "0 9 * * 1".to_owned(),
        };
        let desc = cron.describe();
        assert!(desc.contains("09:00"));
        assert!(desc.contains("Monday"));
    }

    #[test]
    fn schedule_kind_describe_cron_daily() {
        let cron = ScheduleKind::Cron {
            expression: "0 17 * * *".to_owned(),
        };
        let desc = cron.describe();
        assert!(desc.contains("17:00"));
    }

    #[test]
    fn schedule_kind_describe_one_shot() {
        let one_shot = ScheduleKind::OneShot {
            datetime: "2026-05-15T14:30:00Z".to_owned(),
        };
        let desc = one_shot.describe();
        assert!(desc.contains("2026-05-15"));
        assert!(desc.contains("one-time"));
    }

    #[test]
    fn schedule_kind_describe_none() {
        assert_eq!(ScheduleKind::None.describe(), "Not scheduled");
    }

    #[test]
    fn cron_matches_now_works_for_exact_time() {
        // Monday 09:00 should match "0 9 * * 1"
        // Use a known Monday at 09:00 UTC
        let monday_9am = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(cron_matches_now("0 9 * * 1", &monday_9am));
        assert!(!cron_matches_now("0 9 * * 2", &monday_9am)); // Tuesday - no match
    }

    #[test]
    fn cron_matches_now_handles_step() {
        // Every 30 minutes should match at minute 30
        let time_at_30 = chrono::DateTime::parse_from_rfc3339("2026-05-11T10:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(cron_matches_now("*/30 * * * *", &time_at_30));
    }

    #[test]
    fn cron_matches_now_handles_comma_list() {
        // Mon/Wed/Fri at 09:00
        let monday_9am = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        // Monday = 1 in %u format
        assert!(cron_matches_now("0 9 * * 1,3,5", &monday_9am));
    }

    #[test]
    fn cron_matches_now_handles_range() {
        let weekday_9am = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        // Mon-Fri = 1-5
        assert!(cron_matches_now("0 9 * * 1-5", &weekday_9am));
    }

    #[test]
    fn cron_field_matches_exact() {
        assert!(cron_field_matches("5", "5"));
        assert!(!cron_field_matches("5", "6"));
    }

    #[test]
    fn cron_field_matches_wildcard() {
        assert!(cron_field_matches("*", "anything"));
    }

    #[test]
    fn cron_field_matches_step() {
        assert!(cron_field_matches("*/15", "0"));
        assert!(cron_field_matches("*/15", "15"));
        assert!(cron_field_matches("*/15", "30"));
        assert!(!cron_field_matches("*/15", "7"));
    }

    #[test]
    fn cron_field_matches_list() {
        assert!(cron_field_matches("1,3,5", "3"));
        assert!(!cron_field_matches("1,3,5", "2"));
    }

    #[test]
    fn cron_field_matches_range() {
        assert!(cron_field_matches("1-5", "3"));
        assert!(cron_field_matches("1-5", "1"));
        assert!(cron_field_matches("1-5", "5"));
        assert!(!cron_field_matches("1-5", "6"));
    }

    #[test]
    fn describe_cron_every_minute() {
        assert_eq!(describe_cron("* * * * *"), "every minute");
    }

    #[test]
    fn describe_cron_daily_at_5pm() {
        let desc = describe_cron("0 17 * * *");
        assert_eq!(desc, "at 17:00");
    }

    #[test]
    fn describe_cron_weekly_monday_9am() {
        let desc = describe_cron("0 9 * * 1");
        assert_eq!(desc, "at 09:00 on Monday");
    }

    #[test]
    fn describe_cron_weekdays() {
        let desc = describe_cron("0 9 * * 1-5");
        assert_eq!(desc, "at 09:00 on day 1-5");
    }

    #[test]
    fn is_due_one_shot_not_yet() {
        let future_dt = chrono::Utc::now()
            .checked_add_signed(chrono::Duration::hours(24))
            .unwrap();
        let kind = ScheduleKind::OneShot {
            datetime: future_dt.to_rfc3339(),
        };
        let now = chrono::Utc::now();
        assert!(!kind.is_due(None, &now));
    }

    #[test]
    fn is_due_one_shot_past_due() {
        let past_dt = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::hours(1))
            .unwrap();
        let kind = ScheduleKind::OneShot {
            datetime: past_dt.to_rfc3339(),
        };
        let now = chrono::Utc::now();
        assert!(kind.is_due(None, &now));
    }

    #[test]
    fn is_due_one_shot_already_run() {
        let past_dt = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::hours(1))
            .unwrap();
        let kind = ScheduleKind::OneShot {
            datetime: past_dt.to_rfc3339(),
        };
        let now = chrono::Utc::now();
        assert!(!kind.is_due(Some(&now.to_rfc3339()), &now));
    }

    #[test]
    fn is_due_cron_never_run() {
        // If never run, check if current time aligns
        let kind = ScheduleKind::Cron {
            expression: "0 9 * * *".to_owned(),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(kind.is_due(None, &now));
    }

    #[test]
    fn is_due_cron_already_run_recently() {
        let last_run = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:00:00Z").unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-05-11T09:01:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        // Next run should be 2026-05-12T09:00:00Z, which is > now
        let kind = ScheduleKind::Cron {
            expression: "0 9 * * *".to_owned(),
        };
        assert!(!kind.is_due(Some(&last_run.to_rfc3339()), &now));
    }

    #[test]
    fn schedule_kind_from_db_type() {
        let cron = ScheduleKind::from_db_type("cron");
        assert_eq!(
            cron,
            ScheduleKind::Cron {
                expression: String::new()
            }
        );
        let one_shot = ScheduleKind::from_db_type("one_shot");
        assert_eq!(
            one_shot,
            ScheduleKind::OneShot {
                datetime: String::new()
            }
        );
        assert_eq!(ScheduleKind::from_db_type("none"), ScheduleKind::None);
        assert_eq!(ScheduleKind::from_db_type("unknown"), ScheduleKind::None);
    }
}
