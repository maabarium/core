use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;
use tracing::instrument;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::sandbox::{SandboxSummary, SandboxWorkspace, SubprocessRunner, summarize_existing_workspace};
use super::{EvaluationContext, Evaluator, ExperimentResult, MetricScore};

pub struct CodeEvaluator {
    metrics: Vec<MetricDef>,
    target_files: Vec<String>,
    require_tests_pass: bool,
    resolved_paths: ResolvedCodePaths,
}

#[derive(Debug, Clone)]
struct ResolvedCodePaths {
    evaluation_root: PathBuf,
    execution_subdir: Option<PathBuf>,
}

impl ResolvedCodePaths {
    fn new(repo_path: impl Into<PathBuf>) -> Self {
        let repo_path = repo_path.into();
        let repo_anchor = canonicalize_workspace_anchor(&repo_path).unwrap_or(repo_path.clone());
        let execution_anchor =
            canonicalize_execution_anchor(&repo_path).unwrap_or_else(|| repo_anchor.clone());
        let evaluation_root =
            resolve_workspace_root_from_anchor(&repo_anchor).unwrap_or_else(|| repo_anchor.clone());
        let execution_subdir =
            resolve_execution_subdir_from_anchor(&execution_anchor, &evaluation_root);

        Self {
            evaluation_root,
            execution_subdir,
        }
    }
}

impl CodeEvaluator {
    pub fn new(
        metrics: Vec<MetricDef>,
        target_files: Vec<String>,
        require_tests_pass: bool,
        repo_path: impl Into<PathBuf>,
    ) -> Self {
        Self {
            metrics,
            target_files,
            require_tests_pass,
            resolved_paths: ResolvedCodePaths::new(repo_path),
        }
    }

    fn test_runner(
        &self,
        sandbox_root: &std::path::Path,
        evaluation_root: &std::path::Path,
    ) -> Option<SubprocessRunner> {
        if !self.require_tests_pass {
            return None;
        }

        if sandbox_root.join("Cargo.toml").exists() {
            let mut runner = SubprocessRunner::new(
                "cargo",
                vec!["test".into(), "--quiet".into()],
                Duration::from_secs(180),
            )
            .with_env("MAABARIUM_SANDBOX_SUBPROCESS", "1");
            let target_dir = evaluation_root.join("target");
            if target_dir.exists() {
                runner = runner.with_env("CARGO_TARGET_DIR", target_dir.display().to_string());
            }
            Some(runner)
        } else {
            None
        }
    }

    fn evaluation_root(&self) -> PathBuf {
        self.resolved_paths.evaluation_root.clone()
    }

    fn execution_dir(
        &self,
        sandbox_root: &std::path::Path,
    ) -> PathBuf {
        self.resolved_paths
            .execution_subdir
            .as_ref()
            .map(|relative| sandbox_root.join(relative))
            .unwrap_or_else(|| sandbox_root.to_path_buf())
    }

    fn target_alignment(&self, proposal: &Proposal) -> f64 {
        if proposal.file_patches.is_empty() || self.target_files.is_empty() {
            return 1.0;
        }

        let matched = proposal
            .file_patches
            .iter()
            .filter(|patch| {
                self.target_files
                    .iter()
                    .any(|pattern| target_pattern_matches(pattern, &patch.path))
            })
            .count();

        matched as f64 / proposal.file_patches.len() as f64
    }

    fn score_metric(
        &self,
        metric: &MetricDef,
        proposal: &Proposal,
        sandbox: &SandboxSummary,
        alignment: f64,
    ) -> f64 {
        let summary_words = proposal.summary.split_whitespace().count() as f64;
        let summary_signal = (summary_words / 20.0).clamp(0.2, 1.0);
        let patch_signal = if sandbox.file_count == 0 {
            0.35
        } else {
            (0.45 + (sandbox.file_count as f64 * 0.1)).clamp(0.0, 1.0)
        };
        let size_penalty = (sandbox.total_bytes as f64 / 8_192.0).clamp(0.0, 0.25);
        let metric_name = metric.name.to_ascii_lowercase();

        let value = if metric_name.contains("safety") || metric_name.contains("correct") {
            0.45 + (alignment * 0.35) + (summary_signal * 0.2)
        } else if metric_name.contains("performance") {
            0.55 + (alignment * 0.25) + ((1.0 - size_penalty) * 0.2)
        } else if metric_name.contains("maintain")
            || metric_name.contains("read")
            || metric_name.contains("quality")
        {
            0.4 + (summary_signal * 0.35) + (alignment * 0.25) - size_penalty
        } else if metric_name.contains("test") {
            let patch_bonus = if sandbox.file_count > 0 { 0.15 } else { 0.0 };
            if self.require_tests_pass {
                0.6 + (alignment * 0.25) + patch_bonus
            } else {
                0.75
            }
        } else {
            0.4 + (summary_signal * 0.3) + (patch_signal * 0.15) + (alignment * 0.15)
        };

        value.clamp(0.0, 1.0)
    }
}

#[async_trait]
impl Evaluator for CodeEvaluator {
    #[instrument(
        name = "code_evaluator_evaluate",
        skip(self, proposal),
        fields(iteration = iteration, patch_count = proposal.file_patches.len())
    )]
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
        context: &EvaluationContext,
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let evaluation_root = self.evaluation_root();
        let sandbox_summary = if let Some(workspace_path) = context.workspace_path() {
            summarize_existing_workspace(workspace_path, proposal)?
        } else {
            let sandbox = if evaluation_root.exists() {
                SandboxWorkspace::from_repo(&evaluation_root)?
            } else {
                SandboxWorkspace::new()?
            };
            sandbox.materialize(proposal)?
        };
        let execution_root = context
            .workspace_path()
            .unwrap_or_else(|| sandbox_summary.root.as_path());
        let execution_dir = self.execution_dir(execution_root);
        if let Some(runner) = self.test_runner(&execution_dir, &evaluation_root) {
            let output = runner.run(&execution_dir).await?;
            if output.status_code != Some(0) {
                return Err(EvalError::Sandbox(format!(
                    "sandbox subprocess failed: status={:?} stderr={} stdout={}",
                    output.status_code, output.stderr, output.stdout,
                )));
            }
        }
        let alignment = self.target_alignment(proposal);

        let scores = self
            .metrics
            .iter()
            .map(|metric| MetricScore {
                name: metric.name.clone(),
                value: self.score_metric(metric, proposal, &sandbox_summary, alignment),
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
            lora: None,
        })
    }
}

fn canonicalize_workspace_anchor(repo_path: &std::path::Path) -> Option<PathBuf> {
    let canonical = repo_path.canonicalize().ok()?;
    if canonical.is_file() {
        canonical.parent().map(|path| path.to_path_buf())
    } else {
        Some(canonical)
    }
}

fn canonicalize_execution_anchor(repo_path: &std::path::Path) -> Option<PathBuf> {
    let canonical = repo_path.canonicalize().ok()?;
    if canonical.is_file() {
        canonical
            .parent()
            .and_then(|path| path.parent())
            .map(|path| path.to_path_buf())
    } else {
        Some(canonical)
    }
}

#[cfg(test)]
fn resolve_workspace_root(repo_path: &std::path::Path) -> Option<PathBuf> {
    let current = canonicalize_workspace_anchor(repo_path)?;
    resolve_workspace_root_from_anchor(&current)
}

fn resolve_workspace_root_from_anchor(current: &std::path::Path) -> Option<PathBuf> {
    let mut cursor = Some(current);
    while let Some(path) = cursor {
        let cargo_toml = path.join("Cargo.toml");
        if cargo_toml.exists() {
            let contents = std::fs::read_to_string(&cargo_toml).ok()?;
            if contents.contains("[workspace]") {
                return Some(path.to_path_buf());
            }
        }
        cursor = path.parent();
    }

    Some(current.to_path_buf())
}

#[cfg(test)]
fn resolve_execution_subdir(
    repo_path: &std::path::Path,
    evaluation_root: &std::path::Path,
) -> Option<PathBuf> {
    let current = canonicalize_execution_anchor(repo_path)?;
    resolve_execution_subdir_from_anchor(&current, evaluation_root)
}

fn resolve_execution_subdir_from_anchor(
    current: &std::path::Path,
    evaluation_root: &std::path::Path,
) -> Option<PathBuf> {
    current
        .strip_prefix(evaluation_root)
        .ok()
        .map(PathBuf::from)
}

fn target_pattern_matches(pattern: &str, path: &str) -> bool {
    if pattern == path {
        return true;
    }

    if let Some(extension) = pattern
        .rsplit('.')
        .next()
        .filter(|segment| *segment != pattern)
    {
        return path.ends_with(&format!(".{extension}"));
    }

    if let Some(prefix) = pattern.split('*').next() {
        return !prefix.is_empty() && path.starts_with(prefix);
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_manager::{FilePatch, FilePatchOperation, Proposal};

    #[test]
    fn resolves_workspace_root_and_package_execution_subdir() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .expect("manifest dir should canonicalize");
        let workspace_root =
            resolve_workspace_root(&manifest_dir).expect("workspace root should resolve");
        let execution_subdir = resolve_execution_subdir(&manifest_dir, &workspace_root)
            .expect("package execution subdir should resolve");

        assert!(workspace_root.join("Cargo.toml").exists());
        assert_eq!(workspace_root.join(&execution_subdir), manifest_dir);
        assert_eq!(execution_subdir, PathBuf::from("crates/maabarium-core"));
    }

    #[test]
    fn resolves_workspace_root_and_package_execution_subdir_from_file_path() {
        let source_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("lib.rs")
            .canonicalize()
            .expect("source file should canonicalize");
        let manifest_dir = source_file
            .parent()
            .and_then(|src_dir| src_dir.parent())
            .expect("crate root should exist")
            .to_path_buf();
        let workspace_root = resolve_workspace_root(&source_file)
            .expect("workspace root should resolve from file path");
        let execution_subdir = resolve_execution_subdir(&source_file, &workspace_root)
            .expect("package execution subdir should resolve from file path");

        assert!(workspace_root.join("Cargo.toml").exists());
        assert_eq!(workspace_root.join(&execution_subdir), manifest_dir);
        assert_eq!(execution_subdir, PathBuf::from("crates/maabarium-core"));
    }

    #[tokio::test]
    async fn scores_code_proposals_in_range() {
        if std::env::var_os("MAABARIUM_SANDBOX_SUBPROCESS").is_some() {
            return;
        }

        let evaluator = CodeEvaluator::new(
            vec![MetricDef {
                name: "quality".into(),
                weight: 1.0,
                direction: "maximize".into(),
                description: "Overall quality".into(),
            }],
            vec!["src/**/*.rs".into()],
            false,
            env!("CARGO_MANIFEST_DIR"),
        );

        let result = evaluator
            .evaluate(
                &Proposal {
                    summary: "Improve evaluator handling for sandboxed rust files".into(),
                    file_patches: vec![FilePatch {
                        path: "src/lib.rs".into(),
                        operation: FilePatchOperation::Create,
                        content: Some("pub fn hello() {}".into()),
                    }],
                },
                1,
                &EvaluationContext::default(),
            )
            .await
            .expect("evaluation should succeed");

        assert!((0.0..=1.0).contains(&result.weighted_total));
    }
}
