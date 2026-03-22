use async_trait::async_trait;
use crate::error::LLMError;

pub mod ollama;
pub mod openai_compat;
pub mod pool;

pub use ollama::OllamaProvider;
pub use openai_compat::OpenAICompatProvider;
pub use pool::ModelPool;

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
