use async_trait::async_trait;
use serde_json::json;

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

    fn extract_safe_markdown_create_path(prompt: &str) -> Option<String> {
        let mut in_safe_path_block = false;

        for line in prompt.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Safe relative paths:") {
                in_safe_path_block = true;
                continue;
            }

            if !in_safe_path_block {
                continue;
            }

            if let Some(path) = trimmed.strip_prefix("- ") {
                if path.ends_with(".md") {
                    return Some(path.to_owned());
                }
                continue;
            }

            if !trimmed.is_empty() {
                break;
            }
        }

        None
    }

    fn extract_first_file_block(prompt: &str) -> Option<(String, String)> {
        let marker = "<file path=\"";
        let start = prompt.find(marker)?;
        let remainder = &prompt[start + marker.len()..];
        let (path, after_path) = remainder.split_once("\">")?;
        let (content, _) = after_path.split_once("</file>")?;
        Some((path.to_owned(), content.trim_matches('\n').to_owned()))
    }

    fn markdown_modify_diff(existing_content: &str) -> String {
        let old_lines = existing_content
            .trim_end_matches('\n')
            .lines()
            .collect::<Vec<_>>();
        let mut new_content = existing_content.trim_end().to_owned();
        if !new_content.is_empty() {
            new_content.push_str("\n\n");
        }
        new_content.push_str("## Implementation Notes\n- Expand subsystem boundaries, milestones, and execution detail.\n");
        let new_lines = new_content
            .trim_end_matches('\n')
            .lines()
            .collect::<Vec<_>>();
        let mut diff = format!("@@ -1,{} +1,{} @@\n", old_lines.len(), new_lines.len());
        for line in old_lines {
            diff.push('-');
            diff.push_str(line);
            diff.push('\n');
        }
        for line in new_lines {
            diff.push('+');
            diff.push_str(line);
            diff.push('\n');
        }
        diff
    }

    fn rust_modify_diff(existing_content: &str) -> String {
        let first_line = existing_content
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("pub fn baseline() {}")
            .trim_end();
        let replacement = if first_line.contains("maabarium_improvement") {
            "pub fn maabarium_follow_up() {}".to_owned()
        } else {
            "pub fn maabarium_improvement() {}".to_owned()
        };
        format!(
            "@@ -1,1 +1,1 @@\n-{}\n+{}\n",
            first_line, replacement
        )
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
                    content: json!({
                        "summary": "Mock provider generated no file changes",
                        "file_patches": []
                    })
                    .to_string(),
                    tokens_used: 16,
                    latency: std::time::Duration::from_millis(5),
                });
            }
            if request.prompt.contains("No existing target files were found. Create a new markdown file") {
                let path = Self::extract_safe_markdown_create_path(&request.prompt)
                    .unwrap_or_else(|| "docs/draft.md".to_owned());
                let content = format!(
                    "# Detailed Implementation Draft\n\n## Architecture\n- Define concrete subsystems and data flow.\n\n## Delivery Plan\n- List milestones, dependencies, and exit criteria.\n"
                );
                return Ok(CompletionResponse {
                    content: json!({
                        "summary": "Mock provider created a substantial first draft",
                        "file_patches": [
                            {
                                "path": path,
                                "operation": "create",
                                "unified_diff": content,
                            }
                        ]
                    })
                    .to_string(),
                    tokens_used: 32,
                    latency: std::time::Duration::from_millis(5),
                });
            }
            if let Some((path, existing_content)) = Self::extract_first_file_block(&request.prompt) {
                if path.ends_with(".md") {
                    json!({
                        "summary": "Mock provider deepened the existing document",
                        "file_patches": [
                            {
                                "path": path,
                                "operation": "modify",
                                "unified_diff": Self::markdown_modify_diff(&existing_content),
                            }
                        ]
                    })
                    .to_string()
                } else {
                    json!({
                        "summary": "Mock provider generated a safe maabarium improvement",
                        "file_patches": [
                            {
                                "path": path,
                                "operation": "modify",
                                "unified_diff": Self::rust_modify_diff(&existing_content),
                            }
                        ]
                    })
                    .to_string()
                }
            } else {
                json!({
                    "summary": "Mock provider generated a safe maabarium improvement",
                    "file_patches": [
                        {
                            "path": "src/lib.rs",
                            "operation": "modify",
                            "unified_diff": "@@ -1,1 +1,1 @@
-pub fn baseline() {}
+pub fn maabarium_improvement() {}
",
                        }
                    ]
                })
                .to_string()
            }
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
