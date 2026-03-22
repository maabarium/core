use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use crate::error::LLMError;
use super::{CompletionRequest, CompletionResponse, LLMProvider};

pub struct OpenAICompatProvider {
    client: Client,
    endpoint: String,
    model: String,
    api_key: Option<String>,
}

impl OpenAICompatProvider {
    pub fn new(
        endpoint: impl Into<String>,
        model: impl Into<String>,
        api_key: Option<String>,
    ) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.into(),
            model: model.into(),
            api_key,
        }
    }
}

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessageResponse,
}

#[derive(Deserialize)]
struct OpenAIMessageResponse {
    content: String,
}

#[derive(Deserialize)]
struct OpenAIUsage {
    total_tokens: u32,
}

#[async_trait]
impl LLMProvider for OpenAICompatProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let url = format!("{}/chat/completions", self.endpoint.trim_end_matches('/'));
        let body = OpenAIRequest {
            model: self.model.clone(),
            messages: vec![
                OpenAIMessage { role: "system".into(), content: request.system.clone() },
                OpenAIMessage { role: "user".into(), content: request.prompt.clone() },
            ],
            temperature: request.temperature,
            max_tokens: request.max_tokens,
        };
        let mut req = self.client.post(&url).json(&body);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let start = Instant::now();
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(LLMError::Provider(format!("HTTP {status}: {text}")));
        }
        let openai_resp: OpenAIResponse = resp.json().await?;
        let latency = start.elapsed();
        let content = openai_resp
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| LLMError::InvalidResponse("No choices in response".into()))?;
        Ok(CompletionResponse {
            content,
            tokens_used: openai_resp.usage.map(|u| u.total_tokens).unwrap_or(0),
            latency,
        })
    }

    fn provider_name(&self) -> &str {
        "openai-compat"
    }

    fn model_name(&self) -> &str {
        &self.model
    }
}
