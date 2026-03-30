#!/usr/bin/env bash

run_updater_signing_prereqs() {
  echo "Installing desktop dependencies before updater key validation..."
  pnpm install --frozen-lockfile

  echo "Validating updater public key..."
  if [[ -n "${MAABARIUM_UPDATE_PUBKEY_FILE:-}" ]]; then
    node ./scripts/validate-updater-pubkey.mjs --file "$MAABARIUM_UPDATE_PUBKEY_FILE"
  else
    node ./scripts/validate-updater-pubkey.mjs --value "$MAABARIUM_UPDATE_PUBKEY"
  fi

  echo "Validating updater signing keypair..."
  node ./scripts/validate-updater-keypair.mjs
}