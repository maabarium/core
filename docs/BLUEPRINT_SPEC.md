# Blueprint Specification

A **blueprint** is a TOML file that fully describes one experiment domain for Maabarium. The engine reads a blueprint to know what to optimize, how to evaluate progress, which agents to use, and which LLM models to call.

## File Location

Place blueprints in the `blueprints/` directory at the workspace root:

```text
blueprints/
├── example.toml
├── prompt-improvement.toml
├── lora-adapter.toml
├── code-quality.toml
├── product-builder.toml
└── general-research.toml
```

## Choose Workflow Shape First

Before editing individual TOML fields, decide what the workflow is supposed to produce:

- Existing code or application changes: use a code-oriented language such as `rust` or `application`, point `target_files` at existing source-tree globs, and usually keep `require_tests_pass = true`.
- One named document or prompt asset: use `language = "markdown"` or `language = "prompt"`, and prefer an exact relative path such as `docs/project-brief.md` when the workflow should create or refine one specific output file.
- Research brief with citations: use `language = "research"`, keep targets markdown-oriented, and use research metrics such as citation coverage or factual grounding.
- LoRA artefact validation: use `language = "lora"` and target adapter manifests and artefacts rather than source trees.

The most common authoring mistake is choosing a code-oriented workflow shape for a document-oriented task. If the output is a single markdown file, the blueprint should look like a document workflow from the start.

## Complete Reference

```toml
# ─── Identity ─────────────────────────────────────────────────────────────────

[blueprint]
name    = "my-optimiser"          # required, non-empty string
version = "1.0"                   # semver string (informational)
description = """
Human-readable description of what this blueprint optimizes.
Multi-line is fine.
"""

# ─── Domain ──────────────────────────────────────────────────────────────────

[domain]
repo_path    = "."                # path to the git repo being optimised
target_files = ["src/**/*.rs"]   # glob patterns for files in scope
language     = "rust"             # informational; used by evaluators

# ─── Constraints ─────────────────────────────────────────────────────────────

[constraints]
max_iterations      = 500         # safety cap; required, must be > 0
timeout_seconds     = 300         # per-experiment wall-clock limit
require_tests_pass  = true        # evaluator can check this flag
min_improvement     = 0.01        # minimum delta to "keep" a result (0–1 scale)

# ─── Metrics ─────────────────────────────────────────────────────────────────
# weights must sum to 1.0

[metrics]
metrics = [
    { name = "quality",        weight = 0.4, direction = "maximize", description = "Overall quality" },
    { name = "performance",    weight = 0.3, direction = "maximize", description = "Speed" },
    { name = "maintainability",weight = 0.3, direction = "maximize", description = "Ease of change" },
]

# direction: "maximize" (higher is better) | "minimize" (lower is better)

# ─── Agents ──────────────────────────────────────────────────────────────────

[agents]
council_size  = 3     # number of agents in the council
debate_rounds = 2     # how many rounds of cross-critique

agents = [
    {
        name          = "architect",
        role          = "software architect",
        system_prompt = "You are a senior software architect focused on clean, maintainable code.",
        model         = "llama3"              # references a name in [[models.models]]
    },
    {
        name          = "optimizer",
        role          = "performance engineer",
        system_prompt = "You are a performance engineer focused on runtime efficiency.",
        model         = "llama3"
    },
    {
        name          = "reviewer",
        role          = "code reviewer",
        system_prompt = "You are a thorough code reviewer focused on correctness and best practices.",
        model         = "llama3"
    },
]

# ─── Models ──────────────────────────────────────────────────────────────────

[models]
assignment = "explicit"          # "explicit" | "round_robin"
models = [
    {
        name        = "llama3",
        provider    = "ollama",                    # "ollama" | "openai"
        endpoint    = "http://localhost:11434",
        temperature = 0.7,
        max_tokens  = 2048,
        requests_per_minute = 60,
        # api_key_env = "OPENAI_API_KEY"           # optional; env var name for key
    },
    # Add more models for multi-LLM round-robin:
    # { name = "qwen", provider = "ollama", endpoint = "http://localhost:11434",
    #   temperature = 0.5, max_tokens = 1024 },
]

# ─── Evaluator Override ─────────────────────────────────────────────────────

[evaluator]
kind = "builtin"                 # optional: "auto" | "builtin" | "process"
builtin = "prompt"              # required when kind = "builtin": "code" | "prompt" | "research" | "lora"
```

## Field Reference

### `[blueprint]`

| Field         | Type   | Required | Description                                        |
| ------------- | ------ | -------- | -------------------------------------------------- |
| `name`        | string | ✓        | Unique identifier; used as the key in the database |
| `version`     | string | ✓        | Semver string (informational only)                 |
| `description` | string | ✓        | Human-readable description                         |

### `[domain]`

| Field          | Type             | Required | Description                                                           |
| -------------- | ---------------- | -------- | --------------------------------------------------------------------- |
| `repo_path`    | string           | ✓        | Path to the git repository being optimised. `"."` = current directory |
| `target_files` | array of strings | ✓        | Glob patterns for files the agent may modify                          |
| `language`     | string           | ✓        | Programming language hint (used by evaluators)                        |

For document-first workflows, use `language = "markdown"` or `language = "prompt"` and include markdown target paths such as `docs/**/*.md` or an exact destination like `docs/project-echo-implementation.md`. Exact markdown file targets are recommended when the workflow must create or refine one specifically named document.

Use exact paths when the workflow should create or refine one named output file. Use globs when the workflow should search across many existing files. For example:

- Exact path: `docs/release-plan.md`
- Existing-file glob: `src/**/*.rs`
- Directory-style markdown glob: `docs/**/*.md`

### `[constraints]`

| Field                | Type    | Required | Default | Description                                            |
| -------------------- | ------- | -------- | ------- | ------------------------------------------------------ |
| `max_iterations`     | integer | ✓        | —       | Hard cap on experiment count. Must be > 0              |
| `timeout_seconds`    | integer | ✓        | —       | Per-experiment timeout in seconds                      |
| `require_tests_pass` | bool    | ✓        | —       | Evaluator should check that tests pass                 |
| `min_improvement`    | float   | ✓        | —       | Minimum weighted score delta to promote a branch (0–1) |

### `[metrics]`

| Field     | Type               | Required | Description                                 |
| --------- | ------------------ | -------- | ------------------------------------------- |
| `metrics` | array of MetricDef | ✓        | Metric definitions. Weights must sum to 1.0 |

**MetricDef fields:**

| Field         | Type   | Values                       | Description                           |
| ------------- | ------ | ---------------------------- | ------------------------------------- |
| `name`        | string | any                          | Metric identifier                     |
| `weight`      | float  | 0–1                          | Contribution to `weighted_total`      |
| `direction`   | string | `"maximize"` \| `"minimize"` | Whether higher or lower is better     |
| `description` | string | any                          | Prompt text sent to the LLM evaluator |

### `[agents]`

| Field           | Type              | Required | Description                                       |
| --------------- | ----------------- | -------- | ------------------------------------------------- |
| `council_size`  | integer           | ✓        | Number of agents that will propose simultaneously |
| `debate_rounds` | integer           | ✓        | Cross-critique rounds between proposals           |
| `agents`        | array of AgentDef | ✓        | Agent definitions                                 |

**AgentDef fields:**

| Field           | Type   | Required | Description                                       |
| --------------- | ------ | -------- | ------------------------------------------------- |
| `name`          | string | ✓        | Display name                                      |
| `role`          | string | ✓        | Short role label                                  |
| `system_prompt` | string | ✓        | Injected as the system message for every LLM call |
| `model`         | string | ✓        | References a model `name` in `[models].models`    |

### `[models]`

| Field        | Type              | Required | Description                                   |
| ------------ | ----------------- | -------- | --------------------------------------------- |
| `assignment` | string            | —        | Routing mode: `"explicit"` or `"round_robin"` |
| `models`     | array of ModelDef | ✓        | LLM model definitions                         |

**ModelDef fields:**

| Field                 | Type    | Required | Description                                      |
| --------------------- | ------- | -------- | ------------------------------------------------ |
| `name`                | string  | ✓        | Reference name used by agents                    |
| `provider`            | string  | ✓        | `"ollama"` or `"openai"` (OpenAI-compatible)     |
| `endpoint`            | string  | ✓        | Base URL of the LLM API                          |
| `temperature`         | float   | ✓        | Sampling temperature (0.0–1.0)                   |
| `max_tokens`          | integer | ✓        | Maximum tokens per completion                    |
| `api_key_env`         | string  | —        | Environment variable name holding the API key    |
| `requests_per_minute` | integer | —        | Optional per-model pacing limit used by the pool |

### Model Routing

- `assignment = "explicit"`: each agent uses the model named in its `model` field.
- `assignment = "round_robin"`: the runtime rotates requests across the configured model list through `ModelPool`.

### `[evaluator]`

This section is optional. If omitted, Maabarium auto-selects one of the built-in evaluators from blueprint template metadata when present, then falls back to language, metrics, and target-pattern heuristics.

| Field           | Type   | Required | Description                                                                       |
| --------------- | ------ | -------- | --------------------------------------------------------------------------------- |
| `kind`          | string | —        | `"auto"`, `"builtin"`, or `"process"`                                             |
| `builtin`       | string | builtin  | Required when `kind = "builtin"`: `"code"`, `"prompt"`, `"research"`, or `"lora"` |
| `manifest_path` | string | process  | Path to a TOML process-plugin manifest, resolved from `repo_path`                 |
| `plugin_id`     | string | —        | Optional identifier shown in runtime state and diagnostics                        |

When `kind = "builtin"`, `builtin` is mandatory. When `kind = "process"`, `manifest_path` is mandatory. `evaluator.builtin` is rejected for `kind = "auto"` or `kind = "process"`.

#### Process Evaluator Plugin Manifest

When `kind = "process"`, `manifest_path` should point to a TOML file like this:

```toml
[plugin]
id = "custom-evaluator"
version = "1.0.0"
display_name = "Custom Evaluator"
timeout_seconds = 60

[process]
command = "python3"
args = ["tools/custom_evaluator.py"]
working_dir = "."

[environment]
RUST_LOG = "info"
```

The plugin subprocess receives JSON on stdin containing the proposal, current iteration, and metric definitions. It must print JSON on stdout with at least a `scores` array compatible with Maabarium metric scoring.

## Validation Rules

The engine validates a blueprint at load time and refuses to start if:

1. `blueprint.name` is empty
2. `constraints.max_iterations` is 0
3. Metric weights do not sum to 1.0 (±0.01 tolerance)
4. Any metric `direction` is not `"maximize"` or `"minimize"`

## Built-In Evaluator Selection

Maabarium selects one built-in evaluator per blueprint:

- `code`: the default path for code and application work
- `prompt`: used for prompt optimisation blueprints and other prompt-oriented markdown assets
- `lora`: used for LoRA artefact validation blueprints
- `research`: used for research-oriented blueprints

Selection precedence is:

1. explicit evaluator override: `evaluator.kind = "process"` always selects the process plugin path, and `evaluator.kind = "builtin"` with `evaluator.builtin` selects that built-in evaluator directly,
2. template-aware routing: built-in library templates such as `prompt_optimization`, `general_research`, and `lora_validation` select their matching built-in evaluator directly,
3. backward-compatible heuristics: when no explicit override or decisive template metadata exists, Maabarium falls back to language, metric names, blueprint name, and target-path patterns.

Treat `language` as behavior-selecting metadata, not cosmetic labeling. In practice it still influences evaluator fallback, safe creation guidance, and some library affordances, but language alone is not the sole routing signal.

If a workflow is intended to refine one named implementation or planning document instead of prompt assets, it can safely use `language = "markdown"` without being forced onto the prompt evaluator. For prompt-optimisation behavior, prefer a prompt-oriented template or prompt-specific target paths.

The research evaluator activates when a blueprint clearly targets research work, for example:

- `language = "research"`
- a blueprint name containing `research`
- research-oriented metric names such as `citation_coverage`, `source_quality`, `factual_grounding`, or `synthesis_quality`

## Research Evaluator

The built-in research evaluator enforces cited research output instead of relying on prompt wording alone.

It does three things that the generic prompt path does not:

1. it extracts external citations from the proposed content,
2. it can issue a Brave Search API discovery query when credentials are configured, and
3. it verifies and persists source metadata plus query traces alongside the experiment row.

### Citation Requirements

Research proposals must include at least one citation in the proposed file contents. The evaluator recognizes:

- markdown links such as `[SQLite docs](https://sqlite.org/index.html)`
- bare URLs such as `https://www.rust-lang.org/`

If neither a citation nor a usable discovery query can be derived, evaluation fails for that iteration.

### Persisted Research Metadata

For successful research evaluations, Maabarium stores:

- Per-source records: original URL, final URL after redirects when available, host name, optional label, optional HTML title, citation count, verification status, HTTP status code when available, and fetch error when verification failed.
- Per-citation records: file path, source URL, optional label, line number, and captured snippet.
- Per-query-trace records: provider name, issued query text, result count, top returned URLs, latency, execution time, and any discovery error.

This metadata is persisted in SQLite and included in JSON and CSV exports through the experiment record.

## Example Blueprints

### LoRA Artefact Validation

The built-in LoRA path is intentionally narrow. Maabarium does not run first-class MLX training inside the engine today. The supported workflow is:

1. train or export adapter artefacts outside the engine,
2. include those artefacts plus metadata in a proposal,
3. evaluate packaging completeness and reproducibility through the built-in LoRA evaluator.

The evaluator recognizes `language = "lora"` blueprints and expects the proposal to include a `maabarium-lora-run.json` manifest when reproducibility scoring matters.

Minimal manifest example:

```json
{
  "trainer": "mlx_lm",
  "base_model": "mlx-community/Llama-3.2-3B-Instruct",
  "dataset": "fixtures/dataset.jsonl",
  "adapter_path": "adapters/run-001/adapter_model.safetensors",
  "output_dir": "adapters/run-001",
  "eval_command": "python -m mlx_lm.evaluate --adapter-path adapters/run-001",
  "epochs": 2,
  "learning_rate": 0.0002
}
```

This lets the evaluator score three things without overclaiming native training support:

- adapter artefact completeness,
- metadata hygiene,
- reproducibility of the external training or evaluation run.

### Prompt Optimisation

```toml
[blueprint]
name = "prompt-improvement"
version = "1.0"
description = "Continuously improve system prompts for the Creator Buddy app."

[domain]
repo_path = "."
target_files = ["prompts/**/*.md"]
language = "markdown"

[constraints]
max_iterations = 500
timeout_seconds = 120
# Prompt files are markdown, not compiled code — there are no tests to run.
require_tests_pass = false
min_improvement = 0.02

[metrics]
metrics = [
    { name = "actionability",   weight = 0.3, direction = "maximize", description = "How actionable is this prompt?" },
    { name = "specificity",     weight = 0.3, direction = "maximize", description = "How specific and concrete?" },
    { name = "revenue_signal",  weight = 0.2, direction = "maximize", description = "Does it drive revenue-relevant behaviour?" },
    { name = "brevity",         weight = 0.2, direction = "maximize", description = "Is it concise without losing clarity?" },
]

[agents]
council_size = 2
debate_rounds = 1
agents = [
    { name = "prompt-engineer", role = "Prompt Engineer",
      system_prompt = "You specialize in writing clear, actionable system prompts.",
      model = "qwen" },
    { name = "critic", role = "Critic",
      system_prompt = "You find weaknesses and failure modes in proposed prompts.",
      model = "qwen" },
]

[models]
assignment = "explicit"
models = [
    { name = "qwen", provider = "ollama", endpoint = "http://localhost:11434",
    temperature = 0.7, max_tokens = 1024, requests_per_minute = 60 },
]
```

### General Research

```toml
[blueprint]
name = "general-research"
version = "1.0"
description = "Research any topic with grounded synthesis, source tracking, and explicit citations for major claims."

[domain]
repo_path = "."
target_files = ["docs/**/*.md", "research/**/*.md", "notes/**/*.md", "reports/**/*.md"]
language = "research"

[constraints]
max_iterations = 40
timeout_seconds = 240
require_tests_pass = false
min_improvement = 0.02

[metrics]
metrics = [
    { name = "factual_grounding", weight = 0.3, direction = "maximize", description = "Claims should remain grounded in verifiable evidence." },
    { name = "citation_coverage", weight = 0.25, direction = "maximize", description = "Major claims should include explicit citations and source references." },
    { name = "source_quality", weight = 0.25, direction = "maximize", description = "The work should prefer credible, diverse, and recent sources." },
    { name = "synthesis_quality", weight = 0.2, direction = "maximize", description = "The final brief should synthesize findings clearly." },
]

[agents]
council_size = 3
debate_rounds = 2
agents = [
    { name = "researcher", role = "Lead Researcher", system_prompt = "Gather the best available evidence, perform internet lookups when tool access exists, and keep an explicit source list.", model = "llama3" },
    { name = "verifier", role = "Source Verifier", system_prompt = "Reject unsupported claims, require citations, and call out when live source access is unavailable.", model = "llama3" },
    { name = "synthesizer", role = "Research Synthesizer", system_prompt = "Produce a concise research brief with citations for every major claim and explicit uncertainty where evidence is weak.", model = "llama3" },
]

[models]
assignment = "explicit"
models = [
    { name = "llama3", provider = "ollama", endpoint = "http://localhost:11434", temperature = 0.35, max_tokens = 3072, requests_per_minute = 30 },
]
```

### Rust Code Quality

```toml
[blueprint]
name = "rust-code-quality"
version = "1.0"
description = "Improve Rust code quality metrics in this repository."

[domain]
repo_path = "."
target_files = ["src/**/*.rs", "crates/**/*.rs"]
language = "rust"

[constraints]
max_iterations = 100
timeout_seconds = 300
require_tests_pass = true
min_improvement = 0.01

[metrics]
metrics = [
    { name = "correctness",     weight = 0.5, direction = "maximize", description = "Code correctness and safety" },
    { name = "readability",     weight = 0.3, direction = "maximize", description = "Code readability and documentation" },
    { name = "performance",     weight = 0.2, direction = "maximize", description = "Runtime and memory efficiency" },
]

[agents]
council_size = 1
debate_rounds = 0
agents = [
    { name = "rust-expert", role = "Rust Engineer",
      system_prompt = "You are an expert Rust engineer focused on idiomatic, correct, performant code.",
      model = "llama3" },
]

[models]
models = [
    { name = "llama3", provider = "ollama", endpoint = "http://localhost:11434",
      temperature = 0.5, max_tokens = 2048 },
]
```
