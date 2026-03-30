# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- None.

### Changed

- None.

### Fixed

- None.

### Breaking Changes

- None.

## [0.3.7] - 2026-03-30

### Added

- None.

### Changed

- None.

### Fixed

- More release script issues.

### Breaking Changes

- None.

## [0.3.6] - 2026-03-30

### Added

- None.

### Changed

- None.

### Fixed

- Issues with release scripts.

### Breaking Changes

- None.

## [0.3.5] - 2026-03-30

### Added

- None.

### Changed

- None.

### Fixed

- Local desktop release validation now proves updater keypairs by signing a probe payload with the private key, prompts for encrypted updater-key passwords in local interactive flows, and avoids false mismatch reports on encrypted minisign secret keys.

### Breaking Changes

- None.

## [0.3.4] - 2026-03-30

### Added

- None.

### Changed

- None.

### Fixed

- Desktop updater pubkey normalization now unwraps base64-wrapped minisign key files in build-time embedding and release tooling, preventing packaged apps from embedding the wrong trust anchor and rejecting valid signed updates with signature verification failures.
- Local desktop release validation now proves updater keypairs by signing a probe payload with the private key, prompts for encrypted updater-key passwords in local interactive flows, and avoids false mismatch reports on encrypted minisign secret keys.

### Breaking Changes

- None.

## [0.3.3] - 2026-03-30

### Added

- None.

### Changed

- The Blueprint Wizard tips panel now includes clearer guidance for authoring exact-document workflows that need a genuinely detailed first draft rather than a shallow outline.

### Fixed

- Later proposal iterations now build file context from the reusable experiment workspace instead of the original repo path, so exact-document workflows can deepen promoted drafts with `modify` patches instead of repeatedly proposing fresh `create` patches.

### Breaking Changes

- None.

## [0.3.2] - 2026-03-30

### Added

- The Blueprint Wizard now includes a toggleable workflow tips panel with clear guidance on workflow scope, agent behavior, runtime tuning, and incremental document strategies for exact markdown workflows.

### Changed

- Proposal generation now respects the configured model token budget for exact single-document markdown and prompt workflows, so large document-oriented runs no longer silently inherit the older 768-token proposal cap.
- Bundled prompt-improvement and general-research blueprints now steer document-oriented runs toward narrower scaffold-first or section-sized markdown edits, so newly seeded templates match the safer guidance added to the Project Echo workflow.

### Fixed

- Exact single-document markdown workflows now bias proposal prompts toward compact scaffold-first or section-sized edits, which keeps document plans reviewable and reduces truncated JSON failures on local Ollama models.

### Breaking Changes

- None.

## [0.3.1] - 2026-03-29

### Added

- None.

### Changed

- None.

### Fixed

- Retained winner archive export now downloads the generated `.tar.gz` directly from the desktop backend instead of relying on the macOS save-dialog path that was still failing to produce an archive.
- Retained patchset and persisted-preview downloads now show immediate in-card feedback, so evidence exports no longer feel like silent background downloads.
- Research evidence-gap proposals with no file patches now degrade into scored rejections instead of hard parse errors when discovery still cannot resolve a source, so later iterations can continue without being derailed by citation-free fallback summaries.

### Breaking Changes

- None.

## [0.3.0] - 2026-03-29

### Added

- None.

### Changed

- Blueprint documentation and desktop wizard copy now explain workflow types, output types, and target path rules more explicitly, including when to use exact markdown output paths versus broad globs.
- The desktop blueprint wizard now starts with a guided goal, output, workspace, runtime, and review flow that derives safer defaults from the outcome you want, while keeping the full raw template, metric, agent, and model controls available under an advanced section.
- The desktop Blueprint Wizard now uses a denser breadcrumb-style guided layout with a persistent live summary sidebar, mirrored navigation actions, more tactile goal and deliverable cards, and a full-width advanced mode that temporarily takes over the canvas.
- The desktop Blueprint Wizard now hardens its guided render path against malformed live state instead of blanking the full app, and the workspace/runtime steps now surface clearer operational status cards and target-path review blocks so the new shell reads more cleanly.
- The desktop Blueprint Wizard now normalizes malformed live metric, agent, and model state before hook selectors and modal rendering run, and its render boundary now wraps the full body so bad persisted wizard state falls back to an in-modal error instead of a blank screen.
- The guided Blueprint Wizard step bodies now stack their main content cards in cleaner full-width rows instead of splitting each step into narrow side-by-side columns, which makes the step content easier to scan and use on wide desktop layouts.
- The Blueprint Wizard now surfaces workflow identity before goal selection in the guided flow, and the advanced basics, evaluation, and model tabs have been flattened into broader stacked sections instead of older split-column panels.
- Selecting a goal in the guided Blueprint Wizard no longer auto-advances to the output step; the flow now waits for the explicit Next Step action so the goal step feels less jumpy.
- The goal step now reads as name, goal, then description, and custom description text is preserved when the workflow goal changes instead of being reset by template-derived defaults.
- The desktop console now lets operators collapse Run Analytics, Evidence, Workflow Library, and Maintenance independently, restores that layout after restart, and keeps the Blueprint Wizard summary rail sticky with its own scroll window so review actions stay visible during long guided forms.
- The embedded Maintenance readiness tab once again exposes a visible `Run Setup` action, so the guided onboarding modal remains reachable even when the old global setup shortcut is absent.
- The guided Blueprint Wizard runtime step now lets operators change the primary model directly without opening Advanced mode; selecting it reorders the current model pool and updates the simplified council baseline.
- The guided Blueprint Wizard now honors Ollama models explicitly selected in desktop setup even when the live Ollama snapshot has not surfaced them yet, so setup-chosen local models appear in the runtime-step primary-model selector and seed new wizard model pools consistently.
- The desktop console now keeps retained promoted winners and their persisted proposal patchsets in the active workflow snapshot, shows a compact retained winner history with explicit export actions, lets the activity diff jump directly to the selected retained winner, and can export the actual promoted winner files as a backend-built tar.gz archive instead of only downloading persisted patch metadata.
- The desktop console now consolidates retained artifacts, research evidence, and LoRA runtime inspection into a single tabbed evidence panel, keeps manual evidence-tab selection stable, and expands that area to use the freed vertical space in the main console column.
- The maintenance row now combines Readiness Center, Updates, and Persisted Stack into one full-width tabbed maintenance panel instead of splitting those controls across separate cards and the right sidebar.
- The desktop console now remembers the last selected maintenance and evidence tabs across app reloads, so console operators return to the same inspection surface after restart.
- The Blueprint Wizard guided flow now stays goal-first by default: the old template picker is hidden behind advanced controls, and the stepped header renders a derived summary instead of leaking raw guidance text and model names into the main flow.

### Fixed

- Promoting a winner onto `main` or `master` now refreshes a clean checked-out target branch immediately after the ref move, preventing the repository checkout from showing staged deletions or stale tracked files until the user manually resets.
- Proposal generation now performs one structured repair pass when a model reply omits the top-level JSON proposal envelope, letting the same model or a pooled fallback model convert otherwise-usable content into Maabarium's proposal schema before the iteration fails.
- Ollama proposal runs now recover completion content from the provider's `thinking` field when `response` is empty, and still log a bounded raw payload excerpt plus an explicit provider diagnostic when both fields are blank despite reported eval tokens.
- The desktop Evidence > Retained export flow now shows in-card progress while packaging a retained winner archive and confirms the saved `.tar.gz` location after export, so retained file exports no longer read like silent no-ops.
- Retained patchset and persisted-preview downloads now show immediate in-card feedback, and retained archive export now normalizes the chosen save path to `.tar.gz` without relying on a brittle multi-dot file filter in the native save dialog.
- Retained winner archive export now downloads the generated `.tar.gz` directly from the desktop backend instead of relying on the macOS save-dialog path that was still failing to produce an archive.
- Research evidence-gap proposals with no file patches now degrade into scored rejections instead of hard parse errors when discovery still cannot resolve a source, so later iterations can continue without being derailed by citation-free fallback summaries.

### Breaking Changes

- None.

## [0.2.14] - 2026-03-28

### Added

- None.

### Changed

- None.

### Fixed

- Empty markdown and prompt workflows now receive safe file-creation guidance when no target document exists yet, and exact markdown target-file paths no longer expand into invalid nested `draft.md` suggestions.
- Prompt and markdown workflow evaluation now accepts numeric scores followed by extra model text, preventing first-iteration failures when the evaluator model returns a valid score plus a short explanation instead of a bare float.

### Breaking Changes

- None.

## [0.2.13] - 2026-03-28

### Added

- None.

### Changed

- None.

### Fixed

- Desktop release validation now rejects mismatched updater private/public minisign keypairs before publishing, preventing in-app updater failures where a downloaded release bundle cannot pass signature verification.

### Breaking Changes

- None.

## [0.2.12] - 2026-03-28

### Added

- None.

### Changed

- None.

### Fixed

- Application workflows now reject empty proposal patchsets and no-op detached workspaces instead of promoting a retained branch when nothing was actually written to the repository.

### Breaking Changes

- None.

## [0.2.11] - 2026-03-27

### Added

- None.

### Changed

- None.

### Fixed

- Local and CI desktop release builds now preserve the macOS entitlement override when forcing the updater-only `app` bundle target, so signed `Maabarium-Console.app` artifacts keep the Wasmtime executable-memory entitlement instead of failing the release verifier.

### Breaking Changes

- None.

## [0.2.10] - 2026-03-27

### Added

- None.

### Changed

- Release operators can now run the `release-prep` and macOS `desktop-release-r2` flows directly from a local workstation with repo-provided scripts when GitHub Actions minutes are unavailable.

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
