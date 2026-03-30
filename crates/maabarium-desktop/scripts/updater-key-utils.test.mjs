import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMinisignText } from "./updater-key-utils.mjs";

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
