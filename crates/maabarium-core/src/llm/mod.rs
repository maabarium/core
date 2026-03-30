use async_trait::async_trait;
use serde_json::Value;
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
    pub response_format: Option<ResponseFormat>,
}

#[derive(Debug, Clone)]
pub enum ResponseFormat {
    Json,
    JsonSchema(Value),
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

    fn configured_max_tokens(&self) -> Option<u32> {
        None
    }
}

pub fn provider_from_model(model: &ModelDef) -> Result<Arc<dyn LLMProvider>, SecretError> {
    let provider_name = model.provider.trim().to_ascii_lowercase();
    match provider_name.as_str() {
        "mock" => Ok(Arc::new(MockProvider::new(model.name.clone()))),
        "ollama" => Ok(Arc::new(OllamaProvider::new(
            model.endpoint.clone(),
            model.name.clone(),
            model.max_tokens,
        ))),
        "openai"
        | "openai-compat"
        | "deepseek"
        | "groq"
        | "openrouter"
        | "xai"
        | "custom" => {
            let secret_store = SecretStore::new();
            let api_key =
                secret_store.resolve_api_key(&provider_name, model.api_key_env.as_deref())?;
            Ok(Arc::new(OpenAICompatProvider::new(
                model.endpoint.clone(),
                model.name.clone(),
                api_key,
                model.max_tokens,
            )))
        }
        _ => Err(SecretError::InvalidInput(format!(
            "Unsupported model provider '{}' for model '{}'",
            model.provider, model.name
        ))),
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

#[cfg(test)]
mod tests {
    use super::provider_from_model;
    use crate::blueprint::ModelDef;
    use crate::error::SecretError;

    fn test_model(provider: &str) -> ModelDef {
        ModelDef {
            name: "test-model".to_owned(),
            provider: provider.to_owned(),
            endpoint: "https://example.invalid/v1".to_owned(),
            api_key_env: Some("TEST_PROVIDER_KEY".to_owned()),
            temperature: 0.2,
            max_tokens: 256,
            requests_per_minute: Some(5),
        }
    }

    #[test]
    fn resolves_xai_as_openai_compatible_provider() {
        let provider = provider_from_model(&test_model("xai")).expect("xai should resolve");

        assert_eq!(provider.provider_name(), "openai-compat");
        assert_eq!(provider.model_name(), "test-model");
    }

    #[test]
    fn rejects_unknown_provider_names() {
        let error = match provider_from_model(&test_model("not-a-real-provider")) {
            Ok(_) => panic!("unknown providers should fail loudly"),
            Err(error) => error,
        };

        match error {
            SecretError::InvalidInput(message) => {
                assert!(message.contains("Unsupported model provider"));
                assert!(message.contains("not-a-real-provider"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
