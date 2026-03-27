#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This reset script supports macOS only." >&2
  exit 1
fi

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      dry_run=1
      ;;
    --help)
      cat <<'EOF'
Reset Maabarium's macOS production app data by moving it into a timestamped backup.

Usage:
  bash ./scripts/reset-macos-production-data.sh
  bash ./scripts/reset-macos-production-data.sh --dry-run

This targets the production desktop runtime namespace:
  ~/Library/Application Support/com.maabarium.console
  ~/Library/Logs/com.maabarium.console
  ~/Library/Preferences/com.maabarium.console.plist
  ~/Library/Saved Application State/com.maabarium.console.savedState

The script never deletes those paths directly. It moves any existing data into:
  ~/Library/Application Support/maabarium-reset-backups/<timestamp>/
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if pgrep -f "Maabarium-Console.app/Contents/MacOS/maabarium-desktop|/maabarium-desktop" >/dev/null 2>&1; then
  echo "Close Maabarium before resetting production app data." >&2
  exit 1
fi

home_dir="${HOME:?HOME must be set}"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_root="$home_dir/Library/Application Support/maabarium-reset-backups/$timestamp"

declare -a target_paths=(
  "$home_dir/Library/Application Support/com.maabarium.console"
  "$home_dir/Library/Logs/com.maabarium.console"
  "$home_dir/Library/Preferences/com.maabarium.console.plist"
  "$home_dir/Library/Saved Application State/com.maabarium.console.savedState"
)

existing_paths=()
for path in "${target_paths[@]}"; do
  if [[ -e "$path" ]]; then
    existing_paths+=("$path")
  fi
done

if [[ ${#existing_paths[@]} -eq 0 ]]; then
  echo "No production Maabarium desktop data was found under com.maabarium.console."
  exit 0
fi

echo "Backing up the following paths into: $backup_root"
for path in "${existing_paths[@]}"; do
  echo "- $path"
done

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run complete. No files were moved."
  exit 0
fi

mkdir -p "$backup_root"

for path in "${existing_paths[@]}"; do
  parent_name="$(basename "$(dirname "$path")")"
  destination_dir="$backup_root/$parent_name"
  mkdir -p "$destination_dir"
  mv "$path" "$destination_dir/"
done

echo "Production Maabarium desktop data was moved to $backup_root"
echo "The next packaged release launch will start with a clean com.maabarium.console state."