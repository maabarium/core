# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- None.

### Changed

- The macOS desktop release workflow now supports Apple Developer signing and notarization inputs so the published updater archive can contain a Gatekeeper-acceptable app bundle rather than only an updater-signed payload.

### Fixed

- The macOS desktop release workflow now collects staged GitHub Release upload assets with a Bash 3-compatible loop instead of `mapfile`, avoiding upload-step failures on GitHub's macOS runners.
- The desktop release documentation now includes exact local re-sign, notarization, stapling, and optional updater re-pack/sign commands for testing a built app on macOS.

### Breaking Changes

- None.

## [0.2.3] - 2026-03-26

### Added

- None.

### Changed

- The macOS desktop release workflow and local release smoke test now bundle only the `app` target because the updater publish path consumes the signed `.app.tar.gz` archive and `.sig`, not the GUI-oriented `.dmg`.

### Fixed

- The desktop release pipeline no longer depends on the headless-hostile DMG creation step, avoiding `bundle_dmg.sh` failures on GitHub macOS runners while still producing the updater bundle consumed by `latest.json`.
- The local desktop release smoke test now accepts unencrypted Tauri updater signing keys, matching the actual CLI behavior instead of requiring a password when none exists.
- The desktop release workflow and local smoke test now export an explicit empty updater signing-key password when none is configured, preventing interactive password prompts for unencrypted keys.

### Breaking Changes

- None.

## [0.2.2] - 2026-03-26

### Added

- None.

### Changed

- The macOS desktop release workflow now passes explicit Tauri config overrides during `tauri build` so release packaging can inject the validated updater public key and emit dashed `Maabarium-Console` bundle artifact names without changing the desktop window title.

### Fixed

- The desktop release manifest generator now tolerates the `--` separator forwarded by `pnpm`, so `pnpm build:release-manifest -- ...` succeeds in CI.
- The macOS desktop release workflow no longer falls back to the placeholder updater pubkey from `tauri.conf.json` during bundling, preventing repeated signed-release failures from invalid pubkey decoding.

### Breaking Changes

- None.

## [0.2.1] - 2026-03-25

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
