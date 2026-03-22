# Maabarium Architecture

## Overview

Maabarium is a Rust-native, local-first continuous improvement engine inspired by Karpathy's Autoresearch pattern. It implements a **keep-winner loop**: propose → apply → evaluate → keep-or-revert, generalized beyond ML training to arbitrary optimization domains.

## Design Principles

1. **Local-first, private, free** — Ollama + Metal on Apple Silicon, no cloud required by default
2. **Pure Rust control plane** — Tokio async runtime, no Python in the orchestration layer
3. **Autoresearch keep-winner loop** — propose → apply → evaluate → keep/revert
4. **Generalized domains** — pluggable Evaluator trait, not ML-only
5. **Beautiful desktop UX** — Tauri native app with live dashboards (Phase 3)
6. **Future-proof** — MIT license, plugin architecture

## Crate Structure

```
maabarium/
├── crates/
│   ├── maabarium-core/    # Engine, agents, git, LLM, evaluator, persistence
│   ├── maabarium-cli/     # Terminal CLI binary (Phase 1)
│   └── maabarium-app/     # Tauri desktop app (Phase 3 — placeholder)
```

The workspace is split so that `maabarium-core` can be built and tested without pulling in the heavy Tauri/WebView dependencies.

## Core Loop (`engine.rs`)

```
for iteration in 1..=max_iterations {
    branch = git.create_experiment_branch(iteration)
    proposal = council.propose(context, metrics)
    git.apply_proposal(branch, proposal)
    result = timeout(evaluator.evaluate(proposal))
    if result.weighted_total > baseline + min_improvement:
        git.promote_branch(branch)   // fast-forward main
        baseline = result.weighted_total
    else:
        git.delete_branch(branch)   // discard
    persistence.log_experiment(result)
}
```

Key design decisions:
- `CancellationToken` (from `tokio-util`) drives graceful shutdown on Ctrl-C
- Every fallible step uses `continue` with a `tracing::warn!` — no panics in production paths
- `tokio::time::timeout` enforces per-experiment wall-clock limits
- All results persist to SQLite before branch promotion/deletion

## Module Guide

| Module | Responsibility |
|--------|---------------|
| `blueprint` | TOML config parsing + validation |
| `engine` | Keep-winner loop orchestration |
| `agent` | Single Agent + Council (multi-agent debate) |
| `git_manager` | git2 operations, all wrapped in `spawn_blocking` |
| `llm/` | LLMProvider trait, Ollama backend, OpenAI-compat backend, ModelPool |
| `evaluator/` | Evaluator trait, ExperimentResult, PromptEvaluator |
| `metrics` | Weighted scoring, improvement detection, normalization |
| `persistence` | SQLite read/write (WAL mode, parameterised queries) |
| `error` | Typed error enums via `thiserror` |

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
- `OpenAICompatProvider` — generic OpenAI-compatible endpoint (OpenAI, Groq, Anthropic)
- `ModelPool` — round-robin across multiple providers

No external `ollama-rs` crate is used; the Ollama REST API is called directly.

## Evaluator Trait

```rust
#[async_trait]
pub trait Evaluator: Send + Sync {
    async fn evaluate(&self, proposal: &Proposal, iteration: u64) -> Result<ExperimentResult, EvalError>;
}
```

`ExperimentResult` carries multi-dimensional scores, weighted total, duration, and the original proposal — not just a bare `f64`.

## Persistence (SQLite)

Three tables:
- `experiments` — one row per experiment run
- `metrics` — one row per metric dimension per experiment
- `proposals` — proposal metadata

SQLite runs in WAL mode for concurrent reads from a future dashboard while the engine writes.

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Agent writes to arbitrary paths | Evaluator sandboxing in Phase 4 (wasmtime WASI or temp dir with bind mounts) |
| API key leakage | `keyring` crate → OS keychain. Never logged, never serialized to disk |
| Runaway resource usage | Per-experiment timeout via `tokio::time::timeout` + `max_iterations` cap in blueprint |
| Supply chain attacks | `deny.toml` for `cargo-deny`: audit CVEs, licenses, duplicate crates |
| Git history pollution | Experiment branches under `experiment/` prefix; auto-cleanup planned |
| SQL injection | All queries use `rusqlite::params![]` parameterised binding |

## Phased Roadmap

| Phase | Goal | Key deliverables |
|-------|------|-----------------|
| 0 | Foundation | Workspace, SQLite schema, error types, tracing |
| 1 | The Loop | Blueprint parsing, git manager, LLM provider, engine, CLI |
| 2 | Multi-agent | Council debate, multi-LLM pool, rate limiting, keyring |
| 3 | Desktop app | Tauri dashboard, Blueprint Wizard, live metrics |
| 4 | Sandboxing | wasmtime WASI, code evaluator, LoRA evaluator |
| 5 | OSS launch | README, cargo-deny CI, blueprint gallery, export |
