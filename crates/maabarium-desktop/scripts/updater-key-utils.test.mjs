import test from "node:test";
import assert from "node:assert/strict";

import {
  isEncryptedMinisignSecretKey,
  keyIdFromMinisignLine,
  normalizeMinisignText,
  signatureKeyLineFromMinisignSignature,
} from "./updater-key-utils.mjs";
import {
  buildSignerProcessEnv,
  hasLocalTauriCli,
  shouldPassPasswordArg,
} from "./validate-updater-keypair.mjs";
import { formatNormalizedUpdaterKey } from "./normalize-updater-key.mjs";

test("normalizes a wrapped minisign pubkey", () => {
  const wrapped =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIzNzM1MzExODM4QzlDMzcKUldRM25JeURFVk56STN4Y1VscHBFVlBPVUp4aXFTTHhIOCtiWXBSOXA1YmdxQ09pekpkaDk4ZTMK";

  const result = normalizeMinisignText(wrapped, "Updater public key");

  assert.equal(
    result.keyLine,
    "RWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3",
  );
  assert.equal(result.format, "base64-wrapped two-line minisign file");
});

test("preserves a plain two-line minisign pubkey", () => {
  const plain =
    "untrusted comment: minisign public key\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n";

  const result = normalizeMinisignText(plain, "Updater public key");

  assert.equal(
    result.keyLine,
    "RWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3",
  );
  assert.equal(result.format, "two-line minisign file");
});

test("extracts signer key line from wrapped minisign signature text", () => {
  const wrapped =
    "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRM25JeURFVk56STBmb0VNY2IvNkxrNEtMMXcwUlE5RVNZMDAxK3UzNnhNQSthQ2pJaVZhbmxPc2hIVFJWYkVrR1dPM3JYcHRkV1l6ZU03MkFnNjZNd2RQbzRjQU1sYlFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzc0ODY5MzYzCWZpbGU6TWFhYmFyaXVtLUNvbnNvbGUuYXBwLnRhci5negpGeFF4Z1FkRk83UXEzTHRyR1A4dGNGTnpWQllBb05EcHoxQlZGdyt3c1RjWEdEQWpqYS9SYzRVQ1pmdExrM0h4aHg3VWFxeTJXQ2x4KzBZcjgxd0JDQT09Cg==";

  const signatureKeyLine = signatureKeyLineFromMinisignSignature(
    wrapped,
    "Updater signature",
  );

  assert.equal(
    signatureKeyLine,
    "RUQ3nIyDEVNzI0foEMcb/6Lk4KL1w0RQ9ESY001+u36xMA+aCjIiVanlOshHTRVbEkGWO3rXptdWYzeM72Ag66MwdPo4cAMlbQM=",
  );
  assert.equal(
    keyIdFromMinisignLine(signatureKeyLine, "Updater signature"),
    "379c8c8311537323",
  );
});

test("detects a wrapped encrypted minisign secret key", () => {
  const wrapped =
    "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5Zm1GY1MzN21DZC90UDJ0Tno3NXhxT0FHd05RVlBXUm5vMUo4d0djblRuSUFBQkFBQUFBQUFBQUFBQUlBQUFBQUhBaTJCUk9nakRwS01sUWVEYjVEMDA5SnlwNWlYV0V1Q01PbXJxdmJvaW81aGFSRkh0b1ZNWm03U1kwS0dKWCs4a3hENHZUT2NadFdIVXZkbFRFOVdlY2k1WlpsSVd0T25EVmlaWFZNaUhxRFY1SFVPZ2N5QjVuNExRcz0=";

  assert.equal(isEncryptedMinisignSecretKey(wrapped), true);
});

test("removes conflicting signer env vars before probe signing", () => {
  const signerEnv = buildSignerProcessEnv({
    PATH: process.env.PATH,
    TAURI_SIGNING_PRIVATE_KEY: "inline-private-key",
    TAURI_SIGNING_PRIVATE_KEY_FILE: "/tmp/updater.key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "secret",
  });

  assert.equal(signerEnv.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(signerEnv.TAURI_SIGNING_PRIVATE_KEY_FILE, undefined);
  assert.equal(signerEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "secret");
});

test("passes an explicit empty password for encrypted minisign secret keys", () => {
  const encryptedWrapped =
    "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5Zm1GY1MzN21DZC90UDJ0Tno3NXhxT0FHd05RVlBXUm5vMUo4d0djblRuSUFBQkFBQUFBQUFBQUFBQUlBQUFBQUhBaTJCUk9nakRwS01sUWVEYjVEMDA5SnlwNWlYV0V1Q01PbXJxdmJvaW81aGFSRkh0b1ZNWm03U1kwS0dKWCs4a3hENHZUT2NadFdIVXZkbFRFOVdlY2k1WlpsSVd0T25EVmlaWFZNaUhxRFY1SFVPZ2N5QjVuNExRcz0=";

  assert.equal(shouldPassPasswordArg(encryptedWrapped, ""), true);
  assert.equal(shouldPassPasswordArg("plain-key", ""), false);
});

test("detects when the local Tauri CLI is not installed", () => {
  assert.equal(
    hasLocalTauriCli("/definitely/missing/maabarium-desktop"),
    false,
  );
});

test("formats normalized updater pubkeys for Tauri bundle config as two-line minisign text", () => {
  const wrapped =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIzNzM1MzExODM4QzlDMzcKUldRM25JeURFVk56STN4Y1VscHBFVlBPVUp4aXFTTHhIOCtiWXBSOXA1YmdxQ09pekpkaDk4ZTMK";

  assert.equal(
    formatNormalizedUpdaterKey(wrapped, "two-line"),
    "untrusted comment: minisign public key: 23735311838C9C37\nRWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3\n",
  );
  assert.equal(formatNormalizedUpdaterKey(wrapped, "wrapped"), wrapped);
  assert.equal(
    formatNormalizedUpdaterKey(wrapped, "key-line"),
    "RWQ3nIyDEVNzI3xcUlppEVPOUJxiqSLxH8+bYpR9p5bgqCOizJdh98e3",
  );
});
