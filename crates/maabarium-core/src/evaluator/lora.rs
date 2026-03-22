use async_trait::async_trait;
use tracing::instrument;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::sandbox::{SandboxSummary, SandboxWorkspace};
use super::{Evaluator, ExperimentResult, MetricScore};

pub struct LoraEvaluator {
    metrics: Vec<MetricDef>,
}

impl LoraEvaluator {
    pub fn new(metrics: Vec<MetricDef>) -> Self {
        Self { metrics }
    }

    fn adapter_ratio(&self, proposal: &Proposal) -> f64 {
        if proposal.file_patches.is_empty() {
            return 0.0;
        }

        let adapter_files = proposal
            .file_patches
            .iter()
            .filter(|patch| {
                patch.path.ends_with(".safetensors")
                    || patch.path.ends_with(".bin")
                    || patch.path.ends_with(".json")
            })
            .count();
        adapter_files as f64 / proposal.file_patches.len() as f64
    }

    fn metadata_ratio(&self, proposal: &Proposal) -> f64 {
        let has_model_card = proposal.file_patches.iter().any(|patch| {
            patch.path.ends_with("README.md")
                || patch.path.ends_with("adapter_config.json")
                || patch.path.ends_with("tokenizer_config.json")
        });
        if has_model_card { 1.0 } else { 0.4 }
    }

    fn score_metric(
        &self,
        metric: &MetricDef,
        proposal: &Proposal,
        sandbox: &SandboxSummary,
        adapter_ratio: f64,
        metadata_ratio: f64,
    ) -> f64 {
        let summary_signal =
            (proposal.summary.split_whitespace().count() as f64 / 24.0).clamp(0.2, 1.0);
        let compactness = (1.0 - (sandbox.total_bytes as f64 / 65_536.0)).clamp(0.2, 1.0);
        let metric_name = metric.name.to_ascii_lowercase();

        let value = if metric_name.contains("adapter") || metric_name.contains("lora") {
            0.45 + (adapter_ratio * 0.35) + (metadata_ratio * 0.2)
        } else if metric_name.contains("quality") || metric_name.contains("safety") {
            0.4 + (summary_signal * 0.2) + (metadata_ratio * 0.2) + (compactness * 0.2)
        } else if metric_name.contains("performance") || metric_name.contains("latency") {
            0.45 + (compactness * 0.35) + (adapter_ratio * 0.15)
        } else {
            0.4 + (summary_signal * 0.2) + (adapter_ratio * 0.2) + (metadata_ratio * 0.2)
        };

        value.clamp(0.0, 1.0)
    }
}

#[async_trait]
impl Evaluator for LoraEvaluator {
    #[instrument(
        name = "lora_evaluator_evaluate",
        skip(self, proposal),
        fields(iteration = iteration, patch_count = proposal.file_patches.len())
    )]
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let sandbox = SandboxWorkspace::new()?;
        let sandbox_summary = sandbox.materialize(proposal)?;
        let adapter_ratio = self.adapter_ratio(proposal);
        let metadata_ratio = self.metadata_ratio(proposal);

        let scores = self
            .metrics
            .iter()
            .map(|metric| MetricScore {
                name: metric.name.clone(),
                value: self.score_metric(
                    metric,
                    proposal,
                    &sandbox_summary,
                    adapter_ratio,
                    metadata_ratio,
                ),
                weight: metric.weight,
            })
            .collect::<Vec<_>>();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_manager::{FilePatch, FilePatchOperation, Proposal};

    #[tokio::test]
    async fn rewards_adapter_metadata_presence() {
        let evaluator = LoraEvaluator::new(vec![MetricDef {
            name: "lora_quality".into(),
            weight: 1.0,
            direction: "maximize".into(),
            description: "LoRA adapter packaging quality".into(),
        }]);

        let result = evaluator
            .evaluate(
                &Proposal {
                    summary: "Package a LoRA adapter with metadata and model card".into(),
                    file_patches: vec![
                        FilePatch {
                            path: "adapter/model.safetensors".into(),
                            operation: FilePatchOperation::Create,
                            content: Some("weights".into()),
                        },
                        FilePatch {
                            path: "adapter/adapter_config.json".into(),
                            operation: FilePatchOperation::Create,
                            content: Some("{}".into()),
                        },
                        FilePatch {
                            path: "README.md".into(),
                            operation: FilePatchOperation::Create,
                            content: Some("# Adapter".into()),
                        },
                    ],
                },
                1,
            )
            .await
            .expect("evaluation should succeed");

        assert!(result.weighted_total > 0.5);
    }
}
