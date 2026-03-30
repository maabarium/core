#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

source "$SCRIPT_DIR/release-prereqs.sh"

usage() {
  cat <<'EOF'
Run the desktop-release-r2 flow locally on macOS.

Usage:
  bash ./crates/maabarium-desktop/scripts/run-local-desktop-release-r2.sh [options]

Options:
  --release-tag <tag>         Existing GitHub Release tag to upload assets to.
  --release-channel <name>    stable or beta. Defaults to stable unless derived from the GitHub Release.
  --allow-dirty               Skip the clean-worktree guard for local publishing.
  --skip-gh-upload            Build and publish to R2 without uploading assets to a GitHub Release.
  --skip-r2-publish           Build and upload to the GitHub Release without syncing Cloudflare R2.
  --publish-root-manifest     Force publishing root latest.json.
  --no-publish-root-manifest  Force skipping root latest.json.
  --help                      Show this help text.

Environment:
  - TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_FILE
  - optional TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  - MAABARIUM_UPDATE_PUBKEY or MAABARIUM_UPDATE_PUBKEY_FILE
  - MAABARIUM_UPDATE_BASE_URL
  - APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
  - APPLE_SIGNING_IDENTITY if the Developer ID certificate is already installed locally
  - or APPLE_CERTIFICATE plus APPLE_CERTIFICATE_PASSWORD to import a temporary keychain
  - CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY when publishing to R2
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

derive_repo_slug() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    printf '%s\n' "$GITHUB_REPOSITORY"
    return
  fi

  gh repo view --json nameWithOwner --jq .nameWithOwner
}

ensure_clean_worktree() {
  if [[ "${ALLOW_DIRTY_WORKTREE:-false}" == "true" ]]; then
    return
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing local desktop publish from a dirty worktree. Commit or stash changes first, or rerun with --allow-dirty." >&2
    exit 1
  fi
}

normalize_pubkey_line() {
  if [[ -n "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
    node ./scripts/normalize-updater-key.mjs --file "$MAABARIUM_UPDATE_PUBKEY_FILE"
  else
    node ./scripts/normalize-updater-key.mjs --value "${MAABARIUM_UPDATE_PUBKEY:-}"
  fi
}

normalize_pubkey_for_tauri() {
  if [[ -n "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
    node ./scripts/normalize-updater-key.mjs --file "$MAABARIUM_UPDATE_PUBKEY_FILE" --format wrapped
  else
    node ./scripts/normalize-updater-key.mjs --value "${MAABARIUM_UPDATE_PUBKEY:-}" --format wrapped
  fi
}

updater_private_key_requires_password() {
  TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" node --input-type=module -e 'const { isEncryptedMinisignSecretKey } = await import(process.argv[1]); process.exit(isEncryptedMinisignSecretKey(process.env.TAURI_SIGNING_PRIVATE_KEY ?? "") ? 0 : 1);' "$DESKTOP_DIR/scripts/updater-key-utils.mjs"
}

import_apple_certificate() {
  if [[ -z "${APPLE_CERTIFICATE:-}" ]]; then
    return
  fi

  : "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD must be configured when APPLE_CERTIFICATE is provided}"

  ORIGINAL_DEFAULT_KEYCHAIN="$(security default-keychain -d user | tr -d '"')"
  CERT_PATH="$RUNNER_TEMP/maabarium-apple-signing-cert.p12"
  KEYCHAIN_PATH="$RUNNER_TEMP/maabarium-signing.keychain-db"
  KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
  CREATED_TEMP_KEYCHAIN=1

  if ! printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_PATH" 2>/dev/null; then
    printf '%s' "$APPLE_CERTIFICATE" | base64 -D -i -o "$CERT_PATH"
  fi

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  security import "$CERT_PATH" \
    -k "$KEYCHAIN_PATH" \
    -P "$APPLE_CERTIFICATE_PASSWORD" \
    -T /usr/bin/codesign \
    -T /usr/bin/security \
    -T /usr/bin/productbuild
  security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$KEYCHAIN_PASSWORD" \
    "$KEYCHAIN_PATH"

  EXISTING_KEYCHAINS=()
  while IFS= read -r keychain; do
    EXISTING_KEYCHAINS+=("${keychain//\"/}")
  done < <(security list-keychains -d user)

  security list-keychains -d user -s "$KEYCHAIN_PATH" "${EXISTING_KEYCHAINS[@]}"
  security default-keychain -d user -s "$KEYCHAIN_PATH"
}

cleanup() {
  if [[ "${CREATED_TEMP_KEYCHAIN:-0}" == "1" ]]; then
    if [[ -n "${ORIGINAL_DEFAULT_KEYCHAIN:-}" ]]; then
      security default-keychain -d user -s "$ORIGINAL_DEFAULT_KEYCHAIN" >/dev/null 2>&1 || true
    fi
    if [[ -n "${KEYCHAIN_PATH:-}" ]]; then
      security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "${RUNNER_TEMP:-}"
}

RELEASE_TAG=""
RELEASE_CHANNEL=""
UPLOAD_RELEASE=true
PUBLISH_R2=true
PUBLISH_ROOT_MANIFEST=""
ALLOW_DIRTY_WORKTREE=false
CREATED_TEMP_KEYCHAIN=0
RUNNER_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/maabarium-desktop-release.XXXXXX")"
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --release-tag)
      RELEASE_TAG="${2:-}"
      shift 2
      ;;
    --release-channel)
      RELEASE_CHANNEL="${2:-}"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY_WORKTREE=true
      shift
      ;;
    --skip-gh-upload)
      UPLOAD_RELEASE=false
      shift
      ;;
    --skip-r2-publish)
      PUBLISH_R2=false
      shift
      ;;
    --publish-root-manifest)
      PUBLISH_ROOT_MANIFEST=true
      shift
      ;;
    --no-publish-root-manifest)
      PUBLISH_ROOT_MANIFEST=false
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Local desktop-release-r2 can only run on macOS." >&2
  exit 1
fi

if [[ -n "$RELEASE_CHANNEL" && "$RELEASE_CHANNEL" != "stable" && "$RELEASE_CHANNEL" != "beta" ]]; then
  echo "--release-channel must be stable or beta" >&2
  exit 1
fi

require_command cargo
require_command codesign
require_command node
require_command pnpm
require_command security
require_command xcrun

if [[ "$UPLOAD_RELEASE" == true || -n "$RELEASE_TAG" ]]; then
  require_command gh
fi

if [[ "$PUBLISH_R2" == true ]]; then
  require_command aws
fi

cd "$REPO_ROOT"
ensure_clean_worktree

if [[ -n "$RELEASE_TAG" ]]; then
  require_command gh
  REPO_SLUG="$(derive_repo_slug)"
  gh release view "$RELEASE_TAG" --repo "$REPO_SLUG" >/dev/null
  TAG_SHA="$(git rev-parse "$RELEASE_TAG^{commit}")"
  HEAD_SHA="$(git rev-parse HEAD)"
  if [[ "$TAG_SHA" != "$HEAD_SHA" ]]; then
    echo "Checked-out HEAD ($HEAD_SHA) does not match $RELEASE_TAG ($TAG_SHA). Check out the release tag before publishing locally." >&2
    exit 1
  fi

  if [[ -z "$RELEASE_CHANNEL" ]]; then
    if [[ "$(gh release view "$RELEASE_TAG" --repo "$REPO_SLUG" --json isPrerelease --jq .isPrerelease)" == "true" ]]; then
      RELEASE_CHANNEL="beta"
    else
      RELEASE_CHANNEL="stable"
    fi
  fi
else
  if [[ "$UPLOAD_RELEASE" == true ]]; then
    echo "--release-tag is required unless --skip-gh-upload is set." >&2
    exit 1
  fi
  RELEASE_CHANNEL="${RELEASE_CHANNEL:-stable}"
fi

if [[ -z "$RELEASE_CHANNEL" ]]; then
  RELEASE_CHANNEL="stable"
fi

if [[ -z "$PUBLISH_ROOT_MANIFEST" ]]; then
  if [[ "$RELEASE_CHANNEL" == "stable" ]]; then
    PUBLISH_ROOT_MANIFEST=true
  else
    PUBLISH_ROOT_MANIFEST=false
  fi
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_FILE:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_FILE")"
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
fi

if [[ -z "${MAABARIUM_UPDATE_PUBKEY:-}" && -z "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" && -f "$HOME/.tauri/maabarium.key.pub" ]]; then
  export MAABARIUM_UPDATE_PUBKEY_FILE="$HOME/.tauri/maabarium.key.pub"
fi

: "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_FILE must be configured}"
: "${MAABARIUM_UPDATE_BASE_URL:?MAABARIUM_UPDATE_BASE_URL must be configured}"
: "${APPLE_ID:?APPLE_ID must be configured}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD must be configured}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID must be configured}"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+x}" ]] && [[ -t 0 ]] && updater_private_key_requires_password; then
  read -r -s -p "Updater private key password: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  echo
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

if [[ -z "${APPLE_CERTIFICATE:-}" && -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Set APPLE_SIGNING_IDENTITY for a locally installed Developer ID certificate, or provide APPLE_CERTIFICATE plus APPLE_CERTIFICATE_PASSWORD for temporary import." >&2
  exit 1
fi

if [[ "$PUBLISH_R2" == true ]]; then
  : "${CLOUDFLARE_R2_BUCKET:?CLOUDFLARE_R2_BUCKET must be configured}"
  : "${CLOUDFLARE_R2_ENDPOINT:?CLOUDFLARE_R2_ENDPOINT must be configured}"
  : "${CLOUDFLARE_R2_ACCESS_KEY_ID:?CLOUDFLARE_R2_ACCESS_KEY_ID must be configured}"
  : "${CLOUDFLARE_R2_SECRET_ACCESS_KEY:?CLOUDFLARE_R2_SECRET_ACCESS_KEY must be configured}"
  export AWS_ACCESS_KEY_ID="$CLOUDFLARE_R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  export AWS_EC2_METADATA_DISABLED="true"
  export R2_BUCKET="$CLOUDFLARE_R2_BUCKET"
  export R2_ENDPOINT="$CLOUDFLARE_R2_ENDPOINT"
fi

if [[ -z "${MAABARIUM_UPDATE_PUBKEY:-}" && -z "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
  echo "Set MAABARIUM_UPDATE_PUBKEY or MAABARIUM_UPDATE_PUBKEY_FILE before running the local desktop release." >&2
  exit 1
fi

cd "$DESKTOP_DIR"
run_updater_signing_prereqs

RAW_PUBKEY="$(normalize_pubkey_line)"
TAURI_UPDATER_PUBKEY="$(normalize_pubkey_for_tauri)"
TAURI_CONFIG="$(node -e 'process.stdout.write(JSON.stringify({ productName: "Maabarium-Console", bundle: { targets: ["app"], macOS: { entitlements: "Entitlements.plist" } }, plugins: { updater: { pubkey: process.argv[1] } } }));' "$TAURI_UPDATER_PUBKEY")"
export TAURI_CONFIG
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
export MAABARIUM_REQUIRE_APPLE_CLI_SIGNING="1"
export MAABARIUM_UPDATE_CHANNEL="$RELEASE_CHANNEL"

import_apple_certificate

pnpm tauri build \
  --ci \
  --config "$TAURI_CONFIG"

BUNDLE_DIR="$REPO_ROOT/target/release/bundle/macos"
APP_ROOT="$BUNDLE_DIR/Maabarium-Console.app"
"$DESKTOP_DIR/scripts/verify-macos-entitlements.sh" "$APP_ROOT"

case "$(uname -m)" in
  arm64|aarch64)
    PLATFORM_KEY="darwin-aarch64"
    CLI_TARGET_TRIPLE="aarch64-apple-darwin"
    ;;
  x86_64)
    PLATFORM_KEY="darwin-x86_64"
    CLI_TARGET_TRIPLE="x86_64-apple-darwin"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

UPDATER_BUNDLE="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.app.tar.gz' -print -quit)"
if [[ -z "$UPDATER_BUNDLE" ]]; then
  echo "No macOS updater bundle was produced under $BUNDLE_DIR" >&2
  exit 1
fi

SIG_PATH="${UPDATER_BUNDLE}.sig"
if [[ ! -f "$SIG_PATH" ]]; then
  echo "Missing updater signature for $UPDATER_BUNDLE" >&2
  exit 1
fi

CLI_BINARY="$REPO_ROOT/target/cli-bundle/$CLI_TARGET_TRIPLE/release/maabarium"
if [[ ! -f "$CLI_BINARY" ]]; then
  echo "No bundled CLI binary was produced at $CLI_BINARY" >&2
  exit 1
fi

RELEASE_DIR="$DESKTOP_DIR/release"
STAGING_DIR="$RELEASE_DIR/staging"
MANIFEST_DIR="$RELEASE_DIR/$RELEASE_CHANNEL"
rm -rf "$STAGING_DIR/$PLATFORM_KEY" "$MANIFEST_DIR"
mkdir -p "$STAGING_DIR/$PLATFORM_KEY" "$MANIFEST_DIR"

BUNDLE_NAME="$(basename "$UPDATER_BUNDLE")"
RELEASE_BUNDLE_NAME="${BUNDLE_NAME// /-}"
RELEASE_SIG_NAME="${RELEASE_BUNDLE_NAME}.sig"
CLI_ARCHIVE_NAME="maabarium-${PLATFORM_KEY}.tar.gz"

cp "$UPDATER_BUNDLE" "$STAGING_DIR/$PLATFORM_KEY/$RELEASE_BUNDLE_NAME"
cp "$SIG_PATH" "$STAGING_DIR/$PLATFORM_KEY/$RELEASE_SIG_NAME"
tar -C "$(dirname "$CLI_BINARY")" -czf "$STAGING_DIR/$PLATFORM_KEY/$CLI_ARCHIVE_NAME" "$(basename "$CLI_BINARY")"

pnpm build:release-manifest -- \
  --base-url "$MAABARIUM_UPDATE_BASE_URL" \
  --channel "$RELEASE_CHANNEL" \
  --artifacts-dir "$STAGING_DIR" \
  --output "$MANIFEST_DIR/latest.json" \
  --platform "$PLATFORM_KEY=$PLATFORM_KEY/$RELEASE_BUNDLE_NAME" \
  --cli-platform "$PLATFORM_KEY=$PLATFORM_KEY/$CLI_ARCHIVE_NAME"

node "$REPO_ROOT/scripts/release/generate-install-script.mjs" \
  --base-url "$MAABARIUM_UPDATE_BASE_URL" \
  --output "$RELEASE_DIR/install.sh"
chmod +x "$RELEASE_DIR/install.sh"

if [[ "$UPLOAD_RELEASE" == true ]]; then
  DESKTOP_DIR="$DESKTOP_DIR" RELEASE_TAG="$RELEASE_TAG" RELEASE_CHANNEL="$RELEASE_CHANNEL" REPO_SLUG="$REPO_SLUG" \
    node --input-type=module <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const desktopDir = process.env.DESKTOP_DIR;
const releaseTag = process.env.RELEASE_TAG;
const releaseChannel = process.env.RELEASE_CHANNEL;
const repoSlug = process.env.REPO_SLUG;
const manifestPath = path.join(desktopDir, "release", releaseChannel, "latest.json");
const installPath = path.join(desktopDir, "release", "install.sh");
const stagingDir = path.join(desktopDir, "release", "staging");
const releaseAssets = fs.readdirSync(stagingDir, { recursive: true })
  .filter((entry) => typeof entry === "string")
  .map((entry) => path.join(stagingDir, entry))
  .filter((entry) => fs.statSync(entry).isFile())
  .sort();

const result = spawnSync("gh", ["release", "upload", releaseTag, manifestPath, installPath, ...releaseAssets, "--clobber", "--repo", repoSlug], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
EOF
fi

if [[ "$PUBLISH_R2" == true ]]; then
  aws s3 sync "$RELEASE_DIR/staging/" "s3://$R2_BUCKET/" --delete --endpoint-url "$R2_ENDPOINT"
  aws s3 cp "$RELEASE_DIR/$RELEASE_CHANNEL/latest.json" "s3://$R2_BUCKET/$RELEASE_CHANNEL/latest.json" --endpoint-url "$R2_ENDPOINT"
  if [[ "$PUBLISH_ROOT_MANIFEST" == true ]]; then
    aws s3 cp "$RELEASE_DIR/$RELEASE_CHANNEL/latest.json" "s3://$R2_BUCKET/latest.json" --endpoint-url "$R2_ENDPOINT"
  fi
  aws s3 cp "$RELEASE_DIR/install.sh" "s3://$R2_BUCKET/install.sh" --endpoint-url "$R2_ENDPOINT" --content-type 'text/x-shellscript; charset=utf-8'
fi

echo "Local desktop release flow completed."
echo "Channel: $RELEASE_CHANNEL"
echo "Release tag: ${RELEASE_TAG:-<none>}"
echo "Updater bundle: $STAGING_DIR/$PLATFORM_KEY/$RELEASE_BUNDLE_NAME"
echo "CLI archive: $STAGING_DIR/$PLATFORM_KEY/$CLI_ARCHIVE_NAME"
echo "Manifest: $MANIFEST_DIR/latest.json"
echo "Installer: $RELEASE_DIR/install.sh"