use super::{
    CompletionRequest, CompletionResponse, LLMProvider, ResponseFormat,
    build_provider_http_client, send_with_provider_retry,
};
use crate::error::LLMError;
use async_trait::async_trait;
use reqwest::Client;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

pub struct GeminiProvider {
    client: Client,
    endpoint: String,
    model: String,
    api_key: SecretString,
    max_tokens: u32,
}

impl GeminiProvider {
    pub fn new(
        endpoint: impl Into<String>,
        model: impl Into<String>,
        api_key: SecretString,
        max_tokens: u32,
    ) -> Self {
        Self {
            client: build_provider_http_client(),
            endpoint: endpoint.into(),
            model: model.into(),
            api_key,
            max_tokens,
        }
    }
}

pub(crate) fn generate_content_url(endpoint: &str, model: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    let model = model.trim();
    let model = model.strip_prefix("models/").unwrap_or(model);
    if trimmed.ends_with("/v1beta") {
        format!("{trimmed}/models/{model}:generateContent")
    } else {
        format!("{trimmed}/v1beta/models/{model}:generateContent")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
    generation_config: GeminiGenerationConfig,
}

#[derive(Serialize, Deserialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize, Deserialize)]
struct GeminiPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiGenerationConfig {
    temperature: f32,
    max_output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_mime_type: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_json_schema: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
    #[serde(default)]
    prompt_feedback: Option<GeminiPromptFeedback>,
    #[serde(default)]
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiCandidate {
    #[serde(default)]
    content: Option<GeminiContent>,
    #[serde(default)]
    finish_reason: Option<String>,
    #[serde(default)]
    finish_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiPromptFeedback {
    #[serde(default)]
    block_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiUsageMetadata {
    #[serde(default)]
    total_token_count: u32,
}

fn generation_config(request: &CompletionRequest) -> GeminiGenerationConfig {
    match request.response_format.as_ref() {
        Some(ResponseFormat::Json) => GeminiGenerationConfig {
            temperature: request.temperature,
            max_output_tokens: request.max_tokens,
            response_mime_type: Some("application/json"),
            response_json_schema: None,
        },
        Some(ResponseFormat::JsonSchema(schema)) => GeminiGenerationConfig {
            temperature: request.temperature,
            max_output_tokens: request.max_tokens,
            response_mime_type: Some("application/json"),
            response_json_schema: Some(schema.clone()),
        },
        None => GeminiGenerationConfig {
            temperature: request.temperature,
            max_output_tokens: request.max_tokens,
            response_mime_type: None,
            response_json_schema: None,
        },
    }
}

#[async_trait]
impl LLMProvider for GeminiProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let body = GeminiRequest {
            contents: vec![GeminiContent {
                role: Some("user".to_owned()),
                parts: vec![GeminiPart {
                    text: Some(request.prompt.clone()),
                }],
            }],
            system_instruction: (!request.system.trim().is_empty()).then(|| GeminiContent {
                role: None,
                parts: vec![GeminiPart {
                    text: Some(request.system.clone()),
                }],
            }),
            generation_config: generation_config(request),
        };

        let start = Instant::now();
        let resp = send_with_provider_retry(self.provider_name(), self.model_name(), || {
            self.client
                .post(generate_content_url(&self.endpoint, &self.model))
                .header("x-goog-api-key", self.api_key.expose_secret())
                .json(&body)
        })
        .await?;

        let response: GeminiResponse = resp.json().await?;
        if let Some(block_reason) = response
            .prompt_feedback
            .as_ref()
            .and_then(|feedback| feedback.block_reason.as_deref())
        {
            return Err(LLMError::Provider(format!(
                "Gemini blocked the prompt: {block_reason}"
            )));
        }

        let candidate = response
            .candidates
            .into_iter()
            .next()
            .ok_or_else(|| LLMError::InvalidResponse("No candidates in Gemini response".to_owned()))?;
        let content = candidate
            .content
            .map(|content| {
                content
                    .parts
                    .into_iter()
                    .filter_map(|part| part.text)
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        if content.trim().is_empty() {
            let finish = candidate
                .finish_reason
                .or(candidate.finish_message)
                .unwrap_or_else(|| "No text content in Gemini response".to_owned());
            return Err(LLMError::InvalidResponse(finish));
        }

        Ok(CompletionResponse {
            content,
            tokens_used: response
                .usage_metadata
                .map(|usage| usage.total_token_count)
                .unwrap_or(0),
            latency: start.elapsed(),
        })
    }

    fn provider_name(&self) -> &str {
        "gemini"
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
    async fn completes_against_gemini_generate_content_api() {
        let provider = GeminiProvider::new(
            spawn_single_response_server(
                "200 OK",
                r#"{"candidates":[{"content":{"parts":[{"text":"OK"}]}}],"usageMetadata":{"totalTokenCount":7}}"#,
            ),
            "gemini-2.5-flash",
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
            .expect("gemini completion should succeed");

        assert_eq!(response.content, "OK");
        assert_eq!(response.tokens_used, 7);
    }
}