use crate::agent::{Agent, Council};
use crate::blueprint::{BlueprintFile, ModelAssignment};
use crate::error::EngineError;
use crate::evaluator::{EvaluationContext, Evaluator, ExperimentResult};
use crate::git_manager::{AppliedProposal, ExperimentWorkspace, GitManager};
use crate::llm::provider_from_models;
use crate::persistence::{Persistence, PromotionOutcome};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, info_span, instrument, warn};
use uuid::Uuid;

pub type EngineProgressReporter = Arc<dyn Fn(EngineProgressUpdate) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnginePhase {
    Starting,
    Planning,
    Branching,
    Applying,
    Evaluating,
    Persisting,
    Promoting,
    CleaningUp,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct EngineProgressUpdate {
    pub blueprint_name: String,
    pub workspace_path: String,
    pub max_iterations: u64,
    pub iteration: Option<u64>,
    pub phase: EnginePhase,
    pub latest_score: Option<f64>,
    pub latest_duration_ms: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct EnginePhaseTiming {
    pub count: u64,
    pub total_ms: u64,
    pub max_ms: u64,
}

#[derive(Debug, Clone, Default)]
pub struct EngineTimingSummary {
    pub run_id: String,
    pub completed_iterations: u64,
    pub phase_totals: BTreeMap<String, EnginePhaseTiming>,
    pub iteration_durations_ms: Vec<u64>,
    pub proposal_failure_counters: BTreeMap<String, u64>,
}

pub struct EngineConfig {
    pub blueprint: BlueprintFile,
    pub db_path: String,
    pub progress_reporter: Option<EngineProgressReporter>,
}

pub struct Engine {
    config: EngineConfig,
    evaluator: Arc<dyn Evaluator>,
    council: Council,
    git: GitManager,
    persistence: Persistence,
    cancel: CancellationToken,
    progress_reporter: Option<EngineProgressReporter>,
    run_id: String,
    timing_summary: Mutex<EngineTimingSummary>,
}

fn generate_run_id() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_owned()
}

fn build_proposal_context(
    bp: &BlueprintFile,
    proposal_repo_path: &str,
    iteration: u64,
    baseline: f64,
) -> String {
    let target_files = if bp.domain.target_files.is_empty() {
        "- no explicit targets".to_owned()
    } else {
        bp.domain
            .target_files
            .iter()
            .map(|target| format!("- {target}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let mut context = format!(
        "Blueprint: {}\nDescription: {}\nRepository: {}\nLanguage: {}\nIteration: {}\nCurrent baseline: {:.4}\nTarget file patterns:\n{}",
        bp.blueprint.name,
        bp.blueprint.description,
        proposal_repo_path,
        bp.domain.language,
        iteration,
        baseline,
        target_files,
    );

    if bp.domain.language.eq_ignore_ascii_case("research") {
        let search_provider_note = match std::env::var("MAABARIUM_RESEARCH_SEARCH_PROVIDER")
            .ok()
            .as_deref()
        {
            Some("brave_api") => {
                "Runtime search note: Brave Search API is selected. Discovery is using an official API-backed provider, but every claim must still be verified against the destination URLs before it is written into the patch."
            }
            Some("duckduckgo_scrape") => {
                "Runtime search note: DuckDuckGo HTML scrape fallback is selected. Discovery results are lower-assurance leads from an unofficial scraper path; expect instability or blocking, and avoid strong claims unless the destination URLs themselves support them."
            }
            _ => {
                "Runtime search note: The runtime may auto-select the research discovery provider. Confirm every major claim against concrete destination URLs before it is written into the patch."
            }
        };
        context.push_str(
            &format!(
                "\nResearch proposal contract:\n- {search_provider_note}\n- Prefer one narrow markdown patch instead of broad rewrites.\n- Every major claim added must include at least one external URL inline.\n- If evidence is weak or no external URL is available, return no patch, explain the evidence gap in summary, and include a follow-up search cue using the exact phrase Search for \"...\".\n- Prefer appending to an existing research note or creating one new markdown note in the configured target paths.\n- Unified diff hunk headers and line counts must be exact; do not invent them."
            ),
        );
    }

    context
}

impl Engine {
    pub fn new(
        config: EngineConfig,
        evaluator: Arc<dyn Evaluator>,
        cancel: CancellationToken,
    ) -> Result<Self, EngineError> {
        let git = GitManager::new(&config.blueprint.domain.repo_path);
        let persistence = Persistence::open(&config.db_path)?;
        let council = build_council(&config.blueprint)?;
        Ok(Self {
            council,
            git,
            evaluator,
            persistence,
            cancel,
            progress_reporter: config.progress_reporter.clone(),
            run_id: generate_run_id(),
            timing_summary: Mutex::new(EngineTimingSummary::default()),
            config,
        })
    }

    fn report_progress(
        &self,
        phase: EnginePhase,
        iteration: Option<u64>,
        latest_score: Option<f64>,
        latest_duration_ms: Option<u64>,
        message: Option<String>,
    ) {
        if let Some(reporter) = &self.progress_reporter {
            reporter(EngineProgressUpdate {
                blueprint_name: self.config.blueprint.blueprint.name.clone(),
                workspace_path: self.config.blueprint.domain.repo_path.clone(),
                max_iterations: self.config.blueprint.constraints.max_iterations,
                iteration,
                phase,
                latest_score,
                latest_duration_ms,
                message,
            });
        }
    }

    fn log_phase_timing(&self, iteration: u64, phase: &'static str, started_at: std::time::Instant) {
        let duration_ms = started_at.elapsed().as_millis() as u64;
        self.log_phase_duration(iteration, phase, duration_ms);
    }

    fn log_phase_duration(&self, iteration: u64, phase: &'static str, duration_ms: u64) {
        if let Ok(mut summary) = self.timing_summary.lock() {
            let phase_entry = summary
                .phase_totals
                .entry(phase.to_owned())
                .or_default();
            phase_entry.count += 1;
            phase_entry.total_ms += duration_ms;
            phase_entry.max_ms = phase_entry.max_ms.max(duration_ms);
        }
        info!(
            run_id = %self.run_id,
            iteration,
            phase,
            duration_ms,
            "Engine phase completed"
        );
    }

    fn record_iteration_timing(&self, duration_ms: u64) {
        if let Ok(mut summary) = self.timing_summary.lock() {
            summary.completed_iterations += 1;
            summary.iteration_durations_ms.push(duration_ms);
        }
    }

    fn record_proposal_failure_counters(&self, counters: &BTreeMap<String, u64>) {
        if counters.is_empty() {
            return;
        }

        if let Ok(mut summary) = self.timing_summary.lock() {
            for (counter_key, count) in counters {
                *summary
                    .proposal_failure_counters
                    .entry(counter_key.clone())
                    .or_insert(0) += count;
            }
        }
    }

    fn reset_timing_summary(&self) {
        if let Ok(mut summary) = self.timing_summary.lock() {
            *summary = EngineTimingSummary {
                run_id: self.run_id.clone(),
                ..EngineTimingSummary::default()
            };
        }
    }

    pub fn timing_summary(&self) -> EngineTimingSummary {
        self.timing_summary
            .lock()
            .map(|summary| summary.clone())
            .unwrap_or_default()
    }

    #[instrument(
        name = "engine_run",
        skip(self),
        fields(
            blueprint = %self.config.blueprint.blueprint.name,
            db_path = %self.config.db_path
        )
    )]
    pub async fn run(&self) -> Result<(), EngineError> {
        self.reset_timing_summary();
        let bp = &self.config.blueprint;
        let max_iter = bp.constraints.max_iterations;
        let timeout_secs = bp.constraints.timeout_seconds;
        let min_improvement = bp.constraints.min_improvement;
        let bp_name = bp.blueprint.name.clone();

        let mut baseline: f64 = 0.0;

        info!(
            "Engine starting: blueprint={bp_name}, run_id={}, max_iterations={max_iter}, baseline={baseline:.4}",
            self.run_id,
        );
        self.report_progress(
            EnginePhase::Starting,
            None,
            Some(baseline),
            None,
            Some("Preparing engine run".to_owned()),
        );

        let mut reusable_workspace: Option<ExperimentWorkspace> = None;

        for iteration in 1..=max_iter {
            let iteration_span = info_span!(
                "engine_iteration",
                iteration = iteration,
                baseline = baseline
            );
            let _iteration_guard = iteration_span.enter();
            let iteration_started = std::time::Instant::now();

            if self.cancel.is_cancelled() {
                self.report_progress(
                    EnginePhase::Cancelled,
                    Some(iteration),
                    Some(baseline),
                    None,
                    Some(format!(
                        "Cancellation requested before iteration {iteration}"
                    )),
                );
                info!("Engine cancelled at iteration {iteration}");
                return Err(EngineError::Cancelled);
            }

            info!("Iteration {iteration}/{max_iter}");
            self.report_progress(
                EnginePhase::Planning,
                Some(iteration),
                Some(baseline),
                None,
                Some("Council is preparing the next proposal".to_owned()),
            );

            let proposal_repo_path = reusable_workspace
                .as_ref()
                .map(|workspace| workspace.path.display().to_string())
                .unwrap_or_else(|| bp.domain.repo_path.clone());
            let proposal_context = build_proposal_context(bp, &proposal_repo_path, iteration, baseline);
            let planning_started = std::time::Instant::now();

            let proposal = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = self.council.run(
                    &proposal_context,
                    &proposal_repo_path,
                    &bp.domain.target_files,
                    &bp.domain.language,
                    &bp.metrics.metrics,
                ) => result.map_err(EngineError::from),
            } {
                Ok(proposal) => {
                    self.record_proposal_failure_counters(&self.council.last_proposal_failure_counters());
                    proposal
                }
                Err(EngineError::Cancelled) => {
                    self.report_progress(
                        EnginePhase::Cancelled,
                        Some(iteration),
                        Some(baseline),
                        None,
                        Some(format!("Cancellation requested during proposal generation for iteration {iteration}")),
                    );
                    info!("Engine cancelled while generating proposal for iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(e) => {
                    self.record_proposal_failure_counters(&self.council.last_proposal_failure_counters());
                    warn!("Council failed to produce a proposal for iteration {iteration}: {e}");
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };
            self.log_phase_timing(iteration, "planning", planning_started);

            self.report_progress(
                EnginePhase::Branching,
                Some(iteration),
                Some(baseline),
                None,
                Some("Preparing experiment branch metadata".to_owned()),
            );
            let branching_started = std::time::Instant::now();
            if self.cancel.is_cancelled() {
                self.report_progress(
                    EnginePhase::Cancelled,
                    Some(iteration),
                    Some(baseline),
                    None,
                    Some(format!(
                        "Cancellation requested before branch preparation completed for iteration {iteration}"
                    )),
                );
                info!("Engine cancelled while preparing branch metadata for iteration {iteration}");
                return Err(EngineError::Cancelled);
            }
            let branch = GitManager::experiment_branch_name(&self.run_id, iteration);
            self.log_phase_timing(iteration, "branching", branching_started);

            self.report_progress(
                EnginePhase::Applying,
                Some(iteration),
                Some(baseline),
                None,
                Some("Applying the proposal to an isolated git worktree".to_owned()),
            );
            info!(
                run_id = %self.run_id,
                iteration,
                has_reusable_workspace = reusable_workspace.is_some(),
                reusable_workspace_path = reusable_workspace
                    .as_ref()
                    .map(|workspace| workspace.path.display().to_string())
                    .unwrap_or_else(|| "none".to_owned()),
                "Preparing to apply proposal"
            );
            let applying_started = std::time::Instant::now();

            let applied_proposal = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = self.git.apply_proposal(&branch, &proposal, reusable_workspace.as_ref()) => result.map_err(EngineError::from),
            } {
                Ok(applied) => applied,
                Err(EngineError::Cancelled) => {
                    self.report_progress(
                        EnginePhase::Cancelled,
                        Some(iteration),
                        Some(baseline),
                        None,
                        Some(format!(
                            "Cancellation requested while applying iteration {iteration}"
                        )),
                    );
                    if let Some(workspace) = reusable_workspace.as_ref() {
                        let _ = self.git.cleanup_experiment_workspace(&workspace.path).await;
                    }
                    info!("Engine cancelled while applying proposal for iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(e) => {
                    warn!("Failed to apply proposal for iteration {iteration}: {e}");
                    if let Some(workspace) = reusable_workspace.as_ref() {
                        let _ = self.git.detach_experiment_workspace(&workspace.path).await;
                    }
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };
            self.log_phase_timing(iteration, "applying", applying_started);
            log_apply_subphase_timings(self, iteration, &applied_proposal);
            info!(
                run_id = %self.run_id,
                iteration,
                "Apply proposal timing breakdown recorded: exists_before={} valid_before={} exists_after_apply={} valid_after_apply={} reused_workspace={} macos_no_checkout_used={}",
                applied_proposal.timing.workspace_exists_before,
                applied_proposal.timing.workspace_valid_before,
                applied_proposal.timing.workspace_exists_after_apply,
                applied_proposal.timing.workspace_valid_after_apply,
                applied_proposal.timing.reused_workspace,
                applied_proposal.timing.macos_no_checkout_used,
            );
            if applied_proposal.timing.macos_no_checkout_used {
                info!(
                    run_id = %self.run_id,
                    iteration,
                    "macOS git worktree add --no-checkout optimization used for apply path"
                );
            }
            let experiment_workspace = applied_proposal.workspace;

            let evaluation_context = EvaluationContext {
                workspace_path: Some(experiment_workspace.path.clone()),
            };
            let eval_future = self
                .evaluator
                .evaluate(&proposal, iteration, &evaluation_context);
            self.report_progress(
                EnginePhase::Evaluating,
                Some(iteration),
                Some(baseline),
                None,
                Some("Evaluator is running against the proposed changes".to_owned()),
            );
            let evaluating_started = std::time::Instant::now();

            let result: ExperimentResult = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = timeout(Duration::from_secs(timeout_secs), eval_future) => Ok(match result {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    self.log_phase_timing(iteration, "evaluating", evaluating_started);
                    error!("Evaluation error at iteration {iteration}: {e}");
                    let _ = self.git.detach_experiment_workspace(&experiment_workspace.path).await;
                    reusable_workspace = Some(experiment_workspace.clone());
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
                Err(_) => {
                    self.log_phase_timing(iteration, "evaluating", evaluating_started);
                    error!("Evaluation timed out at iteration {iteration}");
                    let _ = self.git.detach_experiment_workspace(&experiment_workspace.path).await;
                    reusable_workspace = Some(experiment_workspace.clone());
                    let _ = self.persistence.log_failure(&bp_name, iteration, "timeout");
                    continue;
                }
                })
            } {
                Ok(result) => result,
                Err(EngineError::Cancelled) => {
                    self.report_progress(
                        EnginePhase::Cancelled,
                        Some(iteration),
                        Some(baseline),
                        None,
                        Some(format!(
                            "Cancellation requested while evaluating iteration {iteration}"
                        )),
                    );
                    let _ = self.git.cleanup_experiment_workspace(&experiment_workspace.path).await;
                    info!("Engine cancelled while evaluating iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(other) => return Err(other),
            };
            self.log_phase_timing(iteration, "evaluating", evaluating_started);

            info!(
                "Iteration {iteration} score={:.4} baseline={baseline:.4}",
                result.weighted_total
            );

            let decision_started = std::time::Instant::now();
            let mut promoted_branch_name: Option<String> = None;
            let mut promoted_target_branch_name: Option<String> = None;
            let mut promoted_commit_oid: Option<String> = None;

            let promotion_outcome = if self.cancel.is_cancelled() {
                self.report_progress(
                    EnginePhase::Cancelled,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!(
                        "Cancellation requested after iteration {iteration} completed"
                    )),
                );
                let _ = self.git.detach_experiment_workspace(&experiment_workspace.path).await;
                let _ = self.git.delete_branch(&branch).await;
                info!("Engine cancelled after iteration {iteration} completed");
                PromotionOutcome::Cancelled
            } else if proposal.file_patches.is_empty() {
                info!(
                    run_id = %self.run_id,
                    iteration,
                    "Rejecting no-op proposal with no file patches"
                );
                self.report_progress(
                    EnginePhase::CleaningUp,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!(
                        "Rejecting no-op proposal for branch '{branch}'"
                    )),
                );
                let _ = self.git.detach_experiment_workspace(&experiment_workspace.path).await;
                PromotionOutcome::Rejected
            } else if crate::metrics::is_improvement(
                baseline,
                result.weighted_total,
                min_improvement,
            ) {
                info!("Improvement found! Promoting branch '{branch}'");
                self.report_progress(
                    EnginePhase::Promoting,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!("Promoting branch '{branch}'")),
                );
                let commit_started = std::time::Instant::now();
                match self
                    .git
                    .commit_experiment_workspace(&experiment_workspace.path, &proposal.summary)
                    .await
                {
                    Ok(committed) => {
                        self.log_phase_duration(
                            iteration,
                            "promotion_commit",
                            commit_started.elapsed().as_millis() as u64,
                        );
                        info!(
                            run_id = %self.run_id,
                            iteration,
                            committed,
                            "Promotion commit completed"
                        );
                        if !committed {
                            info!(
                                run_id = %self.run_id,
                                iteration,
                                "Rejecting promotion because the experiment workspace produced no commit"
                            );
                            self.report_progress(
                                EnginePhase::CleaningUp,
                                Some(iteration),
                                Some(result.weighted_total),
                                Some(result.duration_ms),
                                Some(format!(
                                    "Rejecting no-op workspace for branch '{branch}'"
                                )),
                            );
                            let _ = self
                                .git
                                .detach_experiment_workspace(&experiment_workspace.path)
                                .await;
                            PromotionOutcome::Rejected
                        } else if let Err(error) = self
                            .git
                            .create_branch_at_workspace_head(&experiment_workspace.path, &branch)
                            .await
                        {
                            warn!(
                                "Failed to materialize experiment branch '{branch}' from detached workspace: {error}"
                            );
                            let _ = self
                                .git
                                .cleanup_experiment_workspace(&experiment_workspace.path)
                                .await;
                            PromotionOutcome::PromotionFailed
                        } else {
                            match self.git.promote_branch(&branch).await {
                                Ok(promoted_target_branch) => {
                                    promoted_branch_name = Some(branch.clone());
                                    promoted_target_branch_name = Some(promoted_target_branch);
                                    match self.git.branch_head_commit_oid(&branch).await {
                                        Ok(commit_oid) => {
                                            promoted_commit_oid = Some(commit_oid);
                                        }
                                        Err(error) => {
                                            warn!(
                                                "Failed to resolve promoted commit for branch '{branch}': {error}"
                                            );
                                        }
                                    }
                                    baseline = result.weighted_total;
                                    PromotionOutcome::Promoted
                                }
                                Err(error) => {
                                    warn!("Failed to promote branch: {error}");
                                    let _ = self
                                        .git
                                        .cleanup_experiment_workspace(&experiment_workspace.path)
                                        .await;
                                    PromotionOutcome::PromotionFailed
                                }
                            }
                        }
                    }
                    Err(error) => {
                        warn!("Failed to commit experiment workspace before promotion: {error}");
                        self.log_phase_duration(
                            iteration,
                            "promotion_commit",
                            commit_started.elapsed().as_millis() as u64,
                        );
                        let _ = self
                            .git
                            .cleanup_experiment_workspace(&experiment_workspace.path)
                            .await;
                        PromotionOutcome::PromotionFailed
                    }
                }
            } else {
                self.report_progress(
                    EnginePhase::CleaningUp,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!("Cleaning up non-promoted branch '{branch}'")),
                );
                let _ = self.git.detach_experiment_workspace(&experiment_workspace.path).await;
                PromotionOutcome::Rejected
            };
            self.log_phase_timing(iteration, "promotion_decision", decision_started);
            if matches!(
                promotion_outcome,
                PromotionOutcome::Promoted | PromotionOutcome::Rejected
            ) {
                reusable_workspace = Some(experiment_workspace.clone());
                info!(
                    run_id = %self.run_id,
                    iteration,
                    reusable_workspace_path = %experiment_workspace.path.display(),
                    workspace_exists_after_iteration = experiment_workspace.path.exists(),
                    "Stored reusable workspace after iteration"
                );
            } else {
                reusable_workspace = None;
                info!(
                    run_id = %self.run_id,
                    iteration,
                    workspace_path = %experiment_workspace.path.display(),
                    "Discarded reusable workspace after failed promotion path"
                );
            }
            self.report_progress(
                EnginePhase::Persisting,
                Some(iteration),
                Some(result.weighted_total),
                Some(result.duration_ms),
                Some("Persisting completed iteration results".to_owned()),
            );
            let persisting_started = std::time::Instant::now();

            if let Err(e) = self
                .persistence
                .log_experiment(
                    &bp_name,
                    &result,
                    promotion_outcome,
                    promoted_branch_name.as_deref(),
                    promoted_target_branch_name.as_deref(),
                    promoted_commit_oid.as_deref(),
                )
            {
                error!("Failed to persist experiment: {e}");
            }
            self.log_phase_timing(iteration, "persisting", persisting_started);

            let iteration_duration_ms = iteration_started.elapsed().as_millis() as u64;
            self.record_iteration_timing(iteration_duration_ms);
            info!(
                run_id = %self.run_id,
                iteration,
                duration_ms = iteration_duration_ms,
                outcome = %format!("{}", promotion_outcome.as_db_value_for_display()),
                "Engine iteration completed"
            );

            if matches!(promotion_outcome, PromotionOutcome::Cancelled) {
                return Err(EngineError::Cancelled);
            }
        }

        if let Some(workspace) = reusable_workspace.as_ref() {
            let cleanup_started = std::time::Instant::now();
            if let Err(error) = self.git.cleanup_experiment_workspace(&workspace.path).await {
                warn!("Failed to clean up experiment workspace: {error}");
            }
            self.log_phase_timing(max_iter, "workspace_cleanup", cleanup_started);
        }

        info!("Engine completed {max_iter} iterations. Final baseline={baseline:.4}");
        self.report_progress(
            EnginePhase::Completed,
            Some(max_iter),
            Some(baseline),
            None,
            Some("Engine run completed".to_owned()),
        );
        Ok(())
    }
}

fn log_apply_subphase_timings(engine: &Engine, iteration: u64, applied: &AppliedProposal) {
    if applied.timing.worktree_registration_ms > 0 {
        engine.log_phase_duration(
            iteration,
            "applying_worktree_registration",
            applied.timing.worktree_registration_ms,
        );
    }
    if applied.timing.reset_clean_ms > 0 {
        engine.log_phase_duration(
            iteration,
            "applying_reset_clean",
            applied.timing.reset_clean_ms,
        );
    }
    if applied.timing.checkout_detach_ms > 0 {
        engine.log_phase_duration(
            iteration,
            "applying_checkout_detach",
            applied.timing.checkout_detach_ms,
        );
    }
    if applied.timing.checkout_target_branch_ms > 0 {
        engine.log_phase_duration(
            iteration,
            "applying_checkout_target_branch",
            applied.timing.checkout_target_branch_ms,
        );
    }
    if applied.timing.patch_materialization_ms > 0 {
        engine.log_phase_duration(
            iteration,
            "applying_patch_materialization",
            applied.timing.patch_materialization_ms,
        );
    }
}

#[instrument(name = "build_council", skip(blueprint), fields(blueprint = %blueprint.blueprint.name))]
fn build_council(blueprint: &BlueprintFile) -> Result<Council, EngineError> {
    let mut agents = Vec::new();

    let shared_provider = if blueprint.models.assignment == ModelAssignment::RoundRobin {
        Some(provider_from_models(&blueprint.models, None)?)
    } else {
        None
    };

    for agent_def in blueprint
        .agents
        .agents
        .iter()
        .take(blueprint.agents.council_size as usize)
    {
        let provider = shared_provider
            .clone()
            .unwrap_or(provider_from_models(&blueprint.models, Some(&agent_def.model))?);
        agents.push(Agent::new(agent_def.clone(), provider));
    }

    Ok(Council::new(agents, blueprint.agents.debate_rounds))
}
