#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${1:?usage: verify-macos-entitlements.sh /path/to/App.app}"
APP_BINARY="${APP_ROOT}/Contents/MacOS/maabarium-desktop"
ENTITLEMENT_KEY="com.apple.security.cs.allow-unsigned-executable-memory"

if [[ ! -d "$APP_ROOT" ]]; then
  echo "Expected a macOS app bundle at $APP_ROOT" >&2
  exit 1
fi

if [[ ! -f "$APP_BINARY" ]]; then
  echo "Expected the desktop app binary at $APP_BINARY" >&2
  exit 1
fi

CODESIGN_DETAILS="$(codesign --display --verbose=4 "$APP_BINARY" 2>&1)"
if ! grep -F "flags=0x10000(runtime)" <<<"$CODESIGN_DETAILS" >/dev/null; then
  echo "Desktop app binary is missing hardened runtime." >&2
  exit 1
fi

ENTITLEMENTS_FILE="$(mktemp)"
cleanup() {
  rm -f "$ENTITLEMENTS_FILE"
}
trap cleanup EXIT

if ! codesign --display --entitlements - "$APP_BINARY" >"$ENTITLEMENTS_FILE" 2>/dev/null; then
  echo "Failed to extract desktop app entitlements from $APP_BINARY" >&2
  exit 1
fi

if [[ ! -s "$ENTITLEMENTS_FILE" ]]; then
  echo "Desktop app binary does not contain embedded entitlements." >&2
  exit 1
fi

ENTITLEMENT_VALUE="$(plutil -extract "$ENTITLEMENT_KEY" raw -o - "$ENTITLEMENTS_FILE" 2>/dev/null || true)"
if [[ "$ENTITLEMENT_VALUE" != "1" && "$ENTITLEMENT_VALUE" != "true" ]]; then
  echo "Desktop app binary is missing required entitlement: $ENTITLEMENT_KEY" >&2
  exit 1
fi

echo "Verified hardened runtime and $ENTITLEMENT_KEY on $APP_BINARY"