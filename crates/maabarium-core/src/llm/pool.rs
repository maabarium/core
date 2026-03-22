use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use crate::error::LLMError;
use super::{LLMProvider, CompletionRequest, CompletionResponse};

pub struct ModelPool {
    providers: Vec<Arc<dyn LLMProvider>>,
    counter: AtomicUsize,
}

impl ModelPool {
    pub fn new(providers: Vec<Arc<dyn LLMProvider>>) -> Self {
        Self {
            providers,
            counter: AtomicUsize::new(0),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }

    pub fn next_provider(&self) -> Option<Arc<dyn LLMProvider>> {
        if self.providers.is_empty() {
            return None;
        }
        let idx = self.counter.fetch_add(1, Ordering::Relaxed) % self.providers.len();
        Some(Arc::clone(&self.providers[idx]))
    }

    pub async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let provider = self.next_provider()
            .ok_or_else(|| LLMError::Provider("No providers in pool".into()))?;
        provider.complete(request).await
    }
}
