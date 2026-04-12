use super::{CompletionRequest, CompletionResponse, LLMProvider, ResponseFormat};
use crate::error::LLMError;
use async_trait::async_trait;
use reqwest::Client;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::time::Instant;

const ANTHROPIC_API_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    client: Client,
    endpoint: String,
    model: String,
    api_key: SecretString,
    max_tokens: u32,
}

impl AnthropicProvider {
    pub fn new(
        endpoint: impl Into<String>,
        model: impl Into<String>,
        api_key: SecretString,
        max_tokens: u32,
    ) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.into(),
            model: model.into(),
            api_key,
            max_tokens,
        }
    }
}

pub(crate) fn messages_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}/v1/messages")
    }
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "String::is_empty")]
    system: String,
    messages: Vec<AnthropicMessage>,
    temperature: f32,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicInputBlock>,
}

#[derive(Serialize)]
struct AnthropicInputBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

fn response_mime_type(request: &CompletionRequest) -> &'static str {
    match request.response_format.as_ref() {
        Some(ResponseFormat::Json) | Some(ResponseFormat::JsonSchema(_)) => "application/json",
        None => "text/plain",
    }
}

#[async_trait]
impl LLMProvider for AnthropicProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let body = AnthropicRequest {
            model: self.model.clone(),
            max_tokens: request.max_tokens,
            system: request.system.clone(),
            messages: vec![AnthropicMessage {
                role: "user".to_owned(),
                content: vec![AnthropicInputBlock {
                    block_type: "text".to_owned(),
                    text: request.prompt.clone(),
                }],
            }],
            temperature: request.temperature,
        };

        let start = Instant::now();
        let resp = self
            .client
            .post(messages_url(&self.endpoint))
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("x-api-key", self.api_key.expose_secret())
            .header(reqwest::header::ACCEPT, response_mime_type(request))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(LLMError::Provider(format!("HTTP {status}: {text}")));
        }

        let response: AnthropicResponse = resp.json().await?;
        let content = response
            .content
            .iter()
            .filter(|block| block.block_type == "text")
            .filter_map(|block| block.text.as_deref())
            .collect::<Vec<_>>()
            .join("");
        if content.trim().is_empty() {
            return Err(LLMError::InvalidResponse(
                "No text content in Anthropic response".to_owned(),
            ));
        }

        Ok(CompletionResponse {
            content,
            tokens_used: response
                .usage
                .map(|usage| usage.input_tokens.saturating_add(usage.output_tokens))
                .unwrap_or(0),
            latency: start.elapsed(),
        })
    }

    fn provider_name(&self) -> &str {
        "anthropic"
    }

    fn model_name(&self) -> &str {
        &self.model
    }

    fn configured_max_tokens(&self) -> Option<u32> {
        Some(self.max_tokens)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_single_response_server(status_line: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("local addr should resolve");
        let body_bytes = body.as_bytes().to_vec();
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
    async fn completes_against_anthropic_messages_api() {
        let provider = AnthropicProvider::new(
            spawn_single_response_server(
                "200 OK",
                r#"{"content":[{"type":"text","text":"OK"}],"usage":{"input_tokens":3,"output_tokens":2}}"#,
            ),
            "claude-sonnet-4",
            SecretString::from("test-key".to_owned()),
            128,
        );

        let response = provider
            .complete(&CompletionRequest {
                system: "system".to_owned(),
                prompt: "prompt".to_owned(),
                temperature: 0.2,
                max_tokens: 32,
                response_format: None,
            })
            .await
            .expect("anthropic completion should succeed");

        assert_eq!(response.content, "OK");
        assert_eq!(response.tokens_used, 5);
    }
}