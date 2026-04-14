use async_trait::async_trait;
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

use secrecy::SecretString;
use tokio::time::sleep;
use tracing::warn;

use crate::blueprint::{ModelAssignment, ModelDef, ModelsConfig};
use crate::error::LLMError;
use crate::error::SecretError;
use crate::secrets::SecretStore;

pub mod anthropic;
pub mod gemini;
pub mod mock;
pub mod ollama;
pub mod openai_compat;
pub mod pool;

pub use anthropic::AnthropicProvider;
pub use gemini::GeminiProvider;
pub use mock::MockProvider;
pub use ollama::OllamaProvider;
pub use openai_compat::OpenAICompatProvider;
pub use pool::{ModelPool, PoolMember};

const DEFAULT_PROVIDER_HTTP_TIMEOUT_SECS: u64 = 90;
const DEFAULT_PROVIDER_CONNECT_TIMEOUT_SECS: u64 = 10;
const DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS: usize = 2;

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

pub(crate) fn build_provider_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(
            DEFAULT_PROVIDER_CONNECT_TIMEOUT_SECS,
        ))
        .timeout(Duration::from_secs(DEFAULT_PROVIDER_HTTP_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub(crate) async fn send_with_provider_retry<F>(
    provider_name: &str,
    model_name: &str,
    mut build_request: F,
) -> Result<Response, LLMError>
where
    F: FnMut() -> RequestBuilder,
{
    let mut backoff = Duration::from_millis(750);

    for attempt in 1..=DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS {
        match build_request().send().await {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                if is_transient_status(status) && attempt < DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS {
                    warn!(
                        provider = provider_name,
                        model = model_name,
                        status = %status,
                        attempt,
                        max_attempts = DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS,
                        backoff_ms = backoff.as_millis() as u64,
                        "Retrying transient provider HTTP status"
                    );
                    sleep(backoff).await;
                    backoff *= 2;
                    continue;
                }
                return Err(LLMError::Provider(format!("HTTP {status}: {body}")));
            }
            Err(error)
                if is_transient_reqwest_error(&error)
                    && attempt < DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS =>
            {
                warn!(
                    provider = provider_name,
                    model = model_name,
                    attempt,
                    max_attempts = DEFAULT_PROVIDER_TRANSIENT_RETRY_ATTEMPTS,
                    backoff_ms = backoff.as_millis() as u64,
                    error = %error,
                    "Retrying transient provider request failure"
                );
                sleep(backoff).await;
                backoff *= 2;
            }
            Err(error) => return Err(LLMError::Http(error)),
        }
    }

    Err(LLMError::Timeout)
}

fn is_transient_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    ) || status.is_server_error()
}

fn is_transient_reqwest_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect()
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
        "anthropic" => {
            let api_key = required_provider_secret(&provider_name, model.api_key_env.as_deref())?;
            Ok(Arc::new(AnthropicProvider::new(
                model.endpoint.clone(),
                model.name.clone(),
                api_key,
                model.max_tokens,
            )))
        }
        "gemini" => {
            let api_key = required_provider_secret(&provider_name, model.api_key_env.as_deref())?;
            Ok(Arc::new(GeminiProvider::new(
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

fn required_provider_secret(
    provider_name: &str,
    env_var: Option<&str>,
) -> Result<SecretString, SecretError> {
    provider_secret(provider_name, env_var)?.ok_or_else(|| {
        SecretError::InvalidInput(format!(
            "No API key configured for provider '{provider_name}'"
        ))
    })
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
    use super::{build_provider_http_client, send_with_provider_retry};
    use super::provider_from_model;
    use crate::blueprint::ModelDef;
    use crate::error::LLMError;
    use crate::error::SecretError;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn with_test_provider_key(action: impl FnOnce()) {
        let previous = std::env::var_os("TEST_PROVIDER_KEY");
        unsafe {
            std::env::set_var("TEST_PROVIDER_KEY", "unit-test-provider-key");
        }
        action();
        match previous {
            Some(value) => unsafe {
                std::env::set_var("TEST_PROVIDER_KEY", value);
            },
            None => unsafe {
                std::env::remove_var("TEST_PROVIDER_KEY");
            },
        }
    }

    fn spawn_retry_server(responses: Vec<(&'static str, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("local addr should resolve");

        thread::spawn(move || {
            for (status_line, body) in responses {
                let (mut stream, _) = listener.accept().expect("request should arrive");
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer);
                let response = format!(
                    "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("response should write");
            }
        });

        format!("http://{address}")
    }

    #[tokio::test]
    async fn retries_transient_provider_statuses() {
        let endpoint = spawn_retry_server(vec![
            ("503 Service Unavailable", r#"{"error":"busy"}"#),
            ("200 OK", r#"{"ok":true}"#),
        ]);
        let client = build_provider_http_client();

        let response = send_with_provider_retry("openai-compat", "retry-model", || {
            client.get(&endpoint)
        })
        .await
        .expect("second attempt should succeed");

        let body = response.text().await.expect("response body should read");
        assert_eq!(body, r#"{"ok":true}"#);
    }

    #[tokio::test]
    async fn does_not_retry_non_transient_provider_statuses() {
        let endpoint = spawn_retry_server(vec![(
            "400 Bad Request",
            r#"{"error":"bad request"}"#,
        )]);
        let client = build_provider_http_client();

        let error = send_with_provider_retry("openai-compat", "retry-model", || {
            client.get(&endpoint)
        })
        .await
        .expect_err("client error should not retry");

        assert!(matches!(error, LLMError::Provider(message) if message.contains("400 Bad Request")));
    }

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
        with_test_provider_key(|| {
            let provider = provider_from_model(&test_model("xai")).expect("xai should resolve");

            assert_eq!(provider.provider_name(), "openai-compat");
            assert_eq!(provider.model_name(), "test-model");
        });
    }

    #[test]
    fn resolves_anthropic_as_native_provider() {
        with_test_provider_key(|| {
            let provider = provider_from_model(&test_model("anthropic"))
                .expect("anthropic should resolve");

            assert_eq!(provider.provider_name(), "anthropic");
            assert_eq!(provider.model_name(), "test-model");
        });
    }

    #[test]
    fn resolves_gemini_as_native_provider() {
        with_test_provider_key(|| {
            let provider =
                provider_from_model(&test_model("gemini")).expect("gemini should resolve");

            assert_eq!(provider.provider_name(), "gemini");
            assert_eq!(provider.model_name(), "test-model");
        });
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
