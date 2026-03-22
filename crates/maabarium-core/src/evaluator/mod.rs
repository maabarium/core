use crate::blueprint::BlueprintFile;
use crate::error::EvalError;
use crate::git_manager::Proposal;
use crate::llm::provider_from_models;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub mod code;
pub mod lora;
pub mod prompt;
pub mod research;
pub mod sandbox;

pub use code::CodeEvaluator;
pub use lora::LoraEvaluator;
pub use prompt::PromptEvaluator;
pub use research::ResearchEvaluator;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinEvaluatorKind {
    Code,
    Prompt,
    Research,
    Lora,
}

impl BuiltinEvaluatorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Prompt => "prompt",
            Self::Research => "research",
            Self::Lora => "lora",
        }
    }
}

pub struct EvaluatorRegistry;

impl EvaluatorRegistry {
    pub fn resolve_builtin(blueprint: &BlueprintFile) -> BuiltinEvaluatorKind {
        if Self::is_lora_blueprint(blueprint) {
            BuiltinEvaluatorKind::Lora
        } else if Self::is_research_blueprint(blueprint) {
            BuiltinEvaluatorKind::Research
        } else if Self::is_prompt_blueprint(blueprint) {
            BuiltinEvaluatorKind::Prompt
        } else {
            BuiltinEvaluatorKind::Code
        }
    }

    pub fn build_builtin(blueprint: &BlueprintFile) -> Result<Arc<dyn Evaluator>, EvalError> {
        match Self::resolve_builtin(blueprint) {
            BuiltinEvaluatorKind::Code => Ok(Arc::new(CodeEvaluator::new(
                blueprint.metrics.metrics.clone(),
                blueprint.domain.target_files.clone(),
                blueprint.constraints.require_tests_pass,
                blueprint.domain.repo_path.clone(),
            ))),
            BuiltinEvaluatorKind::Prompt => {
                let provider = provider_from_models(&blueprint.models, None)?;
                Ok(Arc::new(PromptEvaluator::new(
                    provider,
                    blueprint.metrics.metrics.clone(),
                )))
            }
            BuiltinEvaluatorKind::Research => Ok(Arc::new(ResearchEvaluator::new(
                blueprint.metrics.metrics.clone(),
            ))),
            BuiltinEvaluatorKind::Lora => Ok(Arc::new(LoraEvaluator::new(
                blueprint.metrics.metrics.clone(),
            ))),
        }
    }

    pub fn external_plugins_supported() -> bool {
        false
    }

    fn is_prompt_blueprint(blueprint: &BlueprintFile) -> bool {
        blueprint.domain.language.eq_ignore_ascii_case("markdown")
            || blueprint.domain.language.eq_ignore_ascii_case("prompt")
            || blueprint
                .blueprint
                .name
                .to_ascii_lowercase()
                .contains("prompt")
            || blueprint
                .domain
                .target_files
                .iter()
                .any(|pattern| pattern.ends_with(".md") || pattern.contains(".md"))
    }

    fn is_research_blueprint(blueprint: &BlueprintFile) -> bool {
        blueprint.domain.language.eq_ignore_ascii_case("research")
            || blueprint
                .blueprint
                .name
                .to_ascii_lowercase()
                .contains("research")
            || blueprint.metrics.metrics.iter().any(|metric| {
                let metric_name = metric.name.to_ascii_lowercase();
                metric_name.contains("citation")
                    || metric_name.contains("source")
                    || metric_name.contains("grounding")
                    || metric_name.contains("factual")
            })
    }

    fn is_lora_blueprint(blueprint: &BlueprintFile) -> bool {
        blueprint
            .blueprint
            .name
            .to_ascii_lowercase()
            .contains("lora")
            || blueprint.domain.language.eq_ignore_ascii_case("lora")
            || blueprint.domain.target_files.iter().any(|pattern| {
                pattern.ends_with(".safetensors")
                    || pattern.contains("adapter")
                    || pattern.contains("lora-run")
            })
    }
}

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
    pub research: Option<ResearchArtifacts>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchArtifacts {
    pub sources: Vec<ResearchSource>,
    pub citations: Vec<ResearchCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSource {
    pub url: String,
    pub final_url: Option<String>,
    pub host: Option<String>,
    pub label: Option<String>,
    pub title: Option<String>,
    pub citation_count: u32,
    pub verified: bool,
    pub status_code: Option<u16>,
    pub fetch_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchCitation {
    pub file_path: String,
    pub source_url: String,
    pub label: Option<String>,
    pub line_number: u32,
    pub snippet: String,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blueprint::{
        AgentDef, AgentsConfig, BlueprintMeta, ConstraintsConfig, DomainConfig, MetricDef,
        MetricsConfig, ModelAssignment, ModelDef, ModelsConfig,
    };

    fn sample_blueprint(name: &str, language: &str, target_files: Vec<&str>) -> BlueprintFile {
        BlueprintFile {
            blueprint: BlueprintMeta {
                name: name.to_owned(),
                version: "1.0".to_owned(),
                description: "test".to_owned(),
            },
            domain: DomainConfig {
                repo_path: ".".to_owned(),
                target_files: target_files.into_iter().map(str::to_owned).collect(),
                language: language.to_owned(),
            },
            constraints: ConstraintsConfig {
                max_iterations: 10,
                timeout_seconds: 60,
                require_tests_pass: true,
                min_improvement: 0.01,
            },
            metrics: MetricsConfig {
                metrics: vec![MetricDef {
                    name: "quality".to_owned(),
                    weight: 1.0,
                    direction: "maximize".to_owned(),
                    description: "quality".to_owned(),
                }],
            },
            agents: AgentsConfig {
                council_size: 1,
                debate_rounds: 1,
                agents: vec![AgentDef {
                    name: "agent".to_owned(),
                    role: "tester".to_owned(),
                    system_prompt: "test".to_owned(),
                    model: "mock-model".to_owned(),
                }],
            },
            models: ModelsConfig {
                assignment: ModelAssignment::Explicit,
                models: vec![ModelDef {
                    name: "mock-model".to_owned(),
                    provider: "mock".to_owned(),
                    endpoint: "http://localhost".to_owned(),
                    api_key_env: None,
                    temperature: 0.0,
                    max_tokens: 128,
                    requests_per_minute: None,
                }],
            },
            library: None,
        }
    }

    #[test]
    fn registry_resolves_prompt_blueprints() {
        let blueprint = sample_blueprint("prompt-lab", "markdown", vec!["prompts/system.md"]);
        assert_eq!(
            EvaluatorRegistry::resolve_builtin(&blueprint),
            BuiltinEvaluatorKind::Prompt
        );
    }

    #[test]
    fn registry_resolves_lora_blueprints() {
        let blueprint = sample_blueprint(
            "adapter-flow",
            "lora",
            vec!["adapters/model.safetensors", "maabarium-lora-run.json"],
        );
        assert_eq!(
            EvaluatorRegistry::resolve_builtin(&blueprint),
            BuiltinEvaluatorKind::Lora
        );
    }

    #[test]
    fn registry_resolves_research_blueprints() {
        let blueprint = sample_blueprint("market-research", "research", vec!["docs/report.md"]);
        assert_eq!(
            EvaluatorRegistry::resolve_builtin(&blueprint),
            BuiltinEvaluatorKind::Research
        );
    }

    #[test]
    fn registry_defers_external_plugins() {
        assert!(!EvaluatorRegistry::external_plugins_supported());
    }
}
