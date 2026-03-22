use async_trait::async_trait;

use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;

use super::sandbox::{SandboxSummary, SandboxWorkspace};
use super::{Evaluator, ExperimentResult, MetricScore};

pub struct CodeEvaluator {
    metrics: Vec<MetricDef>,
    target_files: Vec<String>,
    require_tests_pass: bool,
}

impl CodeEvaluator {
    pub fn new(
        metrics: Vec<MetricDef>,
        target_files: Vec<String>,
        require_tests_pass: bool,
    ) -> Self {
        Self {
            metrics,
            target_files,
            require_tests_pass,
        }
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
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
    ) -> Result<ExperimentResult, EvalError> {
        let start = std::time::Instant::now();
        let sandbox = SandboxWorkspace::new()?;
        let sandbox_summary = sandbox.materialize(proposal)?;
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
        })
    }
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
    use crate::git_manager::{FilePatch, Proposal};

    #[tokio::test]
    async fn scores_code_proposals_in_range() {
        let evaluator = CodeEvaluator::new(
            vec![MetricDef {
                name: "quality".into(),
                weight: 1.0,
                direction: "maximize".into(),
                description: "Overall quality".into(),
            }],
            vec!["src/**/*.rs".into()],
            true,
        );

        let result = evaluator
            .evaluate(
                &Proposal {
                    summary: "Improve evaluator handling for sandboxed rust files".into(),
                    file_patches: vec![FilePatch {
                        path: "src/lib.rs".into(),
                        content: "pub fn hello() {}".into(),
                    }],
                },
                1,
            )
            .await
            .expect("evaluation should succeed");

        assert!((0.0..=1.0).contains(&result.weighted_total));
    }
}
