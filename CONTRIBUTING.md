# Contributing to maabarium

## Scope

This repository is a Rust workspace for a local-first autonomous research loop. Contributions should preserve the current product direction:

- Tauri desktop app
- Rust-first control plane and evaluators
- SQLite persistence and shared tracing/log files
- blueprint-driven runtime behavior

Review [docs/ROADMAP.md](docs/ROADMAP.md) early if you are proposing a new capability, workflow surface, or product-direction change. It is the clearest public view of where the project should become more useful over time.

If a proposed change would reintroduce stale historical assumptions, update the active docs as part of the change or raise the design decision explicitly.

## Workspace Layout

- `crates/maabarium-core` — engine, council/agents, evaluators, git manager, persistence, export
- `crates/maabarium-cli` — CLI entry point and key-management commands
- `crates/maabarium-desktop` — Tauri desktop console
- `blueprints/` — example and domain blueprints
- `docs/` — active architecture and blueprint-spec documentation
- `.dev/` — implementation parity and closure-planning documents

## Development Setup

Build the workspace:

```bash
cargo build
```

Run the main validation suite:

```bash
cargo test
```

Useful targeted commands:

```bash
cargo test -p maabarium-core --test engine_loop
cd crates/maabarium-desktop && pnpm build
cd crates/maabarium-desktop && pnpm tauri build
```

Run the CLI against the example blueprint:

```bash
cargo run -p maabarium-cli -- run blueprints/example.toml --db data/maabarium.db
```

Inspect experiment history:

```bash
cargo run -p maabarium-cli -- status --db data/maabarium.db
```

Export experiment history:

```bash
cargo run -p maabarium-cli -- export --db data/maabarium.db --format json --output exports/history.json
cargo run -p maabarium-cli -- export --db data/maabarium.db --format csv --output exports/history.csv
```

## Contribution Expectations

- Keep changes focused. Do not mix large refactors with unrelated fixes.
- Preserve the current crate boundaries unless there is a strong reason to change them.
- Prefer root-cause fixes over surface workarounds.
- Do not reformat unrelated code.
- Add or update tests when behavior changes.
- Keep docs in sync when changing runtime behavior, blueprint fields, or roadmap status.

## Code and Review Standards

- Follow the existing Rust style in the repository.
- Use typed errors and avoid adding panic-driven control flow in production paths.
- Preserve tracing and observability on hot paths.
- Treat sandboxing, subprocess execution, secret handling, and persistence changes as security-sensitive.
- Avoid introducing new dependencies unless they are justified by clear functionality or maintenance wins.

## Documentation Expectations

When a change affects project behavior, update the relevant active docs:

- `README.md` for top-level user/developer workflow changes
- `docs/ARCHITECTURE.md` for runtime or architecture changes
- `docs/BLUEPRINT_SPEC.md` for blueprint schema changes
- `.dev/complete/implementation-parity.md` when parity status changes materially
- `.dev/complete/implementation-remaining-items.md` when one of the remaining closure items advances, is deferred, or is closed

## Adding Evaluators or Providers

For new evaluators:

- keep the `Evaluator` contract structured and deterministic where possible
- document runtime prerequisites
- include reproducibility metadata where relevant
- add targeted tests and update docs if blueprint or persistence behavior changes

For new LLM providers:

- fit the existing `LLMProvider` abstraction
- respect model routing and pacing behavior
- avoid leaking secrets into logs or persisted state
- document any provider-specific configuration expectations

## Pull Request Guidance

- Summarize the user-visible or architecture-visible change clearly.
- Call out any documentation updates.
- Mention validation performed, ideally with the exact commands run.
- Note follow-up work explicitly instead of leaving hidden TODOs in behavior-critical paths.

## Issue Intake

- Use the GitHub issue templates under `.github/ISSUE_TEMPLATE/` so roadmap ideas and contributor reports arrive with enough context to act on.
- Use the roadmap idea template for future capabilities, product-direction changes, and UX/workflow proposals.
- Use the contributor report template for bugs, regressions, and contributor workflow problems.
- If an issue changes project behavior, keep the linked roadmap and active docs in sync as the work lands.
