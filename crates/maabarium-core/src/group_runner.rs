//! Orchestrates execution of multiple blueprints in a run group.
//!
//! Supports sequential and parallel execution modes with hardware-aware suggestions
//! and opt-in confirmation for parallel runs.

use std::path::Path;
use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::blueprint::BlueprintFile;
use crate::engine::{Engine, EngineConfig};
use crate::evaluator::EvaluatorRegistry;
use crate::persistence::Persistence;
use crate::run_groups::{
    ExecutionMode, GroupBlueprintEntry, GroupRun, GroupRunExperiment, GroupRunStatus,
    HardwareProfile, RunExperimentStatus, RunGroup,
};
use crate::telegram::{NotificationConfig, TelegramConfig, TelegramNotifier};

/// The result of a single workflow run within a group.
pub struct GroupWorkflowResult {
    pub blueprint_name: String,
    pub experiment_id: Option<i64>,
    pub status: RunExperimentStatus,
    pub error: Option<String>,
}

/// Simple progress reporter for group execution.
pub type GroupProgressReporter = Arc<dyn Fn(&GroupRun, &[GroupWorkflowResult]) + Send + Sync>;

/// Orchestrates execution of multiple blueprint workflows.
pub struct GroupRunner {
    persistence: Arc<Persistence>,
    db_path: String,
    cancel: CancellationToken,
    progress_reporter: Option<GroupProgressReporter>,
    notifier: Option<Arc<TelegramNotifier>>,
    telegram_config: Option<TelegramConfig>,
    hardware_profile: HardwareProfile,
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
            hardware_profile: HardwareProfile::detect(),
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

    /// Run all blueprints in a group.
    pub async fn run_group(
        &self,
        group: &RunGroup,
        force_mode: Option<ExecutionMode>,
    ) -> Result<GroupRun, String> {
        if group.blueprints.is_empty() {
            return Err("Group has no blueprints".to_owned());
        }

        let mode = force_mode.unwrap_or(group.execution_mode);

        // Create the group run record
        let run_id = Uuid::new_v4().simple().to_string()[..8].to_owned();
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

        // Create run experiment entries for each blueprint
        let mut experiment_entries: Vec<GroupRunExperiment> = Vec::new();
        for bp in &group.blueprints {
            let entry = GroupRunExperiment {
                id: 0, // assigned by DB
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
            let db_id = self
                .persistence
                .create_group_run_experiment(&entry)
                .map_err(|e| format!("Failed to create experiment entry: {e}"))?;
            experiment_entries.push(GroupRunExperiment { id: db_id, ..entry });
        }

        if let Some(notifier) = &self.notifier {
            let names: Vec<&str> = group
                .blueprints
                .iter()
                .map(|b| b.blueprint_name.as_str())
                .collect();
            let _ = notifier
                .notify_group_start(&group.name, mode.as_str(), &names)
                .await;
        }

        let results = match mode {
            ExecutionMode::Sequential => {
                self.run_sequential(group, &run_id, &experiment_entries)
                    .await
            }
            ExecutionMode::Parallel => self.run_parallel(group, &run_id, &experiment_entries).await,
        };

        // Finalize the group run
        let completed_at = chrono::Utc::now().to_rfc3339();
        let promoted = results
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
        let rejected = results.len().saturating_sub(promoted + failed + skipped);

        let overall_status = if failed > 0 {
            GroupRunStatus::Failed
        } else if skipped > 0 || self.cancel.is_cancelled() {
            GroupRunStatus::Cancelled
        } else {
            GroupRunStatus::Completed
        };

        let summary = format!(
            "{} promoted, {} rejected, {} failed, {} skipped",
            promoted, rejected, failed, skipped
        );

        self.persistence
            .update_group_run_status(&run_id, overall_status, Some(&completed_at), Some(&summary))
            .map_err(|e| format!("Failed to finalize group run: {e}"))?;
        if group
            .schedule
            .as_ref()
            .is_some_and(|schedule| schedule.enabled)
        {
            let _ = self
                .persistence
                .mark_group_schedule_run(&group.name, &completed_at, None);
        }

        // Update experiment entries as completed
        for (i, entry) in experiment_entries.iter().enumerate() {
            if i < results.len() {
                let _ = self.persistence.update_group_run_experiment(
                    entry.id,
                    results[i].status,
                    results[i].experiment_id,
                    Some(&completed_at),
                    results[i].error.as_deref(),
                );
            }
        }

        if let Some(notifier) = &self.notifier {
            let duration_secs = self.duration_seconds(&now, &completed_at);
            let _ = notifier
                .notify_group_complete(
                    &group.name,
                    promoted as u32,
                    rejected as u32,
                    failed as u32,
                    duration_secs,
                )
                .await;
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

    /// Run blueprints sequentially.
    async fn run_sequential(
        &self,
        group: &RunGroup,
        run_id: &str,
        entries: &[GroupRunExperiment],
    ) -> Vec<GroupWorkflowResult> {
        let mut results = Vec::new();

        for (i, bp) in group.blueprints.iter().enumerate() {
            if self.cancel.is_cancelled() {
                results.push(GroupWorkflowResult {
                    blueprint_name: bp.blueprint_name.clone(),
                    experiment_id: None,
                    status: RunExperimentStatus::Skipped,
                    error: Some("Cancelled".to_owned()),
                });
                continue;
            }

            let entry_id = entries.get(i).map(|e| e.id).unwrap_or(0);
            let started_at = chrono::Utc::now().to_rfc3339();
            let _ = self.persistence.update_group_run_experiment(
                entry_id,
                RunExperimentStatus::Running,
                None,
                Some(&started_at),
                None,
            );

            match self.run_single_blueprint(bp, group).await {
                Ok(exp_id) => {
                    let _ = self.persistence.update_group_run_experiment(
                        entry_id,
                        RunExperimentStatus::Completed,
                        Some(exp_id),
                        None,
                        None,
                    );
                    results.push(GroupWorkflowResult {
                        blueprint_name: bp.blueprint_name.clone(),
                        experiment_id: Some(exp_id),
                        status: RunExperimentStatus::Completed,
                        error: None,
                    });
                }
                Err(e) => {
                    let _ = self.persistence.update_group_run_experiment(
                        entry_id,
                        RunExperimentStatus::Failed,
                        None,
                        None,
                        Some(&e),
                    );
                    results.push(GroupWorkflowResult {
                        blueprint_name: bp.blueprint_name.clone(),
                        experiment_id: None,
                        status: RunExperimentStatus::Failed,
                        error: Some(e),
                    });
                }
            }

            // Report progress
            if let Some(reporter) = &self.progress_reporter {
                let partial_run = GroupRun {
                    id: run_id.to_owned(),
                    group_name: group.name.clone(),
                    execution_mode: group.execution_mode,
                    started_at: None,
                    completed_at: None,
                    status: GroupRunStatus::Running,
                    summary: None,
                };
                reporter(&partial_run, &results);
            }
        }

        results
    }

    /// Run blueprints in parallel.
    async fn run_parallel(
        &self,
        group: &RunGroup,
        _run_id: &str,
        entries: &[GroupRunExperiment],
    ) -> Vec<GroupWorkflowResult> {
        use futures::future::join_all;

        let mut futs = Vec::new();

        for (i, bp) in group.blueprints.iter().enumerate() {
            let entry_id = entries.get(i).map(|e| e.id).unwrap_or(0);
            let started_at = chrono::Utc::now().to_rfc3339();
            let _ = self.persistence.update_group_run_experiment(
                entry_id,
                RunExperimentStatus::Running,
                None,
                Some(&started_at),
                None,
            );

            let blueprint_path = bp.blueprint_path.clone();
            let blueprint_name = bp.blueprint_name.clone();
            let db_path = self.db_path.clone();
            let cancel = self.cancel.clone();
            let run_notifier = self.notifier.clone();
            let group_telegram = group.telegram_enabled;
            let bp_notifications = bp.notifications_enabled;

            // Use join_all instead of tokio::spawn to avoid Send requirements
            let fut = async move {
                let persistence =
                    Persistence::open(&db_path).map_err(|e| format!("DB error: {e}"))?;

                let blueprint = BlueprintFile::load(Path::new(&blueprint_path))
                    .map_err(|e| format!("Failed to load blueprint '{blueprint_name}': {e}"))?;

                let evaluator = EvaluatorRegistry::build(&blueprint)
                    .map_err(|e| format!("Evaluator error: {e}"))?;

                let config = EngineConfig {
                    blueprint,
                    db_path,
                    progress_reporter: None,
                };

                let engine = Engine::new(config, evaluator, cancel)
                    .map_err(|e| format!("Engine init error: {e}"))?;

                engine
                    .run()
                    .await
                    .map_err(|e| format!("Engine error: {e}"))?;

                let experiments = persistence
                    .recent_experiments(1)
                    .map_err(|e| format!("Failed to load experiments: {e}"))?;

                let experiment_id = experiments.first().map(|e| e.id);

                if let Some(notifier) = &run_notifier {
                    if let Some(exp) = experiments.first() {
                        let config =
                            Self::notification_config_from(None, group_telegram, bp_notifications);
                        if exp.promotion_outcome == crate::persistence::PromotionOutcome::Promoted
                            && config.should_notify(crate::telegram::NotificationEvent::Promotion)
                        {
                            let branch = exp.promoted_branch_name.as_deref().unwrap_or("unknown");
                            let _ = notifier
                                .notify_promotion(
                                    &blueprint_name,
                                    exp.weighted_total,
                                    exp.duration_ms,
                                    branch,
                                    exp.iteration,
                                )
                                .await;
                        }
                    }
                }

                let result: Result<i64, String> =
                    experiment_id.ok_or_else(|| "No experiment recorded".to_owned());
                result
            };
            futs.push(fut);
        }

        let outcomes = join_all(futs).await;

        let mut results = Vec::new();
        for (i, outcome) in outcomes.into_iter().enumerate() {
            let bp_name = group
                .blueprints
                .get(i)
                .map(|b| b.blueprint_name.clone())
                .unwrap_or_default();
            match outcome {
                Ok(exp_id) => {
                    results.push(GroupWorkflowResult {
                        blueprint_name: bp_name,
                        experiment_id: Some(exp_id),
                        status: RunExperimentStatus::Completed,
                        error: None,
                    });
                }
                Err(e) => {
                    results.push(GroupWorkflowResult {
                        blueprint_name: bp_name,
                        experiment_id: None,
                        status: RunExperimentStatus::Failed,
                        error: Some(e),
                    });
                }
            }
        }

        results
    }

    /// Run a single blueprint and return its latest experiment ID.
    async fn run_single_blueprint(
        &self,
        bp: &GroupBlueprintEntry,
        group: &RunGroup,
    ) -> Result<i64, String> {
        self.run_single_blueprint_internal(bp, group, &self.persistence, self.cancel.clone())
            .await
    }

    async fn run_single_blueprint_internal(
        &self,
        bp: &GroupBlueprintEntry,
        group: &RunGroup,
        persistence: &Persistence,
        cancel: CancellationToken,
    ) -> Result<i64, String> {
        // Load the blueprint
        let blueprint_path = Path::new(&bp.blueprint_path);
        let blueprint = BlueprintFile::load(blueprint_path)
            .map_err(|e| format!("Failed to load blueprint '{}': {e}", bp.blueprint_name))?;

        // Notify start
        if let Some(notifier) = &self.notifier {
            let should_notify = self.notification_config(group, bp);
            if should_notify.should_notify(crate::telegram::NotificationEvent::RunStart) {
                let _ = notifier
                    .notify_run_start(
                        &bp.blueprint_name,
                        1,
                        blueprint.constraints.max_iterations,
                        &blueprint.domain.repo_path,
                    )
                    .await;
            }
        }

        // Build evaluator
        let evaluator =
            EvaluatorRegistry::build(&blueprint).map_err(|e| format!("Evaluator error: {e}"))?;

        let config = EngineConfig {
            blueprint,
            db_path: self.db_path.clone(),
            progress_reporter: None,
        };

        let engine = Engine::new(config, evaluator, cancel)
            .map_err(|e| format!("Engine init error: {e}"))?;

        engine
            .run()
            .await
            .map_err(|e| format!("Engine error: {e}"))?;

        // Get the latest experiment ID for this run
        let _timing = engine.timing_summary();
        // Get last experiment from DB
        let experiments = persistence
            .recent_experiments(1)
            .map_err(|e| format!("Failed to load recent experiment: {e}"))?;

        let experiment_id = experiments.first().map(|e| e.id);

        // Notify completion/promotion
        if let Some(notifier) = &self.notifier {
            if let Some(exp) = experiments.first() {
                let should_notify = self.notification_config(group, bp);

                if exp.promotion_outcome == crate::persistence::PromotionOutcome::Promoted {
                    if should_notify.should_notify(crate::telegram::NotificationEvent::Promotion) {
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
                } else {
                    if should_notify.should_notify(crate::telegram::NotificationEvent::RunComplete)
                    {
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
            }
        }

        experiment_id.ok_or_else(|| "No experiment recorded".to_owned())
    }

    fn duration_seconds(&self, start: &str, end: &str) -> f64 {
        let start_dt = chrono::DateTime::parse_from_rfc3339(start)
            .ok()
            .map(|dt| dt.timestamp_millis());
        let end_dt = chrono::DateTime::parse_from_rfc3339(end)
            .ok()
            .map(|dt| dt.timestamp_millis());
        match (start_dt, end_dt) {
            (Some(s), Some(e)) => (e - s) as f64 / 1000.0,
            _ => 0.0,
        }
    }

    fn notification_config(
        &self,
        group: &RunGroup,
        bp: &GroupBlueprintEntry,
    ) -> NotificationConfig {
        Self::notification_config_from(
            self.telegram_config.as_ref(),
            group.telegram_enabled,
            bp.notifications_enabled,
        )
    }

    fn notification_config_from(
        telegram_config: Option<&TelegramConfig>,
        group_enabled: bool,
        workflow_notifications_enabled: bool,
    ) -> NotificationConfig {
        NotificationConfig {
            global_enabled: telegram_config.is_none_or(|config| config.enabled),
            group_enabled,
            workflow_notifications_enabled,
            notify_on_start: telegram_config.is_none_or(|config| config.notify_on_start),
            notify_on_complete: telegram_config.is_none_or(|config| config.notify_on_complete),
            notify_on_error: telegram_config.is_none_or(|config| config.notify_on_error),
            notify_on_promotion: telegram_config.is_none_or(|config| config.notify_on_promotion),
        }
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
