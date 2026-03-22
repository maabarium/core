# maabarium

Maabarium is a Rust workspace for running a local-first autonomous research loop:

1. load a blueprint
2. create a proposal
3. evaluate it in a sandbox
4. keep the winner
5. persist and export the results

## Workspace

- `crates/maabarium-core` — engine, evaluators, git manager, persistence, export
- `crates/maabarium-cli` — command-line interface for running, inspecting, and exporting experiments
- `crates/maabarium-app` — native Phase 3 console shell built with `eframe` / `egui`

## Current Phases

- **Phase 3** — desktop console shell
- **Phase 4** — sandbox scaffolding with code and LoRA evaluators
- **Phase 5** — OSS launch basics: README, CI, blueprint gallery, export

## Quick Start

Build the workspace:

```bash
cargo build
```

Run the engine with the example blueprint:

```bash
cargo run -p maabarium-cli -- run blueprints/example.toml
```

Inspect recent experiment history:

```bash
cargo run -p maabarium-cli -- status --db maabarium.db
```

Export experiment history:

```bash
cargo run -p maabarium-cli -- export --db maabarium.db --format json --output exports/history.json
cargo run -p maabarium-cli -- export --db maabarium.db --format csv --output exports/history.csv
```

## Blueprint Gallery

- `blueprints/example.toml` — basic optimizer example
- `blueprints/creator-buddy-prompts.toml` — prompt optimization workflow
- `blueprints/rust-code-quality.toml` — Rust code quality loop
- `blueprints/lora-adapter.toml` — LoRA adapter packaging / evaluation workflow

See:

- [`docs/BLUEPRINT_SPEC.md`](docs/BLUEPRINT_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Validation

Targeted validation commands used in this repository:

```bash
cargo test -p maabarium-app
cargo build
cargo test -p maabarium-core --test engine_loop
```
