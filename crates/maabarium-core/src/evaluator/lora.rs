use async_trait::async_trait;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::instrument;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::sandbox::{SandboxSummary, SandboxWorkspace, SubprocessRunner};
use super::{Evaluator, ExperimentResult, LoraArtifacts, LoraStageArtifact, MetricScore};

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
    train: Option<LoraExecutionSpec>,
    evaluate: Option<LoraExecutionSpec>,
}

#[derive(Debug, Deserialize)]
struct LoraExecutionSpec {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    working_dir: Option<String>,
    #[serde(default)]
    environment: BTreeMap<String, String>,
    #[serde(default = "default_lora_timeout_seconds")]
    timeout_seconds: u64,
    #[serde(default)]
    expected_artifacts: Vec<String>,
}

#[derive(Debug)]
struct LoraExecutionOutcome {
    stage_name: String,
    command: String,
    args: Vec<String>,
    working_dir: String,
    timeout_seconds: u64,
    expected_artifacts_total: usize,
    expected_artifacts: Vec<String>,
    verified_artifacts: Vec<String>,
}

fn default_lora_timeout_seconds() -> u64 {
    900
}

impl LoraEvaluator {
    pub fn new(metrics: Vec<MetricDef>) -> Self {
        Self { metrics }
    }

    fn is_run_manifest_path(path: &str) -> bool {
        matches!(path, "maabarium-lora-run.json" | "lora-run.json")
    }

    fn load_run_manifest(&self, proposal: &Proposal) -> Result<Option<LoraRunManifest>, EvalError> {
        let Some(content) = proposal.file_patches.iter().find_map(|patch| {
            if Self::is_run_manifest_path(&patch.path) {
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
            .any(|patch| Self::is_run_manifest_path(&patch.path));
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

    fn execution_signal(
        &self,
        run_manifest: Option<&LoraRunManifest>,
        outcomes: &[LoraExecutionOutcome],
    ) -> f64 {
        let Some(run_manifest) = run_manifest else {
            return 0.3;
        };

        let defined_stages = usize::from(run_manifest.train.is_some())
            + usize::from(run_manifest.evaluate.is_some());
        if defined_stages == 0 {
            return 0.45;
        }

        let successful_ratio = outcomes.len() as f64 / defined_stages as f64;
        let artifact_bonus = if outcomes
            .iter()
            .any(|outcome| outcome.expected_artifacts_total > 0)
        {
            0.2
        } else {
            0.1
        };

        (0.2 + (successful_ratio * 0.6) + artifact_bonus).clamp(0.0, 1.0)
    }

    async fn run_lora_stage(
        &self,
        stage_name: &str,
        sandbox_root: &Path,
        spec: &LoraExecutionSpec,
    ) -> Result<LoraExecutionOutcome, EvalError> {
        if spec.command.trim().is_empty() {
            return Err(EvalError::Parse(format!(
                "LoRA {stage_name} command cannot be empty"
            )));
        }

        let working_dir = spec
            .working_dir
            .as_deref()
            .map(|path| resolve_execution_path(sandbox_root, path))
            .unwrap_or_else(|| sandbox_root.to_path_buf());

        if !working_dir.exists() {
            return Err(EvalError::Sandbox(format!(
                "LoRA {stage_name} working directory does not exist: {}",
                working_dir.display()
            )));
        }

        let mut runner = SubprocessRunner::new(
            spec.command.clone(),
            spec.args.clone(),
            Duration::from_secs(spec.timeout_seconds),
        );
        for (key, value) in &spec.environment {
            runner = runner.with_env(key.clone(), value.clone());
        }

        let result = runner.run(&working_dir).await?;
        if result.status_code != Some(0) {
            let stderr = if result.stderr.trim().is_empty() {
                "no stderr output".to_owned()
            } else {
                result.stderr.clone()
            };
            return Err(EvalError::Sandbox(format!(
                "LoRA {stage_name} command '{}' failed with status {:?}: {}",
                spec.command, result.status_code, stderr
            )));
        }

        let missing_artifacts = spec
            .expected_artifacts
            .iter()
            .filter(|artifact| !resolve_execution_path(sandbox_root, artifact).exists())
            .cloned()
            .collect::<Vec<_>>();
        if !missing_artifacts.is_empty() {
            return Err(EvalError::Sandbox(format!(
                "LoRA {stage_name} command completed but expected artifacts were missing: {}",
                missing_artifacts.join(", ")
            )));
        }

        Ok(LoraExecutionOutcome {
            stage_name: stage_name.to_owned(),
            command: spec.command.clone(),
            args: spec.args.clone(),
            working_dir: working_dir.display().to_string(),
            timeout_seconds: spec.timeout_seconds,
            expected_artifacts_total: spec.expected_artifacts.len(),
            expected_artifacts: spec.expected_artifacts.clone(),
            verified_artifacts: spec.expected_artifacts.clone(),
        })
    }

    async fn run_lora_pipeline(
        &self,
        sandbox_root: &Path,
        run_manifest: Option<&LoraRunManifest>,
    ) -> Result<Vec<LoraExecutionOutcome>, EvalError> {
        let Some(run_manifest) = run_manifest else {
            return Ok(Vec::new());
        };

        let mut outcomes = Vec::new();
        if let Some(train) = run_manifest.train.as_ref() {
            outcomes.push(self.run_lora_stage("train", sandbox_root, train).await?);
        }
        if let Some(evaluate) = run_manifest.evaluate.as_ref() {
            outcomes.push(
                self.run_lora_stage("evaluate", sandbox_root, evaluate)
                    .await?,
            );
        }
        Ok(outcomes)
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
        execution_signal: f64,
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
                + (execution_signal * 0.15)
        } else if metric_name.contains("quality") || metric_name.contains("safety") {
            0.1 + (summary_signal * 0.2)
                + (metadata_ratio * 0.2)
                + (compactness * 0.15)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.15)
                + (execution_signal * 0.1)
        } else if metric_name.contains("performance") || metric_name.contains("latency") {
            0.1 + (compactness * 0.3)
                + (adapter_ratio * 0.15)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.2)
                + (execution_signal * 0.15)
        } else {
            0.1 + (summary_signal * 0.15)
                + (adapter_ratio * 0.15)
                + (metadata_ratio * 0.2)
                + (reproducibility_ratio * 0.2)
                + (trainer_signal * 0.15)
                + (execution_signal * 0.1)
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
        _context: &super::EvaluationContext,
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let sandbox = SandboxWorkspace::new()?;
        let sandbox_summary = sandbox.materialize(proposal)?;
        let run_manifest = self.load_run_manifest(proposal)?;
        let execution_outcomes = self
            .run_lora_pipeline(sandbox.root(), run_manifest.as_ref())
            .await?;
        let adapter_ratio = self.adapter_ratio(proposal);
        let metadata_ratio = self.metadata_ratio(proposal);
        let reproducibility_ratio = self.reproducibility_ratio(proposal, run_manifest.as_ref());
        let trainer_signal = self.trainer_signal(run_manifest.as_ref());
        let execution_signal = self.execution_signal(run_manifest.as_ref(), &execution_outcomes);

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
                    execution_signal,
                ),
                weight: metric.weight,
            })
            .collect::<Vec<_>>();

        let weighted_total = ExperimentResult::compute_weighted_total(&scores);
        let lora = run_manifest.as_ref().map(|manifest| LoraArtifacts {
            trainer: manifest.trainer.clone(),
            base_model: manifest.base_model.clone(),
            dataset: manifest.dataset.clone(),
            adapter_path: manifest.adapter_path.clone(),
            output_dir: manifest.output_dir.clone(),
            eval_command: manifest.eval_command.clone(),
            epochs: manifest.epochs,
            learning_rate: manifest.learning_rate,
            adapter_ratio,
            metadata_ratio,
            reproducibility_ratio,
            trainer_signal,
            execution_signal,
            sandbox_file_count: sandbox_summary.file_count,
            sandbox_total_bytes: sandbox_summary.total_bytes,
            stages: execution_outcomes
                .iter()
                .map(|outcome| LoraStageArtifact {
                    name: outcome.stage_name.clone(),
                    command: outcome.command.clone(),
                    args: outcome.args.clone(),
                    working_dir: outcome.working_dir.clone(),
                    timeout_seconds: outcome.timeout_seconds,
                    expected_artifacts: outcome.expected_artifacts.clone(),
                    verified_artifacts: outcome.verified_artifacts.clone(),
                })
                .collect(),
        });

        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            scores,
            weighted_total,
            duration_ms: start.elapsed().as_millis() as u64,
            research: None,
            lora,
        })
    }
}

fn resolve_execution_path(root: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
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
                                r#"{"trainer":"mlx_lm","base_model":"mlx-community/Llama-3","dataset":"fixtures/dataset.jsonl","adapter_path":"adapter/model.safetensors","output_dir":"adapter","eval_command":"python -m mlx_lm.evaluate","epochs":2,"learning_rate":0.0002,"train":{"command":"sh","args":["-c","printf trained > adapter/train.log"],"timeout_seconds":5,"expected_artifacts":["adapter/train.log"]},"evaluate":{"command":"sh","args":["-c","printf scored > adapter/eval.log"],"timeout_seconds":5,"expected_artifacts":["adapter/eval.log"]}}"#.into(),
                            ),
                        },
                    ],
                },
                1,
                &crate::evaluator::EvaluationContext::default(),
            )
            .await
            .expect("evaluation should succeed");

        assert!(result.weighted_total > 0.5);
    }

    #[tokio::test]
    async fn fails_when_lora_subprocess_stage_fails() {
        let evaluator = LoraEvaluator::new(vec![MetricDef {
            name: "lora_quality".into(),
            weight: 1.0,
            direction: "maximize".into(),
            description: "LoRA adapter packaging quality".into(),
        }]);

        let error = evaluator
            .evaluate(
                &Proposal {
                    summary: "Run a failing LoRA training stage".into(),
                    file_patches: vec![FilePatch {
                        path: "maabarium-lora-run.json".into(),
                        operation: FilePatchOperation::Create,
                        content: Some(
                            r#"{"trainer":"mlx_lm","base_model":"mlx-community/Llama-3","dataset":"fixtures/dataset.jsonl","adapter_path":"adapter/model.safetensors","train":{"command":"sh","args":["-c","exit 7"],"timeout_seconds":5}}"#.into(),
                        ),
                    }],
                },
                1,
                &crate::evaluator::EvaluationContext::default(),
            )
            .await
            .expect_err("evaluation should fail when the LoRA subprocess exits non-zero");

        assert!(error.to_string().contains("LoRA train command 'sh' failed"));
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
                &crate::evaluator::EvaluationContext::default(),
            )
            .await
            .expect_err("evaluation should reject malformed manifests");

        assert!(error.to_string().contains("Invalid LoRA run manifest"));
    }

    #[tokio::test]
    async fn ignores_nested_lora_run_json_files() {
        let evaluator = LoraEvaluator::new(vec![MetricDef {
            name: "lora_quality".into(),
            weight: 1.0,
            direction: "maximize".into(),
            description: "LoRA adapter packaging quality".into(),
        }]);

        let result = evaluator
            .evaluate(
                &Proposal {
                    summary: "Package adapter metadata without a canonical root manifest".into(),
                    file_patches: vec![
                        FilePatch {
                            path: "README.md".into(),
                            operation: FilePatchOperation::Modify,
                            content: Some("# Adapter\n".into()),
                        },
                        FilePatch {
                            path: "adapters/lora-run.json".into(),
                            operation: FilePatchOperation::Create,
                            content: Some("{\"note\":\"not the canonical manifest\"}".into()),
                        },
                    ],
                },
                1,
                &crate::evaluator::EvaluationContext::default(),
            )
            .await
            .expect("nested lora-run.json should not be treated as the canonical manifest");

        assert!(result.weighted_total > 0.0);
    }
}
