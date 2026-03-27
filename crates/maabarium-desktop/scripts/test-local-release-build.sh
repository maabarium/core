#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
RELEASE_DIR="$DESKTOP_DIR/release"
STAGING_DIR="$RELEASE_DIR/staging"
BASE_URL="${MAABARIUM_UPDATE_BASE_URL:-https://downloads.maabarium.com}"

case "$(uname -m)" in
  arm64|aarch64)
    PLATFORM_KEY="darwin-aarch64"
    ;;
  x86_64)
    PLATFORM_KEY="darwin-x86_64"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_FILE:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_FILE")"
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
fi

if [[ -z "${MAABARIUM_UPDATE_PUBKEY:-}" && -z "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" && -f "$HOME/.tauri/maabarium.key.pub" ]]; then
  export MAABARIUM_UPDATE_PUBKEY_FILE="$HOME/.tauri/maabarium.key.pub"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "Set TAURI_SIGNING_PRIVATE_KEY to the updater private key contents, or set TAURI_SIGNING_PRIVATE_KEY_FILE to the key file path." >&2
  exit 1
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  export MAABARIUM_REQUIRE_APPLE_CLI_SIGNING="1"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  echo "TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set; continuing with an unencrypted updater signing key."
fi

export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if [[ -z "${MAABARIUM_UPDATE_PUBKEY:-}" && -z "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
  echo "Set MAABARIUM_UPDATE_PUBKEY or MAABARIUM_UPDATE_PUBKEY_FILE before running the local release build." >&2
  exit 1
fi

cd "$DESKTOP_DIR"
pnpm install --frozen-lockfile

if [[ -n "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
  node ./scripts/validate-updater-pubkey.mjs --file "$MAABARIUM_UPDATE_PUBKEY_FILE"
else
  node ./scripts/validate-updater-pubkey.mjs --value "$MAABARIUM_UPDATE_PUBKEY"
fi

RAW_PUBKEY="$({
  if [[ -n "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
    cat "$MAABARIUM_UPDATE_PUBKEY_FILE"
  else
    printf '%s' "$MAABARIUM_UPDATE_PUBKEY"
  fi
} | node -e 'const fs = require("fs"); const raw = fs.readFileSync(0, "utf8").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim(); const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean); process.stdout.write(lines[lines.length - 1]);')"

TAURI_CONFIG="$(node -e 'process.stdout.write(JSON.stringify({ productName: "Maabarium-Console", bundle: { targets: ["app"] }, plugins: { updater: { pubkey: process.argv[1] } } }));' "$RAW_PUBKEY")"
export TAURI_CONFIG

pnpm tauri build --config "$TAURI_CONFIG"

BUNDLE_DIR="$REPO_ROOT/target/release/bundle/macos"
APP_ROOT="$BUNDLE_DIR/Maabarium-Console.app"
UPDATER_BUNDLE="$BUNDLE_DIR/Maabarium-Console.app.tar.gz"
SIG_PATH="$UPDATER_BUNDLE.sig"

if [[ ! -f "$UPDATER_BUNDLE" ]]; then
  echo "Expected updater bundle at $UPDATER_BUNDLE" >&2
  exit 1
fi

if [[ ! -f "$SIG_PATH" ]]; then
  echo "Expected updater signature at $SIG_PATH" >&2
  exit 1
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  BUNDLED_CLI_PATH="$(find "$APP_ROOT/Contents/Resources" -path '*/cli/*/maabarium' -type f -print -quit)"
  if [[ ! -f "$BUNDLED_CLI_PATH" ]]; then
    echo "Expected a bundled CLI executable under $APP_ROOT/Contents/Resources" >&2
    exit 1
  fi

  "$DESKTOP_DIR/scripts/verify-macos-entitlements.sh" "$APP_ROOT"

  APP_CODESIGN_DETAILS="$(codesign --display --verbose=4 "$APP_ROOT" 2>&1)"
  CLI_CODESIGN_DETAILS="$(codesign --display --verbose=4 "$BUNDLED_CLI_PATH" 2>&1)"

  codesign --verify --strict --verbose=2 "$APP_ROOT"
  codesign --verify --strict --verbose=2 "$BUNDLED_CLI_PATH"

  if ! grep -F "Authority=Developer ID Application" <<<"$APP_CODESIGN_DETAILS" >/dev/null; then
    echo "App bundle is not signed with a Developer ID Application identity." >&2
    exit 1
  fi

  if ! grep -F "Authority=Developer ID Application" <<<"$CLI_CODESIGN_DETAILS" >/dev/null; then
    echo "Bundled CLI is not signed with a Developer ID Application identity." >&2
    exit 1
  fi

  if ! grep -F "Timestamp=" <<<"$CLI_CODESIGN_DETAILS" >/dev/null; then
    echo "Bundled CLI signature does not include a secure timestamp." >&2
    exit 1
  fi

  if ! grep -F "flags=0x10000(runtime)" <<<"$CLI_CODESIGN_DETAILS" >/dev/null; then
    echo "Bundled CLI signature is missing hardened runtime." >&2
    exit 1
  fi

  SPCTL_OUTPUT="$(spctl --assess --type execute --verbose "$APP_ROOT" 2>&1)" || SPCTL_STATUS=$?
  SPCTL_STATUS="${SPCTL_STATUS:-0}"

  STAPLER_OUTPUT="$(xcrun stapler validate "$APP_ROOT" 2>&1)" || STAPLER_STATUS=$?
  STAPLER_STATUS="${STAPLER_STATUS:-0}"

  HAS_NOTARIZATION_CREDENTIALS=0
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    HAS_NOTARIZATION_CREDENTIALS=1
  fi
  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    HAS_NOTARIZATION_CREDENTIALS=1
  fi

  if [[ "$SPCTL_STATUS" -ne 0 || "$STAPLER_STATUS" -ne 0 ]]; then
    echo "$SPCTL_OUTPUT" >&2
    echo "$STAPLER_OUTPUT" >&2

    if grep -F "Unnotarized Developer ID" <<<"$SPCTL_OUTPUT" >/dev/null; then
      echo "Signed app is still unnotarized, so Finder launch will fail on current macOS releases." >&2
      if [[ "$HAS_NOTARIZATION_CREDENTIALS" -eq 0 ]]; then
        echo "Provide APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH so Tauri can notarize during the local release build." >&2
      fi
    fi

    exit 1
  fi
fi

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/$PLATFORM_KEY"
cp "$UPDATER_BUNDLE" "$STAGING_DIR/$PLATFORM_KEY/$(basename "$UPDATER_BUNDLE")"
cp "$SIG_PATH" "$STAGING_DIR/$PLATFORM_KEY/$(basename "$SIG_PATH")"

pnpm build:release-manifest -- \
  --base-url "$BASE_URL" \
  --artifacts-dir "$STAGING_DIR" \
  --output "$RELEASE_DIR/latest.json" \
  --platform "$PLATFORM_KEY=$PLATFORM_KEY/$(basename "$UPDATER_BUNDLE")"

node "$REPO_ROOT/scripts/release/generate-install-script.mjs" \
  --base-url "$BASE_URL" \
  --output "$RELEASE_DIR/install.sh"

chmod +x "$RELEASE_DIR/install.sh"

echo "Local desktop release validation completed."
echo "Updater bundle: $UPDATER_BUNDLE"
echo "Updater signature: $SIG_PATH"
echo "Manifest: $RELEASE_DIR/latest.json"
echo "Installer: $RELEASE_DIR/install.sh"