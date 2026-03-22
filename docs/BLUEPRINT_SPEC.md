# Blueprint Specification

A **blueprint** is a TOML file that fully describes one experiment domain for Maabarium. The engine reads a blueprint to know what to optimize, how to evaluate progress, which agents to use, and which LLM models to call.

## File Location

Place blueprints in the `blueprints/` directory at the workspace root:

```
blueprints/
├── example.toml
├── creator-buddy-prompts.toml
└── rust-code-quality.toml
```

## Complete Reference

```toml
# ─── Identity ─────────────────────────────────────────────────────────────────

[blueprint]
name    = "my-optimizer"          # required, non-empty string
version = "1.0"                   # semver string (informational)
description = """
Human-readable description of what this blueprint optimizes.
Multi-line is fine.
"""

# ─── Domain ──────────────────────────────────────────────────────────────────

[domain]
repo_path    = "."                # path to the git repo being optimized
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
models = [
    {
        name        = "llama3",
        provider    = "ollama",                    # "ollama" | "openai"
        endpoint    = "http://localhost:11434",
        temperature = 0.7,
        max_tokens  = 2048,
        # api_key_env = "OPENAI_API_KEY"           # optional; env var name for key
    },
    # Add more models for multi-LLM round-robin:
    # { name = "qwen", provider = "ollama", endpoint = "http://localhost:11434",
    #   temperature = 0.5, max_tokens = 1024 },
]
```

## Field Reference

### `[blueprint]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Unique identifier; used as the key in the database |
| `version` | string | ✓ | Semver string (informational only) |
| `description` | string | ✓ | Human-readable description |

### `[domain]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo_path` | string | ✓ | Path to the git repository being optimized. `"."` = current directory |
| `target_files` | array of strings | ✓ | Glob patterns for files the agent may modify |
| `language` | string | ✓ | Programming language hint (used by evaluators) |

### `[constraints]`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `max_iterations` | integer | ✓ | — | Hard cap on experiment count. Must be > 0 |
| `timeout_seconds` | integer | ✓ | — | Per-experiment timeout in seconds |
| `require_tests_pass` | bool | ✓ | — | Evaluator should check that tests pass |
| `min_improvement` | float | ✓ | — | Minimum weighted score delta to promote a branch (0–1) |

### `[metrics]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metrics` | array of MetricDef | ✓ | Metric definitions. Weights must sum to 1.0 |

**MetricDef fields:**

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `name` | string | any | Metric identifier |
| `weight` | float | 0–1 | Contribution to `weighted_total` |
| `direction` | string | `"maximize"` \| `"minimize"` | Whether higher or lower is better |
| `description` | string | any | Prompt text sent to the LLM evaluator |

### `[agents]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `council_size` | integer | ✓ | Number of agents that will propose simultaneously |
| `debate_rounds` | integer | ✓ | Cross-critique rounds between proposals |
| `agents` | array of AgentDef | ✓ | Agent definitions |

**AgentDef fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Display name |
| `role` | string | ✓ | Short role label |
| `system_prompt` | string | ✓ | Injected as the system message for every LLM call |
| `model` | string | ✓ | References a model `name` in `[models].models` |

### `[models]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `models` | array of ModelDef | ✓ | LLM model definitions |

**ModelDef fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Reference name used by agents |
| `provider` | string | ✓ | `"ollama"` or `"openai"` (OpenAI-compatible) |
| `endpoint` | string | ✓ | Base URL of the LLM API |
| `temperature` | float | ✓ | Sampling temperature (0.0–1.0) |
| `max_tokens` | integer | ✓ | Maximum tokens per completion |
| `api_key_env` | string | — | Environment variable name holding the API key |

## Validation Rules

The engine validates a blueprint at load time and refuses to start if:

1. `blueprint.name` is empty
2. `constraints.max_iterations` is 0
3. Metric weights do not sum to 1.0 (±0.01 tolerance)
4. Any metric `direction` is not `"maximize"` or `"minimize"`

## Example Blueprints

### Prompt Optimization

```toml
[blueprint]
name = "creator-buddy-prompts"
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
    { name = "revenue_signal",  weight = 0.2, direction = "maximize", description = "Does it drive revenue-relevant behavior?" },
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
models = [
    { name = "qwen", provider = "ollama", endpoint = "http://localhost:11434",
      temperature = 0.7, max_tokens = 1024 },
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
