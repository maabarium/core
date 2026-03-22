use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::error::BlueprintError;

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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelsConfig {
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
            return Err(BlueprintError::Validation("Blueprint name cannot be empty".into()));
        }
        if self.constraints.max_iterations == 0 {
            return Err(BlueprintError::Validation("max_iterations must be > 0".into()));
        }
        let weight_sum: f64 = self.metrics.metrics.iter().map(|m| m.weight).sum();
        if (weight_sum - 1.0).abs() > 0.01 {
            return Err(BlueprintError::Validation(
                format!("Metric weights must sum to 1.0, got {weight_sum}")
            ));
        }
        for m in &self.metrics.metrics {
            if m.direction != "maximize" && m.direction != "minimize" {
                return Err(BlueprintError::Validation(
                    format!("Metric '{}' direction must be 'maximize' or 'minimize'", m.name)
                ));
            }
        }
        Ok(())
    }
}
