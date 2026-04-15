#!/usr/bin/env bash

set -euo pipefail

if ! command -v xcrun >/dev/null 2>&1; then
  echo "Missing required command: xcrun" >&2
  exit 1
fi

: "${APPLE_ID:?APPLE_ID must be configured}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD must be configured}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID must be configured}"

OUTPUT_PATH="$(mktemp "${TMPDIR:-/tmp}/maabarium-notarytool.XXXXXX")"
cleanup() {
  rm -f "$OUTPUT_PATH"
}
trap cleanup EXIT

if xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  >"$OUTPUT_PATH" 2>&1; then
  echo "Validated Apple notarization access for team $APPLE_TEAM_ID."
  exit 0
fi

NOTARY_OUTPUT="$(cat "$OUTPUT_PATH")"

if grep -Eqi "required agreement is missing or has expired|in-effect agreement that has not been signed or has expired" <<<"$NOTARY_OUTPUT"; then
  echo "Apple notarization access failed: a required Apple Developer agreement is missing or expired for team $APPLE_TEAM_ID." >&2
  echo "Sign the latest legal agreements for that team in developer.apple.com/account, then rerun the release build." >&2
else
  echo "Apple notarization access check failed before build." >&2
fi

printf '%s\n' "$NOTARY_OUTPUT" >&2
exit 1