//! Groups blueprints for scheduled, sequential or parallel execution.
//!
//! A run group collects one or more blueprint workflows that can be executed together.
//! The execution can be sequential (default) or parallel (if hardware permits).

use serde::{Deserialize, Serialize};

use crate::cron::CronSchedule;

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

    /// Return true if this schedule is due at `now`.
    ///
    /// `last_run_at` is the RFC 3339 time of the last scheduled execution.
    /// Cron expressions use local wall-clock time. A cron schedule that has
    /// never run and has no stored anchor is due only during a matching
    /// minute; [`ScheduledRun::is_due`] prefers the stored next-run anchor.
    pub fn is_due(&self, last_run_at: Option<&str>, now: &chrono::DateTime<chrono::Utc>) -> bool {
        match self {
            Self::None => false,
            Self::Cron { expression } => {
                let Ok(schedule) = CronSchedule::parse(expression) else {
                    return false;
                };
                let now_local = now.with_timezone(&chrono::Local);
                match last_run_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) {
                    Some(last) => schedule
                        .next_after(&last.with_timezone(&chrono::Local))
                        .is_some_and(|next| next <= now_local),
                    None => schedule.matches(&now_local),
                }
            }
            Self::OneShot { datetime } => chrono::DateTime::parse_from_rfc3339(datetime)
                .is_ok_and(|scheduled| *now >= scheduled && last_run_at.is_none()),
        }
    }

    /// Validate the schedule before it is stored.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::None => Ok(()),
            Self::Cron { expression } => CronSchedule::parse(expression).map(|_| ()),
            Self::OneShot { datetime } => chrono::DateTime::parse_from_rfc3339(datetime)
                .map(|_| ())
                .map_err(|e| format!("One-shot schedule must be an RFC 3339 datetime: {e}")),
        }
    }

    /// The next time this schedule fires strictly after `after`, if any.
    pub fn next_run_after(
        &self,
        after: &chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        match self {
            Self::None => None,
            Self::Cron { expression } => CronSchedule::parse(expression)
                .ok()?
                .next_after(&after.with_timezone(&chrono::Local))
                .map(|next| next.with_timezone(&chrono::Utc)),
            Self::OneShot { datetime } => chrono::DateTime::parse_from_rfc3339(datetime)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .filter(|dt| dt > after),
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

impl ScheduledRun {
    /// Build a validated schedule, anchored to its first run after `now`.
    ///
    /// One-shot times in the past are rejected so saving does not trigger an
    /// immediate run by surprise.
    pub fn new_validated(
        kind: ScheduleKind,
        enabled: bool,
        now: &chrono::DateTime<chrono::Utc>,
    ) -> Result<Self, String> {
        kind.validate()?;
        let next_run_at = kind.next_run_after(now);
        if matches!(kind, ScheduleKind::OneShot { .. }) && next_run_at.is_none() {
            return Err("One-shot schedules must be in the future".to_owned());
        }
        if matches!(kind, ScheduleKind::Cron { .. }) && next_run_at.is_none() {
            return Err("This cron expression has no upcoming run".to_owned());
        }
        Ok(Self {
            enabled: enabled && !matches!(kind, ScheduleKind::None),
            kind,
            last_run_at: None,
            next_run_at: next_run_at.map(|next| next.to_rfc3339()),
        })
    }

    /// Whether an enabled schedule is due at `now`, preferring the stored
    /// next-run anchor so a missed minute is caught up on the next check.
    pub fn is_due(&self, now: &chrono::DateTime<chrono::Utc>) -> bool {
        if !self.enabled {
            return false;
        }
        if let ScheduleKind::Cron { .. } = self.kind {
            if let Some(next) = self
                .next_run_at
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            {
                return *now >= next;
            }
        }
        self.kind.is_due(self.last_run_at.as_deref(), now)
    }
}

/// Produce a human-readable description of a cron expression (local time).
fn describe_cron(expression: &str) -> String {
    if CronSchedule::parse(expression).is_err() {
        return format!("invalid cron: {expression}");
    }
    let parts: Vec<&str> = expression.split_whitespace().collect();
    let (minute_str, hour_str, dom, month, dow) =
        (parts[0], parts[1], parts[2], parts[3], parts[4]);
    let simple = |s: &str| s.parse::<u32>().ok();
    let time_desc = match (simple(hour_str), simple(minute_str)) {
        (Some(hour), Some(minute)) => format!("at {hour:02}:{minute:02}"),
        _ if hour_str == "*" && minute_str == "*" => "every minute".to_owned(),
        _ => format!("cron {minute_str} {hour_str}"),
    };
    let day_name = |value: &str| match value.to_ascii_lowercase().as_str() {
        "0" | "7" | "sun" => Some("Sunday"),
        "1" | "mon" => Some("Monday"),
        "2" | "tue" => Some("Tuesday"),
        "3" | "wed" => Some("Wednesday"),
        "4" | "thu" => Some("Thursday"),
        "5" | "fri" => Some("Friday"),
        "6" | "sat" => Some("Saturday"),
        _ => None,
    };
    let mut desc = time_desc;
    if dom != "*" {
        desc.push_str(&format!(" on day {dom} of the month"));
    }
    if month != "*" {
        desc.push_str(&format!(" in month {month}"));
    }
    match (dow, day_name(dow)) {
        ("*", _) => {}
        (_, Some(name)) => desc.push_str(&format!(" on {name}")),
        (other, None) => desc.push_str(&format!(" on weekdays {other}")),
    }
    desc
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
    /// Hardware detected once per process; detection spawns `sysctl`,
    /// `nvidia-smi` and `system_profiler`, which take a noticeable time.
    pub fn cached() -> Self {
        static PROFILE: std::sync::OnceLock<HardwareProfile> = std::sync::OnceLock::new();
        PROFILE.get_or_init(Self::detect).clone()
    }

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
        assert_eq!(desc, "at 09:00 on weekdays 1-5");
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

    fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> chrono::DateTime<chrono::Utc> {
        use chrono::TimeZone;
        chrono::Local
            .with_ymd_and_hms(y, mo, d, h, mi, 0)
            .earliest()
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn is_due_cron_never_run_matches_local_minute() {
        let kind = ScheduleKind::Cron {
            expression: "0 9 * * *".to_owned(),
        };
        assert!(kind.is_due(None, &local(2026, 5, 11, 9, 0)));
        assert!(!kind.is_due(None, &local(2026, 5, 11, 9, 1)));
    }

    #[test]
    fn is_due_cron_after_last_run_waits_for_next_occurrence() {
        let kind = ScheduleKind::Cron {
            expression: "0 9 * * *".to_owned(),
        };
        let last = local(2026, 5, 11, 9, 0).to_rfc3339();
        assert!(!kind.is_due(Some(&last), &local(2026, 5, 11, 9, 1)));
        assert!(kind.is_due(Some(&last), &local(2026, 5, 12, 9, 0)));
        // A missed occurrence is caught up later.
        assert!(kind.is_due(Some(&last), &local(2026, 5, 20, 13, 7)));
    }

    #[test]
    fn sunday_cron_is_due_on_sunday_and_after_a_long_gap() {
        // 2026-11-22 is a Sunday.
        let kind = ScheduleKind::Cron {
            expression: "0 9 * * 0".to_owned(),
        };
        assert!(kind.is_due(None, &local(2026, 11, 22, 9, 0)));
        let last = local(2026, 11, 1, 9, 0).to_rfc3339();
        assert!(kind.is_due(Some(&last), &local(2026, 11, 20, 9, 0)));
    }

    #[test]
    fn monthly_cron_does_not_fire_daily() {
        let kind = ScheduleKind::Cron {
            expression: "0 9 1 * *".to_owned(),
        };
        assert!(!kind.is_due(None, &local(2026, 11, 2, 9, 0)));
        assert!(kind.is_due(None, &local(2026, 12, 1, 9, 0)));
    }

    #[test]
    fn scheduled_run_uses_next_run_anchor() {
        let next = local(2026, 11, 22, 9, 0);
        let schedule = ScheduledRun {
            kind: ScheduleKind::Cron {
                expression: "0 9 * * *".to_owned(),
            },
            enabled: true,
            last_run_at: None,
            next_run_at: Some(next.to_rfc3339()),
        };
        assert!(!schedule.is_due(&local(2026, 11, 22, 8, 59)));
        // A poll that misses the exact minute still fires.
        assert!(schedule.is_due(&local(2026, 11, 22, 9, 3)));
        let disabled = ScheduledRun {
            enabled: false,
            ..schedule
        };
        assert!(!disabled.is_due(&local(2026, 11, 22, 9, 3)));
    }

    #[test]
    fn validate_rejects_bad_schedules() {
        assert!(
            ScheduleKind::Cron {
                expression: "0 9 * *".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            ScheduleKind::Cron {
                expression: "0 25 * * *".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            ScheduleKind::OneShot {
                datetime: "tomorrow".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            ScheduleKind::Cron {
                expression: "0 9 * * 0".into()
            }
            .validate()
            .is_ok()
        );
    }

    #[test]
    fn next_run_after_skips_past_one_shot() {
        let now = chrono::Utc::now();
        let past = ScheduleKind::OneShot {
            datetime: (now - chrono::Duration::hours(1)).to_rfc3339(),
        };
        assert!(past.next_run_after(&now).is_none());
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
