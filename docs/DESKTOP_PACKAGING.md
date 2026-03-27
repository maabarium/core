# Desktop Packaging

## Supported Desktop Shell

The supported desktop application is the Tauri project in `crates/maabarium-desktop`.

## Current Packaging Strategy

The current release/distribution story is intentionally simple:

1. build the Tauri desktop bundle
2. ship the resulting app bundle for local/manual distribution
3. keep runtime data external to the app binary

This is now a hybrid strategy:

1. manual local release builds still work
2. a focused GitHub Actions workflow can build a Developer ID-signed and notarized macOS updater bundle when Apple signing secrets are configured
3. `latest.json` plus signed updater bundles can be published to Cloudflare R2

## Build Command

Build the desktop app in release mode:

```bash
cd crates/maabarium-desktop && pnpm tauri build
```

Expected macOS bundle output:

```text
target/release/bundle/macos
```

## Runtime Expectations

The app now stores desktop runtime artifacts in app-specific OS directories instead of the repository `data/` directory.

On macOS the desktop app uses:

- database: `~/Library/Application Support/com.maabarium.console/maabarium.db`
- log file: `~/Library/Logs/com.maabarium.console/maabarium.log`
- blueprint library: `~/Library/Application Support/com.maabarium.console/blueprints/`
- bundled CLI: `~/Library/Application Support/com.maabarium.console/bin/maabarium`

On first desktop launch, if legacy repository-relative files exist, the app migrates them forward:

- legacy database: `data/maabarium.db`
- legacy log file: `data/maabarium.log`
- legacy blueprints: `blueprints/*.toml`

The desktop bundle now also includes the built-in repository blueprint library as app resources. On startup the app seeds any missing built-in blueprints from the bundled resources into the app-data `blueprints/` directory, so downloaded releases no longer depend on a repository checkout to populate the library.

Supported release builds can also bundle the standalone `maabarium` CLI binary as an app resource. On startup the desktop app seeds that binary into the app-data `bin/` directory and refreshes it when the bundled resource changes, so desktop installs can expose the same terminal tooling without a second manual download.

The app reads the app-specific paths to populate live metrics, history, diff, and log views.

## Local Distribution Model

The currently supported distribution model is manual/local distribution of the generated app bundle.

That means:

- build the release binary on the target machine or a compatible macOS environment
- launch the app normally after installation
- let the app own its database and log files under the OS application-data directories

Manual distribution is still supported, but a concrete updater path now exists for desktop releases.

## R2-Backed Updater Flow

The updater storage endpoint can be backed by Cloudflare R2.

- `MAABARIUM_UPDATE_BASE_URL` should point to the public release origin, ideally an R2-backed custom domain.
- release builds should provide `MAABARIUM_UPDATE_PUBKEY` during `pnpm tauri build` so the packaged app embeds the updater public key.
- `latest.json` lives at the root of that release origin.
- signed updater bundles live under platform-key subdirectories such as `darwin-aarch64/`, where the published macOS updater archive is named `Maabarium-Console.app.tar.gz`.

The GitHub updater workflow intentionally bundles only the macOS `app` target. The updater release path consumes the signed `.app.tar.gz` bundle and `.sig`; it does not publish the `.dmg`, and skipping that target avoids Finder AppleScript failures on headless macOS runners.

## Release Operator Checklist

Use this checklist when you need to publish or republish desktop updater metadata.

### Stable release sequence

1. Run `.github/workflows/release-prep.yml` with the correct semver bump.
2. Let `release-prep` create and publish the normal GitHub Release plus the `desktop-vX.Y.Z` tag.
3. Let `.github/workflows/desktop-release-r2.yml` run from that published Release event, or rerun it manually for the same tag with `release_channel=stable` if you need to republish.
4. Confirm the workflow published `stable/latest.json` and refreshed the root `latest.json` alias used by `install.sh`.
5. Confirm the signed updater bundle, `.sig`, and `install.sh` were uploaded to both the GitHub Release and Cloudflare R2.

### Beta release sequence

1. Create a GitHub prerelease for the tag you want to distribute as beta.
2. Let `.github/workflows/desktop-release-r2.yml` run from that prerelease event, which automatically maps the release to the `beta` channel.
3. If you need to rebuild or republish that same prerelease tag, run `desktop-release-r2` manually with the release tag and `release_channel=beta`.
4. Confirm the workflow published `beta/latest.json` without replacing the root `latest.json` stable alias.
5. Confirm the signed updater bundle, `.sig`, and `install.sh` were uploaded to the GitHub Release and Cloudflare R2.

### Post-publish checks

1. Verify the downloaded app is Apple-signed, notarized, and stapled.
2. Verify the packaged app resolves updates from the expected channel manifest.
3. If you are testing on a machine with older packaged builds, back up or reset `com.maabarium.console` app data before treating the run as a clean first-launch check.

For a real downloadable macOS release, the app inside that updater archive must still be Apple-signed and notarized. The desktop release workflow now supports Tauri's built-in macOS signing and notarization environment variables so CI can publish a Gatekeeper-acceptable app bundle instead of only an updater-signed payload.

The updater signing public key is not an R2 value. It is the public half of the Tauri updater signing keypair. Use the Tauri-generated public key content directly, not a PEM block, Cloudflare key, or base64url variant.

For local builds, `MAABARIUM_UPDATE_PUBKEY_FILE` can point at the generated `.pub` file and will be embedded at compile time. A runtime `MAABARIUM_UPDATE_PUBKEY` still overrides the embedded key for development sessions.

Before pasting a value into GitHub Actions configuration, validate it locally with `cd crates/maabarium-desktop && pnpm validate:updater-pubkey -- --file ~/.tauri/maabarium.key.pub`. The validator prints the recommended raw key line for `MAABARIUM_UPDATE_PUBKEY`.

For a full local updater-release smoke test, run `cd crates/maabarium-desktop && TAURI_SIGNING_PRIVATE_KEY_FILE=~/.tauri/maabarium.key MAABARIUM_UPDATE_PUBKEY_FILE=~/.tauri/maabarium.key.pub pnpm test:release-local`.

If you need to re-sign and notarize an already-built app locally for launch testing, use the exact commands documented in [crates/maabarium-desktop/release/README.md](../crates/maabarium-desktop/release/README.md).

See [crates/maabarium-desktop/release/README.md](../crates/maabarium-desktop/release/README.md) for the concrete release flow and required variables.

## Release Expectations

For any release-like handoff of the desktop app, document at least:

- commit or tag being built
- exact `cd crates/maabarium-desktop && pnpm tauri build` command
- output bundle path for the current platform
- expected database path for the packaged app
- expected log path for the packaged app
- expected blueprint-library path for the packaged app
- expected bundled CLI path for the packaged app when release bundling is enabled
- whether the binary was tested against a real local database/log pair

## macOS Signing and Notarization

The current supported signing/notarization path now has two forms:

- CI-backed signing and notarization through `.github/workflows/desktop-release-r2.yml` when the Apple secrets are configured
- a manual local re-sign/notarize fallback for existing `.app` bundles

### Prerequisites

- Apple Developer membership with a `Developer ID Application` certificate installed in Keychain
- Xcode command-line tools available (`xcrun`, `codesign`)
- An app-specific password configured for notarization, or a saved `notarytool` keychain profile

### 1. Build the Release Binary

```bash
cd crates/maabarium-desktop && pnpm tauri build
```

### 2. Create a Minimal `.app` Bundle

Use the Tauri-generated `.app` bundle from the release build output as the notarization artifact.

For example:

```bash
APP_ROOT="target/release/bundle/macos/Maabarium Console.app"
```

### 3. Sign the App Bundle

```bash
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: YOUR NAME (TEAMID)" \
  "$APP_ROOT"
```

Optional stricter variant:

```bash
codesign --deep --force --verify --verbose \
  --options runtime \
  --sign "Developer ID Application: YOUR NAME (TEAMID)" \
  "$APP_ROOT"
```

### 4. Create a Notarization Upload Artifact

```bash
ditto -c -k --keepParent "$APP_ROOT" dist/Maabarium.zip
```

### 5. Submit for Notarization

Using a stored keychain profile:

```bash
xcrun notarytool submit dist/Maabarium.zip \
  --keychain-profile "AC_PROFILE" \
  --wait
```

### 6. Staple the Result

```bash
xcrun stapler staple "$APP_ROOT"
```

### 7. Verify the Stapled App

```bash
spctl --assess --type execute --verbose "$APP_ROOT"
codesign --verify --deep --strict --verbose=2 "$APP_ROOT"
```

### Notes

- This process still works for manual releases.
- A focused CI workflow now exists for signed and notarized macOS updater publishing to Cloudflare R2.
- The runtime data paths remain external to the bundle, but they now live in app-specific OS directories.
- On macOS that means `~/Library/Application Support/com.maabarium.console/` for the database and blueprint library, plus `~/Library/Logs/com.maabarium.console/` for logs.
- Existing repository-relative desktop data and blueprints are migrated forward on first run when present.
- Built-in blueprint TOMLs are bundled inside the app and seeded into app data when missing.
- When release bundling is enabled, the packaged app also refreshes a seeded CLI copy under `~/Library/Application Support/com.maabarium.console/bin/`.

## Explicit Deferrals

The following are still deferred until a later closure pass:

- `cargo bundle` adoption
- installer generation
- multi-platform updater aggregation in one release job
- multi-provider notarization authentication beyond the current Apple ID plus app-specific password flow

These are packaging enhancements, not current requirements for the supported desktop workflow.

## Validation Checklist

- build: `cd crates/maabarium-desktop && pnpm tauri build`
- manifest: `cd crates/maabarium-desktop && pnpm build:release-manifest -- --base-url https://downloads.maabarium.com`
- bundle exists under `target/release/bundle/`
- app launch tested manually when a GUI session is available
- app can create and read its app-specific runtime database and log files
- app can seed and read its app-specific blueprint library without a repo checkout
- signing/notarization steps documented for manual release builds
- updater publish flow documented for R2-backed releases

## Rationale

This keeps the packaging story aligned with the live architecture:

- Tauri desktop app
- app-specific desktop runtime data and logs
- bundled built-in blueprints seeded into app data on startup
- no second desktop stack
- a concrete but narrow R2-backed updater path for real desktop release verification
