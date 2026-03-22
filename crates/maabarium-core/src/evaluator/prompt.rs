use async_trait::async_trait;
use std::sync::Arc;
use crate::error::EvalError;
use crate::llm::{LLMProvider, CompletionRequest};
use crate::blueprint::MetricDef;
use crate::git_manager::Proposal;
use super::{Evaluator, ExperimentResult, MetricScore};

pub struct PromptEvaluator {
    llm: Arc<dyn LLMProvider>,
    metrics: Vec<MetricDef>,
}

impl PromptEvaluator {
    pub fn new(llm: Arc<dyn LLMProvider>, metrics: Vec<MetricDef>) -> Self {
        Self { llm, metrics }
    }
}

#[async_trait]
impl Evaluator for PromptEvaluator {
    async fn evaluate(&self, proposal: &Proposal, iteration: u64) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let mut scores = Vec::new();
        for metric in &self.metrics {
            let system = format!(
                "You are an expert evaluator for the metric '{}'. {}. \
                 Respond with a single float between 0.0 and 1.0.",
                metric.name, metric.description
            );
            let prompt = format!(
                "Evaluate the following proposal on the '{}' metric ({}). \
                 Proposal: {}\nRespond with only a number between 0.0 and 1.0.",
                metric.name, metric.direction, proposal.summary
            );
            let req = CompletionRequest {
                system,
                prompt,
                temperature: 0.1,
                max_tokens: 16,
            };
            let resp = self.llm.complete(&req).await?;
            let value: f64 = resp.content.trim().parse().map_err(|_| {
                EvalError::Parse(format!(
                    "Could not parse score '{}' for metric '{}'",
                    resp.content.trim(),
                    metric.name
                ))
            })?;
            scores.push(MetricScore {
                name: metric.name.clone(),
                value: value.clamp(0.0, 1.0),
                weight: metric.weight,
            });
        }
        let weighted_total = ExperimentResult::compute_weighted_total(&scores);
        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            scores,
            weighted_total,
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }
}
