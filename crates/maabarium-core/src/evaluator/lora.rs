use async_trait::async_trait;
use serde::Deserialize;
use tracing::instrument;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::sandbox::{SandboxSummary, SandboxWorkspace};
use super::{Evaluator, ExperimentResult, MetricScore};

pub struct LoraEvaluator {
    metrics: Vec<MetricDef>,
}

#[derive(Debug, Deserialize)]
struct LoraRunManifest {
    trainer: String,
    base_model: String,
    dataset: String,
    adapter_path: String,
    output_dir: Option<String>,
    eval_command: Option<String>,
    epochs: Option<u32>,
    learning_rate: Option<f64>,
}

impl LoraEvaluator {
    pub fn new(metrics: Vec<MetricDef>) -> Self {
        Self { metrics }
    }

    fn load_run_manifest(&self, proposal: &Proposal) -> Result<Option<LoraRunManifest>, EvalError> {
        let Some(content) = proposal.file_patches.iter().find_map(|patch| {
            if patch.path.ends_with("maabarium-lora-run.json")
                || patch.path.ends_with("lora-run.json")
            {
                patch.content.as_deref()
            } else {
                None
            }
        }) else {
            return Ok(None);
        };

        serde_json::from_str(content)
            .map(Some)
            .map_err(|error| EvalError::Parse(format!("Invalid LoRA run manifest: {error}")))
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
        let has_run_manifest = proposal
            .file_patches
            .iter()
            .any(|patch| patch.path.ends_with("maabarium-lora-run.json"));
        match (has_model_card, has_run_manifest) {
            (true, true) => 1.0,
            (true, false) => 0.7,
            (false, true) => 0.6,
            (false, false) => 0.35,
        }
    }

    fn reproducibility_ratio(
        &self,
        proposal: &Proposal,
        run_manifest: Option<&LoraRunManifest>,
    ) -> f64 {
        let Some(run_manifest) = run_manifest else {
            return 0.3;
        };

        let output_dir_present = run_manifest
            .output_dir
            .as_ref()
            .map(|output_dir| {
                proposal
                    .file_patches
                    .iter()
                    .any(|patch| patch.path.starts_with(output_dir))
            })
            .unwrap_or(false);
        let adapter_present = proposal
            .file_patches
            .iter()
            .any(|patch| patch.path == run_manifest.adapter_path);
        let epochs_present = run_manifest.epochs.unwrap_or_default() > 0;
        let learning_rate_present = run_manifest.learning_rate.unwrap_or_default() > 0.0;
        let eval_command_present = run_manifest
            .eval_command
            .as_ref()
            .map(|command| !command.trim().is_empty())
            .unwrap_or(false);

        let mut score = 0.2_f64;
        if !run_manifest.base_model.trim().is_empty() {
            score += 0.2;
        }
        if !run_manifest.dataset.trim().is_empty() {
            score += 0.2;
        }
        if adapter_present || output_dir_present {
            score += 0.2;
        }
        if epochs_present && learning_rate_present {
            score += 0.1;
        }
        if eval_command_present {
            score += 0.1;
        }
        score.clamp(0.0, 1.0)
    }

    fn trainer_signal(&self, run_manifest: Option<&LoraRunManifest>) -> f64 {
        let Some(run_manifest) = run_manifest else {
            return 0.35;
        };

        let trainer = run_manifest.trainer.trim().to_ascii_lowercase();
        if trainer.contains("mlx") {
            1.0
        } else if trainer.contains("python") || trainer.contains("external") {
            0.8
        } else {
            0.55
        }
    }

    fn score_metric(
        &self,
        metric: &MetricDef,
        proposal: &Proposal,
        sandbox: &SandboxSummary,
        adapter_ratio: f64,
        metadata_ratio: f64,
        reproducibility_ratio: f64,
        trainer_signal: f64,
    ) -> f64 {
        let summary_signal =
            (proposal.summary.split_whitespace().count() as f64 / 24.0).clamp(0.2, 1.0);
        let compactness = (1.0 - (sandbox.total_bytes as f64 / 65_536.0)).clamp(0.2, 1.0);
        let metric_name = metric.name.to_ascii_lowercase();

        let value = if metric_name.contains("adapter") || metric_name.contains("lora") {
            0.15 + (adapter_ratio * 0.25)
                + (metadata_ratio * 0.2)
                + (reproducibility_ratio * 0.25)
                + (trainer_signal * 0.15)
        } else if metric_name.contains("quality") || metric_name.contains("safety") {
            0.1 + (summary_signal * 0.2)
                + (metadata_ratio * 0.2)
                + (compactness * 0.15)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.15)
        } else if metric_name.contains("performance") || metric_name.contains("latency") {
            0.1 + (compactness * 0.3)
                + (adapter_ratio * 0.15)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.2)
        } else {
            0.1 + (summary_signal * 0.15)
                + (adapter_ratio * 0.15)
                + (metadata_ratio * 0.2)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.15)
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
        let run_manifest = self.load_run_manifest(proposal)?;
        let adapter_ratio = self.adapter_ratio(proposal);
        let metadata_ratio = self.metadata_ratio(proposal);
        let reproducibility_ratio = self.reproducibility_ratio(proposal, run_manifest.as_ref());
        let trainer_signal = self.trainer_signal(run_manifest.as_ref());

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
                    reproducibility_ratio,
                    trainer_signal,
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
            research: None,
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
                        FilePatch {
                            path: "maabarium-lora-run.json".into(),
                            operation: FilePatchOperation::Create,
                            content: Some(
                                r#"{"trainer":"mlx_lm","base_model":"mlx-community/Llama-3","dataset":"fixtures/dataset.jsonl","adapter_path":"adapter/model.safetensors","output_dir":"adapter","eval_command":"python -m mlx_lm.evaluate","epochs":2,"learning_rate":0.0002}"#.into(),
                            ),
                        },
                    ],
                },
                1,
            )
            .await
            .expect("evaluation should succeed");

        assert!(result.weighted_total > 0.5);
    }

    #[tokio::test]
    async fn rejects_invalid_run_manifest() {
        let evaluator = LoraEvaluator::new(vec![MetricDef {
            name: "lora_quality".into(),
            weight: 1.0,
            direction: "maximize".into(),
            description: "LoRA adapter packaging quality".into(),
        }]);

        let error = evaluator
            .evaluate(
                &Proposal {
                    summary: "Package a malformed manifest".into(),
                    file_patches: vec![FilePatch {
                        path: "maabarium-lora-run.json".into(),
                        operation: FilePatchOperation::Create,
                        content: Some("not-json".into()),
                    }],
                },
                1,
            )
            .await
            .expect_err("evaluation should reject malformed manifests");

        assert!(error.to_string().contains("Invalid LoRA run manifest"));
    }
}
