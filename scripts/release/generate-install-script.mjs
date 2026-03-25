import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.MAABARIUM_UPDATE_BASE_URL ?? "",
    output: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
      continue;
    }

    if (token === "--output" && next) {
      args.output = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.baseUrl) {
    throw new Error(
      "Missing required --base-url argument or MAABARIUM_UPDATE_BASE_URL environment variable.",
    );
  }

  if (!args.output) {
    throw new Error("Missing required --output argument.");
  }

  return args;
}

function printHelp() {
  console.log(`Generate a macOS install.sh wrapper that reads Maabarium's updater manifest.

Usage:
  node scripts/release/generate-install-script.mjs \
    --base-url https://downloads.maabarium.com \
    --output crates/maabarium-desktop/release/install.sh
`);
}

function toShellLiteral(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildScript(baseUrl) {
  const manifestUrl = new URL(
    "latest.json",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();

  return `#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_MANIFEST_URL=${toShellLiteral(manifestUrl)}
readonly DEFAULT_INSTALL_DIR='/Applications'

fail() {
  echo "maabarium install: $*" >&2
  exit 1
}

note() {
  echo "maabarium install: $*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  note "Git is required for Maabarium workflows and is not installed. Starting automatic installation."

  if command -v brew >/dev/null 2>&1; then
    brew install git || fail "Automatic Git installation via Homebrew failed"
  elif command -v xcode-select >/dev/null 2>&1; then
    xcode-select --install || true
    if ! command -v git >/dev/null 2>&1; then
      note "Apple's Command Line Tools installer has been started. Finish that installer to complete Git setup before running Maabarium."
    fi
  else
    fail "Git is required, but no supported automatic installer was found on this machine"
  fi
}

cleanup() {
  if [[ -n "\${temp_dir:-}" && -d "$temp_dir" ]]; then
    rm -rf "$temp_dir"
  fi
}

trap cleanup EXIT

require_command curl
require_command tar
require_command find
require_command ditto
[[ -x /usr/bin/plutil ]] || fail "plutil is required on macOS"

case "$(uname -s)" in
  Darwin) ;;
  *) fail "This installer only supports macOS." ;;
esac

case "$(uname -m)" in
  arm64|aarch64)
    platform_key='darwin-aarch64'
    ;;
  x86_64)
    platform_key='darwin-x86_64'
    ;;
  *)
    fail "Unsupported macOS architecture: $(uname -m)"
    ;;
esac

ensure_git

manifest_url="\${MAABARIUM_UPDATE_MANIFEST_URL:-$DEFAULT_MANIFEST_URL}"
install_dir="\${MAABARIUM_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
temp_dir="$(mktemp -d)"
manifest_path="$temp_dir/latest.json"
archive_path="$temp_dir/maabarium-update.tar.gz"

echo "Fetching updater manifest from $manifest_url"
curl --fail --silent --show-error --location "$manifest_url" --output "$manifest_path"

if ! version="$(/usr/bin/plutil -extract version raw -o - "$manifest_path" 2>/dev/null)"; then
  fail "Unable to read the release version from latest.json"
fi

if ! artifact_url="$(/usr/bin/plutil -extract "platforms.\${platform_key}.url" raw -o - "$manifest_path" 2>/dev/null)"; then
  fail "No published macOS bundle was found for $platform_key in latest.json"
fi

if [[ -z "$artifact_url" ]]; then
  fail "The updater manifest did not provide a download URL for $platform_key"
fi

echo "Downloading Maabarium $version for $platform_key"
curl --fail --silent --show-error --location "$artifact_url" --output "$archive_path"

tar -xzf "$archive_path" -C "$temp_dir"
app_bundle="$(find "$temp_dir" -maxdepth 4 -type d -name '*.app' -print -quit)"

if [[ -z "$app_bundle" ]]; then
  fail "Downloaded archive did not contain a .app bundle"
fi

target_path="$install_dir/$(basename "$app_bundle")"

if [[ -w "$install_dir" ]]; then
  mkdir -p "$install_dir"
  rm -rf "$target_path"
  ditto "$app_bundle" "$target_path"
else
  sudo mkdir -p "$install_dir"
  sudo rm -rf "$target_path"
  sudo ditto "$app_bundle" "$target_path"
fi

echo "Installed $(basename "$target_path") to $target_path"
echo "Launch it with: open \"$target_path\""
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const script = buildScript(args.baseUrl);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, script, { encoding: "utf8", mode: 0o755 });
  console.log(`Wrote install script to ${args.output}`);
}

main();
