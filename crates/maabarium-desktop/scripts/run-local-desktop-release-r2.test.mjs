import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawnSync } from "node:child_process";

const desktopDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

function runReleaseScript(args) {
  return spawnSync(
    "bash",
    ["./scripts/run-local-desktop-release-r2.sh", ...args],
    {
      cwd: desktopDir,
      encoding: "utf8",
      env: {
        ...process.env,
        APPLE_ID: "test-apple-id",
        APPLE_PASSWORD: "test-apple-password",
        APPLE_TEAM_ID: "TEAMID1234",
        MAABARIUM_UPDATE_BASE_URL: "https://downloads.example.test",
        TAURI_SIGNING_PRIVATE_KEY: "placeholder",
        MAABARIUM_UPDATE_PUBKEY: "placeholder",
      },
    },
  );
}

test("dirty worktree is rejected unless allow-dirty is set", () => {
  const withoutFlag = runReleaseScript([
    "--skip-gh-upload",
    "--skip-r2-publish",
  ]);
  assert.notEqual(withoutFlag.status, 0);
  assert.match(
    withoutFlag.stderr,
    /Refusing local desktop publish from a dirty worktree/,
  );

  const withFlag = runReleaseScript([
    "--allow-dirty",
    "--skip-gh-upload",
    "--skip-r2-publish",
  ]);
  assert.notEqual(withFlag.status, 0);
  assert.doesNotMatch(
    withFlag.stderr,
    /Refusing local desktop publish from a dirty worktree/,
  );
  assert.match(
    `${withFlag.stdout}\n${withFlag.stderr}`,
    /APPLE_SIGNING_IDENTITY|APPLE_CERTIFICATE|Updater public key|Updater private key|Updater signing keypair|Lockfile is up to date|No updater public key provided|Updater public key is not valid|not valid base64 minisign key material/,
  );
});
