import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { normalizeMinisignText } from "./updater-key-utils.mjs";

function printHelp() {
  console.log(`Validate that a Tauri updater public key matches the updater private key.

Usage:
  pnpm validate:updater-keypair
  pnpm validate:updater-keypair -- --pubkey-file ~/.tauri/maabarium.key.pub --private-key-file ~/.tauri/maabarium.key

Options:
  --pubkey-file <path>       Read the updater public key from a file
  --pubkey-value <text>      Read the updater public key from an inline value
  --pubkey-env-var <name>    Environment variable to read for the public key (default: MAABARIUM_UPDATE_PUBKEY)
  --private-key-file <path>  Read the updater private key from a file
  --private-key-value <text> Read the updater private key from an inline value
  --private-key-env-var <name>
                             Environment variable to read for the private key (default: TAURI_SIGNING_PRIVATE_KEY)
  --help                     Show this help text

Notes:
  - Accepts either the raw key line or the two-line minisign file contents for both keys.
  - Falls back to MAABARIUM_UPDATE_PUBKEY_FILE and TAURI_SIGNING_PRIVATE_KEY_FILE when the inline env vars are unset.
  - Fails without printing the key material when the key IDs do not match.
`);
}

function parseArgs(argv) {
  const args = {
    pubkeyFile: null,
    pubkeyValue: null,
    pubkeyEnvVar: "MAABARIUM_UPDATE_PUBKEY",
    pubkeyFileEnvVar: "MAABARIUM_UPDATE_PUBKEY_FILE",
    privateKeyFile: null,
    privateKeyValue: null,
    privateKeyEnvVar: "TAURI_SIGNING_PRIVATE_KEY",
    privateKeyFileEnvVar: "TAURI_SIGNING_PRIVATE_KEY_FILE",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--") {
      continue;
    }

    if (token === "--pubkey-file" && next) {
      args.pubkeyFile = next;
      index += 1;
      continue;
    }

    if (token === "--pubkey-value" && next) {
      args.pubkeyValue = next;
      index += 1;
      continue;
    }

    if (token === "--pubkey-env-var" && next) {
      args.pubkeyEnvVar = next;
      index += 1;
      continue;
    }

    if (token === "--private-key-file" && next) {
      args.privateKeyFile = next;
      index += 1;
      continue;
    }

    if (token === "--private-key-value" && next) {
      args.privateKeyValue = next;
      index += 1;
      continue;
    }

    if (token === "--private-key-env-var" && next) {
      args.privateKeyEnvVar = next;
      index += 1;
      continue;
    }

    if (token === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.pubkeyFile && args.pubkeyValue !== null) {
    throw new Error("Use either --pubkey-file or --pubkey-value, not both.");
  }

  if (args.privateKeyFile && args.privateKeyValue !== null) {
    throw new Error(
      "Use either --private-key-file or --private-key-value, not both.",
    );
  }

  return args;
}

function loadInput({ file, value, envVar, fileEnvVar, label }) {
  if (file) {
    const filePath = path.resolve(process.cwd(), file);
    return {
      sourceLabel: `file:${filePath}`,
      rawValue: fs.readFileSync(filePath, "utf8"),
    };
  }

  if (value !== null) {
    return {
      sourceLabel: `inline ${label}`,
      rawValue: value,
    };
  }

  const fileEnvValue = process.env[fileEnvVar];
  if (fileEnvValue) {
    const filePath = path.resolve(process.cwd(), fileEnvValue);
    return {
      sourceLabel: `file:${filePath}`,
      rawValue: fs.readFileSync(filePath, "utf8"),
    };
  }

  const envValue = process.env[envVar];
  if (!envValue) {
    throw new Error(
      `No ${label} provided. Pass a file or value, or set ${envVar} or ${fileEnvVar}.`,
    );
  }

  return {
    sourceLabel: `env:${envVar}`,
    rawValue: envValue,
  };
}

function normalizeMinisignKey(rawValue, label) {
  return normalizeMinisignText(rawValue, label).keyLine;
}

function keyIdFromKeyLine(keyLine, label) {
  const decoded = Buffer.from(keyLine, "base64");
  if (decoded.length < 10) {
    throw new Error(`${label} is too short to contain a minisign key ID.`);
  }

  return decoded.subarray(2, 10).toString("hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pubkeyInput = loadInput({
    file: args.pubkeyFile,
    value: args.pubkeyValue,
    envVar: args.pubkeyEnvVar,
    fileEnvVar: args.pubkeyFileEnvVar,
    label: "updater public key",
  });
  const privateKeyInput = loadInput({
    file: args.privateKeyFile,
    value: args.privateKeyValue,
    envVar: args.privateKeyEnvVar,
    fileEnvVar: args.privateKeyFileEnvVar,
    label: "updater private key",
  });

  const pubkeyLine = normalizeMinisignKey(
    pubkeyInput.rawValue,
    "Updater public key",
  );
  const privateKeyLine = normalizeMinisignKey(
    privateKeyInput.rawValue,
    "Updater private key",
  );

  const publicKeyId = keyIdFromKeyLine(pubkeyLine, "Updater public key");
  const privateKeyId = keyIdFromKeyLine(privateKeyLine, "Updater private key");

  if (publicKeyId !== privateKeyId) {
    throw new Error(
      `Updater private/public key mismatch: ${pubkeyInput.sourceLabel} does not match ${privateKeyInput.sourceLabel}.`,
    );
  }

  console.log("Updater signing keypair is consistent.");
  console.log(`Public key source: ${pubkeyInput.sourceLabel}`);
  console.log(`Private key source: ${privateKeyInput.sourceLabel}`);
}

main();
