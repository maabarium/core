<p align="center">
	<img src="crates/maabarium-desktop/icons/maabariumLogo.png" alt="Maabarium logo" width="144" />
</p>

<h1 align="center">Maabarium</h1>

<p align="center"><strong>Local-first autonomous research and evaluation workflows in Rust.</strong></p>

<p align="center">Council-driven proposals • Git-isolated experiments • SQLite persistence • Tauri desktop console</p>

Maabarium is a Rust workspace for running blueprint-driven improvement loops across code, prompts, product work, and research.

At a high level, each run follows the same keep-winner pattern:

1. load a blueprint
2. generate a proposal through configured models
3. apply the proposal in an isolated git-backed workspace
4. evaluate the result in a sandbox or domain-specific evaluator
5. keep, reject, or export the outcome with persistence and traces

What ships today:

- council-driven proposal generation with configurable model routing and request pacing
- git-backed experiment isolation, proposal application, and winner promotion
- SQLite persistence for experiments, metrics, proposals, and desktop history views
- keychain-backed provider secret storage
- research and LoRA-oriented evaluator flows alongside general code and prompt workflows
- a Tauri desktop console with setup persistence, blueprint library management, live run state, history, diff, and logs

## Workspace

- `crates/maabarium-core` — engine, evaluators, git manager, persistence, export
- `crates/maabarium-cli` — command-line interface for running, inspecting, and exporting experiments
- `crates/maabarium-desktop` — Tauri desktop console with the web UI and native shell

## Current Status

The repository has a working core runtime, CLI, and Tauri desktop application.

Current repository capabilities include:

- council-driven keep-winner engine orchestration
- blueprint-driven model assignment with `explicit` and `round_robin` strategies
- Wasmtime-backed sandbox policy validation and subprocess-based evaluation paths
- desktop onboarding/setup persistence for runtime strategy, local and remote providers, workspace defaults, and research search mode
- desktop packaging and updater support for the Tauri app shell

Remaining closure work and historical parity notes live under:

- [`.dev/complete/implementation-parity.md`](.dev/complete/implementation-parity.md)
- [`.dev/complete/implementation-remaining-items.md`](.dev/complete/implementation-remaining-items.md)

## Desktop Packaging

The desktop application is the Tauri project in `crates/maabarium-desktop`, shipped as **Maabarium Console**.

Current supported packaging/distribution path:

```bash
cd crates/maabarium-desktop && pnpm tauri build
```

Expected macOS bundle output:

```text
target/release/bundle/macos
```

Desktop runtime data is external to the app bundle and stored in app-specific OS locations.

On macOS, the desktop app uses:

- `~/Library/Application Support/com.maabarium.console/maabarium.db`
- `~/Library/Logs/com.maabarium.console/maabarium.log`
- `~/Library/Application Support/com.maabarium.console/blueprints/`
- `~/Library/Application Support/com.maabarium.console/bin/maabarium`

On first launch, the desktop app can migrate legacy repo-local runtime files forward when they already exist.

The desktop bundle also seeds bundled blueprint TOMLs into the app-data blueprint library, and release bundles can ship a standalone CLI resource for desktop installs.

See [docs/DESKTOP_PACKAGING.md](docs/DESKTOP_PACKAGING.md) for the fuller packaging and updater flow.

## Quick Start

### Build The Workspace

```bash
cargo build
```

### Run The CLI With The Example Blueprint

```bash
cargo run -p maabarium-cli -- run blueprints/example.toml --db data/maabarium.db
```

### Inspect Recent Experiment History

```bash
cargo run -p maabarium-cli -- status --db data/maabarium.db
```

### Export Experiment History

```bash
cargo run -p maabarium-cli -- export --db data/maabarium.db --format json --output exports/history.json
cargo run -p maabarium-cli -- export --db data/maabarium.db --format csv --output exports/history.csv
```

### Manage Provider API Keys Through The OS Keychain

```bash
cargo run -p maabarium-cli -- keys set openai
cargo run -p maabarium-cli -- keys get openai
cargo run -p maabarium-cli -- keys delete openai
```

### Launch The Desktop App In Development

```bash
cd crates/maabarium-desktop
pnpm install
pnpm tauri dev
```

## Blueprint Gallery

- `blueprints/example.toml` — example prompt-lab workflow for improving Maabarium itself
- `blueprints/code-quality.toml` — correctness, readability, maintainability, and performance improvements for production codebases
- `blueprints/prompt-improvement.toml` — prompt clarity, specificity, and usability improvements for reusable prompt assets
- `blueprints/product-builder.toml` — end-to-end product strategy, implementation, and verification loop for whole applications
- `blueprints/general-research.toml` — grounded research workflow with source tracking and explicit citations
- `blueprints/lora-adapter.toml` — sandboxed validation of externally produced LoRA adapter artifacts and reproducibility metadata

## Documentation

- [docs/BLUEPRINT_SPEC.md](docs/BLUEPRINT_SPEC.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DESKTOP_PACKAGING.md](docs/DESKTOP_PACKAGING.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [.dev/complete/implementation-parity.md](.dev/complete/implementation-parity.md)
- [.dev/complete/implementation-remaining-items.md](.dev/complete/implementation-remaining-items.md)

## Validation

Targeted validation commands used in this repository:

```bash
cargo build
cargo test
cargo test -p maabarium-core --test engine_loop
cd crates/maabarium-desktop && pnpm build
```

## License

Maabarium is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
