use crate::error::EvalError;
use crate::git_manager::Proposal;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub mod code;
pub mod lora;
pub mod prompt;
pub mod sandbox;

pub use code::CodeEvaluator;
pub use lora::LoraEvaluator;
pub use prompt::PromptEvaluator;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricScore {
    pub name: String,
    pub value: f64,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperimentResult {
    pub iteration: u64,
    pub proposal: Proposal,
    pub scores: Vec<MetricScore>,
    pub weighted_total: f64,
    pub duration_ms: u64,
}

impl ExperimentResult {
    pub fn compute_weighted_total(scores: &[MetricScore]) -> f64 {
        scores.iter().map(|s| s.value * s.weight).sum()
    }
}

#[async_trait]
pub trait Evaluator: Send + Sync {
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
    ) -> Result<ExperimentResult, EvalError>;
}
