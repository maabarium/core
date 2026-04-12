# Maabarium Architecture

## Overview

Maabarium is a Rust-native, local-first continuous improvement engine inspired by Karpathy's Autoresearch pattern. It implements a **keep-winner loop**: propose → apply → evaluate → keep-or-revert, generalised beyond ML training to arbitrary optimisation domains.

## Design Principles

1. **Local-first, private, free** — native Rust orchestration with strong support for local runtimes such as Ollama on Apple Silicon; no cloud required by default
2. **Pure Rust control plane** — Tokio async runtime, no Python in the orchestration layer
3. **Autoresearch keep-winner loop** — propose → apply → evaluate → keep/revert
4. **Generalized domains** — pluggable Evaluator trait, not ML-only
5. **Beautiful desktop UX** — Tauri desktop console with live dashboards
6. **Future-proof** — explicit extension points, documented trade-offs, and OSS-ready structure

## Crate Structure

```text
maabarium/
├── crates/
│   ├── maabarium-core/    # Engine, agents, git, LLM, evaluator, persistence
│   ├── maabarium-cli/     # Terminal CLI binary (Phase 1)
│   └── maabarium-desktop/ # Tauri desktop console
```

The workspace is split so that `maabarium-core` can be built and tested independently of the Tauri desktop shell.

## Core Loop (`engine.rs`)

```text
for iteration in 1..=max_iterations {
    branch = experiment_branch_name(iteration)
    proposal = council.propose(context, metrics)
    workspace = git.apply_proposal(branch, proposal, reusable_workspace)
    result = timeout(evaluator.evaluate(proposal, EvaluationContext { workspace_path: workspace }))
    if result.weighted_total > baseline + min_improvement:
        git.create_branch_at_workspace_head(workspace, branch)
        git.promote_branch(branch)   // fast-forward main
        baseline = result.weighted_total
        outcome = promoted
    else:
        git.detach_experiment_workspace(workspace)
        outcome = rejected
    persistence.log_experiment(result, outcome)
}
```

Key design decisions:

- `CancellationToken` (from `tokio-util`) drives graceful shutdown on Ctrl-C
- Every fallible step uses `continue` with a `tracing::warn!` — no panics in production paths
- `tokio::time::timeout` enforces per-experiment wall-clock limits
- All results persist to SQLite with the engine's explicit promotion outcome
- Detached experiment worktrees are reused across iterations when safe, then cleaned up once at the end of the run
- Experiment branch refs are materialized only on promoted iterations; rejected runs stay as detached worktree state and never create branch history
- The CLI prints an end-of-run timing summary aggregated from per-phase engine instrumentation
- Sandbox snapshot materialization uses a dedicated workspace materializer with macOS clone-on-write support where available and a portable copy fallback everywhere else

## Module Guide

| Module        | Responsibility                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `blueprint`   | TOML config parsing + validation                                                                 |
| `engine`      | Keep-winner loop orchestration                                                                   |
| `agent`       | Single Agent + Council (multi-agent debate)                                                      |
| `git_manager` | git2 operations, reusable detached experiment worktrees, all wrapped in `spawn_blocking`         |
| `llm/`        | LLMProvider trait, Ollama backend, OpenAI-compat backend, ModelPool with routing + rate limiting |
| `evaluator/`  | Evaluator trait, ExperimentResult, PromptEvaluator                                               |
| `metrics`     | Weighted scoring, improvement detection, normalization                                           |
| `persistence` | SQLite read/write (WAL mode, parameterised queries)                                              |
| `error`       | Typed error enums via `thiserror`                                                                |

## git2 / Async Mismatch

`git2` (libgit2 bindings) is synchronous and not designed for async Tokio tasks. All `git2` calls in `git_manager.rs` are wrapped in `tokio::task::spawn_blocking` to prevent stalling the Tokio executor. This is the standard pattern for calling blocking code from async Rust.

## LLM Abstraction

The `LLMProvider` trait decouples the engine from any specific LLM backend:

```rust
#[async_trait]
pub trait LLMProvider: Send + Sync {
    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, LLMError>;
    fn provider_name(&self) -> &str;
    fn model_name(&self) -> &str;
}
```

Implementations:

- `OllamaProvider` — calls Ollama REST API (`POST /api/generate`) via `reqwest`
- `OpenAICompatProvider` — generic OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, DeepSeek, xAI, compatible gateways)
- `AnthropicProvider` — native Anthropic Messages API client
- `GeminiProvider` — native Gemini `generateContent` API client
- `ModelPool` — wraps one or more providers, enforces per-model request pacing, and supports `explicit` or `round_robin` blueprint assignment

No external `ollama-rs` crate is used; the Ollama REST API is called directly.

When blueprints use `assignment = "explicit"`, each agent receives a pool containing just its configured model. When they use `assignment = "round_robin"`, the pool rotates across the entire configured model list.

## Evaluator Trait

```rust
#[async_trait]
pub trait Evaluator: Send + Sync {
    async fn evaluate(&self, proposal: &Proposal, iteration: u64, context: &EvaluationContext) -> Result<ExperimentResult, EvalError>;
}
```

`ExperimentResult` carries multi-dimensional scores, weighted total, duration, and the original proposal — not just a bare `f64`.

## Persistence (SQLite)

Three tables:

- `experiments` — one row per experiment run
- `metrics` — one row per metric dimension per experiment
- `proposals` — proposal metadata

SQLite runs in WAL mode for concurrent reads from a future dashboard while the engine writes.

The default database and log paths are:

- `data/maabarium.db`
- `data/maabarium.log`

The Tauri desktop console reads both sources to render live score, duration, and token-usage cards.

## Security Model

- Agent writes to arbitrary paths: reused git worktrees or sandbox snapshots plus path sanitization and Wasmtime-backed policy validation
- Untrusted code execution: subprocess-based evaluator execution inside isolated worktrees or fallback sandbox roots
- API key leakage: `keyring` crate → OS keychain. Never logged, never serialized to disk
- Runaway resource usage: per-experiment timeout via `tokio::time::timeout` + `max_iterations` cap in blueprint
- Supply chain attacks: `deny.toml` for `cargo-deny` audits CVEs, licenses, and duplicate crates
- Git history pollution: experiment branches under the `experiment/` prefix with explicit cleanup paths
- SQL injection: all queries use `rusqlite::params![]` parameterised binding

## Current Status

The original phase model is now mostly complete through the working core runtime and Tauri desktop console.

Implemented in the current repository:

- workspace split across `maabarium-core`, `maabarium-cli`, and `maabarium-desktop`
- council-driven proposal generation and engine loop orchestration
- git-backed experiment isolation and branch promotion/revert flow
- SQLite persistence and export
- live Tauri desktop cards, history, diff, and logs backed by persisted runtime data
- blueprint-driven multi-model routing with per-model pacing
- tracing spans on engine, pool, evaluator, and sandbox hot paths
- Wasmtime-backed sandbox policy validation and subprocess-based code evaluation
- reusable experiment worktrees plus CLI run timing summaries for profiling and operator visibility
- APFS-friendly sandbox workspace materialization for macOS plus a portable fallback path for Linux and Windows

## Build Profiles

Portable optimised local builds can use:

```bash
cargo build --profile release-lto
```

Machine-specific local benchmarking can opt into native CPU tuning explicitly:

```bash
RUSTFLAGS="-C target-cpu=native" cargo build --profile release-lto
```

The native-tuned command is intentionally separate from portable release builds so distributed artefacts do not assume the build host's CPU feature set.

## Closure Status

The historical closure items are now explicitly resolved in code and docs:

1. Desktop packaging/distribution is documented for the Tauri desktop app
2. Evaluator selection is routed through an internal built-in registry
3. OSS launch artefacts exist and match the repository
4. The LoRA path is explicitly scoped to external artefact validation with reproducibility manifests

## Desktop Packaging and Distribution

The supported desktop distribution path is the Tauri app bundle built from the workspace.

Current packaging expectation:

- build with `cd crates/maabarium-desktop && pnpm tauri build`
- distribute the generated platform bundle from the Tauri output directory
- keep runtime data outside the app binary at `data/maabarium.db` and `data/maabarium.log`

The desktop stack is Tauri-based. A manual signing/notarisation process is documented, but not yet automated.

The detailed packaging/release expectations are documented in [DESKTOP_PACKAGING.md](DESKTOP_PACKAGING.md).

## Explicitly Deferred

The following are not active implementation commitments in the current roadmap:

- No second desktop shell is planned; the supported desktop shell is the Tauri app.
- No runtime shared-library evaluator plugin ABI is promised; external plugins remain deferred behind the built-in evaluator registry because ABI stability and supply-chain trust are not solved yet.
- No native Rust MLX-first path is promised; the supported LoRA path validates externally produced artefacts and reproducibility metadata instead of claiming in-engine training.
- No CI-backed signing/notarisation automation is promised yet.
- No return to the old broad phase-table format is planned for active docs.

## Evaluator Selection

Evaluator choice is now resolved through `EvaluatorRegistry` in `maabarium-core`.

- `evaluator.kind = "process"` selects `ProcessPluginEvaluator`
- `evaluator.kind = "builtin"` with `evaluator.builtin = "code" | "prompt" | "research" | "lora"` selects the matching built-in evaluator directly
- built-in template metadata is the next routing signal when there is no explicit evaluator override
- language, metric names, blueprint name, and target-path patterns remain as backward-compatible fallback heuristics

This keeps evaluator selection deterministic and typed without exposing a dynamic shared-library plugin surface.

## LoRA Execution Model

The supported LoRA workflow is intentionally narrow:

- training or fine-tuning happens outside the engine,
- proposals carry adapter artefacts plus `maabarium-lora-run.json`,
- `LoraEvaluator` scores artefact completeness, metadata hygiene, and reproducibility hints from that manifest.

This closes the roadmap item without overstating native MLX support.

## Superseded Historical Assumptions

- The live desktop app is Tauri-based and lives in `crates/maabarium-desktop`.
- The runtime does not use a pure WASI-only execution model for evaluator execution; it uses a hybrid sandboxing approach.
