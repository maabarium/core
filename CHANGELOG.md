# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- None.

### Changed

- `release-prep` now refreshes `Cargo.lock` after version bumps on clean GitHub runners so release commits keep the workspace lockfile aligned with the published crate metadata.
- `release-prep` now enforces a successful CI run before preparing a release, uses the `Unreleased` section as GitHub Release notes, and commits the changelog rollover together with version bumps.

### Fixed

- The macOS desktop release workflow now publishes the updater archive as `Maabarium-Console.app.tar.gz` and validates plus injects the Tauri updater public key into the build config so signed release builds no longer fail on the placeholder updater pubkey.

### Breaking Changes

- None.

## [0.2.0] - 2026-03-25

### Added

- Automatic Git detection and guided installation across the CLI, desktop setup flows, and the generated macOS installer, reducing first-run friction for isolated worktree workflows.
- A generated `install.sh` artifact for macOS desktop releases that downloads the signed app bundle from `latest.json` metadata and installs it into `/Applications`.
- A `release-lto` Cargo build profile and companion build-profile documentation for faster optimized local builds with an explicit path for host-specific benchmarking.
- Changelog rollover support in the release automation so `Unreleased` notes are promoted directly into versioned release entries.

### Changed

- Engine execution is now more efficient and easier to reason about, with reusable detached experiment worktrees, explicit retained-versus-rejected promotion outcomes, and less unnecessary branch materialization.
- CLI runs now check for Git before starting and finish with aggregated timing summaries that make run performance easier to inspect.
- Sandbox and workspace materialization now favor APFS-friendly copy-on-write behavior on macOS while preserving a portable fallback path on other platforms.
- The desktop console now highlights retained winner scoring, adds a direct Maintenance jump target, gives the LoRA runtime panel more space, and presents clearer Git readiness and setup guidance with installer details.
- Release documentation and manifest examples now align on the production downloads host and describe the installer flow more clearly.

### Fixed

- GitHub Actions CI now installs the Linux desktop system packages required for reliable Tauri desktop validation.
- Dependency policy and release workflow configuration issues were corrected so `cargo-deny`, licensing checks, and release preparation complete more reliably in automation.

### Breaking Changes

- None.

## [0.1.0] - 2026-03-24

### Initial Release

- Initial Maabarium desktop, CLI, core engine, blueprint runtime, and release automation foundation.
