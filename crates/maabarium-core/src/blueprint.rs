use crate::error::BlueprintError;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelAssignment {
    #[default]
    Explicit,
    RoundRobin,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BlueprintLibraryKind {
    #[default]
    Workflow,
    Template,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlueprintTemplateKind {
    CodeQuality,
    PromptOptimization,
    ProductBuilder,
    GeneralResearch,
    LoraValidation,
    Custom,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct BlueprintLibraryMeta {
    #[serde(default)]
    pub kind: BlueprintLibraryKind,
    #[serde(default)]
    pub setup_required: bool,
    #[serde(default)]
    pub template: Option<BlueprintTemplateKind>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BlueprintMeta {
    pub name: String,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DomainConfig {
    pub repo_path: String,
    pub target_files: Vec<String>,
    pub language: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConstraintsConfig {
    pub max_iterations: u64,
    pub timeout_seconds: u64,
    pub require_tests_pass: bool,
    pub min_improvement: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MetricDef {
    pub name: String,
    pub weight: f64,
    pub direction: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MetricsConfig {
    pub metrics: Vec<MetricDef>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentDef {
    pub name: String,
    pub role: String,
    pub system_prompt: String,
    pub model: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentsConfig {
    pub council_size: u32,
    pub debate_rounds: u32,
    pub agents: Vec<AgentDef>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelDef {
    pub name: String,
    pub provider: String,
    pub endpoint: String,
    pub api_key_env: Option<String>,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(default)]
    pub requests_per_minute: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelsConfig {
    #[serde(default)]
    pub assignment: ModelAssignment,
    pub models: Vec<ModelDef>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BlueprintFile {
    pub blueprint: BlueprintMeta,
    pub domain: DomainConfig,
    pub constraints: ConstraintsConfig,
    pub metrics: MetricsConfig,
    pub agents: AgentsConfig,
    pub models: ModelsConfig,
    #[serde(default)]
    pub library: Option<BlueprintLibraryMeta>,
}

impl BlueprintFile {
    pub fn load(path: &Path) -> Result<Self, BlueprintError> {
        let content = std::fs::read_to_string(path)?;
        let bp: BlueprintFile = toml::from_str(&content)?;
        bp.validate()?;
        Ok(bp)
    }

    pub fn validate(&self) -> Result<(), BlueprintError> {
        if self.blueprint.name.is_empty() {
            return Err(BlueprintError::Validation(
                "Blueprint name cannot be empty".into(),
            ));
        }
        if self.constraints.max_iterations == 0 {
            return Err(BlueprintError::Validation(
                "max_iterations must be > 0".into(),
            ));
        }
        let weight_sum: f64 = self.metrics.metrics.iter().map(|m| m.weight).sum();
        if (weight_sum - 1.0).abs() > 0.01 {
            return Err(BlueprintError::Validation(format!(
                "Metric weights must sum to 1.0, got {weight_sum}"
            )));
        }
        for m in &self.metrics.metrics {
            if m.direction != "maximize" && m.direction != "minimize" {
                return Err(BlueprintError::Validation(format!(
                    "Metric '{}' direction must be 'maximize' or 'minimize'",
                    m.name
                )));
            }
        }
        if self.models.models.is_empty() {
            return Err(BlueprintError::Validation(
                "At least one model must be defined".into(),
            ));
        }
        for model in &self.models.models {
            if let Some(limit) = model.requests_per_minute {
                if limit == 0 {
                    return Err(BlueprintError::Validation(format!(
                        "Model '{}' requests_per_minute must be > 0",
                        model.name
                    )));
                }
            }
        }
        Ok(())
    }

    pub fn library_kind(&self) -> BlueprintLibraryKind {
        self.library
            .as_ref()
            .map(|library| library.kind)
            .unwrap_or(BlueprintLibraryKind::Workflow)
    }

    pub fn requires_setup(&self) -> bool {
        self.library
            .as_ref()
            .map(|library| {
                library.setup_required || library.kind == BlueprintLibraryKind::Template
            })
            .unwrap_or(false)
    }
}
