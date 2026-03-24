use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::blueprint::{BlueprintFile, MetricDef};
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::{Evaluator, ExperimentResult, MetricScore, ResearchArtifacts};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProcessPluginManifest {
    pub plugin: ProcessPluginMetadata,
    pub process: ProcessPluginProcess,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProcessPluginMetadata {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default = "default_plugin_timeout_seconds")]
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProcessPluginProcess {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginEvaluationRequest {
    iteration: u64,
    proposal: Proposal,
    metrics: Vec<MetricDef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginEvaluationResponse {
    scores: Vec<MetricScore>,
    #[serde(default)]
    weighted_total: Option<f64>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    research: Option<ResearchArtifacts>,
}

pub struct ProcessPluginEvaluator {
    manifest_path: PathBuf,
    manifest: ProcessPluginManifest,
    metrics: Vec<MetricDef>,
}

impl ProcessPluginEvaluator {
    pub fn from_blueprint(blueprint: &BlueprintFile) -> Result<Self, EvalError> {
        let manifest_path = resolve_manifest_path(blueprint)?;
        let content = std::fs::read_to_string(&manifest_path).map_err(|error| {
            EvalError::Parse(format!(
                "Failed to read plugin manifest {}: {error}",
                manifest_path.display()
            ))
        })?;
        let manifest: ProcessPluginManifest = toml::from_str(&content).map_err(|error| {
            EvalError::Parse(format!(
                "Invalid plugin manifest {}: {error}",
                manifest_path.display()
            ))
        })?;

        if manifest.plugin.id.trim().is_empty() {
            return Err(EvalError::Parse(
                "Plugin manifest id cannot be empty".to_owned(),
            ));
        }
        if manifest.process.command.trim().is_empty() {
            return Err(EvalError::Parse(
                "Plugin process command cannot be empty".to_owned(),
            ));
        }

        Ok(Self {
            manifest_path,
            manifest,
            metrics: blueprint.metrics.metrics.clone(),
        })
    }
}

#[async_trait]
impl Evaluator for ProcessPluginEvaluator {
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
    ) -> Result<ExperimentResult, EvalError> {
        let started = std::time::Instant::now();
        let request = PluginEvaluationRequest {
            iteration,
            proposal: proposal.clone(),
            metrics: self.metrics.clone(),
        };
        let request_json = serde_json::to_vec(&request).map_err(|error| {
            EvalError::Parse(format!("Failed to serialize plugin request: {error}"))
        })?;

        let working_dir = self.manifest.process.working_dir.as_deref().map(|path| {
            resolve_relative_path(self.manifest_path.parent().unwrap_or(Path::new(".")), path)
        });

        let mut command = Command::new(&self.manifest.process.command);
        command
            .args(&self.manifest.process.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = working_dir {
            command.current_dir(dir);
        }
        for (key, value) in &self.manifest.environment {
            command.env(key, value);
        }

        let mut child = command.spawn().map_err(|error| {
            EvalError::Parse(format!(
                "Failed to start evaluator plugin '{}': {error}",
                self.manifest.plugin.id
            ))
        })?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(&request_json).await.map_err(|error| {
                EvalError::Parse(format!("Failed to write plugin stdin: {error}"))
            })?;
        }
        drop(child.stdin.take());

        let timeout = std::time::Duration::from_secs(self.manifest.plugin.timeout_seconds);
        let output = tokio::time::timeout(timeout, child.wait_with_output())
            .await
            .map_err(|_| {
                EvalError::Parse(format!(
                    "Evaluator plugin '{}' timed out after {}s",
                    self.manifest.plugin.id, self.manifest.plugin.timeout_seconds
                ))
            })?
            .map_err(|error| {
                EvalError::Parse(format!(
                    "Failed while waiting for evaluator plugin '{}': {error}",
                    self.manifest.plugin.id
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(EvalError::Parse(format!(
                "Evaluator plugin '{}' exited with status {}: {}",
                self.manifest.plugin.id,
                output.status,
                if stderr.is_empty() {
                    "no stderr output"
                } else {
                    &stderr
                }
            )));
        }

        let response: PluginEvaluationResponse =
            serde_json::from_slice(&output.stdout).map_err(|error| {
                EvalError::Parse(format!(
                    "Invalid evaluator plugin response from '{}': {error}",
                    self.manifest.plugin.id
                ))
            })?;

        if response.scores.is_empty() {
            return Err(EvalError::Parse(format!(
                "Evaluator plugin '{}' returned no metric scores",
                self.manifest.plugin.id
            )));
        }

        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            weighted_total: response
                .weighted_total
                .unwrap_or_else(|| ExperimentResult::compute_weighted_total(&response.scores)),
            duration_ms: response
                .duration_ms
                .unwrap_or_else(|| started.elapsed().as_millis() as u64),
            scores: response.scores,
            research: response.research,
            lora: None,
        })
    }
}

fn default_plugin_timeout_seconds() -> u64 {
    60
}

fn resolve_manifest_path(blueprint: &BlueprintFile) -> Result<PathBuf, EvalError> {
    let path = blueprint
        .evaluator
        .as_ref()
        .and_then(|config| config.manifest_path.as_deref())
        .ok_or_else(|| {
            EvalError::Parse(
                "Process evaluator blueprints must include evaluator.manifest_path".to_owned(),
            )
        })?;
    Ok(resolve_relative_path(
        Path::new(&blueprint.domain.repo_path),
        path,
    ))
}

fn resolve_relative_path(base: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}
