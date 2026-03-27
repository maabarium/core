# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- None.

### Changed

- None.

### Fixed

- Packaged desktop apps now resolve the bundled CLI from the shipped `generated-resources/cli/...` path, so launching a newer app refreshes the app-data CLI instead of leaving an older seeded binary in place.
- Signed macOS desktop release bundles now embed the hardened-runtime entitlement required by the Wasmtime sandbox evaluator, preventing product-builder workflows from crashing when iteration evaluation publishes executable pages.
- Desktop release validation now fails fast when the built app is missing the macOS executable-memory entitlement required by the Wasmtime sandbox path.

### Breaking Changes

- None.

## [0.2.9] - 2026-03-27

### Added

- None.

### Changed

- None.

### Fixed

- The desktop onboarding modal no longer re-inspects the selected workspace on every background console snapshot refresh, preventing the workspace status row from flickering between "Inspecting..." and "Repository detected ...".
- The desktop onboarding modal now shows an in-progress state while recommended Ollama models are being pulled, so local-runtime setup no longer looks frozen during long downloads.

### Breaking Changes

- None.

## [0.2.8] - 2026-03-27

### Added

- Release manifests now publish standalone CLI archives under `cli.artifacts`, allowing packaged `maabarium` binaries to discover platform-specific self-update payloads.

### Changed

- Packaged CLI builds now embed their updater manifest/base URL configuration at build time, so `maabarium self version`, `self check`, and `self update` do not depend on runtime shell environment variables when launched outside CI.

### Fixed

- The desktop Ollama onboarding flow now detects app-bundle installs on macOS, so existing `/Applications/Ollama.app` setups are no longer misreported as missing when the `ollama` binary is not on `PATH`.
- The desktop local-runtime status now reports Ollama model inspection failures explicitly instead of incorrectly claiming that no local models exist, and the recommended-model pull action uses the same resolved Ollama command path.

### Breaking Changes

- None.

## [0.2.7] - 2026-03-27

### Added

- The desktop setup flow can now install or remove a managed `~/.local/bin/maabarium` symlink for the bundled CLI, report link health, and show macOS shell PATH guidance when that directory is not exported.
- The desktop onboarding flow now includes a `Pull Recommended Models` action that asks the local Ollama runtime to download any missing suggested models after Ollama is installed and running.

### Changed

- Packaged desktop releases now embed their updater manifest endpoint at build time, so Finder-launched apps no longer depend on runtime shell environment variables to enable update checks.
- The desktop updater UI and release workflow now use the published `stable` and `beta` channels instead of exposing an unused `nightly` option.
- The desktop app now self-heals the managed CLI symlink on startup when the bundled app-data CLI target changes or the existing link becomes stale.

### Fixed

- Release desktop builds no longer migrate repository-local runtime files and blueprint libraries by default, avoiding development-only state leaking into downloaded production apps.
- The macOS desktop window close hook now explicitly closes the window when no flow is running, so the native red close button works again instead of appearing to do nothing.
- Packaged desktop apps now resolve bundled blueprint resources from Tauri's nested `_up_` resource layout, so fresh installs seed the full built-in blueprint library instead of only showing `example.toml`.

### Breaking Changes

- None.

## [0.2.6] - 2026-03-26

### Added

- None.

### Changed

- The local desktop release smoke test now treats notarization and stapling as part of macOS launchability validation, rather than stopping at successful Developer ID code signing.

### Fixed

- The desktop release guidance now calls out that a signed-but-unnotarized app can surface Finder's generic `cannot be opened because of a problem` error on current macOS releases.
- The macOS desktop app no longer depends on Homebrew OpenSSL dylibs at launch, avoiding immediate startup aborts on notarized CI builds copied onto other machines.

### Breaking Changes

- None.

## [0.2.5] - 2026-03-26

### Added

- A macOS pre-bundle signing hook now signs the bundled desktop CLI resource with the configured Developer ID identity before Tauri packages the app.

### Changed

- The macOS desktop release workflow now imports the Apple signing certificate into a temporary keychain before bundling so nested packaged executables can be signed during the build.
- The local desktop release smoke test now verifies the bundled CLI executable inside the `.app` for Developer ID authority, secure timestamp, and hardened runtime in addition to the updater archive outputs.

### Fixed

- Desktop release preparation now clears stale generated bundled-CLI resources before copying the current target binary, preventing old resource layouts from leaking into later macOS app bundles.
- The macOS desktop release pipeline now signs the bundled CLI resource before app notarization, addressing notarization failures caused by an unsigned nested executable in `Contents/Resources/generated-resources/cli/.../maabarium`.
- Non-release desktop builds now ensure `generated-resources/cli/` exists before the release-only CLI bundling shortcut returns, preventing CI `cargo build` failures when Tauri validates bundled resource paths.

### Breaking Changes

- None.

## [0.2.4] - 2026-03-26

### Added

- The desktop package now includes a reusable `prepare:apple-certificate` helper that converts a Developer ID Application `.p12` export into a verified, GitHub-ready `APPLE_CERTIFICATE` base64 value.

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
