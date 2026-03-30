import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  keyIdFromMinisignLine,
  normalizeMinisignText,
} from "./updater-key-utils.mjs";

function parseArgs(argv) {
  const args = {
    file: null,
    value: null,
    stdin: false,
    format: "key-line",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--") {
      continue;
    }

    if (token === "--file" && next) {
      args.file = next;
      index += 1;
      continue;
    }

    if (token === "--value" && next) {
      args.value = next;
      index += 1;
      continue;
    }

    if (token === "--stdin") {
      args.stdin = true;
      continue;
    }

    if (token === "--format" && next) {
      args.format = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (
    args.format !== "key-line" &&
    args.format !== "two-line" &&
    args.format !== "wrapped"
  ) {
    throw new Error(
      "--format must be one of 'key-line', 'two-line', or 'wrapped'.",
    );
  }

  return args;
}

function loadValue(args) {
  if (args.file) {
    return fs.readFileSync(args.file, "utf8");
  }

  if (args.value !== null) {
    return args.value;
  }

  if (args.stdin) {
    return fs.readFileSync(0, "utf8");
  }

  throw new Error("Pass --file, --value, or --stdin.");
}

export function formatNormalizedUpdaterKey(rawValue, format = "key-line") {
  const { keyLine, normalizedLines } = normalizeMinisignText(
    rawValue,
    "Updater key",
  );
  const twoLineText =
    normalizedLines.length === 2
      ? `${normalizedLines.join("\n")}\n`
      : `untrusted comment: minisign public key: ${keyIdFromMinisignLine(keyLine, "Updater key").toUpperCase()}\n${keyLine}\n`;

  if (format === "two-line") {
    return twoLineText;
  }

  if (format === "wrapped") {
    return Buffer.from(twoLineText, "utf8").toString("base64");
  }

  return keyLine;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const normalized = formatNormalizedUpdaterKey(loadValue(args), args.format);
  process.stdout.write(normalized);
}

const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const moduleFilePath = fileURLToPath(import.meta.url);

if (entryFilePath === moduleFilePath) {
  main();
}
