use async_trait::async_trait;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant, sleep};
use tracing::instrument;

use crate::error::LLMError;
use super::{LLMProvider, CompletionRequest, CompletionResponse};

pub struct PoolMember {
    provider: Arc<dyn LLMProvider>,
    min_interval: Option<Duration>,
    next_ready_at: Mutex<Instant>,
}

impl PoolMember {
    pub fn new(provider: Arc<dyn LLMProvider>, requests_per_minute: Option<u32>) -> Self {
        let min_interval = requests_per_minute
            .filter(|limit| *limit > 0)
            .map(|limit| Duration::from_secs_f64(60.0 / limit as f64));
        Self {
            provider,
            min_interval,
            next_ready_at: Mutex::new(Instant::now()),
        }
    }

    #[instrument(name = "pool_member_acquire_slot", skip(self), fields(model = %self.provider.model_name()))]
    async fn acquire_slot(&self) {
        let Some(min_interval) = self.min_interval else {
            return;
        };

        let mut next_ready_at = self.next_ready_at.lock().await;
        let now = Instant::now();
        if *next_ready_at > now {
            sleep(*next_ready_at - now).await;
        }
        let scheduled_from = Instant::now().max(*next_ready_at);
        *next_ready_at = scheduled_from + min_interval;
    }
}

pub struct ModelPool {
    providers: Vec<PoolMember>,
    counter: AtomicUsize,
    label: String,
}

impl ModelPool {
    pub fn new(providers: Vec<PoolMember>) -> Self {
        let label = providers
            .iter()
            .map(|provider| provider.provider.model_name().to_owned())
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            providers,
            counter: AtomicUsize::new(0),
            label,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }

    pub fn next_provider_index(&self) -> Option<usize> {
        if self.providers.is_empty() {
            return None;
        }
        Some(self.counter.fetch_add(1, Ordering::Relaxed) % self.providers.len())
    }

    pub fn next_provider_name(&self) -> Option<&str> {
        self.next_provider_index()
            .and_then(|index| self.providers.get(index))
            .map(|provider| provider.provider.model_name())
    }

    #[instrument(name = "model_pool_complete", skip(self, request), fields(pool = %self.model_name()))]
    pub async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let provider_index = self
            .next_provider_index()
            .ok_or_else(|| LLMError::Provider("No providers in pool".into()))?;
        let provider = &self.providers[provider_index];
        provider.acquire_slot().await;
        let response = provider.provider.complete(request).await?;
        tracing::info!(
            provider = provider.provider.provider_name(),
            model = provider.provider.model_name(),
            tokens_used = response.tokens_used,
            latency_ms = response.latency.as_millis() as u64,
            "LLM completion finished"
        );
        Ok(response)
    }
}

#[async_trait]
impl LLMProvider for ModelPool {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        ModelPool::complete(self, request).await
    }

    fn provider_name(&self) -> &str {
        "model-pool"
    }

    fn model_name(&self) -> &str {
        if self.label.is_empty() {
            "unconfigured"
        } else {
            &self.label
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    struct TestProvider {
        name: &'static str,
        calls: StdMutex<Vec<&'static str>>,
    }

    impl TestProvider {
        fn new(name: &'static str) -> Self {
            Self {
                name,
                calls: StdMutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl LLMProvider for TestProvider {
        async fn complete(&self, _request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
            self.calls.lock().expect("calls lock").push(self.name);
            Ok(CompletionResponse {
                content: self.name.to_owned(),
                tokens_used: 1,
                latency: Duration::from_millis(1),
            })
        }

        fn provider_name(&self) -> &str {
            self.name
        }

        fn model_name(&self) -> &str {
            self.name
        }
    }

    #[tokio::test]
    async fn rotates_across_providers() {
        let first = Arc::new(TestProvider::new("one"));
        let second = Arc::new(TestProvider::new("two"));
        let pool = ModelPool::new(vec![
            PoolMember::new(first.clone(), None),
            PoolMember::new(second.clone(), None),
        ]);
        let request = CompletionRequest {
            system: "system".into(),
            prompt: "prompt".into(),
            temperature: 0.0,
            max_tokens: 1,
        };

        let first_response = pool.complete(&request).await.expect("first completion");
        let second_response = pool.complete(&request).await.expect("second completion");

        assert_eq!(first_response.content, "one");
        assert_eq!(second_response.content, "two");
    }
}
