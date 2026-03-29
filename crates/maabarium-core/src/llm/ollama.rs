use super::{CompletionRequest, CompletionResponse, LLMProvider};
use crate::error::LLMError;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tracing::warn;

const MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS: usize = 1_200;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<OllamaFormat>,
    options: OllamaOptions,
}

#[derive(Serialize)]
#[serde(untagged)]
enum OllamaFormat {
    JsonMode(String),
    JsonSchema(Value),
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
    thinking: Option<String>,
    #[serde(default)]
    eval_count: Option<u32>,
}

fn extract_ollama_content(response: String, thinking: Option<String>) -> Option<String> {
    if !response.trim().is_empty() {
        return Some(response);
    }

    thinking.filter(|content| !content.trim().is_empty())
}

fn ollama_payload_excerpt(raw_payload: &str) -> String {
    let trimmed = raw_payload.trim();
    if trimmed.is_empty() {
        return "<empty payload>".to_owned();
    }

    let total_chars = trimmed.chars().count();
    if total_chars <= MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS {
        return trimmed.to_owned();
    }

    let snippet = trimmed
        .chars()
        .take(MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS)
        .collect::<String>();
    format!(
        "{snippet}\n...[truncated {} chars]",
        total_chars - MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS
    )
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
            format: request.response_format.as_ref().map(|format| match format {
                super::ResponseFormat::Json => OllamaFormat::JsonMode("json".to_owned()),
                super::ResponseFormat::JsonSchema(schema) => {
                    OllamaFormat::JsonSchema(schema.clone())
                }
            }),
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
        let raw_payload = resp.text().await?;
        let ollama_resp: OllamaResponse = serde_json::from_str(&raw_payload).map_err(|error| {
            LLMError::InvalidResponse(format!(
                "Failed to parse Ollama response JSON: {error}; payload_excerpt={}",
                ollama_payload_excerpt(&raw_payload)
            ))
        })?;
        let latency = start.elapsed();
        let tokens_used = ollama_resp.eval_count.unwrap_or(0);
        let response_was_empty = ollama_resp.response.trim().is_empty();
        let content = extract_ollama_content(ollama_resp.response, ollama_resp.thinking);

        if tokens_used > 0 && content.is_none() {
            warn!(
                provider = "ollama",
                model = %self.model,
                tokens_used,
                payload_excerpt = %ollama_payload_excerpt(&raw_payload),
                "Ollama returned empty response content despite reporting eval tokens"
            );
            return Err(LLMError::Provider(format!(
                "Ollama returned empty response content despite reporting {tokens_used} eval tokens"
            )));
        }

        if content
            .as_deref()
            .is_some_and(|content| response_was_empty && !content.trim().is_empty())
        {
            warn!(
                provider = "ollama",
                model = %self.model,
                tokens_used,
                "Ollama returned proposal content in thinking while response was empty; using thinking fallback"
            );
        }

        Ok(CompletionResponse {
            content: content.unwrap_or_default(),
            tokens_used,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_single_response_server(status_line: &str, body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("local addr should resolve");
        let body_bytes = body.into_bytes();
        let status_line = status_line.to_owned();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("request should arrive");
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body_bytes.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("response head should write");
            stream
                .write_all(&body_bytes)
                .expect("response body should write");
        });

        format!("http://{address}")
    }

    #[tokio::test]
    async fn returns_provider_error_when_eval_tokens_exist_but_content_is_empty() {
        let endpoint = spawn_single_response_server(
            "200 OK",
            r#"{"response":"","thinking":"","eval_count":42}"#.to_owned(),
        );
        let provider = OllamaProvider::new(endpoint, "qwen3.5:9b");

        let error = provider
            .complete(&CompletionRequest {
                system: "system".to_owned(),
                prompt: "prompt".to_owned(),
                temperature: 0.0,
                max_tokens: 128,
                response_format: None,
            })
            .await
            .expect_err("empty content with eval tokens should fail");

        assert!(matches!(error, LLMError::Provider(_)));
        assert!(error
            .to_string()
            .contains("empty response content despite reporting 42 eval tokens"));
    }

    #[tokio::test]
    async fn falls_back_to_thinking_when_response_is_empty() {
        let endpoint = spawn_single_response_server(
            "200 OK",
            r#"{"response":"","thinking":"{\"summary\":\"ok\",\"file_patches\":[]}","eval_count":42}"#.to_owned(),
        );
        let provider = OllamaProvider::new(endpoint, "qwen3.5:9b");

        let response = provider
            .complete(&CompletionRequest {
                system: "system".to_owned(),
                prompt: "prompt".to_owned(),
                temperature: 0.0,
                max_tokens: 128,
                response_format: None,
            })
            .await
            .expect("thinking fallback should succeed");

        assert_eq!(response.content, "{\"summary\":\"ok\",\"file_patches\":[]}");
        assert_eq!(response.tokens_used, 42);
    }

    #[tokio::test]
    async fn returns_completion_content_for_normal_ollama_payloads() {
        let endpoint = spawn_single_response_server(
            "200 OK",
            r#"{"response":"{\"summary\":\"ok\",\"file_patches\":[]}","eval_count":13}"#.to_owned(),
        );
        let provider = OllamaProvider::new(endpoint, "qwen3.5:9b");

        let response = provider
            .complete(&CompletionRequest {
                system: "system".to_owned(),
                prompt: "prompt".to_owned(),
                temperature: 0.0,
                max_tokens: 128,
                response_format: None,
            })
            .await
            .expect("normal payload should succeed");

        assert_eq!(response.content, "{\"summary\":\"ok\",\"file_patches\":[]}");
        assert_eq!(response.tokens_used, 13);
    }

    #[test]
    fn truncates_ollama_payload_excerpts() {
        let payload = "x".repeat(MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS + 11);
        let excerpt = ollama_payload_excerpt(&payload);

        assert!(excerpt.starts_with(&"x".repeat(MAX_OLLAMA_PAYLOAD_EXCERPT_CHARS)));
        assert!(excerpt.ends_with("...[truncated 11 chars]"));
    }
}
