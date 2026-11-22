use super::{
    CompletionRequest, CompletionResponse, LLMProvider, ResponseFormat, build_provider_http_client,
    send_with_provider_retry,
};
use crate::error::LLMError;
use async_trait::async_trait;
use reqwest::Client;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::time::Instant;

pub struct OpenAICompatProvider {
    client: Client,
    provider_id: String,
    endpoint: String,
    model: String,
    api_key: Option<SecretString>,
    max_tokens: u32,
}

impl OpenAICompatProvider {
    pub fn new(
        provider_id: impl Into<String>,
        endpoint: impl Into<String>,
        model: impl Into<String>,
        api_key: Option<SecretString>,
        max_tokens: u32,
    ) -> Self {
        Self {
            client: build_provider_http_client(),
            provider_id: provider_id.into(),
            endpoint: endpoint.into(),
            model: model.into(),
            api_key,
            max_tokens,
        }
    }
}

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<OpenAIResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<OpenAIThinking>,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAIResponseFormat {
    #[serde(rename = "type")]
    format_type: &'static str,
}

#[derive(Serialize)]
struct OpenAIThinking {
    #[serde(rename = "type")]
    thinking_type: &'static str,
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
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIUsage {
    total_tokens: u32,
}

#[async_trait]
impl LLMProvider for OpenAICompatProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let url = format!("{}/chat/completions", self.endpoint.trim_end_matches('/'));
        let wants_json = matches!(
            request.response_format,
            Some(ResponseFormat::Json | ResponseFormat::JsonSchema(_))
        );
        let body = OpenAIRequest {
            model: self.model.clone(),
            messages: vec![
                OpenAIMessage {
                    role: "system".into(),
                    content: request.system.clone(),
                },
                OpenAIMessage {
                    role: "user".into(),
                    content: request.prompt.clone(),
                },
            ],
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            response_format: wants_json.then_some(OpenAIResponseFormat {
                format_type: "json_object",
            }),
            thinking: (self.provider_id == "deepseek").then_some(OpenAIThinking {
                thinking_type: "disabled",
            }),
        };
        let start = Instant::now();
        let resp = send_with_provider_retry(self.provider_name(), self.model_name(), || {
            let mut req = self.client.post(&url).json(&body);
            if let Some(key) = &self.api_key {
                req = req.bearer_auth(key.expose_secret());
            }
            req
        })
        .await?;
        let openai_resp: OpenAIResponse = resp.json().await?;
        let latency = start.elapsed();
        let message = openai_resp
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| LLMError::InvalidResponse("No choices in response".into()))?;
        let content = message.message.content.unwrap_or_default();
        if content.trim().is_empty() {
            let reasoning = message.message.reasoning_content.unwrap_or_default();
            let detail = if reasoning.trim().is_empty() {
                "message content was empty".to_owned()
            } else {
                format!(
                    "message content was empty; reasoning_content had {} chars",
                    reasoning.chars().count()
                )
            };
            return Err(LLMError::InvalidResponse(detail));
        }
        Ok(CompletionResponse {
            content,
            tokens_used: openai_resp.usage.map(|u| u.total_tokens).unwrap_or(0),
            latency,
        })
    }

    fn provider_name(&self) -> &str {
        &self.provider_id
    }

    fn model_name(&self) -> &str {
        &self.model
    }

    fn configured_max_tokens(&self) -> Option<u32> {
        Some(self.max_tokens)
    }
}
