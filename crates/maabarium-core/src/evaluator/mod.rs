use crate::blueprint::BlueprintFile;
use crate::error::EvalError;
use crate::git_manager::Proposal;
use crate::llm::provider_from_models;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub mod code;
pub mod lora;
pub mod plugin;
pub mod prompt;
pub mod research;
pub mod sandbox;

pub use code::CodeEvaluator;
pub use lora::LoraEvaluator;
pub use plugin::{ProcessPluginEvaluator, ProcessPluginManifest};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchQueryTrace {
    pub provider: String,
    pub query_text: String,
    pub result_count: u32,
    pub top_urls: Vec<String>,
    pub latency_ms: u64,
    pub executed_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoraStageArtifact {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: String,
    pub timeout_seconds: u64,
    pub expected_artifacts: Vec<String>,
    pub verified_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoraArtifacts {
    pub trainer: String,
    pub base_model: String,
    pub dataset: String,
    pub adapter_path: String,
    pub output_dir: Option<String>,
    pub eval_command: Option<String>,
    pub epochs: Option<u32>,
    pub learning_rate: Option<f64>,
    pub adapter_ratio: f64,
    pub metadata_ratio: f64,
    pub reproducibility_ratio: f64,
    pub trainer_signal: f64,
    pub execution_signal: f64,
    pub sandbox_file_count: usize,
    pub sandbox_total_bytes: usize,
    pub stages: Vec<LoraStageArtifact>,
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
                Some(blueprint.blueprint.description.clone()),
            ))),
            BuiltinEvaluatorKind::Lora => Ok(Arc::new(LoraEvaluator::new(
                blueprint.metrics.metrics.clone(),
            ))),
        }
    }

    pub fn build(blueprint: &BlueprintFile) -> Result<Arc<dyn Evaluator>, EvalError> {
        if blueprint
            .evaluator
            .as_ref()
            .is_some_and(|config| config.kind == crate::blueprint::EvaluatorKind::Process)
        {
            return Ok(Arc::new(ProcessPluginEvaluator::from_blueprint(blueprint)?));
        }

        Self::build_builtin(blueprint)
    }

    pub fn describe(blueprint: &BlueprintFile) -> String {
        if blueprint
            .evaluator
            .as_ref()
            .is_some_and(|config| config.kind == crate::blueprint::EvaluatorKind::Process)
        {
            return blueprint
                .evaluator
                .as_ref()
                .and_then(|config| config.plugin_id.clone())
                .or_else(|| {
                    blueprint
                        .evaluator
                        .as_ref()
                        .and_then(|config| config.manifest_path.clone())
                })
                .map(|value| format!("process:{value}"))
                .unwrap_or_else(|| "process".to_owned());
        }

        Self::resolve_builtin(blueprint).as_str().to_owned()
    }

    pub fn external_plugins_supported() -> bool {
        true
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
    pub lora: Option<LoraArtifacts>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchArtifacts {
    pub sources: Vec<ResearchSource>,
    pub citations: Vec<ResearchCitation>,
    #[serde(default)]
    pub query_traces: Vec<ResearchQueryTrace>,
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
            evaluator: None,
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
    fn registry_reports_process_plugin_support() {
        assert!(EvaluatorRegistry::external_plugins_supported());
    }
}
