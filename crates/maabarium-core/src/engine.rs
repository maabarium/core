use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tokio::time::timeout;
use tracing::{error, info, info_span, instrument, warn};
use crate::agent::{Agent, Council};
use crate::blueprint::BlueprintFile;
use crate::evaluator::{Evaluator, ExperimentResult};
use crate::git_manager::GitManager;
use crate::llm::provider_from_models;
use crate::persistence::Persistence;
use crate::error::EngineError;

pub struct EngineConfig {
    pub blueprint: BlueprintFile,
    pub db_path: String,
}

pub struct Engine {
    config: EngineConfig,
    evaluator: Arc<dyn Evaluator>,
    council: Council,
    git: GitManager,
    persistence: Persistence,
    cancel: CancellationToken,
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
            config,
        })
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

        info!("Engine starting: blueprint={bp_name}, max_iterations={max_iter}, baseline={baseline:.4}");

        for iteration in 1..=max_iter {
            let iteration_span = info_span!(
                "engine_iteration",
                iteration = iteration,
                baseline = baseline
            );
            let _iteration_guard = iteration_span.enter();

            if self.cancel.is_cancelled() {
                info!("Engine cancelled at iteration {iteration}");
                return Err(EngineError::Cancelled);
            }

            info!("Iteration {iteration}/{max_iter}");

            let proposal_context = format!(
                "Blueprint: {}\nDescription: {}\nRepository: {}\nLanguage: {}\nIteration: {}\nCurrent baseline: {:.4}",
                bp.blueprint.name,
                bp.blueprint.description,
                bp.domain.repo_path,
                bp.domain.language,
                iteration,
                baseline,
            );

            let proposal = match self
                .council
                .run(
                    &proposal_context,
                    &bp.domain.repo_path,
                    &bp.domain.target_files,
                    &bp.domain.language,
                    &bp.metrics.metrics,
                )
                .await
            {
                Ok(proposal) => proposal,
                Err(e) => {
                    warn!("Council failed to produce a proposal for iteration {iteration}: {e}");
                    let _ = self.persistence.log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };

            let branch = match self.git.create_experiment_branch(iteration).await {
                Ok(b) => b,
                Err(e) => {
                    warn!("Failed to create branch for iteration {iteration}: {e}");
                    let _ = self.persistence.log_failure(&bp_name, iteration, &e.to_string());
                    continue;
                }
            };

            if let Err(e) = self.git.apply_proposal(&branch, &proposal).await {
                warn!("Failed to apply proposal for iteration {iteration}: {e}");
                let _ = self.persistence.log_failure(&bp_name, iteration, &e.to_string());
                let _ = self.git.delete_branch(&branch).await;
                continue;
            }

            let eval_future = self.evaluator.evaluate(&proposal, iteration);

            let result: ExperimentResult = match timeout(
                Duration::from_secs(timeout_secs),
                eval_future,
            )
            .await
            {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    error!("Evaluation error at iteration {iteration}: {e}");
                    let _ = self.persistence.log_failure(&bp_name, iteration, &e.to_string());
                    let _ = self.git.delete_branch(&branch).await;
                    continue;
                }
                Err(_) => {
                    error!("Evaluation timed out at iteration {iteration}");
                    let _ = self.persistence.log_failure(&bp_name, iteration, "timeout");
                    let _ = self.git.delete_branch(&branch).await;
                    continue;
                }
            };

            info!(
                "Iteration {iteration} score={:.4} baseline={baseline:.4}",
                result.weighted_total
            );

            if let Err(e) = self.persistence.log_experiment(&bp_name, &result) {
                error!("Failed to persist experiment: {e}");
            }

            if crate::metrics::is_improvement(baseline, result.weighted_total, min_improvement) {
                info!("Improvement found! Promoting branch '{branch}'");
                if let Err(e) = self.git.promote_branch(&branch).await {
                    warn!("Failed to promote branch: {e}");
                } else {
                    baseline = result.weighted_total;
                }
            } else {
                let _ = self.git.delete_branch(&branch).await;
            }
        }

        info!("Engine completed {max_iter} iterations. Final baseline={baseline:.4}");
        Ok(())
    }
}

#[instrument(name = "build_council", skip(blueprint), fields(blueprint = %blueprint.blueprint.name))]
fn build_council(blueprint: &BlueprintFile) -> Result<Council, EngineError> {
    let mut agents = Vec::new();

    for agent_def in blueprint.agents.agents.iter().take(blueprint.agents.council_size as usize) {
        let provider = provider_from_models(&blueprint.models, Some(&agent_def.model))?;
        agents.push(Agent::new(agent_def.clone(), provider));
    }

    Ok(Council::new(agents, blueprint.agents.debate_rounds))
}
