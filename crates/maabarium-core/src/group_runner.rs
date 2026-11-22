//! Orchestrates execution of multiple blueprints in a run group.
//!
//! Supports sequential and parallel execution modes with hardware-aware suggestions
//! and opt-in confirmation for parallel runs.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use futures::stream::{FuturesUnordered, StreamExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::blueprint::BlueprintFile;
use crate::engine::{Engine, EngineConfig};
use crate::evaluator::EvaluatorRegistry;
use crate::persistence::{Persistence, PromotionOutcome};
use crate::run_groups::{
    ExecutionMode, GroupBlueprintEntry, GroupRun, GroupRunExperiment, GroupRunStatus,
    HardwareProfile, RunExperimentStatus, RunGroup,
};
use crate::telegram::{NotificationConfig, NotificationEvent, TelegramConfig, TelegramNotifier};

/// The result of a single workflow run within a group.
pub struct GroupWorkflowResult {
    pub blueprint_name: String,
    pub experiment_id: Option<i64>,
    pub status: RunExperimentStatus,
    pub error: Option<String>,
    /// Whether any experiment recorded by this workflow run was promoted.
    pub promoted: bool,
}

/// Simple progress reporter for group execution.
pub type GroupProgressReporter = Arc<dyn Fn(&GroupRun, &[GroupWorkflowResult]) + Send + Sync>;

/// True if a process with this id still exists.
///
/// On platforms without a cheap check this answers `true`, so a run recorded
/// by another process is never closed out while it may still be working.
pub fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let Ok(pid) = libc::pid_t::try_from(pid) else {
            return false;
        };
        // Signal 0 performs the permission and existence checks only.
        let result = unsafe { libc::kill(pid, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

/// Orchestrates execution of multiple blueprint workflows.
pub struct GroupRunner {
    persistence: Arc<Persistence>,
    db_path: String,
    cancel: CancellationToken,
    progress_reporter: Option<GroupProgressReporter>,
    notifier: Option<Arc<TelegramNotifier>>,
    telegram_config: Option<TelegramConfig>,
    hardware_profile: HardwareProfile,
    triggered_by_schedule: bool,
}

/// What a finished workflow produced.
struct WorkflowOutcome {
    experiment_id: i64,
    promoted: bool,
}

impl GroupRunner {
    pub fn new(persistence: Arc<Persistence>, db_path: String, cancel: CancellationToken) -> Self {
        let telegram_config = persistence
            .telegram_get_config()
            .ok()
            .flatten()
            .filter(|config| config.enabled);
        Self {
            persistence,
            db_path,
            cancel,
            progress_reporter: None,
            notifier: telegram_config
                .as_ref()
                .map(|config| Arc::new(TelegramNotifier::new(config))),
            telegram_config,
            hardware_profile: HardwareProfile::cached(),
            triggered_by_schedule: false,
        }
    }

    /// Attach a progress reporter.
    pub fn with_progress_reporter(mut self, reporter: GroupProgressReporter) -> Self {
        self.progress_reporter = Some(reporter);
        self
    }

    /// Attach a Telegram notifier.
    pub fn with_notifier(mut self, notifier: Arc<TelegramNotifier>) -> Self {
        self.notifier = Some(notifier);
        self
    }

    pub fn with_telegram_config(mut self, config: TelegramConfig) -> Self {
        self.telegram_config = Some(config);
        self
    }

    /// Mark this run as started by the group's schedule.
    ///
    /// Only scheduled runs advance the schedule, so a manual run never uses
    /// up a one-time slot or skips the next recurring one.
    pub fn triggered_by_schedule(mut self) -> Self {
        self.triggered_by_schedule = true;
        self
    }

    /// Run all blueprints in a group.
    pub async fn run_group(
        &self,
        group: &RunGroup,
        force_mode: Option<ExecutionMode>,
    ) -> Result<GroupRun, String> {
        if group.blueprints.is_empty() {
            return Err("Group has no blueprints".to_owned());
        }

        let mut mode = force_mode.unwrap_or(group.execution_mode);
        if mode == ExecutionMode::Parallel && has_duplicate_blueprints(group) {
            // Two copies of one blueprint at once would race on its workspace
            // and could not be told apart in the experiment history.
            tracing::warn!(group = %group.name, "Duplicate blueprints; running sequentially");
            mode = ExecutionMode::Sequential;
        }

        let run_id = Uuid::new_v4().simple().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let group_run = GroupRun {
            id: run_id.clone(),
            group_name: group.name.clone(),
            execution_mode: mode,
            started_at: Some(now.clone()),
            completed_at: None,
            status: GroupRunStatus::Running,
            summary: None,
        };
        self.persistence
            .create_group_run(&group_run)
            .map_err(|e| format!("Failed to create group run: {e}"))?;

        let mut entries: Vec<GroupRunExperiment> = Vec::new();
        for bp in &group.blueprints {
            let entry = GroupRunExperiment {
                id: 0,
                group_run_id: run_id.clone(),
                experiment_id: None,
                blueprint_name: bp.blueprint_name.clone(),
                blueprint_path: bp.blueprint_path.clone(),
                sort_order: bp.sort_order,
                status: RunExperimentStatus::Pending,
                started_at: None,
                completed_at: None,
                error: None,
            };
            match self.persistence.create_group_run_experiment(&entry) {
                Ok(id) => entries.push(GroupRunExperiment { id, ..entry }),
                Err(error) => {
                    let message = format!("Failed to create experiment entry: {error}");
                    let _ = self.persistence.update_group_run_status(
                        &run_id,
                        GroupRunStatus::Failed,
                        Some(&chrono::Utc::now().to_rfc3339()),
                        Some(&message),
                    );
                    return Err(message);
                }
            }
        }

        if let Some(notifier) = &self.notifier {
            if group.telegram_enabled {
                let names: Vec<&str> = group
                    .blueprints
                    .iter()
                    .map(|b| b.blueprint_name.as_str())
                    .collect();
                let _ = notifier
                    .notify_group_start(&group.name, mode.as_str(), &names)
                    .await;
            }
        }

        let results = match mode {
            ExecutionMode::Sequential => self.run_sequential(group, &run_id, &entries).await,
            ExecutionMode::Parallel => self.run_parallel(group, &run_id, &entries).await,
        };

        let completed_at = chrono::Utc::now().to_rfc3339();
        let promoted = results.iter().filter(|r| r.promoted).count();
        let completed = results
            .iter()
            .filter(|r| matches!(r.status, RunExperimentStatus::Completed))
            .count();
        let failed = results
            .iter()
            .filter(|r| matches!(r.status, RunExperimentStatus::Failed))
            .count();
        let skipped = results
            .iter()
            .filter(|r| matches!(r.status, RunExperimentStatus::Skipped))
            .count();
        let not_promoted = completed.saturating_sub(promoted);

        let overall_status = if failed > 0 {
            GroupRunStatus::Failed
        } else if skipped > 0 || self.cancel.is_cancelled() {
            GroupRunStatus::Cancelled
        } else {
            GroupRunStatus::Completed
        };
        let summary = format!(
            "{promoted} promoted, {not_promoted} not promoted, {failed} failed, {skipped} skipped"
        );

        self.persistence
            .update_group_run_status(&run_id, overall_status, Some(&completed_at), Some(&summary))
            .map_err(|e| format!("Failed to finalize group run: {e}"))?;

        if self.triggered_by_schedule {
            if let Some(schedule) = group.schedule.as_ref().filter(|s| s.enabled) {
                let next = schedule
                    .kind
                    .next_run_after(&chrono::Utc::now())
                    .map(|next| next.to_rfc3339());
                let _ = self.persistence.mark_group_schedule_run(
                    &group.name,
                    &completed_at,
                    next.as_deref(),
                );
            }
        }

        if let Some(notifier) = &self.notifier {
            if group.telegram_enabled {
                let _ = notifier
                    .notify_group_complete(
                        &group.name,
                        promoted as u32,
                        not_promoted as u32,
                        failed as u32,
                        duration_seconds(&now, &completed_at),
                    )
                    .await;
            }
        }

        Ok(GroupRun {
            id: run_id,
            group_name: group.name.clone(),
            execution_mode: mode,
            started_at: Some(now),
            completed_at: Some(completed_at),
            status: overall_status,
            summary: Some(summary),
        })
    }

    fn record_result(&self, entry_id: i64, result: &GroupWorkflowResult) {
        let completed_at = chrono::Utc::now().to_rfc3339();
        let _ = self.persistence.update_group_run_experiment(
            entry_id,
            result.status,
            result.experiment_id,
            Some(&completed_at),
            result.error.as_deref(),
        );
    }

    fn report_progress(
        &self,
        group: &RunGroup,
        run_id: &str,
        mode: ExecutionMode,
        results: &[GroupWorkflowResult],
    ) {
        if let Some(reporter) = &self.progress_reporter {
            let partial_run = GroupRun {
                id: run_id.to_owned(),
                group_name: group.name.clone(),
                execution_mode: mode,
                started_at: None,
                completed_at: None,
                status: GroupRunStatus::Running,
                summary: None,
            };
            reporter(&partial_run, results);
        }
    }

    fn skipped(bp: &GroupBlueprintEntry) -> GroupWorkflowResult {
        GroupWorkflowResult {
            blueprint_name: bp.blueprint_name.clone(),
            experiment_id: None,
            status: RunExperimentStatus::Skipped,
            error: Some("Cancelled".to_owned()),
            promoted: false,
        }
    }

    fn to_result(
        bp: &GroupBlueprintEntry,
        outcome: Result<WorkflowOutcome, String>,
    ) -> GroupWorkflowResult {
        match outcome {
            Ok(outcome) => GroupWorkflowResult {
                blueprint_name: bp.blueprint_name.clone(),
                experiment_id: Some(outcome.experiment_id),
                status: RunExperimentStatus::Completed,
                error: None,
                promoted: outcome.promoted,
            },
            Err(error) => GroupWorkflowResult {
                blueprint_name: bp.blueprint_name.clone(),
                experiment_id: None,
                status: RunExperimentStatus::Failed,
                error: Some(error),
                promoted: false,
            },
        }
    }

    /// Run blueprints sequentially.
    async fn run_sequential(
        &self,
        group: &RunGroup,
        run_id: &str,
        entries: &[GroupRunExperiment],
    ) -> Vec<GroupWorkflowResult> {
        let mut results = Vec::new();
        for (bp, entry) in group.blueprints.iter().zip(entries) {
            let result = if self.cancel.is_cancelled() {
                Self::skipped(bp)
            } else {
                let _ = self
                    .persistence
                    .mark_group_run_experiment_started(entry.id, &chrono::Utc::now().to_rfc3339());
                let baseline = self.persistence.max_experiment_id().unwrap_or(0);
                let outcome = execute_workflow(
                    self.db_path.clone(),
                    bp.clone(),
                    self.cancel.clone(),
                    self.notifier.clone(),
                    self.notification_config(group, bp),
                    baseline,
                )
                .await;
                Self::to_result(bp, outcome)
            };
            self.record_result(entry.id, &result);
            results.push(result);
            self.report_progress(group, run_id, ExecutionMode::Sequential, &results);
        }
        results
    }

    /// Run blueprints in parallel, each on its own blocking thread.
    async fn run_parallel(
        &self,
        group: &RunGroup,
        run_id: &str,
        entries: &[GroupRunExperiment],
    ) -> Vec<GroupWorkflowResult> {
        let baseline = self.persistence.max_experiment_id().unwrap_or(0);
        let mut slots: Vec<Option<GroupWorkflowResult>> =
            group.blueprints.iter().map(|_| None).collect();
        let mut pending = FuturesUnordered::new();

        for (index, (bp, entry)) in group.blueprints.iter().zip(entries).enumerate() {
            if self.cancel.is_cancelled() {
                let result = Self::skipped(bp);
                self.record_result(entry.id, &result);
                slots[index] = Some(result);
                continue;
            }
            let _ = self
                .persistence
                .mark_group_run_experiment_started(entry.id, &chrono::Utc::now().to_rfc3339());
            let db_path = self.db_path.clone();
            let bp_owned = bp.clone();
            let cancel = self.cancel.clone();
            let notifier = self.notifier.clone();
            let config = self.notification_config(group, bp);
            // The engine future is not Send, so each workflow gets its own
            // single-threaded runtime on a blocking thread.
            let handle = tokio::task::spawn_blocking(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| format!("Runtime error: {e}"))?;
                runtime.block_on(execute_workflow(
                    db_path, bp_owned, cancel, notifier, config, baseline,
                ))
            });
            pending.push(async move { (index, entry.id, handle.await) });
        }

        while let Some((index, entry_id, joined)) = pending.next().await {
            let outcome = joined.unwrap_or_else(|e| Err(format!("Workflow thread failed: {e}")));
            let result = Self::to_result(&group.blueprints[index], outcome);
            self.record_result(entry_id, &result);
            slots[index] = Some(result);
            let done: Vec<GroupWorkflowResult> = slots
                .iter()
                .flatten()
                .map(|r| GroupWorkflowResult {
                    blueprint_name: r.blueprint_name.clone(),
                    experiment_id: r.experiment_id,
                    status: r.status,
                    error: r.error.clone(),
                    promoted: r.promoted,
                })
                .collect();
            self.report_progress(group, run_id, ExecutionMode::Parallel, &done);
        }

        slots.into_iter().flatten().collect()
    }

    fn notification_config(
        &self,
        group: &RunGroup,
        bp: &GroupBlueprintEntry,
    ) -> NotificationConfig {
        notification_config_from(
            self.telegram_config.as_ref(),
            group.telegram_enabled,
            bp.notifications_enabled,
        )
    }

    /// Get the detected hardware profile.
    pub fn hardware_profile(&self) -> &HardwareProfile {
        &self.hardware_profile
    }

    /// Suggest whether parallel mode is feasible for the given group.
    pub fn suggest_mode(&self, group: &RunGroup) -> ExecutionMode {
        self.hardware_profile
            .suggest_execution_mode(group.blueprints.len())
    }
}

fn has_duplicate_blueprints(group: &RunGroup) -> bool {
    let mut seen = HashSet::new();
    group
        .blueprints
        .iter()
        .any(|bp| !seen.insert(bp.blueprint_path.as_str()))
}

fn duration_seconds(start: &str, end: &str) -> f64 {
    let parse = |value: &str| {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|dt| dt.timestamp_millis())
    };
    match (parse(start), parse(end)) {
        (Some(s), Some(e)) => (e - s) as f64 / 1000.0,
        _ => 0.0,
    }
}

fn notification_config_from(
    telegram_config: Option<&TelegramConfig>,
    group_enabled: bool,
    workflow_notifications_enabled: bool,
) -> NotificationConfig {
    NotificationConfig {
        global_enabled: telegram_config.is_some_and(|config| config.enabled),
        group_enabled,
        workflow_notifications_enabled,
        notify_on_start: telegram_config.is_some_and(|config| config.notify_on_start),
        notify_on_complete: telegram_config.is_some_and(|config| config.notify_on_complete),
        notify_on_error: telegram_config.is_some_and(|config| config.notify_on_error),
        notify_on_promotion: telegram_config.is_some_and(|config| config.notify_on_promotion),
    }
}

/// Run one workflow and link the experiments it recorded.
///
/// Experiments are matched by the loaded blueprint's name and by id above
/// `baseline`, the highest id before the workflow started, so another
/// workflow's experiments are never attributed to this one.
async fn execute_workflow(
    db_path: String,
    bp: GroupBlueprintEntry,
    cancel: CancellationToken,
    notifier: Option<Arc<TelegramNotifier>>,
    config: NotificationConfig,
    baseline: i64,
) -> Result<WorkflowOutcome, String> {
    let notify = |event| notifier.as_ref().filter(|_| config.should_notify(event));
    let result = async {
        let blueprint = BlueprintFile::load(Path::new(&bp.blueprint_path))
            .map_err(|e| format!("Failed to load blueprint '{}': {e}", bp.blueprint_name))?;
        let recorded_name = blueprint.blueprint.name.clone();
        if let Some(notifier) = notify(NotificationEvent::RunStart) {
            let _ = notifier
                .notify_run_start(&bp.blueprint_name, 1, blueprint.constraints.max_iterations)
                .await;
        }
        let evaluator =
            EvaluatorRegistry::build(&blueprint).map_err(|e| format!("Evaluator error: {e}"))?;
        let engine = Engine::new(
            EngineConfig {
                blueprint,
                db_path: db_path.clone(),
                progress_reporter: None,
            },
            evaluator,
            cancel,
        )
        .map_err(|e| format!("Engine init error: {e}"))?;
        engine
            .run()
            .await
            .map_err(|e| format!("Engine error: {e}"))?;

        let persistence = Persistence::open(&db_path).map_err(|e| format!("DB error: {e}"))?;
        let recorded = persistence
            .experiments_for_blueprint_after(&recorded_name, baseline)
            .map_err(|e| format!("Failed to load experiments: {e}"))?;
        let Some(&(latest_id, _)) = recorded.first() else {
            return Err("No experiment recorded for this workflow".to_owned());
        };
        let promoted_id = recorded
            .iter()
            .find(|(_, outcome)| *outcome == PromotionOutcome::Promoted)
            .map(|(id, _)| *id);
        let shown_id = promoted_id.unwrap_or(latest_id);
        if let Ok(Some(exp)) = persistence.experiment_by_id(shown_id) {
            if promoted_id.is_some() {
                if let Some(notifier) = notify(NotificationEvent::Promotion) {
                    let branch = exp.promoted_branch_name.as_deref().unwrap_or("unknown");
                    let _ = notifier
                        .notify_promotion(
                            &bp.blueprint_name,
                            exp.weighted_total,
                            exp.duration_ms,
                            branch,
                            exp.iteration,
                        )
                        .await;
                }
            } else if let Some(notifier) = notify(NotificationEvent::RunComplete) {
                let reason = format!("{:?}", exp.promotion_outcome);
                let _ = notifier
                    .notify_run_complete(
                        &bp.blueprint_name,
                        exp.weighted_total,
                        exp.duration_ms,
                        exp.iteration,
                        &reason,
                    )
                    .await;
            }
        }
        Ok(WorkflowOutcome {
            experiment_id: shown_id,
            promoted: promoted_id.is_some(),
        })
    }
    .await;

    if let Err(error) = &result {
        if let Some(notifier) = notify(NotificationEvent::RunError) {
            let _ = notifier
                .notify_run_error(&bp.blueprint_name, error, 0)
                .await;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notifications_are_off_without_a_telegram_config() {
        let config = notification_config_from(None, true, true);
        assert!(!config.should_notify(NotificationEvent::Promotion));
    }

    #[test]
    fn notifications_follow_event_preferences() {
        let telegram = TelegramConfig {
            bot_token: String::new(),
            chat_id: "1".into(),
            enabled: true,
            notify_on_start: false,
            notify_on_complete: true,
            notify_on_error: true,
            notify_on_promotion: false,
            updated_at: String::new(),
        };
        let config = notification_config_from(Some(&telegram), true, true);
        assert!(!config.should_notify(NotificationEvent::Promotion));
        assert!(!config.should_notify(NotificationEvent::RunStart));
        assert!(config.should_notify(NotificationEvent::RunComplete));
        let muted = notification_config_from(Some(&telegram), true, false);
        assert!(!muted.should_notify(NotificationEvent::RunComplete));
    }

    #[test]
    fn own_process_is_alive() {
        assert!(process_is_alive(std::process::id()));
    }
}
