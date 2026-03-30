import fs from "node:fs";
import process from "node:process";

import { normalizeMinisignText } from "./updater-key-utils.mjs";

function parseArgs(argv) {
  const args = {
    file: null,
    value: null,
    stdin: false,
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

    throw new Error(`Unknown argument: ${token}`);
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

const args = parseArgs(process.argv.slice(2));
const { keyLine } = normalizeMinisignText(loadValue(args), "Updater key");
process.stdout.write(keyLine);
