use crate::agent::{Agent, Council};
use crate::blueprint::{BlueprintFile, ModelAssignment};
use crate::error::EngineError;
use crate::evaluator::{Evaluator, ExperimentResult};
use crate::git_manager::GitManager;
use crate::llm::provider_from_models;
use crate::persistence::Persistence;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, info_span, instrument, warn};

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
}

fn build_proposal_context(bp: &BlueprintFile, iteration: u64, baseline: f64) -> String {
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
        bp.domain.repo_path,
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
                "\nResearch proposal contract:\n- {search_provider_note}\n- Prefer one narrow markdown patch instead of broad rewrites.\n- Every major claim added must include at least one external URL inline.\n- If evidence is weak or no external URL is available, return no patch and explain the evidence gap in summary.\n- Prefer appending to an existing research note or creating one new markdown note in the configured target paths.\n- Unified diff hunk headers and line counts must be exact; do not invent them."
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

    #[instrument(
        name = "engine_run",
        skip(self),
        fields(
            blueprint = %self.config.blueprint.blueprint.name,
            db_path = %self.config.db_path
        )
    )]
    pub async fn run(&self) -> Result<(), EngineError> {
        let bp = &self.config.blueprint;
        let max_iter = bp.constraints.max_iterations;
        let timeout_secs = bp.constraints.timeout_seconds;
        let min_improvement = bp.constraints.min_improvement;
        let bp_name = bp.blueprint.name.clone();

        let mut baseline: f64 = self
            .persistence
            .load_baseline(&bp_name)
            .ok()
            .flatten()
            .unwrap_or(0.0);

        info!(
            "Engine starting: blueprint={bp_name}, max_iterations={max_iter}, baseline={baseline:.4}"
        );
        self.report_progress(
            EnginePhase::Starting,
            None,
            Some(baseline),
            None,
            Some("Preparing engine run".to_owned()),
        );

        for iteration in 1..=max_iter {
            let iteration_span = info_span!(
                "engine_iteration",
                iteration = iteration,
                baseline = baseline
            );
            let _iteration_guard = iteration_span.enter();

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

            let proposal_context = build_proposal_context(bp, iteration, baseline);

            let proposal = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = self.council.run(
                    &proposal_context,
                    &bp.domain.repo_path,
                    &bp.domain.target_files,
                    &bp.domain.language,
                    &bp.metrics.metrics,
                ) => result.map_err(EngineError::from),
            } {
                Ok(proposal) => proposal,
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
                    warn!("Council failed to produce a proposal for iteration {iteration}: {e}");
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };

            self.report_progress(
                EnginePhase::Branching,
                Some(iteration),
                Some(baseline),
                None,
                Some("Creating an experiment branch".to_owned()),
            );

            let branch = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = self.git.create_experiment_branch(iteration) => result.map_err(EngineError::from),
            } {
                Ok(b) => b,
                Err(EngineError::Cancelled) => {
                    self.report_progress(
                        EnginePhase::Cancelled,
                        Some(iteration),
                        Some(baseline),
                        None,
                        Some(format!("Cancellation requested before branch creation completed for iteration {iteration}")),
                    );
                    info!("Engine cancelled while creating branch for iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(e) => {
                    warn!("Failed to create branch for iteration {iteration}: {e}");
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };

            self.report_progress(
                EnginePhase::Applying,
                Some(iteration),
                Some(baseline),
                None,
                Some("Applying the proposal to an isolated git worktree".to_owned()),
            );

            match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = self.git.apply_proposal(&branch, &proposal) => result.map_err(EngineError::from),
            } {
                Ok(()) => {}
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
                    let _ = self.git.delete_branch(&branch).await;
                    info!("Engine cancelled while applying proposal for iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(e) => {
                    warn!("Failed to apply proposal for iteration {iteration}: {e}");
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    let _ = self.git.delete_branch(&branch).await;
                    continue;
                }
            }

            let eval_future = self.evaluator.evaluate(&proposal, iteration);
            self.report_progress(
                EnginePhase::Evaluating,
                Some(iteration),
                Some(baseline),
                None,
                Some("Evaluator is running against the proposed changes".to_owned()),
            );

            let result: ExperimentResult = match tokio::select! {
                _ = self.cancel.cancelled() => Err(EngineError::Cancelled),
                result = timeout(Duration::from_secs(timeout_secs), eval_future) => Ok(match result {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    error!("Evaluation error at iteration {iteration}: {e}");
                    let _ = self
                        .persistence
                        .log_failure(&bp_name, iteration, &e.to_string());
                    let _ = self.git.delete_branch(&branch).await;
                    continue;
                }
                Err(_) => {
                    error!("Evaluation timed out at iteration {iteration}");
                    let _ = self.persistence.log_failure(&bp_name, iteration, "timeout");
                    let _ = self.git.delete_branch(&branch).await;
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
                    let _ = self.git.delete_branch(&branch).await;
                    info!("Engine cancelled while evaluating iteration {iteration}");
                    return Err(EngineError::Cancelled);
                }
                Err(other) => return Err(other),
            };

            info!(
                "Iteration {iteration} score={:.4} baseline={baseline:.4}",
                result.weighted_total
            );

            self.report_progress(
                EnginePhase::Persisting,
                Some(iteration),
                Some(result.weighted_total),
                Some(result.duration_ms),
                Some("Persisting completed iteration results".to_owned()),
            );

            if let Err(e) = self.persistence.log_experiment(&bp_name, &result) {
                error!("Failed to persist experiment: {e}");
            }

            if self.cancel.is_cancelled() {
                self.report_progress(
                    EnginePhase::Cancelled,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!(
                        "Cancellation requested after iteration {iteration} completed"
                    )),
                );
                let _ = self.git.delete_branch(&branch).await;
                return Err(EngineError::Cancelled);
            }

            if crate::metrics::is_improvement(baseline, result.weighted_total, min_improvement) {
                info!("Improvement found! Promoting branch '{branch}'");
                self.report_progress(
                    EnginePhase::Promoting,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!("Promoting branch '{branch}'")),
                );
                if let Err(e) = self.git.promote_branch(&branch).await {
                    warn!("Failed to promote branch: {e}");
                } else {
                    baseline = result.weighted_total;
                }
            } else {
                self.report_progress(
                    EnginePhase::CleaningUp,
                    Some(iteration),
                    Some(result.weighted_total),
                    Some(result.duration_ms),
                    Some(format!("Cleaning up non-promoted branch '{branch}'")),
                );
                let _ = self.git.delete_branch(&branch).await;
            }
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
