use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use crate::error::LLMError;
use super::{CompletionRequest, CompletionResponse, LLMProvider};

pub struct OllamaProvider {
    client: Client,
    endpoint: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(endpoint: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.into(),
            model: model.into(),
        }
    }
}

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    system: String,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
    #[serde(default)]
    eval_count: Option<u32>,
}

#[async_trait]
impl LLMProvider for OllamaProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let url = format!("{}/api/generate", self.endpoint.trim_end_matches('/'));
        let body = OllamaRequest {
            model: self.model.clone(),
            prompt: request.prompt.clone(),
            system: request.system.clone(),
            stream: false,
            options: OllamaOptions {
                temperature: request.temperature,
                num_predict: request.max_tokens,
            },
        };
        let start = Instant::now();
        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(LLMError::Provider(format!("HTTP {status}: {text}")));
        }
        let ollama_resp: OllamaResponse = resp.json().await?;
        let latency = start.elapsed();
        Ok(CompletionResponse {
            content: ollama_resp.response,
            tokens_used: ollama_resp.eval_count.unwrap_or(0),
            latency,
        })
    }

    fn provider_name(&self) -> &str {
        "ollama"
    }

    fn model_name(&self) -> &str {
        &self.model
    }
}
