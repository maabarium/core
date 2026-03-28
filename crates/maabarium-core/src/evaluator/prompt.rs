use super::{EvaluationContext, Evaluator, ExperimentResult, MetricScore};
use crate::blueprint::MetricDef;
use crate::error::EvalError;
use crate::git_manager::Proposal;
use crate::llm::{CompletionRequest, LLMProvider};
use async_trait::async_trait;
use std::sync::Arc;
use tracing::instrument;

pub struct PromptEvaluator {
    llm: Arc<dyn LLMProvider>,
    metrics: Vec<MetricDef>,
}

impl PromptEvaluator {
    pub fn new(llm: Arc<dyn LLMProvider>, metrics: Vec<MetricDef>) -> Self {
        Self { llm, metrics }
    }
}

fn extract_score(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if let Ok(value) = trimmed.parse::<f64>() {
        return Some(value);
    }

    trimmed
        .split_whitespace()
        .filter_map(|token| {
            let candidate = token.trim_matches(|ch: char| {
                !ch.is_ascii_digit() && ch != '.' && ch != '-' && ch != '+'
            });
            if candidate.is_empty() {
                None
            } else {
                candidate.parse::<f64>().ok()
            }
        })
        .next()
}

#[async_trait]
impl Evaluator for PromptEvaluator {
    #[instrument(
        name = "prompt_evaluator_evaluate",
        skip(self, proposal),
        fields(iteration = iteration, metrics = self.metrics.len())
    )]
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
        _context: &EvaluationContext,
    ) -> Result<ExperimentResult, EvalError> {
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
                response_format: None,
            };
            let resp = self.llm.complete(&req).await?;
            let value = extract_score(&resp.content).ok_or_else(|| {
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
            research: None,
            lora: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::LLMError;
    use crate::llm::CompletionRequest;
    use crate::llm::CompletionResponse;
    use std::time::Duration;

    struct StaticProvider {
        response: String,
    }

    #[async_trait]
    impl LLMProvider for StaticProvider {
        async fn complete(
            &self,
            _request: &CompletionRequest,
        ) -> Result<CompletionResponse, LLMError> {
            Ok(CompletionResponse {
                content: self.response.clone(),
                tokens_used: 8,
                latency: Duration::from_millis(1),
            })
        }

        fn provider_name(&self) -> &str {
            "test"
        }

        fn model_name(&self) -> &str {
            "static"
        }
    }

    fn sample_metric() -> MetricDef {
        MetricDef {
            name: "document_quality".to_owned(),
            weight: 1.0,
            direction: "maximize".to_owned(),
            description: "The document should be clear and well structured.".to_owned(),
        }
    }

    fn sample_proposal() -> Proposal {
        Proposal {
            summary: "Refine the Project Echo implementation document.".to_owned(),
            file_patches: Vec::new(),
        }
    }

    #[test]
    fn extracts_score_from_plain_number() {
        assert_eq!(extract_score("0.95"), Some(0.95));
    }

    #[test]
    fn extracts_score_from_number_with_extra_text() {
        assert_eq!(extract_score("0.95\nStrong structure and sequencing."), Some(0.95));
        assert_eq!(extract_score("Score: 0.72 out of 1.0"), Some(0.72));
    }

    #[test]
    fn extracts_score_when_timestamp_line_follows_number() {
        let response = "0.95\n2026-03-28T12:04:20.975600Z INFO prompt_evaluator_evaluate: trailing runtime text";

        assert_eq!(extract_score(response), Some(0.95));
    }

    #[test]
    fn rejects_responses_without_numeric_score() {
        assert_eq!(extract_score("High confidence, but no score provided."), None);
    }

    #[tokio::test]
    async fn prompt_evaluator_accepts_multiline_numeric_response() {
        let evaluator = PromptEvaluator::new(
            Arc::new(StaticProvider {
                response: "0.95\nStrong structure and sequencing.".to_owned(),
            }),
            vec![sample_metric()],
        );

        let result = evaluator
            .evaluate(&sample_proposal(), 1, &EvaluationContext::default())
            .await
            .expect("multiline numeric response should parse");

        assert_eq!(result.scores.len(), 1);
        assert_eq!(result.scores[0].value, 0.95);
        assert_eq!(result.weighted_total, 0.95);
    }

    #[tokio::test]
    async fn prompt_evaluator_accepts_timestamp_after_score() {
        let evaluator = PromptEvaluator::new(
            Arc::new(StaticProvider {
                response: "0.95\n2026-03-28T12:04:20.975600Z INFO prompt_evaluator_evaluate: trailing runtime text".to_owned(),
            }),
            vec![sample_metric()],
        );

        let result = evaluator
            .evaluate(&sample_proposal(), 1, &EvaluationContext::default())
            .await
            .expect("timestamped multiline response should parse");

        assert_eq!(result.scores.len(), 1);
        assert_eq!(result.scores[0].value, 0.95);
        assert_eq!(result.weighted_total, 0.95);
    }
}
