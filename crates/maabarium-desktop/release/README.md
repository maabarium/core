# Desktop Release Flow

This directory is the working home for updater release artifacts produced for the Tauri desktop app.

## What Ships In The Desktop App

The desktop release is a standalone Tauri application that links `maabarium-core` into the app binary.

That means:

- the desktop app includes the core engine and can run the loop itself
- supported release builds can also bundle the standalone CLI binary as an app resource

For a user installing the macOS desktop release, there is not a second required process for the core engine. The desktop app owns that runtime.

The CLI remains optional at runtime, but supported desktop release builds can now seed a bundled copy into the app-data `bin/` directory so GUI installs can expose the same terminal-driven workflows without a second download step.

## Runtime Data Location

The packaged macOS desktop app stores its runtime files in app-specific directories:

- database: `~/Library/Application Support/com.maabarium.console/maabarium.db`
- blueprint library: `~/Library/Application Support/com.maabarium.console/blueprints/`
- bundled CLI: `~/Library/Application Support/com.maabarium.console/bin/maabarium`
- logs: `~/Library/Logs/com.maabarium.console/maabarium.log`

The built-in blueprint library is bundled into the desktop app as resources and seeded into the app-data `blueprints/` directory on startup.

If a legacy desktop session previously used repository-relative files under `data/` or `blueprints/`, the desktop app migrates those files forward on first run when the app-specific files do not already exist.

## What Is R2-Based vs Tauri-Based

- `MAABARIUM_UPDATE_BASE_URL` can point at a public Cloudflare R2 bucket URL or, preferably, an R2-backed custom domain such as `https://downloads.maabarium.com`.
- `latest.json` and the signed updater bundles can be published to that R2 bucket.
- `MAABARIUM_UPDATE_PUBKEY` is not a Cloudflare value. It is the public half of the Tauri updater signing keypair.

That means the storage and delivery URL can come from Cloudflare R2, but the trust anchor still comes from Tauri signing.

## Required Runtime Values

Configure the desktop app with:

- `MAABARIUM_UPDATE_BASE_URL` or `MAABARIUM_UPDATE_MANIFEST_URL`
- `MAABARIUM_UPDATE_PUBKEY`
- optional `MAABARIUM_UPDATE_CHANNEL`

Recommended layout when publishing to R2:

```text
https://downloads.maabarium.com/install.sh
https://downloads.maabarium.com/latest.json
https://downloads.maabarium.com/darwin-aarch64/Maabarium-Console.app.tar.gz
https://downloads.maabarium.com/darwin-aarch64/Maabarium-Console.app.tar.gz.sig
```

## Generating the Tauri Signing Keypair

Run this once from the desktop package:

```bash
cd crates/maabarium-desktop
pnpm tauri signer generate -w ~/.tauri/maabarium.key
```

That produces:

- a private key, used only in CI as `TAURI_SIGNING_PRIVATE_KEY`
- a public key file, whose contents become `MAABARIUM_UPDATE_PUBKEY`

`MAABARIUM_UPDATE_PUBKEY` must be the Tauri-generated updater public key content. Use either the raw key line or the two-line `.pub` file contents. Do not use a PEM block, a Cloudflare credential, or a base64url-encoded variant.

Before copying the value into GitHub, validate it locally:

```bash
cd crates/maabarium-desktop
pnpm validate:updater-pubkey -- --file ~/.tauri/maabarium.key.pub
```

The validator prints a `Recommended GitHub variable value` line. Use that raw key line for `MAABARIUM_UPDATE_PUBKEY` if you want to avoid multiline variable handling surprises in GitHub Actions.

The release workflow also passes that validated key to `tauri build --config ...` so Tauri's updater `pubkey` is overridden explicitly at bundle time and the placeholder value in `tauri.conf.json` is never used in CI.

For release packaging, the workflow also applies a release-only `productName` override of `Maabarium-Console`, so the generated macOS `.app`, `.dmg`, and updater `.app.tar.gz` artifacts use dashed filenames while the desktop window title remains `Maabarium Console`.

Do not commit either key. Only the public key content should be copied into runtime configuration.
Release builds should provide that public key during `pnpm tauri build` so the packaged app embeds the updater trust anchor. A runtime `MAABARIUM_UPDATE_PUBKEY` value still overrides the embedded key for local or development sessions.

## Local Release Build

Build signed updater artifacts locally:

```bash
cd crates/maabarium-desktop
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/maabarium.key"
export MAABARIUM_UPDATE_PUBKEY_FILE="$HOME/.tauri/maabarium.key.pub"
pnpm tauri build
pnpm build:release-manifest -- --base-url https://downloads.maabarium.com --cli-platform stable/0.1.0/darwin-aarch64/maabarium-cli.tar.gz
```

The generated manifest is written to:

```text
crates/maabarium-desktop/release/latest.json
```

Generate the matching bootstrap installer script from the same base URL metadata:

```bash
node scripts/release/generate-install-script.mjs \
  --base-url https://downloads.maabarium.com \
  --output crates/maabarium-desktop/release/install.sh
```

## GitHub Actions Release Job

The release system now has two layers:

- `.github/workflows/release-prep.yml` is the authoritative manual entry point. It accepts a required semver bump (`patch`, `minor`, or `major`), updates the version-bearing files, commits that change back to the selected branch, and creates the GitHub Release plus the `desktop-v*` tag.
- `.github/workflows/desktop-release-r2.yml` reacts to published or prereleased GitHub Releases and builds a signed macOS updater bundle from the release tag. It can still be run manually with `workflow_dispatch` when you need to republish an existing tag.

The desktop publishing workflow publishes:

- updater bundle
- updater signature
- `latest.json`
- `install.sh`

and also uploads those artifacts to the matching GitHub Release before syncing the updater files to Cloudflare R2.

### Release-Prep Inputs

- `bump`: required `patch | minor | major`
- `draft`: optional boolean
- `prerelease`: optional boolean

The semver level is intentionally explicit. The workflow does not try to infer major, minor, or patch from commit messages or file diffs.

### Release-Prep Flow

1. Run `release-prep` from the branch you want to release.
2. The workflow requires a successful completed `ci` push run for the current branch HEAD before it will prepare a release.
3. The workflow validates `CHANGELOG.md`, uses the `Unreleased` section as the GitHub Release notes, and requires explicit `### Breaking Changes` entries for major releases.
4. The workflow bumps versions in Cargo metadata, the desktop package manifest, and `tauri.conf.json`, then rolls the `Unreleased` section into the released version in `CHANGELOG.md`.
5. It commits the version bump plus the changelog rollover back to the branch.
6. It creates the GitHub Release, which also creates the `desktop-vX.Y.Z` tag.
7. Publishing that Release triggers `desktop-release-r2`, which builds and publishes the signed updater artifacts plus the generated `install.sh`.

to Cloudflare R2.

### Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- optional `MAABARIUM_UPDATE_PUBKEY` if you prefer storing the updater public key as a masked secret instead of a repository variable

### Required GitHub Variables

- `MAABARIUM_UPDATE_PUBKEY`
- `MAABARIUM_UPDATE_BASE_URL`
- `CLOUDFLARE_R2_BUCKET`
- `CLOUDFLARE_R2_ENDPOINT`

Example values:

- `MAABARIUM_UPDATE_PUBKEY = <contents of ~/.tauri/maabarium.key.pub>`
- `MAABARIUM_UPDATE_BASE_URL = https://downloads.maabarium.com`
- `CLOUDFLARE_R2_BUCKET = maabarium-releases`
- `CLOUDFLARE_R2_ENDPOINT = https://<account-id>.r2.cloudflarestorage.com`

## Triggering a Release

Recommended path:

1. Run `release-prep` from GitHub Actions.
2. Update `CHANGELOG.md` under `## [Unreleased]` with the notes for that release.
3. Choose the semver bump.
4. Let the created GitHub Release trigger `desktop-release-r2` automatically.

Fresh installs can then use:

```bash
curl -fsSL https://downloads.maabarium.com/install.sh | bash
```

The generated installer reads `latest.json` at runtime, selects the correct macOS architecture bundle, and installs the downloaded `.app` into `/Applications`.

Manual fallback:

- Run `desktop-release-r2` with `workflow_dispatch` and provide an existing `release_tag` if you need to rebuild or republish a release without generating a new version.

## Important Limitation

This workflow is intentionally narrow:

- it publishes a real signed macOS updater path now
- it does not yet build Linux and Windows updater artifacts into the same manifest

That is enough to verify a real updater manifest and end-to-end desktop update checks on macOS without guessing at multi-platform bundle naming.
