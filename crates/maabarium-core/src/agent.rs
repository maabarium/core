use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures::future::join_all;
use serde::Deserialize;
use serde_json::json;
use tracing::{debug, info, warn};

use crate::blueprint::{AgentDef, MetricDef};
use crate::error::LLMError;
use crate::git_manager::{FilePatch, FilePatchOperation, Proposal};
use crate::llm::{CompletionRequest, LLMProvider, ResponseFormat};

const MAX_CONTEXT_FILES: usize = 3;
const MAX_FILE_CHARS: usize = 4_000;
const MAX_INVALID_RESPONSE_SNIPPET_CHARS: usize = 1_200;
const DEFAULT_PROPOSAL_MAX_TOKENS: u32 = 768;
const COMPLEX_PROPOSAL_MAX_TOKENS: u32 = 1_536;
const EXACT_DOCUMENT_PROPOSAL_MAX_TOKENS: u32 = 3_072;

#[derive(Debug, Clone)]
struct FileContext {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ProposalPayload {
    summary: String,
    file_patches: Vec<DiffPatchPayload>,
}

#[derive(Debug, Deserialize)]
struct DiffPatchPayload {
    path: String,
    operation: FilePatchOperation,
    unified_diff: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffApplyResult {
    content: Option<String>,
    had_trailing_newline: bool,
}

pub struct Agent {
    def: AgentDef,
    llm: Arc<dyn LLMProvider>,
}

fn research_patch_guidance(language: &str) -> &'static str {
    if language.eq_ignore_ascii_case("research") {
        "\n\
         Research workflow rules:\n\
         - Prefer a single markdown patch in docs/, research/, notes/, or reports/.\n\
         - Every major claim you add must include at least one inline markdown link or bare external URL.\n\
         - Prefer appending a new section or creating a new markdown file instead of rewriting large existing files.\n\
         - When modifying an existing file, copy exact unchanged context lines and ensure each unified diff hunk count is exact.\n\
         - If you cannot supply at least one external URL, return an empty file_patches array, explain the evidence gap in summary, and include a follow-up search cue using the exact phrase Search for \"...\".\n\
         - Do not invent hunk sizes or line counts."
    } else {
        ""
    }
}

fn is_exact_target_path(path: &str) -> bool {
    !path.contains('*') && !path.contains('?') && !path.contains('[') && !path.contains('{')
}

fn prefers_incremental_document_proposals(language: &str, target_files: &[String]) -> bool {
    (language.eq_ignore_ascii_case("markdown") || language.eq_ignore_ascii_case("prompt"))
        && target_files.len() == 1
        && target_files.iter().all(|path| is_exact_target_path(path))
}

fn incremental_document_guidance(
    language: &str,
    target_files: &[String],
    file_contexts: &[FileContext],
) -> &'static str {
    if !prefers_incremental_document_proposals(language, target_files) {
        return "";
    }

    if file_contexts.is_empty() {
        "\nIncremental document workflow rules:\n- The target is one exact document path. If it does not exist yet, create a substantial v1 draft that is immediately useful.\n- Include concrete section content, implementation detail, milestones, and risks rather than placeholder-only headings.\n- Do not return only a title line, an empty scaffold, or a boilerplate shell.\n- Make the first draft strong enough that later iterations can deepen specific sections instead of reinitializing the document."
    } else {
        "\nIncremental document workflow rules:\n- The target is one exact document path. Prefer revising one section or one tightly related cluster of lines at a time.\n- Deepen the existing document in place; do not reset it to a fresh header, version banner, or empty scaffold.\n- Avoid whole-document rewrites when a focused section edit will do.\n- Keep each proposal narrow enough that the JSON and diff remain compact and reviewable."
    }
}

fn exact_existing_markdown_target_disallows_raw_fallback(
    path: &str,
    operation: FilePatchOperation,
    target_files: &[String],
) -> bool {
    if operation != FilePatchOperation::Modify {
        return false;
    }

    if target_files.len() != 1 || !is_exact_target_path(&target_files[0]) || target_files[0] != path {
        return false;
    }

    let lower = path.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with("readme") || lower.ends_with("readme.md")
}

fn raw_content_fallback_prompt_guidance(language: &str, target_files: &[String]) -> &'static str {
    if prefers_incremental_document_proposals(language, target_files) {
        "For one exact existing markdown document target, do not use whole-file replacement. Emit a focused unified diff against the current file contents.\n              For create operations on markdown targets, you may place the full new file content in unified_diff when exact diffing against an empty file is impractical."
    } else {
        "For markdown or JSON targets, if exact diffing is difficult, you may place the final file content in unified_diff and it will be treated as a whole-file replacement."
    }
}

fn proposal_max_tokens(language: &str, target_files: &[String], llm: &dyn LLMProvider) -> u32 {
    let heuristic_budget = if language.eq_ignore_ascii_case("research")
        || language.eq_ignore_ascii_case("lora")
    {
        COMPLEX_PROPOSAL_MAX_TOKENS
    } else if prefers_incremental_document_proposals(language, target_files) {
        EXACT_DOCUMENT_PROPOSAL_MAX_TOKENS
    } else {
        DEFAULT_PROPOSAL_MAX_TOKENS
    };

    llm.configured_max_tokens()
        .filter(|configured| *configured > 0)
        .map(|configured| heuristic_budget.min(configured))
        .unwrap_or(heuristic_budget)
}

fn proposal_temperature(provider_name: &str) -> f32 {
    if provider_name.eq_ignore_ascii_case("ollama") {
        0.0
    } else {
        0.2
    }
}

fn proposal_response_format() -> ResponseFormat {
    ResponseFormat::JsonSchema(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "summary": {
                "type": "string"
            },
            "file_patches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "path": {
                            "type": "string"
                        },
                        "operation": {
                            "type": "string",
                            "enum": ["create", "modify", "delete"]
                        },
                        "unified_diff": {
                            "type": "string"
                        }
                    },
                    "required": ["path", "operation", "unified_diff"]
                }
            }
        },
        "required": ["summary", "file_patches"]
    }))
}

fn proposal_repair_prompt(original_prompt: &str, raw_response: &str) -> String {
    format!(
        "A previous model answer for this task did not include a top-level JSON object, so it could not be parsed into a proposal.\n\n\
         Repair the answer by converting it into valid JSON that matches the required proposal schema.\n\
         Preserve the original intent and content where possible.\n\
         If the original answer is incomplete or unsafe, return an empty file_patches array and explain the limitation in summary.\n\
         Do not add markdown fences or commentary outside the JSON object.\n\n\
         Original task prompt:\n{original_prompt}\n\n\
         Original model answer:\n{raw_response}"
    )
}

fn invalid_response_snippet(raw_response: &str) -> String {
    let trimmed = raw_response.trim();
    if trimmed.is_empty() {
        return "<empty response>".to_owned();
    }

    let total_chars = trimmed.chars().count();
    if total_chars <= MAX_INVALID_RESPONSE_SNIPPET_CHARS {
        return trimmed.to_owned();
    }

    let snippet = trimmed
        .chars()
        .take(MAX_INVALID_RESPONSE_SNIPPET_CHARS)
        .collect::<String>();
    format!(
        "{snippet}\n...[truncated {} chars]",
        total_chars - MAX_INVALID_RESPONSE_SNIPPET_CHARS
    )
}

fn is_missing_json_object_error(error: &LLMError) -> bool {
    matches!(
        error,
        LLMError::InvalidResponse(message)
            if message == "Model response did not include a JSON object"
    )
}

fn diff_anchor_example(file_contexts: &[FileContext]) -> String {
    let Some(file) = file_contexts
        .iter()
        .find(|file| file.content.lines().any(|line| !line.trim().is_empty()))
    else {
        return String::new();
    };

    if let Some(anchor) = markdown_section_anchor_example(file) {
        return anchor;
    }

    let Some((anchor_line_number, anchor_line)) = file
        .content
        .lines()
        .enumerate()
        .find(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| (index + 1, line.trim_end()))
    else {
        return String::new();
    };

    if anchor_line.chars().count() > 120 {
        return String::new();
    }

    format!(
        "\nExact diff anchor for '{}' when modifying the first non-empty line (line {}):\n{{\n  \"summary\": \"short explanation\",\n  \"file_patches\": [\n    {{\n      \"path\": \"{}\",\n      \"operation\": \"modify\",\n      \"unified_diff\": \"@@ -{},1 +{},1 @@\\n-{}\\n+<replacement line with the same surrounding format>\\n\"\n    }}\n  ]\n}}\nCopy the '-' line exactly from Existing file contents if you modify that line.\n",
        file.path, anchor_line_number, file.path, anchor_line_number, anchor_line_number, anchor_line,
    )
}

fn markdown_section_anchor_example(file: &FileContext) -> Option<String> {
    if !file.path.to_ascii_lowercase().ends_with(".md") {
        return None;
    }

    let lines = file.content.lines().collect::<Vec<_>>();
    let title_line_index = lines
        .iter()
        .position(|line| !line.trim().is_empty())?;
    let (heading_line_index, heading_line) = lines
        .iter()
        .enumerate()
        .skip(title_line_index + 1)
        .find(|(_, line)| line.trim_start().starts_with('#'))?;
    let heading_line = heading_line.trim_end();
    if heading_line.chars().count() > 120 {
        return None;
    }

    let line_number = heading_line_index + 1;
    Some(format!(
        "\nExact diff anchor for '{}' when deepening the first empty section (line {}):\n{{\n  \"summary\": \"short explanation\",\n  \"file_patches\": [\n    {{\n      \"path\": \"{}\",\n      \"operation\": \"modify\",\n      \"unified_diff\": \"@@ -{},1 +{},3 @@\\n {}\\n+\\n+- Add a concrete implementation detail under this section.\\n\"\n    }}\n  ]\n}}\nDo not spend the proposal on a title-only or version-only edit when the document still has empty sections.\n",
        file.path, line_number, file.path, line_number, line_number, heading_line,
    ))
}

fn normalize_proposal_failure_reason(error: &LLMError) -> &'static str {
    match error {
        LLMError::InvalidResponse(message) => {
            if message.starts_with("Invalid proposal JSON:") {
                "invalid_response.proposal_json"
            } else if message.contains("Unified diff validation failed") {
                if message.contains("encountered an empty unified diff line without a prefix") {
                    "invalid_response.unified_diff.blank_line_without_prefix"
                } else if message.contains("context mismatch") {
                    "invalid_response.unified_diff.context_mismatch"
                } else if message.contains("context line referenced beyond end of file") {
                    "invalid_response.unified_diff.context_beyond_eof"
                } else if message.contains("new-line count mismatch") {
                    "invalid_response.unified_diff.new_line_count_mismatch"
                } else if message.contains("old-line count mismatch") {
                    "invalid_response.unified_diff.old_line_count_mismatch"
                } else if message.contains("removal mismatch") {
                    "invalid_response.unified_diff.removal_mismatch"
                } else {
                    "invalid_response.unified_diff.other"
                }
            } else if message.contains("must provide a unified diff") {
                "invalid_response.missing_required_unified_diff"
            } else if message.contains("missing unified_diff") {
                "invalid_response.missing_unified_diff_field"
            } else if message.contains("is not safe") {
                "invalid_response.unsafe_patch_path"
            } else {
                "invalid_response.other"
            }
        }
        LLMError::Provider(message) => {
            if message.starts_with("Ollama returned empty response content") {
                "provider.ollama_empty_content"
            } else if message.starts_with("HTTP 404") {
                "provider.http_404"
            } else if message.starts_with("HTTP 429") {
                "provider.http_429"
            } else if message.starts_with("HTTP 5") {
                "provider.http_5xx"
            } else if message.starts_with("HTTP ") {
                "provider.http_other"
            } else {
                "provider.other"
            }
        }
        LLMError::Timeout => "timeout",
        LLMError::Http(_) => "http_request",
    }
}

fn format_proposal_failure_counters(counters: &BTreeMap<(String, &'static str), u64>) -> String {
    counters
        .iter()
        .map(|((provider, reason), count)| format!("{provider}:{reason}={count}"))
        .collect::<Vec<_>>()
        .join(", ")
}

impl Agent {
    pub fn new(def: AgentDef, llm: Arc<dyn LLMProvider>) -> Self {
        Self { def, llm }
    }

    pub async fn propose(
        &self,
        context: &str,
        repo_path: &str,
        target_files: &[String],
        language: &str,
        metrics: &[MetricDef],
    ) -> Result<Proposal, LLMError> {
        let metrics_desc = metrics
            .iter()
            .map(|m| format!("- {} ({}): {}", m.name, m.direction, m.description))
            .collect::<Vec<_>>()
            .join("\n");
        let targets_desc = if target_files.is_empty() {
            "- no explicit targets".to_owned()
        } else {
            target_files
                .iter()
                .map(|target| format!("- {target}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let file_contexts = collect_file_contexts(repo_path, target_files, language)?;
        let allowed_paths = file_contexts
            .iter()
            .map(|file| file.path.clone())
            .collect::<HashSet<_>>();
        let suggested_create_paths = suggest_create_paths(target_files, language);
        let files_desc = if file_contexts.is_empty() {
            if supports_empty_target_creation_guidance(language)
                && !suggested_create_paths.is_empty()
            {
                format!(
                    "No existing target files were found. Create a new markdown file instead of returning an empty patch. Safe relative paths:\n{}",
                    suggested_create_paths
                        .iter()
                        .map(|path| format!("- {path}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            } else {
                "No existing target files were found. Return an empty file_patches array and explain why in summary.".to_owned()
            }
        } else {
            file_contexts
                .iter()
                .map(|file| format!("<file path=\"{}\">\n{}\n</file>", file.path, file.content,))
                .collect::<Vec<_>>()
                .join("\n\n")
        };
          let research_guidance = research_patch_guidance(language);
          let document_guidance = incremental_document_guidance(language, target_files, &file_contexts);
          let raw_content_fallback_guidance = raw_content_fallback_prompt_guidance(language, target_files);
          let diff_anchor = diff_anchor_example(&file_contexts);
          let prompt = format!(
            "Context:\n{context}\n\nTarget files:\n{targets_desc}\n\nMetrics to optimize:\n{metrics_desc}\n\n\
             Existing file contents:\n{files_desc}\n\n\
             {diff_anchor}\
             \n\
             Return valid JSON with this exact shape and no markdown fences:\n\
              {{\n  \"summary\": \"short explanation\",\n  \"file_patches\": [\n    {{ \"path\": \"relative/path\", \"operation\": \"modify\", \"unified_diff\": \"@@ -1,1 +1,2 @@\\n old line\\n+new line\" }}\n  ]\n}}\n\n\
              The strings \"old line\" and \"new line\" are placeholders only. Replace them with exact file content from Existing file contents if you emit a diff.\n\
              Use operation=create for new files, modify for existing files, delete for removals.\n\
              For create/delete, still provide a unified diff against the empty or prior file.\n\
              {raw_content_fallback_guidance}\n\
              Each patch must target exactly one safe relative path.\n\
              Do not invent paths outside the target patterns.\n\
               Keep changes narrow and preserve valid {language} syntax.\n\
               Unified diff rules are strict:\n\
               - Every line after a @@ hunk header must start with exactly one prefix: space for context, + for additions, - for removals, or \\ for the no-newline marker.\n\
               - Blank lines inside a hunk are never empty: emit a prefixed blank line such as ' ' for blank context or '+' for a blank added line.\n\
               - Never emit an empty line inside a hunk body.\n\
               - Do not include prose, explanations, markdown fences, or file headers inside unified_diff.\n\
               - When modifying an existing code file, preserve exact surrounding formatting from Existing file contents unless the changed lines require otherwise. Do not expand one-line code into multi-line code unless the diff counts and context exactly match the file.\n\
             - If Existing file contents show a one-line item such as 'pub fn baseline() {{}}', reuse that exact one-line text in the diff. Do not rewrite it as 'pub fn baseline() {{' and '}}' on separate lines.\n\
               - For code files such as Rust, TOML, or other source files, do not fall back to whole-file content. Return an empty file_patches array if you cannot produce an exact unified diff.\n\
               Example with a blank added line:\n\
               @@ -1,2 +1,3 @@\n\
              alpha\n\
               +\n\
              beta\n\
               If you are not confident that the JSON or unified diff will be exact, return an empty file_patches array and explain the limitation in summary.\n\
               A correct empty patch is better than malformed JSON or an invalid diff.{research_guidance}{document_guidance}"
        );
        let req = CompletionRequest {
            system: self.def.system_prompt.clone(),
            prompt,
            temperature: proposal_temperature(self.llm.provider_name()),
            max_tokens: proposal_max_tokens(language, target_files, self.llm.as_ref()),
            response_format: Some(proposal_response_format()),
        };
        let resp = self.llm.complete(&req).await?;
        match parse_proposal_payload(&resp.content, &file_contexts, &allowed_paths, target_files) {
            Ok(proposal) => Ok(proposal),
            Err(error) if is_missing_json_object_error(&error) => {
                warn!(
                    agent = %self.def.name,
                    provider = %self.llm.provider_name(),
                    model = %self.llm.model_name(),
                    parse_error = %error,
                    response_excerpt = %invalid_response_snippet(&resp.content),
                    "Proposal response omitted a top-level JSON object; attempting repair pass"
                );
                let repair_request = CompletionRequest {
                    system: self.def.system_prompt.clone(),
                    prompt: proposal_repair_prompt(&req.prompt, &resp.content),
                    temperature: 0.0,
                    max_tokens: proposal_max_tokens(language, target_files, self.llm.as_ref()),
                    response_format: Some(proposal_response_format()),
                };
                let repaired = self.llm.complete(&repair_request).await?;
                parse_proposal_payload(
                    &repaired.content,
                    &file_contexts,
                    &allowed_paths,
                    target_files,
                )
                .map_err(|repair_error| {
                    warn!(
                        agent = %self.def.name,
                        provider = %self.llm.provider_name(),
                        model = %self.llm.model_name(),
                        parse_error = %repair_error,
                        response_excerpt = %invalid_response_snippet(&repaired.content),
                        "Proposal repair response was still invalid"
                    );
                    LLMError::InvalidResponse(format!(
                        "Model response did not include a JSON object; repair pass failed: {repair_error}"
                    ))
                })
            }
            Err(error @ LLMError::InvalidResponse(_)) => {
                warn!(
                    agent = %self.def.name,
                    provider = %self.llm.provider_name(),
                    model = %self.llm.model_name(),
                    parse_error = %error,
                    response_excerpt = %invalid_response_snippet(&resp.content),
                    "Proposal response was invalid"
                );
                Err(error)
            }
            Err(error) => Err(error),
        }
    }

    pub async fn debate(
        &self,
        proposal: &Proposal,
        other_proposals: &[Proposal],
    ) -> Result<String, LLMError> {
        let others = other_proposals
            .iter()
            .map(|p| format!("- {}", p.summary))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "Your proposal: {}\n\nOther proposals:\n{others}\n\n\
             Critique the other proposals and defend yours briefly.",
            proposal.summary
        );
        let req = CompletionRequest {
            system: self.def.system_prompt.clone(),
            prompt,
            temperature: 0.5,
            max_tokens: 256,
            response_format: None,
        };
        let resp = self.llm.complete(&req).await?;
        Ok(resp.content.trim().to_owned())
    }

    pub fn name(&self) -> &str {
        &self.def.name
    }

    pub fn provider_name(&self) -> &str {
        self.llm.provider_name()
    }
}

pub struct Council {
    agents: Vec<Agent>,
    debate_rounds: u32,
    last_proposal_failure_counters: Mutex<BTreeMap<String, u64>>,
}

struct CouncilProposal {
    agent_index: usize,
    agent_name: String,
    proposal: Proposal,
}

impl Council {
    pub fn new(agents: Vec<Agent>, debate_rounds: u32) -> Self {
        Self {
            agents,
            debate_rounds,
            last_proposal_failure_counters: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn last_proposal_failure_counters(&self) -> BTreeMap<String, u64> {
        self.last_proposal_failure_counters
            .lock()
            .map(|counters| counters.clone())
            .unwrap_or_default()
    }

    pub async fn run(
        &self,
        context: &str,
        repo_path: &str,
        target_files: &[String],
        language: &str,
        metrics: &[MetricDef],
    ) -> Result<Proposal, LLMError> {
        if self.agents.is_empty() {
            return Err(LLMError::Provider("Council has no agents".into()));
        }

        let proposal_round_started = Instant::now();
        let proposal_results = join_all(self.agents.iter().enumerate().map(
            |(agent_index, agent)| async move {
                let started = Instant::now();
                let result = agent
                    .propose(context, repo_path, target_files, language, metrics)
                    .await;
                (
                    agent_index,
                    agent.name().to_owned(),
                    agent.provider_name().to_owned(),
                    started.elapsed(),
                    result,
                )
            },
        ))
        .await;

        let mut proposals = Vec::new();
        let mut proposal_failure_counters = BTreeMap::new();
        for (agent_index, agent_name, provider_name, duration, result) in proposal_results {
            match result {
                Ok(proposal) => {
                    info!(
                        agent = %agent_name,
                        provider = %provider_name,
                        duration_ms = duration.as_millis() as u64,
                        "Council proposal completed"
                    );
                    proposals.push(CouncilProposal {
                        agent_index,
                        agent_name,
                        proposal,
                    });
                }
                Err(error) => {
                    let failure_reason = normalize_proposal_failure_reason(&error);
                    *proposal_failure_counters
                        .entry((provider_name.clone(), failure_reason))
                        .or_insert(0) += 1;
                    warn!(
                        agent = %agent_name,
                        provider = %provider_name,
                        duration_ms = duration.as_millis() as u64,
                        failure_reason = %failure_reason,
                        error = %error,
                        "Council proposal failed"
                    );
                }
            }
        }

        let failed_proposals = proposal_failure_counters.values().sum::<u64>();
        if let Ok(mut counters) = self.last_proposal_failure_counters.lock() {
            *counters = proposal_failure_counters
                .iter()
                .map(|((provider, failure_reason), count)| {
                    (format!("{provider}:{failure_reason}"), *count)
                })
                .collect();
        }
        if !proposal_failure_counters.is_empty() {
            for ((provider, failure_reason), count) in &proposal_failure_counters {
                warn!(
                    provider = %provider,
                    failure_reason = %failure_reason,
                    count = *count,
                    "Council proposal failure counter"
                );
            }
        }

        info!(
            duration_ms = proposal_round_started.elapsed().as_millis() as u64,
            requested_agents = self.agents.len(),
            successful_proposals = proposals.len(),
            failed_proposals,
            proposal_failure_counters = %format_proposal_failure_counters(&proposal_failure_counters),
            "Council proposal round finished"
        );

        if proposals.is_empty() {
            return Err(LLMError::Provider("All agents failed to propose".into()));
        }

        for round in 0..self.debate_rounds {
            let round_started = Instant::now();
            for (proposal_index, proposal_entry) in proposals.iter().enumerate() {
                let agent = &self.agents[proposal_entry.agent_index];
                let others: Vec<Proposal> = proposals
                    .iter()
                    .enumerate()
                    .filter(|(other_index, _)| *other_index != proposal_index)
                    .map(|(_, proposal)| proposal.proposal.clone())
                    .collect();
                // The debate critique is logged via tracing but does not currently
                // mutate the proposal. In Phase 2 this will feed back into a
                // synthesis step that produces a refined consensus proposal.
                let debate_started = Instant::now();
                if let Ok(critique) = agent.debate(&proposal_entry.proposal, &others).await {
                    debug!(
                        agent = %proposal_entry.agent_name,
                        round = round + 1,
                        duration_ms = debate_started.elapsed().as_millis() as u64,
                        critique = %critique,
                        "Debate round critique"
                    );
                }
            }

            info!(
                round = round + 1,
                duration_ms = round_started.elapsed().as_millis() as u64,
                active_agents = proposals.len(),
                "Council debate round finished"
            );
        }

        Ok(proposals.remove(0).proposal)
    }
}

fn parse_proposal_payload(
    raw_response: &str,
    file_contexts: &[FileContext],
    allowed_paths: &HashSet<String>,
    target_files: &[String],
) -> Result<Proposal, LLMError> {
    let json = extract_json_object(raw_response)?;
    let payload: ProposalPayload = serde_json::from_str(&json)
        .map_err(|error| LLMError::InvalidResponse(format!("Invalid proposal JSON: {error}")))?;
    let file_lookup = file_contexts
        .iter()
        .map(|file| (file.path.as_str(), file.content.as_str()))
        .collect::<std::collections::HashMap<_, _>>();

    if payload.summary.trim().is_empty() {
        return Err(LLMError::InvalidResponse(
            "Proposal summary cannot be empty".to_owned(),
        ));
    }

    let mut file_patches = Vec::with_capacity(payload.file_patches.len());
    for patch in &payload.file_patches {
        if patch.path.trim().is_empty() {
            return Err(LLMError::InvalidResponse(
                "Proposal patch path cannot be empty".to_owned(),
            ));
        }
        let patch_path = Path::new(&patch.path);
        if patch_path.is_absolute()
            || patch_path
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(LLMError::InvalidResponse(format!(
                "Proposal patch path '{}' is not safe",
                patch.path
            )));
        }

        let file_exists = allowed_paths.contains(&patch.path);
        let operation = if patch.operation == FilePatchOperation::Modify
            && !file_exists
            && path_matches_targets(target_files, &patch.path)
        {
            FilePatchOperation::Create
        } else {
            patch.operation
        };

        match operation {
            FilePatchOperation::Modify | FilePatchOperation::Delete if !file_exists => {
                return Err(LLMError::InvalidResponse(format!(
                    "Proposal patch path '{}' must already exist for {:?} operations",
                    patch.path, operation
                )));
            }
            FilePatchOperation::Create if file_exists => {
                return Err(LLMError::InvalidResponse(format!(
                    "Proposal patch path '{}' already exists and cannot be created again",
                    patch.path
                )));
            }
            FilePatchOperation::Create if !path_matches_targets(target_files, &patch.path) => {
                return Err(LLMError::InvalidResponse(format!(
                    "Proposal patch path '{}' is outside the configured target patterns",
                    patch.path
                )));
            }
            _ => {}
        }

        let diff = patch.unified_diff.as_deref().ok_or_else(|| {
            LLMError::InvalidResponse(format!(
                "Proposal patch '{}' is missing unified_diff",
                patch.path
            ))
        })?;
        let original_content = file_lookup.get(patch.path.as_str()).copied();
        let raw_fallback_allowed = supports_raw_content_fallback(&patch.path, operation)
            && !exact_existing_markdown_target_disallows_raw_fallback(
                &patch.path,
                operation,
                target_files,
            );
        let exact_markdown_target = exact_existing_markdown_target_disallows_raw_fallback(
            &patch.path,
            operation,
            target_files,
        );
        let result = if looks_like_unified_diff(diff) {
            match apply_unified_diff(original_content, diff, operation) {
                Ok(result) => result,
                Err(error) if exact_markdown_target => {
                    if let Ok(result) = apply_unified_diff_with_trimmed_leading_blank_lines(
                        original_content,
                        diff,
                        operation,
                    ) {
                        result
                    } else if let Some(recovered) = recover_text_from_diffish_payload(diff)
                        .filter(|content| has_substantive_markdown_content(content))
                    {
                        apply_raw_content_fallback(&recovered, operation).map_err(
                            |fallback_error| {
                                LLMError::InvalidResponse(format!(
                                    "Unified diff validation failed for '{}': {error}; substantive markdown recovery failed: {fallback_error}",
                                    patch.path
                                ))
                            },
                        )?
                    } else {
                        return Err(LLMError::InvalidResponse(format!(
                            "Unified diff validation failed for '{}': {error}",
                            patch.path
                        )));
                    }
                }
                Err(error) if raw_fallback_allowed => {
                    let recovered = recover_text_from_diffish_payload(diff).ok_or_else(|| {
                        LLMError::InvalidResponse(format!(
                            "Unified diff validation failed for '{}': {error}",
                            patch.path
                        ))
                    })?;
                    apply_raw_content_fallback(&recovered, operation).map_err(|fallback_error| {
                        LLMError::InvalidResponse(format!(
                            "Unified diff validation failed for '{}': {error}; raw fallback failed: {fallback_error}",
                            patch.path
                        ))
                    })?
                }
                Err(error) => {
                    return Err(LLMError::InvalidResponse(format!(
                        "Unified diff validation failed for '{}': {error}",
                        patch.path
                    )));
                }
            }
        } else if raw_fallback_allowed {
            apply_raw_content_fallback(diff, operation).map_err(|error| {
                LLMError::InvalidResponse(format!(
                    "Raw content fallback failed for '{}': {error}",
                    patch.path
                ))
            })?
        } else if exact_markdown_target {
            if has_substantive_markdown_content(diff) {
                apply_raw_content_fallback(diff, operation).map_err(|error| {
                    LLMError::InvalidResponse(format!(
                        "Raw substantive markdown fallback failed for '{}': {error}",
                        patch.path
                    ))
                })?
            } else {
                return Err(LLMError::InvalidResponse(format!(
                    "Proposal patch '{}' must provide a valid unified diff or substantive markdown content for existing exact markdown document targets",
                    patch.path
                )));
            }
        } else {
            return Err(LLMError::InvalidResponse(format!(
                "Proposal patch '{}' must provide a unified diff for this file type",
                patch.path
            )));
        };
        if exact_markdown_target
            && original_content.is_some_and(|existing| !has_substantive_markdown_content(existing))
            && result
                .content
                .as_deref()
                .is_some_and(|content| !has_substantive_markdown_content(content))
        {
            return Err(LLMError::InvalidResponse(format!(
                "Proposal patch '{}' must add substantive section content when refining an exact markdown scaffold",
                patch.path
            )));
        }
        file_patches.push(FilePatch {
            path: patch.path.clone(),
            operation,
            content: result.content,
        });
    }

    Ok(Proposal {
        summary: payload.summary.trim().to_owned(),
        file_patches,
    })
}

fn apply_unified_diff(
    original: Option<&str>,
    diff: &str,
    operation: FilePatchOperation,
) -> Result<DiffApplyResult, String> {
    let had_original = original.is_some();
    let original = original.unwrap_or("");
    let (original_lines, original_has_trailing_newline) = split_preserving_eof(original);
    let diff_lines = diff.lines().collect::<Vec<_>>();
    let mut output = Vec::new();
    let mut source_index = 0usize;
    let mut line_index = 0usize;
    let mut saw_hunk = false;
    let mut result_has_trailing_newline = original_has_trailing_newline;

    while line_index < diff_lines.len() {
        let line = diff_lines[line_index];
        if line.starts_with("--- ") || line.starts_with("+++ ") || line.starts_with("diff --git") {
            line_index += 1;
            continue;
        }
        if !line.starts_with("@@") {
            return Err(format!("unexpected diff line '{}'", line));
        }
        saw_hunk = true;

        let (old_start, expected_old, expected_new) = parse_hunk_header(line)?;
        let target_index = if old_start == 0 { 0 } else { old_start - 1 };
        if target_index < source_index {
            return Err("diff hunks overlap or go backwards".to_owned());
        }
        while source_index < target_index {
            if source_index >= original_lines.len() {
                return Err(format!(
                    "hunk header references line {} beyond end of file ({})",
                    target_index + 1,
                    original_lines.len()
                ));
            }
            output.push(original_lines[source_index].clone());
            source_index += 1;
        }

        line_index += 1;
        let mut consumed_old = 0usize;
        let mut consumed_new = 0usize;
        let mut last_line_had_no_newline = false;
        let mut last_prefix = None;
        while line_index < diff_lines.len() {
            let hunk_line = diff_lines[line_index];
            if hunk_line.starts_with("@@") {
                break;
            }
            if hunk_line.starts_with("--- ")
                || hunk_line.starts_with("+++ ")
                || hunk_line.starts_with("diff --git")
            {
                break;
            }
            if hunk_line == "\\ No newline at end of file" {
                if last_prefix.is_none() {
                    return Err("newline marker must follow a diff line".to_owned());
                }
                last_line_had_no_newline = true;
                line_index += 1;
                continue;
            }

            if hunk_line.is_empty() {
                return Err("encountered an empty unified diff line without a prefix".to_owned());
            }

            let (prefix, text) = hunk_line.split_at(1);
            if last_line_had_no_newline {
                match last_prefix {
                    Some(' ') => {
                        result_has_trailing_newline = false;
                    }
                    Some('-') => {}
                    Some('+') => {
                        result_has_trailing_newline = false;
                    }
                    _ => {}
                }
                last_line_had_no_newline = false;
            }
            match prefix {
                " " => {
                    let current = original_lines
                        .get(source_index)
                        .ok_or_else(|| "context line referenced beyond end of file".to_owned())?;
                    if current != text {
                        return Err(format!(
                            "context mismatch: expected '{}', found '{}'",
                            text, current
                        ));
                    }
                    output.push(current.clone());
                    source_index += 1;
                    consumed_old += 1;
                    consumed_new += 1;
                }
                "-" => {
                    let current = original_lines
                        .get(source_index)
                        .ok_or_else(|| "removal line referenced beyond end of file".to_owned())?;
                    if current != text {
                        return Err(format!(
                            "removal mismatch: expected '{}', found '{}'",
                            text, current
                        ));
                    }
                    source_index += 1;
                    consumed_old += 1;
                }
                "+" => {
                    output.push(text.to_owned());
                    consumed_new += 1;
                }
                _ => return Err(format!("unsupported unified diff prefix '{}'", prefix)),
            }
            last_prefix = prefix.chars().next();
            if matches!(last_prefix, Some('+')) {
                result_has_trailing_newline = true;
            }
            line_index += 1;
        }

        if last_line_had_no_newline {
            match last_prefix {
                Some(' ') => {
                    result_has_trailing_newline = false;
                }
                Some('-') => {
                    result_has_trailing_newline = expected_new == 0;
                }
                Some('+') => {
                    result_has_trailing_newline = false;
                }
                _ => {}
            }
        }

        if consumed_old != expected_old {
            return Err(format!(
                "old-line count mismatch: expected {}, got {}",
                expected_old, consumed_old
            ));
        }
        if consumed_new != expected_new {
            return Err(format!(
                "new-line count mismatch: expected {}, got {}",
                expected_new, consumed_new
            ));
        }
    }

    if !saw_hunk {
        return Err("unified diff did not contain any hunks".to_owned());
    }

    while source_index < original_lines.len() {
        output.push(original_lines[source_index].clone());
        source_index += 1;
    }

    let content = if operation == FilePatchOperation::Delete {
        if !output.is_empty() {
            return Err("delete patch must remove the full file content".to_owned());
        }
        None
    } else {
        let mut result = output.join("\n");
        if result_has_trailing_newline {
            result.push('\n');
        }
        Some(result)
    };

    match operation {
        FilePatchOperation::Create if had_original => {
            return Err("create patch expected an empty original file".to_owned());
        }
        FilePatchOperation::Create if content.as_deref().is_some_and(str::is_empty) => {
            return Err("create patch must add file content".to_owned());
        }
        FilePatchOperation::Modify if content.is_none() => {
            return Err("modify patch cannot delete the file".to_owned());
        }
        FilePatchOperation::Delete if !had_original => {
            return Err("delete patch expected an existing file".to_owned());
        }
        _ => {}
    }

    Ok(DiffApplyResult {
        content,
        had_trailing_newline: result_has_trailing_newline,
    })
}

fn looks_like_unified_diff(diff: &str) -> bool {
    let trimmed = diff.trim_start();
    trimmed.starts_with("@@")
        || trimmed.starts_with("--- ")
        || trimmed.starts_with("+++ ")
        || trimmed.starts_with("diff --git")
}

fn supports_raw_content_fallback(path: &str, operation: FilePatchOperation) -> bool {
    if matches!(operation, FilePatchOperation::Delete) {
        return false;
    }

    let lower = path.to_ascii_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".json")
        || lower.ends_with(".txt")
        || lower.ends_with("readme")
        || lower.ends_with("readme.md")
}

fn apply_raw_content_fallback(
    content: &str,
    operation: FilePatchOperation,
) -> Result<DiffApplyResult, String> {
    if matches!(operation, FilePatchOperation::Delete) {
        return Err("raw content fallback is not supported for delete patches".to_owned());
    }

    if content.trim().is_empty() {
        return Err("raw content fallback cannot be empty".to_owned());
    }

    Ok(DiffApplyResult {
        content: Some(content.to_owned()),
        had_trailing_newline: content.ends_with('\n'),
    })
}

fn apply_unified_diff_with_trimmed_leading_blank_lines(
    original: Option<&str>,
    diff: &str,
    operation: FilePatchOperation,
) -> Result<DiffApplyResult, String> {
    let Some(original) = original else {
        return Err("leading-blank-line retry requires an existing file".to_owned());
    };

    let leading_blank_prefix = leading_blank_prefix(original);
    if leading_blank_prefix.is_empty() {
        return Err("existing file does not start with leading blank lines".to_owned());
    }

    let trimmed_original = &original[leading_blank_prefix.len()..];
    let mut reapplied = apply_unified_diff(Some(trimmed_original), diff, operation)?;
    if let Some(content) = reapplied.content.as_mut() {
        let mut combined = leading_blank_prefix.to_owned();
        combined.push_str(content);
        *content = combined;
    }
    Ok(reapplied)
}

fn leading_blank_prefix(content: &str) -> &str {
    let mut prefix_len = 0usize;
    let mut saw_blank = false;

    for segment in content.split_inclusive('\n') {
        if segment.trim().is_empty() {
            prefix_len += segment.len();
            saw_blank = true;
        } else {
            break;
        }
    }

    if saw_blank {
        &content[..prefix_len]
    } else {
        ""
    }
}

fn has_substantive_markdown_content(content: &str) -> bool {
    content.lines().any(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            return false;
        }

        let stripped = trimmed
            .trim_start_matches(['-', '*', '+', ' '])
            .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == ')')
            .trim();
        stripped.chars().any(|ch| ch.is_alphanumeric()) && stripped.len() >= 8
    })
}

fn recover_text_from_diffish_payload(diff: &str) -> Option<String> {
    let mut recovered = Vec::new();

    for line in diff.lines() {
        if line.starts_with("@@")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("diff --git")
        {
            continue;
        }

        if line == "\\ No newline at end of file" {
            continue;
        }

        if let Some(stripped) = line.strip_prefix('+') {
            recovered.push(stripped.to_owned());
            continue;
        }

        if let Some(stripped) = line.strip_prefix(' ') {
            recovered.push(stripped.to_owned());
            continue;
        }

        if line.starts_with('-') {
            continue;
        }

        recovered.push(line.to_owned());
    }

    if recovered.is_empty() {
        None
    } else {
        Some(format!("{}\n", recovered.join("\n")))
    }
}

fn split_preserving_eof(content: &str) -> (Vec<String>, bool) {
    if content.is_empty() {
        return (Vec::new(), false);
    }

    let has_trailing_newline = content.ends_with('\n');
    let trimmed = if has_trailing_newline {
        &content[..content.len() - 1]
    } else {
        content
    };

    let lines = if trimmed.is_empty() {
        Vec::new()
    } else {
        trimmed.split('\n').map(ToOwned::to_owned).collect()
    };

    (lines, has_trailing_newline)
}

fn parse_hunk_header(header: &str) -> Result<(usize, usize, usize), String> {
    let trimmed = header
        .strip_prefix("@@")
        .and_then(|value| value.split("@@").next())
        .map(str::trim)
        .ok_or_else(|| format!("invalid hunk header '{}'", header))?;
    let mut parts = trimmed.split_whitespace();
    let old_range = parts
        .next()
        .ok_or_else(|| format!("missing old range in '{}'", header))?;
    let new_range = parts
        .next()
        .ok_or_else(|| format!("missing new range in '{}'", header))?;
    let (old_start, old_count) = parse_range(old_range, '-')?;
    let (_, new_count) = parse_range(new_range, '+')?;
    Ok((old_start, old_count, new_count))
}

fn parse_range(range: &str, prefix: char) -> Result<(usize, usize), String> {
    let value = range
        .strip_prefix(prefix)
        .ok_or_else(|| format!("range '{}' is missing prefix '{}'", range, prefix))?;
    if let Some((start, count)) = value.split_once(',') {
        Ok((
            start
                .parse::<usize>()
                .map_err(|error| format!("invalid start '{}': {error}", start))?,
            count
                .parse::<usize>()
                .map_err(|error| format!("invalid count '{}': {error}", count))?,
        ))
    } else {
        Ok((
            value
                .parse::<usize>()
                .map_err(|error| format!("invalid start '{}': {error}", value))?,
            1,
        ))
    }
}

fn extract_json_object(raw_response: &str) -> Result<String, LLMError> {
    let trimmed = raw_response.trim();
    let cleaned = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };

    let start = cleaned.find('{').ok_or_else(|| {
        LLMError::InvalidResponse("Model response did not include a JSON object".to_owned())
    })?;
    let end = cleaned.rfind('}').ok_or_else(|| {
        LLMError::InvalidResponse("Model response did not include a closing JSON brace".to_owned())
    })?;

    Ok(cleaned[start..=end].to_owned())
}

fn collect_file_contexts(
    repo_path: &str,
    target_files: &[String],
    language: &str,
) -> Result<Vec<FileContext>, LLMError> {
    let repo_root = resolve_repo_root(repo_path)?;
    let mut candidates = Vec::new();
    collect_matching_files(
        &repo_root,
        &repo_root,
        target_files,
        language,
        &mut candidates,
    )?;
    candidates.sort();
    candidates.truncate(MAX_CONTEXT_FILES);

    let mut contexts = Vec::new();
    for path in candidates {
        let relative = path
            .strip_prefix(&repo_root)
            .map_err(|error| LLMError::Provider(format!("Failed to strip repo prefix: {error}")))?
            .to_string_lossy()
            .replace('\\', "/");

        let content = fs::read_to_string(&path).map_err(|error| {
            LLMError::Provider(format!("Failed to read '{}': {error}", relative))
        })?;
        let truncated = if content.chars().count() > MAX_FILE_CHARS {
            content.chars().take(MAX_FILE_CHARS).collect::<String>()
        } else {
            content
        };
        contexts.push(FileContext {
            path: relative,
            content: truncated,
        });
    }

    Ok(contexts)
}

fn suggest_create_paths(target_files: &[String], language: &str) -> Vec<String> {
    let mut suggestions = Vec::new();

    for pattern in target_files {
        let Some(path) = suggest_create_path(pattern, language) else {
            continue;
        };

        if !suggestions.contains(&path) {
            suggestions.push(path);
        }
    }

    suggestions
}

fn suggest_create_path(pattern: &str, language: &str) -> Option<String> {
    let normalized = pattern.trim().replace('\\', "/");

    if !normalized.contains('*') && Path::new(normalized.as_str()).extension().is_some() {
        return Some(normalized);
    }

    let prefix = normalized
        .split("**")
        .next()
        .unwrap_or(normalized.as_str())
        .split('*')
        .next()
        .unwrap_or(normalized.as_str())
        .trim_end_matches('/');

    if prefix.is_empty() {
        return None;
    }

    let file_name = match language.to_ascii_lowercase().as_str() {
        "research" => "research-brief.md",
        "markdown" | "prompt" => "draft.md",
        "lora" => "run-report.json",
        _ => return None,
    };

    Some(format!("{prefix}/{file_name}"))
}

fn supports_empty_target_creation_guidance(language: &str) -> bool {
    matches!(
        language.to_ascii_lowercase().as_str(),
        "research" | "markdown" | "prompt"
    )
}

fn resolve_repo_root(repo_path: &str) -> Result<PathBuf, LLMError> {
    let path = PathBuf::from(repo_path);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| LLMError::Provider(format!("Failed to read current dir: {error}")))?
            .join(path)
    };

    resolved.canonicalize().map_err(|error| {
        LLMError::Provider(format!(
            "Failed to resolve repository path '{}': {error}",
            repo_path
        ))
    })
}

fn collect_matching_files(
    repo_root: &Path,
    current_dir: &Path,
    target_files: &[String],
    language: &str,
    output: &mut Vec<PathBuf>,
) -> Result<(), LLMError> {
    for entry in fs::read_dir(current_dir).map_err(|error| {
        LLMError::Provider(format!(
            "Failed to read '{}': {error}",
            current_dir.display()
        ))
    })? {
        let entry = entry
            .map_err(|error| LLMError::Provider(format!("Failed to inspect dir entry: {error}")))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| LLMError::Provider(format!("Failed to inspect file type: {error}")))?;

        if file_type.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if matches!(name.as_ref(), ".git" | "target" | ".idea") {
                continue;
            }
            collect_matching_files(repo_root, &path, target_files, language, output)?;
            continue;
        }

        let relative = match path.strip_prefix(repo_root) {
            Ok(value) => value.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        if !target_files.is_empty() {
            if !target_files
                .iter()
                .any(|pattern| target_pattern_matches(pattern, &relative))
            {
                continue;
            }
        } else if !is_text_path(&relative, language) {
            continue;
        }

        if !is_text_path(&relative, language) {
            continue;
        }

        output.push(path);
    }

    Ok(())
}

fn target_pattern_matches(pattern: &str, path: &str) -> bool {
    if pattern == path {
        return true;
    }

    if let Some((prefix, suffix)) = pattern.split_once("**") {
        let suffix = suffix.trim_start_matches('/');
        let prefix = prefix.trim_end_matches('/');
        return (prefix.is_empty() || path.starts_with(prefix))
            && (suffix.is_empty() || path.ends_with(suffix.trim_start_matches('*')));
    }

    if let Some(extension) = pattern
        .rsplit('.')
        .next()
        .filter(|segment| *segment != pattern)
    {
        let prefix = pattern.split('*').next().unwrap_or("");
        return path.ends_with(&format!(".{extension}"))
            && (prefix.is_empty() || path.starts_with(prefix));
    }

    pattern
        .split('*')
        .next()
        .map(|prefix| !prefix.is_empty() && path.starts_with(prefix))
        .unwrap_or(false)
}

fn path_matches_targets(target_files: &[String], path: &str) -> bool {
    if target_files.is_empty() {
        return false;
    }

    target_files
        .iter()
        .any(|pattern| target_pattern_matches(pattern, path))
}

fn is_text_path(path: &str, language: &str) -> bool {
    match language.to_ascii_lowercase().as_str() {
        "markdown" | "prompt" => path.ends_with(".md"),
        "lora" => path.ends_with(".json") || path.ends_with("README.md"),
        _ => path.ends_with(".rs") || path.ends_with(".md") || path.ends_with(".toml"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::MockProvider;
    use crate::llm::pool::{ModelPool, PoolMember};
    use crate::llm::{CompletionRequest, CompletionResponse, LLMProvider};
    use async_trait::async_trait;
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;
    use tokio::sync::Barrier;
    use tokio::time::{Duration, timeout};

    struct BarrierProvider {
        model: String,
        barrier: Arc<Barrier>,
    }

    #[async_trait]
    impl LLMProvider for BarrierProvider {
        async fn complete(
            &self,
            _request: &CompletionRequest,
        ) -> Result<CompletionResponse, LLMError> {
            self.barrier.wait().await;
            Ok(CompletionResponse {
                content: format!(
                    "{{\n  \"summary\": \"{} proposal\",\n  \"file_patches\": [\n    {{\n      \"path\": \"src/lib.rs\",\n      \"operation\": \"modify\",\n      \"unified_diff\": \"@@ -1,1 +1,1 @@\\n-pub fn baseline() {{}}\\n+pub fn {}() {{}}\\n\"\n    }}\n  ]\n}}",
                    self.model, self.model,
                ),
                tokens_used: 8,
                latency: Duration::from_millis(1),
            })
        }

        fn provider_name(&self) -> &str {
            "barrier"
        }

        fn model_name(&self) -> &str {
            &self.model
        }
    }

    struct SequenceProvider {
        provider: &'static str,
        model: &'static str,
        responses: StdMutex<VecDeque<&'static str>>,
    }

    impl SequenceProvider {
        fn new(provider: &'static str, model: &'static str, responses: Vec<&'static str>) -> Self {
            Self {
                provider,
                model,
                responses: StdMutex::new(responses.into()),
            }
        }
    }

    #[async_trait]
    impl LLMProvider for SequenceProvider {
        async fn complete(
            &self,
            _request: &CompletionRequest,
        ) -> Result<CompletionResponse, LLMError> {
            let content = self
                .responses
                .lock()
                .expect("responses lock")
                .pop_front()
                .expect("response should be queued");
            Ok(CompletionResponse {
                content: content.to_owned(),
                tokens_used: 8,
                latency: Duration::from_millis(1),
            })
        }

        fn provider_name(&self) -> &str {
            self.provider
        }

        fn model_name(&self) -> &str {
            self.model
        }
    }

    struct RecordingProvider {
        provider: &'static str,
        model: &'static str,
        configured_max_tokens: Option<u32>,
        seen_max_tokens: StdMutex<Vec<u32>>,
        response: &'static str,
    }

    impl RecordingProvider {
        fn new(
            provider: &'static str,
            model: &'static str,
            configured_max_tokens: Option<u32>,
            response: &'static str,
        ) -> Self {
            Self {
                provider,
                model,
                configured_max_tokens,
                seen_max_tokens: StdMutex::new(Vec::new()),
                response,
            }
        }

        fn last_seen_max_tokens(&self) -> Option<u32> {
            self.seen_max_tokens
                .lock()
                .expect("seen_max_tokens lock")
                .last()
                .copied()
        }
    }

    #[async_trait]
    impl LLMProvider for RecordingProvider {
        async fn complete(
            &self,
            request: &CompletionRequest,
        ) -> Result<CompletionResponse, LLMError> {
            self.seen_max_tokens
                .lock()
                .expect("seen_max_tokens lock")
                .push(request.max_tokens);
            Ok(CompletionResponse {
                content: self.response.to_owned(),
                tokens_used: 8,
                latency: Duration::from_millis(1),
            })
        }

        fn provider_name(&self) -> &str {
            self.provider
        }

        fn model_name(&self) -> &str {
            self.model
        }

        fn configured_max_tokens(&self) -> Option<u32> {
            self.configured_max_tokens
        }
    }

    #[tokio::test]
    async fn parses_structured_llm_patch_payload() {
        let repo_root =
            std::env::temp_dir().join(format!("maabarium-agent-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(repo_root.join("src")).expect("temp repo should be created");
        fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
            .expect("source file should be written");

        let agent = Agent::new(
            AgentDef {
                name: "engineer".into(),
                role: "engineer".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "mock".into(),
            },
            Arc::new(MockProvider::new("mock")),
        );

        let proposal = agent
            .propose(
                "Improve the baseline function",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["src/**/*.rs".into()],
                "rust",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect("proposal should parse");

        assert_eq!(proposal.file_patches.len(), 1);
        assert_eq!(proposal.file_patches[0].path, "src/lib.rs");
        assert_eq!(
            proposal.file_patches[0].operation,
            FilePatchOperation::Modify
        );
        assert!(
            proposal.file_patches[0]
                .content
                .as_deref()
                .expect("content should exist")
                .contains("maabarium_improvement")
        );

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn runs_council_proposals_concurrently() {
        let repo_root =
            std::env::temp_dir().join(format!("maabarium-council-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(repo_root.join("src")).expect("temp repo should be created");
        fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
            .expect("source file should be written");

        let barrier = Arc::new(Barrier::new(2));
        let council = Council::new(
            vec![
                Agent::new(
                    AgentDef {
                        name: "alpha".into(),
                        role: "engineer".into(),
                        system_prompt: "Return valid patch payloads".into(),
                        model: "alpha".into(),
                    },
                    Arc::new(BarrierProvider {
                        model: "alpha".into(),
                        barrier: Arc::clone(&barrier),
                    }),
                ),
                Agent::new(
                    AgentDef {
                        name: "beta".into(),
                        role: "engineer".into(),
                        system_prompt: "Return valid patch payloads".into(),
                        model: "beta".into(),
                    },
                    Arc::new(BarrierProvider {
                        model: "beta".into(),
                        barrier,
                    }),
                ),
            ],
            0,
        );

        let proposal = timeout(
            Duration::from_millis(200),
            council.run(
                "Improve the baseline function",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["src/**/*.rs".into()],
                "rust",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            ),
        )
        .await
        .expect("proposal generation should not serialize across agents")
        .expect("proposal generation should succeed");

        assert_eq!(proposal.summary, "alpha proposal");
        assert_eq!(proposal.file_patches[0].path, "src/lib.rs");

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn repairs_missing_json_object_with_same_provider() {
        let repo_root =
            std::env::temp_dir().join(format!("maabarium-agent-repair-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(repo_root.join("docs")).expect("temp repo should be created");
        fs::write(repo_root.join("docs/brief.md"), "# Brief\n\nOld content.\n")
            .expect("source file should be written");

        let agent = Agent::new(
            AgentDef {
                name: "researcher".into(),
                role: "researcher".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "repair-model".into(),
            },
            Arc::new(SequenceProvider::new(
                "ollama",
                "repair-model",
                vec![
                    "Here is the repaired brief in markdown:\n\n# Brief\n\nNew cited content.\n",
                    r##"{
  "summary": "Rewrite the brief with cited content.",
  "file_patches": [
    {
      "path": "docs/brief.md",
      "operation": "modify",
      "unified_diff": "# Brief\n\nNew cited content.\n"
    }
  ]
}"##,
                ],
            )),
        );

        let proposal = agent
            .propose(
                "Refresh the research brief",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["docs/**/*.md".into()],
                "research",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect("repair pass should recover the proposal");

        assert_eq!(proposal.summary, "Rewrite the brief with cited content.");
        assert_eq!(proposal.file_patches.len(), 1);
        assert_eq!(proposal.file_patches[0].path, "docs/brief.md");
        assert_eq!(
            proposal.file_patches[0].content.as_deref(),
            Some("# Brief\n\nNew cited content.\n")
        );

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn repairs_missing_json_object_through_model_pool_fallback() {
        let repo_root = std::env::temp_dir().join(format!(
            "maabarium-agent-repair-pool-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(repo_root.join("docs")).expect("temp repo should be created");
        fs::write(repo_root.join("docs/brief.md"), "# Brief\n\nOld content.\n")
            .expect("source file should be written");

        let pool = ModelPool::new(vec![
            PoolMember::new(
                Arc::new(SequenceProvider::new(
                    "ollama",
                    "primary-model",
                    vec!["Draft answer without JSON."],
                )),
                None,
            ),
            PoolMember::new(
                Arc::new(SequenceProvider::new(
                    "ollama",
                    "fallback-model",
                    vec![
                        r##"{
  "summary": "Repair the brief through the fallback model.",
  "file_patches": [
    {
      "path": "docs/brief.md",
      "operation": "modify",
      "unified_diff": "# Brief\n\nFallback content.\n"
    }
  ]
}"##,
                    ],
                )),
                None,
            ),
        ]);

        let agent = Agent::new(
            AgentDef {
                name: "researcher".into(),
                role: "researcher".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "pool".into(),
            },
            Arc::new(pool),
        );

        let proposal = agent
            .propose(
                "Refresh the research brief",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["docs/**/*.md".into()],
                "research",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect("fallback model should repair the proposal");

        assert_eq!(
            proposal.file_patches[0].content.as_deref(),
            Some("# Brief\n\nFallback content.\n")
        );

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn surfaces_repair_failure_when_second_attempt_still_lacks_json() {
        let repo_root = std::env::temp_dir().join(format!(
            "maabarium-agent-repair-fail-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(repo_root.join("docs")).expect("temp repo should be created");
        fs::write(repo_root.join("docs/brief.md"), "# Brief\n\nOld content.\n")
            .expect("source file should be written");

        let agent = Agent::new(
            AgentDef {
                name: "researcher".into(),
                role: "researcher".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "repair-model".into(),
            },
            Arc::new(SequenceProvider::new(
                "ollama",
                "repair-model",
                vec!["Plain text answer.", "Still plain text."],
            )),
        );

        let error = agent
            .propose(
                "Refresh the research brief",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["docs/**/*.md".into()],
                "research",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect_err("repair failure should be surfaced");

        assert!(error.to_string().contains("repair pass failed"));

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn exact_markdown_targets_use_provider_token_budget_for_proposals() {
        let repo_root = std::env::temp_dir().join(format!(
            "maabarium-agent-markdown-budget-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(repo_root.join("docs")).expect("temp repo should be created");
        fs::write(repo_root.join("docs/brief.md"), "# Brief\n\nOld content.\n")
            .expect("source file should be written");

        let provider = Arc::new(RecordingProvider::new(
            "ollama",
            "qwen3.5:9b",
            Some(3_072),
            r##"{
  "summary": "Tighten the brief.",
  "file_patches": [
    {
      "path": "docs/brief.md",
      "operation": "modify",
            "unified_diff": "@@ -1,3 +1,3 @@\n # Brief\n \n-Old content.\n+Updated content.\n"
    }
  ]
}"##,
        ));

        let agent = Agent::new(
            AgentDef {
                name: "writer".into(),
                role: "writer".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "qwen3.5:9b".into(),
            },
            provider.clone(),
        );

        let proposal = agent
            .propose(
                "Refine the implementation brief",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["docs/brief.md".into()],
                "markdown",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect("proposal should succeed");

        assert_eq!(proposal.summary, "Tighten the brief.");
        assert_eq!(provider.last_seen_max_tokens(), Some(3_072));

        let _ = fs::remove_dir_all(repo_root);
    }

    #[tokio::test]
    async fn rust_targets_keep_default_proposal_budget_even_with_larger_model_limit() {
        let repo_root = std::env::temp_dir().join(format!(
            "maabarium-agent-rust-budget-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(repo_root.join("src")).expect("temp repo should be created");
        fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
            .expect("source file should be written");

        let provider = Arc::new(RecordingProvider::new(
            "ollama",
            "qwen3.5:9b",
            Some(3_072),
            r##"{
  "summary": "Rename the function.",
  "file_patches": [
    {
      "path": "src/lib.rs",
      "operation": "modify",
      "unified_diff": "@@ -1,1 +1,1 @@\n-pub fn baseline() {}\n+pub fn improved() {}\n"
    }
  ]
}"##,
        ));

        let agent = Agent::new(
            AgentDef {
                name: "engineer".into(),
                role: "engineer".into(),
                system_prompt: "Return valid patch payloads".into(),
                model: "qwen3.5:9b".into(),
            },
            provider.clone(),
        );

        let proposal = agent
            .propose(
                "Improve the baseline function",
                repo_root.to_str().expect("repo path should be utf-8"),
                &["src/**/*.rs".into()],
                "rust",
                &[MetricDef {
                    name: "quality".into(),
                    weight: 1.0,
                    direction: "maximize".into(),
                    description: "Overall quality".into(),
                }],
            )
            .await
            .expect("proposal should succeed");

        assert_eq!(proposal.summary, "Rename the function.");
        assert_eq!(provider.last_seen_max_tokens(), Some(DEFAULT_PROPOSAL_MAX_TOKENS));

        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn renders_empty_invalid_response_snippets_explicitly() {
        assert_eq!(invalid_response_snippet("   \n\t  "), "<empty response>");
    }

    #[test]
    fn truncates_invalid_response_snippets_with_remaining_char_count() {
        let raw = "a".repeat(MAX_INVALID_RESPONSE_SNIPPET_CHARS + 25);

        let snippet = invalid_response_snippet(&raw);

        assert!(snippet.starts_with(&"a".repeat(MAX_INVALID_RESPONSE_SNIPPET_CHARS)));
        assert!(snippet.ends_with("...[truncated 25 chars]"));
    }

    #[test]
    fn suggests_research_creation_paths_from_targets() {
        let suggestions = suggest_create_paths(
            &["docs/**/*.md".into(), "research/**/*.md".into()],
            "research",
        );

        assert_eq!(
            suggestions,
            vec![
                "docs/research-brief.md".to_owned(),
                "research/research-brief.md".to_owned()
            ]
        );
    }

    #[test]
    fn suggests_markdown_creation_path_for_exact_target_file() {
        let suggestions =
            suggest_create_paths(&["docs/project-echo-implementation.md".into()], "markdown");

        assert_eq!(
            suggestions,
            vec!["docs/project-echo-implementation.md".to_owned()]
        );
    }

    #[test]
    fn suggests_markdown_creation_path_for_glob_target() {
        let suggestions = suggest_create_paths(&["docs/**/*.md".into()], "markdown");

        assert_eq!(suggestions, vec!["docs/draft.md".to_owned()]);
    }

    #[test]
    fn applies_unified_diff_with_validation() {
        let updated = apply_unified_diff(
            Some("fn main() {\n    println!(\"old\");\n}\n"),
            "@@ -1,3 +1,3 @@\n fn main() {\n-    println!(\"old\");\n+    println!(\"new\");\n }",
            FilePatchOperation::Modify,
        )
        .expect("diff should apply");

        assert_eq!(
            updated.content.as_deref(),
            Some("fn main() {\n    println!(\"new\");\n}\n")
        );
        assert!(updated.had_trailing_newline);
    }

    #[test]
    fn creates_and_deletes_files_explicitly() {
        let created = apply_unified_diff(
            None,
            "@@ -0,0 +1,2 @@\n+pub fn created() {\n+}\n\\ No newline at end of file",
            FilePatchOperation::Create,
        )
        .expect("create diff should apply");
        assert_eq!(created.content.as_deref(), Some("pub fn created() {\n}"));
        assert!(!created.had_trailing_newline);

        let deleted = apply_unified_diff(
            Some("pub fn old() {}\n"),
            "@@ -1,1 +0,0 @@\n-pub fn old() {}",
            FilePatchOperation::Delete,
        )
        .expect("delete diff should apply");
        assert!(deleted.content.is_none());
    }

    #[test]
    fn applies_multi_hunk_diffs_and_validates_newline_markers() {
        let updated = apply_unified_diff(
            Some("line one\nline two\nline three\nline four\n"),
            "@@ -1,2 +1,2 @@\n-line one\n+line 1\n line two\n@@ -3,2 +3,2 @@\n line three\n-line four\n+line 4\n\\ No newline at end of file",
            FilePatchOperation::Modify,
        )
        .expect("multi-hunk diff should apply");

        assert_eq!(
            updated.content.as_deref(),
            Some("line 1\nline two\nline three\nline 4")
        );
        assert!(!updated.had_trailing_newline);
    }

    #[test]
    fn rejects_invalid_newline_markers() {
        let error = apply_unified_diff(
            Some("hello\n"),
            "@@ -1,1 +1,1 @@\n\\ No newline at end of file\n-hello\n+hello",
            FilePatchOperation::Modify,
        )
        .expect_err("dangling newline marker should fail");

        assert!(error.contains("newline marker must follow a diff line"));
    }

    #[test]
    fn accepts_raw_markdown_content_for_text_targets() {
        let proposal = parse_proposal_payload(
            r##"{
    "summary": "Rewrite the note with a clearer structure.",
    "file_patches": [
        {
            "path": "docs/notes.md",
            "operation": "modify",
            "unified_diff": "# Runtime validation fixture\n\nThis note is clearer now.\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/notes.md".into(),
                content: "# Runtime validation fixture\n\nOld content.\n".into(),
            }],
            &HashSet::from(["docs/notes.md".to_owned()]),
            &["docs/**/*.md".into()],
        )
        .expect("raw markdown fallback should parse");

        assert_eq!(proposal.file_patches.len(), 1);
        assert_eq!(
            proposal.file_patches[0].operation,
            FilePatchOperation::Modify
        );
        assert_eq!(
            proposal.file_patches[0].content.as_deref(),
            Some("# Runtime validation fixture\n\nThis note is clearer now.\n")
        );
    }

    #[test]
    fn rejects_raw_markdown_content_for_existing_exact_document_targets() {
        let error = parse_proposal_payload(
            r##"{
    "summary": "Rewrite the implementation brief.",
    "file_patches": [
        {
            "path": "docs/project-echo-implementation.md",
            "operation": "modify",
            "unified_diff": "# Project Echo Implementation (v1.0)\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "# Project Echo Implementation\n\n## Architecture\n- Existing detail.\n".into(),
            }],
            &HashSet::from(["docs/project-echo-implementation.md".to_owned()]),
            &["docs/project-echo-implementation.md".into()],
        )
        .expect_err("raw fallback should be rejected for exact existing markdown documents");

        assert!(error
            .to_string()
            .contains("must provide a valid unified diff or substantive markdown content"));
    }

    #[test]
    fn accepts_substantive_raw_markdown_content_for_existing_exact_document_targets() {
        let proposal = parse_proposal_payload(
            r##"{
    "summary": "Fill the first section with implementation detail.",
    "file_patches": [
        {
            "path": "docs/project-echo-implementation.md",
            "operation": "modify",
            "unified_diff": "# Project Echo Implementation\n\n## Product Scope\n### Goals\n- Preserve project context across local sessions with a persistent knowledge store.\n\n### User Value\n- Reduce context switching for solo builders.\n\n## Architecture\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "# Project Echo Implementation\n\n## Product Scope\n### Goals\n\n### User Value\n\n## Architecture\n".into(),
            }],
            &HashSet::from(["docs/project-echo-implementation.md".to_owned()]),
            &["docs/project-echo-implementation.md".into()],
        )
        .expect("substantive exact-document markdown content should be accepted through guarded raw fallback");

        assert!(proposal.file_patches[0]
            .content
            .as_deref()
            .is_some_and(|content| content.contains("persistent knowledge store")));
    }

    #[test]
    fn recovers_substantive_exact_markdown_from_malformed_diff_counts() {
        let proposal = parse_proposal_payload(
            r##"{
    "summary": "Populate product scope with real detail.",
    "file_patches": [
        {
            "path": "docs/project-echo-implementation.md",
            "operation": "modify",
            "unified_diff": "@@ -1,1 +1,10 @@\n # Project Echo Implementation\n+## Product Scope\n+\n+### Goals\n+- Build a local-first, LLM-powered project memory system that persists context across sessions for solo builders.\n+- Enable retrieval-augmented generation over project code, docs, and notes.\n+\n+### User Value\n+- Solo developers regain context after breaks without manual summarization.\n+\n+## Architecture\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "# Project Echo Implementation\n\n## Product Scope\n### Goals\n\n### User Value\n\n## Architecture\n".into(),
            }],
            &HashSet::from(["docs/project-echo-implementation.md".to_owned()]),
            &["docs/project-echo-implementation.md".into()],
        )
        .expect("malformed exact markdown diff should recover when content is substantive");

        let content = proposal.file_patches[0]
            .content
            .as_deref()
            .expect("recovered content should exist");
        assert!(content.contains("persists context across sessions"));
        assert!(content.contains("Solo developers regain context after breaks"));
    }

    #[test]
    fn exact_markdown_diff_can_apply_when_existing_file_has_leading_blank_lines() {
        let proposal = parse_proposal_payload(
            r##"{
    "summary": "Fill the first section.",
    "file_patches": [
        {
            "path": "docs/project-echo-implementation.md",
            "operation": "modify",
            "unified_diff": "@@ -3,1 +3,3 @@\n ## Product Scope\n+\n+- Define the persistent local-first project memory model.\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "\n# Project Echo Implementation\n\n## Product Scope\n\n## Architecture\n".into(),
            }],
            &HashSet::from(["docs/project-echo-implementation.md".to_owned()]),
            &["docs/project-echo-implementation.md".into()],
        )
        .expect("exact markdown diff should apply after trimming leading blank lines");

        assert_eq!(
            proposal.file_patches[0].content.as_deref(),
            Some("\n# Project Echo Implementation\n\n## Product Scope\n\n- Define the persistent local-first project memory model.\n\n## Architecture\n")
        );
    }

    #[test]
    fn upgrades_missing_modify_targets_to_create_for_allowed_text_paths() {
        let proposal = parse_proposal_payload(
            r##"{
    "summary": "Create a focused research note.",
    "file_patches": [
        {
            "path": "notes/local-first-ai-workflow.md",
            "operation": "modify",
            "unified_diff": "# Local-first AI workflow\n\nA starter note.\n"
        }
    ]
}"##,
            &[],
            &HashSet::new(),
            &["notes/**/*.md".into()],
        )
        .expect("missing markdown targets should be upgraded to create");

        assert_eq!(proposal.file_patches.len(), 1);
        assert_eq!(
            proposal.file_patches[0].operation,
            FilePatchOperation::Create
        );
        assert_eq!(
            proposal.file_patches[0].content.as_deref(),
            Some("# Local-first AI workflow\n\nA starter note.\n")
        );
    }

    #[test]
    fn recovers_text_from_malformed_diffish_markdown() {
        let proposal = parse_proposal_payload(
                    r##"{
          "summary": "Rewrite the product brief with clearer sections.",
          "file_patches": [
            {
              "path": "docs/product-brief.md",
              "operation": "modify",
              "unified_diff": "@@ -1,2 +1,4 @@\n\n# Product Brief\n\nClarify the app value and release shape."
            }
          ]
        }"##,
                    &[FileContext {
                        path: "docs/product-brief.md".into(),
                        content: "# Product Brief\n\nOld brief.\n".into(),
                    }],
                    &HashSet::from(["docs/product-brief.md".to_owned()]),
                    &["docs/**/*.md".into()],
                )
                .expect("diffish markdown should recover through raw fallback");

        assert_eq!(proposal.file_patches.len(), 1);
        assert!(
            proposal.file_patches[0]
                .content
                .as_deref()
                .expect("recovered content should exist")
                .contains("Clarify the app value and release shape.")
        );
    }

    #[test]
    fn exact_document_guidance_requests_substantial_first_draft() {
        let guidance = incremental_document_guidance(
            "markdown",
            &["docs/project-echo-implementation.md".into()],
            &[],
        );

        assert!(guidance.contains("substantial v1 draft"));
        assert!(guidance.contains("Do not return only a title line"));
    }

    #[test]
    fn exact_document_guidance_for_existing_file_forbids_header_reset() {
        let guidance = incremental_document_guidance(
            "markdown",
            &["docs/project-echo-implementation.md".into()],
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "# Project Echo Implementation\n".into(),
            }],
        );

        assert!(guidance.contains("do not reset it to a fresh header"));
    }

    #[test]
    fn diff_anchor_example_uses_actual_first_non_empty_line_number() {
        let anchor = diff_anchor_example(&[FileContext {
            path: "docs/project-echo-implementation.md".into(),
            content: "\n# Project Echo Implementation\n\n## Architecture\n".into(),
        }]);

        assert!(anchor.contains("deepening the first empty section"));
        assert!(anchor.contains("line 4"));
        assert!(anchor.contains("@@ -4,1 +4,3 @@"));
    }

    #[test]
    fn rejects_exact_markdown_scaffold_patch_without_substantive_content() {
        let error = parse_proposal_payload(
            r##"{
    "summary": "Add a version header.",
    "file_patches": [
        {
            "path": "docs/project-echo-implementation.md",
            "operation": "modify",
            "unified_diff": "@@ -1,1 +1,1 @@\n-# Project Echo Implementation\n+# Project Echo Implementation (v1.0)\n"
        }
    ]
}"##,
            &[FileContext {
                path: "docs/project-echo-implementation.md".into(),
                content: "\n# Project Echo Implementation\n\n## Product Scope\n### Goals\n\n## Architecture\n".into(),
            }],
            &HashSet::from(["docs/project-echo-implementation.md".to_owned()]),
            &["docs/project-echo-implementation.md".into()],
        )
        .expect_err("title-only scaffold refinements should be rejected");

        assert!(error.to_string().contains("must add substantive section content"));
    }

    #[test]
    fn normalizes_proposal_failure_reasons() {
        assert_eq!(
                    normalize_proposal_failure_reason(&LLMError::InvalidResponse(
                        "Unified diff validation failed for 'src/lib.rs': context mismatch: expected 'a', found 'b'"
                            .to_owned(),
                    )),
                    "invalid_response.unified_diff.context_mismatch"
                );
        assert_eq!(
                    normalize_proposal_failure_reason(&LLMError::InvalidResponse(
                        "Unified diff validation failed for 'src/lib.rs': encountered an empty unified diff line without a prefix"
                            .to_owned(),
                    )),
                    "invalid_response.unified_diff.blank_line_without_prefix"
                );
        assert_eq!(
            normalize_proposal_failure_reason(&LLMError::Provider(
                "Ollama returned empty response content despite reporting 42 eval tokens"
                    .to_owned(),
            )),
            "provider.ollama_empty_content"
        );
        assert_eq!(
            normalize_proposal_failure_reason(&LLMError::Provider(
                "HTTP 404 Not Found: {\"error\":\"model not found\"}".to_owned(),
            )),
            "provider.http_404"
        );
    }

    #[test]
    fn formats_proposal_failure_counters_compactly() {
        let counters = BTreeMap::from([
            (("mock".to_owned(), "invalid_response.proposal_json"), 2_u64),
            (
                (
                    "ollama".to_owned(),
                    "invalid_response.unified_diff.context_mismatch",
                ),
                1_u64,
            ),
        ]);

        assert_eq!(
            format_proposal_failure_counters(&counters),
            "mock:invalid_response.proposal_json=2, ollama:invalid_response.unified_diff.context_mismatch=1"
        );
    }
}
