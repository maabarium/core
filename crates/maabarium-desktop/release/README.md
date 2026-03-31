# Desktop Release Flow

This directory is the working home for updater release artifacts produced for the Tauri desktop app.

## What Ships In The Desktop App

The desktop release is a standalone Tauri application that links `maabarium-core` into the app binary.

That means:

- the desktop app includes the core engine and can run the loop itself
- supported release builds can also bundle the standalone CLI binary as an app resource

For a user installing the macOS desktop release, there is not a second required process for the core engine. The desktop app owns that runtime.

The CLI remains optional at runtime, but supported desktop release builds can now seed a bundled copy into the app-data `bin/` directory so GUI installs can expose the same terminal-driven workflows without a second download step.

If a user installs the optional shell link from the desktop setup flow, that `~/.local/bin/maabarium` symlink is managed separately from the `.app` bundle. Dragging `Maabarium-Console.app` to Trash does not remove the shell link automatically; use the app's `Remove CLI Link` action first if you want to clean that integration up.

## Runtime Data Location

The packaged macOS desktop app stores its runtime files in app-specific directories:

- database: `~/Library/Application Support/com.maabarium.console/maabarium.db`
- blueprint library: `~/Library/Application Support/com.maabarium.console/blueprints/`
- bundled CLI: `~/Library/Application Support/com.maabarium.console/bin/maabarium`
- logs: `~/Library/Logs/com.maabarium.console/maabarium.log`

The built-in blueprint library is bundled into the desktop app as resources and seeded into the app-data `blueprints/` directory on startup.

Debug desktop builds migrate legacy repository-relative files under `data/` or `blueprints/` on first run when the app-specific files do not already exist. Packaged release builds do not perform that migration unless `MAABARIUM_ENABLE_LEGACY_DESKTOP_MIGRATION=1` is set for the process.

## What Is R2-Based vs Tauri-Based

- `MAABARIUM_UPDATE_BASE_URL` can point at a public Cloudflare R2 bucket URL or, preferably, an R2-backed custom domain such as `https://downloads.maabarium.com`.
- `latest.json` and the signed updater bundles can be published to that R2 bucket.
- `MAABARIUM_UPDATE_PUBKEY` is not a Cloudflare value. It is the public half of the Tauri updater signing keypair.

That means the storage and delivery URL can come from Cloudflare R2, but the trust anchor still comes from Tauri signing.

## Required Runtime Values

Configure the desktop app with:

- `MAABARIUM_UPDATE_BASE_URL` or `MAABARIUM_UPDATE_MANIFEST_URL`
- `MAABARIUM_UPDATE_PUBKEY`
- optional `MAABARIUM_UPDATE_CHANNEL` with `stable` or `beta`

Packaged release builds should embed those values at build time. Finder-launched apps do not inherit your GitHub Actions environment, so setting `MAABARIUM_UPDATE_BASE_URL` only in CI publication steps is not enough on its own.

Recommended layout when publishing to R2:

```text
https://downloads.maabarium.com/install.sh
https://downloads.maabarium.com/latest.json
https://downloads.maabarium.com/stable/latest.json
https://downloads.maabarium.com/beta/latest.json
https://downloads.maabarium.com/darwin-aarch64/Maabarium-Console.app.tar.gz
https://downloads.maabarium.com/darwin-aarch64/Maabarium-Console.app.tar.gz.sig
```

`latest.json` remains the stable alias for the install script. The in-app updater resolves `stable/latest.json` or `beta/latest.json` based on the saved release channel.

## Reset Old Production App Data Before A Fresh Release Test

If you previously ran older packaged builds that populated `~/Library/Application Support/com.maabarium.console`, you can back up and clear that production desktop state before testing a new release:

```bash
cd crates/maabarium-desktop
pnpm reset:macos-production-data
```

That script moves existing production app data, logs, preferences, and saved state into a timestamped backup under `~/Library/Application Support/maabarium-reset-backups/`. Use `--dry-run` to inspect what would be moved.

## Generating the Tauri Signing Keypair

Run this once from the desktop package:

```bash
cd crates/maabarium-desktop
pnpm tauri signer generate -w ~/.tauri/maabarium.key
```

That produces:

- a private key, used only in CI as `TAURI_SIGNING_PRIVATE_KEY`
- a public key file, whose contents become `MAABARIUM_UPDATE_PUBKEY`

`MAABARIUM_UPDATE_PUBKEY` must be the Tauri-generated updater public key content. You can provide either the raw key line or the two-line `.pub` file contents, but Maabarium now normalizes both forms into the base64-wrapped minisign payload that Tauri expects at runtime. Do not use a PEM block, a Cloudflare credential, or a base64url-encoded variant.

Before copying the value into GitHub, validate it locally:

```bash
cd crates/maabarium-desktop
pnpm validate:updater-pubkey -- --file ~/.tauri/maabarium.key.pub
```

The validator prints a `Recommended GitHub variable value` line. Use that raw key line for `MAABARIUM_UPDATE_PUBKEY` if you want to avoid multiline variable handling surprises in GitHub Actions.

The release workflow also passes a normalized base64-wrapped minisign public key to `tauri build --config ...` so Tauri's updater `pubkey` is overridden explicitly at bundle time and the placeholder value in `tauri.conf.json` is never used in CI. The compiled desktop runtime now embeds the normalized base64-wrapped updater pubkey via `MAABARIUM_UPDATE_PUBKEY` or `MAABARIUM_UPDATE_PUBKEY_FILE`, matching what the updater plugin expects during install.

For release packaging, the workflow also applies a release-only `productName` override of `Maabarium-Console`, so the generated macOS `.app` and updater `.app.tar.gz` artifacts use dashed filenames while the desktop window title remains `Maabarium Console`.

The GitHub release workflow now bundles only the macOS `app` target. That is intentional: the updater publishing flow consumes the signed `.app.tar.gz` bundle and its `.sig`, while the `.dmg` path pulls in Finder AppleScript steps that are brittle on headless runners and are not used by the updater manifest.

When the Apple signing secrets are configured, that workflow also uses Tauri's supported macOS signing and notarization environment variables during `tauri build`, so the published updater archive contains a Developer ID-signed and notarized app instead of an ad-hoc signed bundle that Gatekeeper will reject.

Because the desktop app embeds a Wasmtime-based sandbox evaluator, signed macOS release bundles also need the hardened-runtime exception `com.apple.security.cs.allow-unsigned-executable-memory`. That entitlement now comes from `crates/maabarium-desktop/Entitlements.plist`, and both the local release smoke script and CI workflow verify that the built app binary carries it before artifacts are staged or published.

Do not commit either key. Only the public key content should be copied into runtime configuration.
Release builds should provide that public key during `pnpm tauri build` so the packaged app embeds the updater trust anchor. A runtime `MAABARIUM_UPDATE_PUBKEY` value still overrides the embedded key for local or development sessions.

## Local Release Build

Build signed updater artifacts locally:

```bash
cd crates/maabarium-desktop
export TAURI_SIGNING_PRIVATE_KEY_FILE="$HOME/.tauri/maabarium.key"
export MAABARIUM_UPDATE_PUBKEY_FILE="$HOME/.tauri/maabarium.key.pub"
pnpm test:release-local
```

Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if your updater private key was generated with a password. Unencrypted local keys can omit it.

The local smoke script and CI workflow export an explicit empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when none is configured so Tauri does not pause for an interactive password prompt on unencrypted keys.

That command performs the same local steps the CI release job cares about:

- validates the updater pubkey
- builds the signed macOS app bundle with the dashed release-only product name
- verifies the signed app keeps the Wasmtime executable-memory entitlement required by the sandbox evaluator
- verifies the updater archive and `.sig` exist
- stages the updater bundle under the platform key
- generates `latest.json` and `install.sh`

The generated manifest is written to:

```text
crates/maabarium-desktop/release/latest.json
```

If you only want to build the app manually, the equivalent bundle command is:

```bash
pnpm tauri build --config '{"productName":"Maabarium-Console","bundle":{"targets":["app"]}}'
```

## GitHub Actions Release Job

The release system now has two layers:

- `.github/workflows/release-prep.yml` is the authoritative manual entry point. It accepts a required semver bump (`patch`, `minor`, or `major`), updates the version-bearing files, commits that change back to the selected branch, and creates the GitHub Release plus the `desktop-v*` tag.
- `.github/workflows/desktop-release-r2.yml` reacts to published or prereleased GitHub Releases and builds a signed macOS updater bundle from the release tag. It can still be run manually with `workflow_dispatch` when you need to republish an existing tag.

If GitHub Actions minutes are unavailable, the local equivalents are `bash ./scripts/release/run-local-release-prep.sh --bump <patch|minor|major>` from the repository root and `cd crates/maabarium-desktop && pnpm publish:release-local -- --release-tag desktop-vX.Y.Z --release-channel stable|beta` for the macOS publish step.

The desktop publishing workflow publishes:

- updater bundle
- updater signature
- standalone CLI archive
- `latest.json`
- `install.sh`

and also uploads those artifacts to the matching GitHub Release before syncing the updater files to Cloudflare R2.

### Stable vs Beta Operator Checklist

Use the published Release event as the default trigger. Manual `workflow_dispatch` is primarily for rebuilding or republishing an existing tag.

Stable:

1. Run `release-prep` with the intended semver bump.
2. Publish the normal GitHub Release created by that workflow.
3. Let `desktop-release-r2` publish the signed bundle plus `stable/latest.json`.
4. Verify the workflow also refreshed root `latest.json` for the install script.

Beta:

1. Create or publish the tag as a GitHub prerelease.
2. Let `desktop-release-r2` react to that prerelease and publish the `beta` channel automatically.
3. Only use manual `workflow_dispatch` with `release_channel=beta` when republishing an existing beta tag.
4. Verify the workflow published `beta/latest.json` and did not replace root `latest.json`.

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

### Local Workstation Flow

Run this when you need the same release flow without consuming GitHub Actions minutes.

1. From the repository root, run `bash ./scripts/release/run-local-release-prep.sh --bump patch` and add `--draft` or `--prerelease` when needed.
2. Check out the resulting release tag locally so the workstation publish step builds the exact tagged commit.
3. Ensure the Apple signing identity is available in Keychain, or set `APPLE_CERTIFICATE` plus `APPLE_CERTIFICATE_PASSWORD` so the script can import a temporary keychain.
4. Export the updater signing key, updater public key, update base URL, Apple notarization values, and Cloudflare R2 credentials.
5. Run `cd crates/maabarium-desktop && pnpm publish:release-local -- --release-tag desktop-vX.Y.Z --release-channel stable`.
   Add `--allow-dirty` only when you intentionally need a local publish from an uncommitted workstation state.
6. Confirm the script uploads the updater bundle, signature, CLI archive, channel manifest, and `install.sh` to the GitHub Release and Cloudflare R2.

### Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- optional `MAABARIUM_UPDATE_PUBKEY` if you prefer storing the updater public key as a masked secret instead of a repository variable

### Required GitHub Variables

- `MAABARIUM_UPDATE_PUBKEY`
- `MAABARIUM_UPDATE_BASE_URL`
- `APPLE_TEAM_ID`
- `CLOUDFLARE_R2_BUCKET`
- `CLOUDFLARE_R2_ENDPOINT`
- optional `APPLE_SIGNING_IDENTITY`
- optional `APPLE_PROVIDER_SHORT_NAME`

Example values:

- `MAABARIUM_UPDATE_PUBKEY = <contents of ~/.tauri/maabarium.key.pub>`
- `MAABARIUM_UPDATE_BASE_URL = https://downloads.maabarium.com`
- `APPLE_TEAM_ID = ABCD123456`
- `CLOUDFLARE_R2_BUCKET = maabarium-releases`
- `CLOUDFLARE_R2_ENDPOINT = https://<account-id>.r2.cloudflarestorage.com`

### Apple Signing Notes

- `APPLE_CERTIFICATE` must be the base64-encoded contents of your exported Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD` is the password used when exporting that `.p12` file.
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are used by Tauri's notarization flow. `APPLE_PASSWORD` should be an Apple app-specific password.
- `APPLE_SIGNING_IDENTITY` is optional if the identity can be inferred from `APPLE_CERTIFICATE`, but setting it explicitly is safer for CI.
- The macOS release flow now signs the bundled desktop CLI resource during Tauri's `beforeBundleCommand`, so the signing identity must be available in Keychain before `pnpm tauri build` starts. The GitHub Actions workflow imports the `.p12` into a temporary keychain first; for local validation, install the certificate in Keychain or import it manually before running the release script.
- A Developer ID signature alone is not enough for a downloadable app on current macOS releases. If the app is not notarized and stapled, Finder can show a generic `cannot be opened because of a problem` error instead of a clear Gatekeeper prompt.
- To generate a GitHub-ready `APPLE_CERTIFICATE` value from a local `.p12` export, run `cd crates/maabarium-desktop && pnpm prepare:apple-certificate -- --copy ~/Downloads/DeveloperIDApplication.p12`. The helper script verifies that the base64 output decodes back to the original file before printing or copying it.

## Local Re-sign And Notarize An Existing App Build

If you already built the app locally and want a launchable macOS app for testing on your own machine, re-sign and notarize the `.app` bundle directly:

```bash
cd /Users/kabudu/projex/maabarium-group/maabarium/crates/maabarium-desktop
APP_ROOT="/Users/kabudu/projex/maabarium-group/maabarium/target/release/bundle/macos/Maabarium-Console.app"
ZIP_PATH="$PWD/release/Maabarium-Console-notarize.zip"

codesign --deep --force --verify --verbose \
  --options runtime \
  --sign "Developer ID Application: YOUR NAME (TEAMID)" \
  "$APP_ROOT"

ditto -c -k --keepParent "$APP_ROOT" "$ZIP_PATH"

xcrun notarytool submit "$ZIP_PATH" \
  --apple-id "YOUR_APPLE_ID" \
  --password "YOUR_APP_SPECIFIC_PASSWORD" \
  --team-id "YOUR_TEAM_ID" \
  --wait

xcrun stapler staple "$APP_ROOT"

spctl --assess --type execute --verbose "$APP_ROOT"
codesign --verify --deep --strict --verbose=2 "$APP_ROOT"
```

If your certificate is already installed in Keychain and you only need a local re-sign without notarization, you can stop after the `codesign` command for signature debugging only. Do not treat that app as launchable-by-default on end-user machines; current macOS releases will still reject it until notarization succeeds and the ticket is stapled.

## Rebuild The Updater Archive After Local Re-signing

If you re-sign or notarize the app after `tauri build` and want to republish the updater payload, recreate the archive and updater signature from the finalized `.app`:

```bash
cd /Users/kabudu/projex/maabarium-group/maabarium/crates/maabarium-desktop
APP_ROOT="/Users/kabudu/projex/maabarium-group/maabarium/target/release/bundle/macos/Maabarium-Console.app"
ARCHIVE_PATH="/Users/kabudu/projex/maabarium-group/maabarium/target/release/bundle/macos/Maabarium-Console.app.tar.gz"

rm -f "$ARCHIVE_PATH" "$ARCHIVE_PATH.sig"
tar -C "$(dirname "$APP_ROOT")" -czf "$ARCHIVE_PATH" "$(basename "$APP_ROOT")"

pnpm tauri signer sign \
  -f "$HOME/.tauri/maabarium.key" \
  "$ARCHIVE_PATH"
```

Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` or pass `-p ...` only if your updater private key is encrypted.

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
