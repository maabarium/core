# maabarium

Maabarium is a Rust workspace for running a local-first autonomous research loop:

1. load a blueprint
2. create a proposal
3. evaluate it in a sandbox
4. keep the winner
5. persist and export the results

The current implementation includes:

- a council-driven engine loop that generates proposals through configured LLM providers
- git worktree application before evaluation and promotion
- keychain-backed API key storage
- a Tauri desktop console that tails shared tracing logs and reads live experiment metrics from SQLite
- blueprint-driven model routing with `explicit` and `round_robin` assignment modes

## Workspace

- `crates/maabarium-core` — engine, evaluators, git manager, persistence, export
- `crates/maabarium-cli` — command-line interface for running, inspecting, and exporting experiments
- `crates/maabarium-desktop` — Tauri desktop console with the web UI and native shell

## Current Status

The repository has a working core runtime and Tauri desktop console.

Implemented today:

- council-driven proposal generation and keep-winner engine loop
- git-backed application, evaluation, persistence, and promotion/revert flow
- keychain-backed provider secret storage
- Tauri desktop console with live score, history, diff, and log views
- blueprint-driven model routing with `explicit` and `round_robin` assignment modes
- Wasmtime-backed sandbox policy validation and subprocess-based code evaluation

Remaining closure work is tracked in [`.dev/implementation-remaining-items.md`](.dev/implementation-remaining-items.md).

## Desktop Packaging

The desktop application is the Tauri project in `crates/maabarium-desktop`.

Current supported packaging/distribution path:

```bash
cd crates/maabarium-desktop && pnpm tauri build
```

Expected macOS bundle output:

```text
target/release/bundle/macos
```

Runtime data remains external to the binary and is expected at:

- `data/maabarium.db`
- `data/maabarium.log`

See [`docs/DESKTOP_PACKAGING.md`](docs/DESKTOP_PACKAGING.md) for the current release expectations and deferred packaging work.

## Quick Start

Build the workspace:

```bash
cargo build
```

Run the engine with the example blueprint:

```bash
cargo run -p maabarium-cli -- run blueprints/example.toml --db data/maabarium.db
```

Inspect recent experiment history:

```bash
cargo run -p maabarium-cli -- status --db data/maabarium.db
```

Export experiment history:

```bash
cargo run -p maabarium-cli -- export --db data/maabarium.db --format json --output exports/history.json
cargo run -p maabarium-cli -- export --db data/maabarium.db --format csv --output exports/history.csv
```

Manage provider API keys through the OS keychain:

```bash
cargo run -p maabarium-cli -- keys set openai
cargo run -p maabarium-cli -- keys get openai
cargo run -p maabarium-cli -- keys delete openai
```

## Blueprint Gallery

- `blueprints/example.toml` — basic optimizer example
- `blueprints/prompt-improvement.toml` — generic prompt improvement workflow
- `blueprints/code-quality.toml` — generic code quality loop
- `blueprints/lora-adapter.toml` — external LoRA adapter artifact validation workflow with a reproducibility manifest

See:

- [`docs/BLUEPRINT_SPEC.md`](docs/BLUEPRINT_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DESKTOP_PACKAGING.md`](docs/DESKTOP_PACKAGING.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`SECURITY.md`](SECURITY.md)
- [`.dev/implementation-parity.md`](.dev/implementation-parity.md)
- [`.dev/implementation-remaining-items.md`](.dev/implementation-remaining-items.md)

## Validation

Targeted validation commands used in this repository:

```bash
cargo build
cargo test -p maabarium-core --test engine_loop
cd crates/maabarium-desktop && pnpm build
```
