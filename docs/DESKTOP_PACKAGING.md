# Desktop Packaging

## Supported Desktop Shell

The supported desktop application is the Tauri project in `crates/maabarium-desktop`.

## Current Packaging Strategy

The current release/distribution story is intentionally simple:

1. build the Tauri desktop bundle
2. ship the resulting app bundle for local/manual distribution
3. keep runtime data external to the app binary

This is a documentation-first packaging strategy. A manual macOS signing/notarization process is documented below, but it is not yet automated.

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

The app expects shared runtime artifacts to remain outside the binary:

- database: `data/maabarium.db`
- log file: `data/maabarium.log`

The app reads those paths to populate live metrics, history, diff, and log views.

## Local Distribution Model

The currently supported distribution model is manual/local distribution of the generated app bundle.

That means:

- build the release binary on the target machine or a compatible macOS environment
- keep the repository-relative `data/` directory available
- launch the binary from a context where it can access the repo data paths

No installer, DMG, or auto-update path is currently promised.

## Release Expectations

For any release-like handoff of the desktop app, document at least:

- commit or tag being built
- exact `cd crates/maabarium-desktop && pnpm tauri build` command
- output bundle path for the current platform
- expected data path: `data/maabarium.db`
- expected log path: `data/maabarium.log`
- whether the binary was tested against a real local database/log pair

## macOS Signing and Notarization

The current supported signing/notarization path is manual and intended for release-style handoff builds.

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

- This process is documented for manual releases; it is not yet automated in CI.
- The runtime data paths remain external to the bundle:
  - `data/maabarium.db`
  - `data/maabarium.log`
- The bundle does not currently embed or relocate runtime data.

## Explicit Deferrals

The following are still deferred until a later closure pass:

- `cargo bundle` adoption
- installer generation
- auto-update tooling
- CI automation of signing/notarization

These are packaging enhancements, not current requirements for the supported desktop workflow.

## Validation Checklist

- build: `cd crates/maabarium-desktop && pnpm tauri build`
- bundle exists under `target/release/bundle/`
- app launch tested manually when a GUI session is available
- app can read `data/maabarium.db` and `data/maabarium.log`
- signing/notarization steps documented for manual release builds

## Rationale

This keeps the packaging story aligned with the live architecture:

- Tauri desktop app
- repo-relative shared data/log files
- no second desktop stack
- no premature packaging automation before the product surface stabilizes
