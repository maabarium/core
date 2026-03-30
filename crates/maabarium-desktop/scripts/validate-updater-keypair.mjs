import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import readline from "node:readline";

import {
  isEncryptedMinisignSecretKey,
  keyIdFromMinisignLine,
  normalizeMinisignText,
  signatureKeyLineFromMinisignSignature,
} from "./updater-key-utils.mjs";

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

async function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "";
  }

  const input = createReadStream("/dev/tty");
  const output = createWriteStream("/dev/tty");

  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  });

  try {
    const password = await new Promise((resolve) => {
      rl.question(question, resolve);
    });
    process.stdout.write("\n");
    return password;
  } finally {
    rl.close();
    input.close();
    output.close();
  }
}

async function resolvePrivateKeyPassword(rawValue) {
  const configuredPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (configuredPassword !== undefined) {
    return configuredPassword;
  }

  if (!isEncryptedMinisignSecretKey(rawValue)) {
    return "";
  }

  return promptHidden("Updater private key password: ");
}

function signerKeyIdFromPrivateKey(rawValue, password) {
  const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
  const packageDir = path.dirname(scriptsDir);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maabarium-keypair-"));
  const payloadPath = path.join(tempDir, "payload.txt");
  const privateKeyPath = path.join(tempDir, "updater.key");

  try {
    fs.writeFileSync(payloadPath, "maabarium-keypair-check\n", "utf8");
    fs.writeFileSync(privateKeyPath, rawValue, {
      encoding: "utf8",
      mode: 0o600,
    });

    const args = [
      "--dir",
      packageDir,
      "tauri",
      "signer",
      "sign",
      "--private-key-path",
      privateKeyPath,
    ];
    if (password) {
      args.push("--password", password);
    }
    args.push(payloadPath);

    const result = spawnSync("pnpm", args, {
      encoding: "utf8",
      env: process.env,
    });

    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      if (
        /wrong password|incorrect updater private key password/i.test(output)
      ) {
        throw new Error(
          "Updater private key could not be unlocked. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD to the correct password before running release validation.",
        );
      }

      throw new Error(
        `Failed to validate updater private key by signing a probe payload: ${output.trim() || "unknown signer failure"}`,
      );
    }

    const signaturePath = `${payloadPath}.sig`;
    const signature = fs.readFileSync(signaturePath, "utf8");
    const signatureKeyLine = signatureKeyLineFromMinisignSignature(
      signature,
      "Updater signature",
    );

    return keyIdFromMinisignLine(signatureKeyLine, "Updater signature");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
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
  normalizeMinisignKey(privateKeyInput.rawValue, "Updater private key");

  const publicKeyId = keyIdFromMinisignLine(pubkeyLine, "Updater public key");
  const password = await resolvePrivateKeyPassword(privateKeyInput.rawValue);
  const privateKeyId = signerKeyIdFromPrivateKey(
    privateKeyInput.rawValue,
    password,
  );

  if (publicKeyId !== privateKeyId) {
    throw new Error(
      `Updater private/public key mismatch: ${pubkeyInput.sourceLabel} does not match ${privateKeyInput.sourceLabel}.`,
    );
  }

  console.log("Updater signing keypair is consistent.");
  console.log(`Public key source: ${pubkeyInput.sourceLabel}`);
  console.log(`Private key source: ${privateKeyInput.sourceLabel}`);
}

await main();
