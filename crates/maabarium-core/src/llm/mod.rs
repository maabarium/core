use async_trait::async_trait;
use std::sync::Arc;

use secrecy::SecretString;

use crate::blueprint::{ModelAssignment, ModelDef, ModelsConfig};
use crate::error::LLMError;
use crate::error::SecretError;
use crate::secrets::SecretStore;

pub mod mock;
pub mod ollama;
pub mod openai_compat;
pub mod pool;

pub use mock::MockProvider;
pub use ollama::OllamaProvider;
pub use openai_compat::OpenAICompatProvider;
pub use pool::{ModelPool, PoolMember};

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub system: String,
    pub prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct CompletionResponse {
    pub content: String,
    pub tokens_used: u32,
    pub latency: std::time::Duration,
}

#[async_trait]
pub trait LLMProvider: Send + Sync {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError>;
    fn provider_name(&self) -> &str;
    fn model_name(&self) -> &str;
}

pub fn provider_from_model(model: &ModelDef) -> Result<Arc<dyn LLMProvider>, SecretError> {
    let provider_name = model.provider.trim().to_ascii_lowercase();
    match provider_name.as_str() {
        "mock" => Ok(Arc::new(MockProvider::new(model.name.clone()))),
        "ollama" => Ok(Arc::new(OllamaProvider::new(
            model.endpoint.clone(),
            model.name.clone(),
        ))),
        "openai" | "openai-compat" => {
            let secret_store = SecretStore::new();
            let api_key =
                secret_store.resolve_api_key(&provider_name, model.api_key_env.as_deref())?;
            Ok(Arc::new(OpenAICompatProvider::new(
                model.endpoint.clone(),
                model.name.clone(),
                api_key,
            )))
        }
        _ => Ok(Arc::new(MockProvider::new(model.name.clone()))),
    }
}

pub fn provider_from_models(
    models: &ModelsConfig,
    preferred_model: Option<&str>,
) -> Result<Arc<dyn LLMProvider>, SecretError> {
    match models.assignment {
        ModelAssignment::Explicit => {
            let model = preferred_model
                .and_then(|name| {
                    models
                        .models
                        .iter()
                        .find(|candidate| candidate.name == name)
                })
                .or_else(|| models.models.first())
                .ok_or_else(|| SecretError::InvalidInput("No models configured".to_owned()))?;
            Ok(Arc::new(ModelPool::new(vec![PoolMember::new(
                provider_from_model(model)?,
                model.requests_per_minute,
            )])))
        }
        ModelAssignment::RoundRobin => {
            let providers = models
                .models
                .iter()
                .map(|model| {
                    provider_from_model(model)
                        .map(|provider| PoolMember::new(provider, model.requests_per_minute))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Arc::new(ModelPool::new(providers)))
        }
    }
}

pub fn provider_secret(
    provider: &str,
    env_var: Option<&str>,
) -> Result<Option<SecretString>, SecretError> {
    SecretStore::new().resolve_api_key(provider, env_var)
}
