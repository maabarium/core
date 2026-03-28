use async_trait::async_trait;

use crate::error::LLMError;

use super::{CompletionRequest, CompletionResponse, LLMProvider};

pub struct MockProvider {
    model: String,
}

impl MockProvider {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
        }
    }
}

#[async_trait]
impl LLMProvider for MockProvider {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError> {
        let content = if request.prompt.contains("Respond with only a number") {
            "0.78".to_owned()
        } else if request.prompt.contains("\"file_patches\"") {
            if request.prompt.contains("MAABARIUM_MOCK_EMPTY_PATCHSET") {
                return Ok(CompletionResponse {
                    content: "{\n  \"summary\": \"Mock provider generated no file changes\",\n  \"file_patches\": []\n}".to_owned(),
                    tokens_used: 16,
                    latency: std::time::Duration::from_millis(5),
                });
            }
            let path = request
                .prompt
                .lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix("<file path=\"")
                        .and_then(|rest| rest.split_once("\">").map(|(path, _)| path.to_owned()))
                })
                .unwrap_or_else(|| "src/lib.rs".to_owned());
            format!(
                "{{\n  \"summary\": \"Mock provider generated a safe maabarium improvement\",\n  \"file_patches\": [\n    {{\n      \"path\": \"{}\",\n      \"operation\": \"modify\",\n      \"unified_diff\": \"@@ -1,1 +1,1 @@\\n-pub fn baseline() {{}}\\n+pub fn maabarium_improvement() {{}}\\n\"\n    }}\n  ]\n}}",
                path,
            )
        } else {
            let summary = request
                .prompt
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("Iteratively improve the target files")
                .trim();
            format!("{} via {}", summary, self.model)
        };

        Ok(CompletionResponse {
            content,
            tokens_used: 32,
            latency: std::time::Duration::from_millis(5),
        })
    }

    fn provider_name(&self) -> &str {
        "mock"
    }

    fn model_name(&self) -> &str {
        &self.model
    }
}
