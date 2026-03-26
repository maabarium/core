#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$DESKTOP_DIR/generated-resources/cli"

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

if [[ ! -d "$CLI_DIR" ]]; then
  exit 0
fi

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
REQUIRE_SIGNING="${MAABARIUM_REQUIRE_APPLE_CLI_SIGNING:-0}"

if [[ -z "$SIGNING_IDENTITY" ]]; then
  if [[ "$REQUIRE_SIGNING" == "1" ]]; then
    echo "APPLE_SIGNING_IDENTITY must be set to sign the bundled CLI resources." >&2
    exit 1
  fi
  exit 0
fi

if ! security find-identity -v -p codesigning | grep -F "$SIGNING_IDENTITY" >/dev/null; then
  if [[ "$REQUIRE_SIGNING" == "1" ]]; then
    echo "Configured Apple signing identity was not found in the active keychains: $SIGNING_IDENTITY" >&2
    exit 1
  fi
  exit 0
fi

signed_any=0

while IFS= read -r -d '' candidate; do
  if [[ ! -x "$candidate" ]]; then
    continue
  fi

  codesign \
    --force \
    --sign "$SIGNING_IDENTITY" \
    --options runtime \
    --timestamp \
    "$candidate"

  signed_any=1
done < <(find "$CLI_DIR" -type f -print0)

if [[ "$REQUIRE_SIGNING" == "1" && "$signed_any" != "1" ]]; then
  echo "No bundled CLI executables were found under $CLI_DIR" >&2
  exit 1
fi
