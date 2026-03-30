import test from "node:test";
import assert from "node:assert/strict";

import {
  isEncryptedMinisignSecretKey,
  keyIdFromMinisignLine,
  normalizeMinisignText,
  signatureKeyLineFromMinisignSignature,
} from "./updater-key-utils.mjs";

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
