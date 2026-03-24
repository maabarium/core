#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const defaultChangelogPath = path.join(repoRoot, "CHANGELOG.md");

const releaseTargets = [
  {
    type: "cargo",
    path: "crates/maabarium-core/Cargo.toml",
  },
  {
    type: "cargo",
    path: "crates/maabarium-cli/Cargo.toml",
  },
  {
    type: "cargo",
    path: "crates/maabarium-desktop/Cargo.toml",
  },
  {
    type: "json",
    path: "crates/maabarium-desktop/package.json",
    property: "version",
  },
  {
    type: "json",
    path: "crates/maabarium-desktop/tauri.conf.json",
    property: "version",
  },
];

function parseArgs(argv) {
  const options = {
    bump: null,
    dryRun: false,
    changelogPath: defaultChangelogPath,
    githubOutput: process.env.GITHUB_OUTPUT ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--bump") {
      options.bump = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--changelog") {
      options.changelogPath = path.resolve(
        process.cwd(),
        argv[index + 1] ?? "",
      );
      index += 1;
      continue;
    }

    if (value === "--github-output") {
      options.githubOutput = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  if (!options.bump || !["patch", "minor", "major"].includes(options.bump)) {
    throw new Error(
      "Usage: node scripts/release/bump-version.mjs --bump <patch|minor|major> [--dry-run] [--github-output <path>]",
    );
  }

  return options;
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function bumpVersion(currentVersion, bump) {
  const parsed = parseSemver(currentVersion);
  if (bump === "patch") {
    parsed.patch += 1;
  } else if (bump === "minor") {
    parsed.minor += 1;
    parsed.patch = 0;
  } else {
    parsed.major += 1;
    parsed.minor = 0;
    parsed.patch = 0;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function writeFile(relativePath, content) {
  fs.writeFileSync(path.join(repoRoot, relativePath), content);
}

function normalizeSectionLines(lines) {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0].trim() === "") {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}

function rolloverChangelog(changelogPath, nextVersion, releaseDate) {
  const content = fs.readFileSync(changelogPath, "utf8");
  const lines = content.split(/\r?\n/);
  const unreleasedIndex = lines.findIndex((line) =>
    /^##\s+\[Unreleased\]\s*$/i.test(line.trim()),
  );

  if (unreleasedIndex === -1) {
    throw new Error("CHANGELOG.md must contain a `## [Unreleased]` section.");
  }

  let nextHeadingIndex = lines.length;
  for (let index = unreleasedIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      nextHeadingIndex = index;
      break;
    }
  }

  const unreleasedBody = normalizeSectionLines(
    lines.slice(unreleasedIndex + 1, nextHeadingIndex),
  );
  const newUnreleasedBody = [
    "",
    "### Added",
    "",
    "- None.",
    "",
    "### Changed",
    "",
    "- None.",
    "",
    "### Fixed",
    "",
    "- None.",
    "",
    "### Breaking Changes",
    "",
    "- None.",
    "",
  ];

  const rolledLines = [
    ...lines.slice(0, unreleasedIndex),
    "## [Unreleased]",
    ...newUnreleasedBody,
    `## [${nextVersion}] - ${releaseDate}`,
    "",
    ...unreleasedBody,
    "",
    ...lines.slice(nextHeadingIndex),
  ];

  fs.writeFileSync(
    changelogPath,
    `${rolledLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()}\n`,
  );
}

function readTargetVersion(target) {
  const content = readFile(target.path);
  if (target.type === "cargo") {
    const match = content.match(/^version = "([^"]+)"$/m);
    if (!match) {
      throw new Error(`Could not find Cargo version in ${target.path}`);
    }

    return match[1];
  }

  const parsed = JSON.parse(content);
  const value = parsed[target.property];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Could not find JSON version property in ${target.path}`);
  }

  return value;
}

function updateTargetVersion(target, nextVersion) {
  const content = readFile(target.path);
  if (target.type === "cargo") {
    const updated = content.replace(
      /^version = "([^"]+)"$/m,
      `version = "${nextVersion}"`,
    );
    if (updated === content) {
      throw new Error(`Failed to update Cargo version in ${target.path}`);
    }
    writeFile(target.path, updated);
    return;
  }

  const parsed = JSON.parse(content);
  parsed[target.property] = nextVersion;
  writeFile(target.path, `${JSON.stringify(parsed, null, 2)}\n`);
}

function appendGithubOutput(filePath, values) {
  if (!filePath) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const versions = releaseTargets.map(readTargetVersion);
  const currentVersion = versions[0];
  const mismatchedTarget = versions.find(
    (version) => version !== currentVersion,
  );
  if (mismatchedTarget) {
    throw new Error(
      `Release versions are out of sync. Expected all version fields to match ${currentVersion}.`,
    );
  }

  const nextVersion = bumpVersion(currentVersion, options.bump);
  const releaseDate = new Date().toISOString().slice(0, 10);

  if (!options.dryRun) {
    for (const target of releaseTargets) {
      updateTargetVersion(target, nextVersion);
    }
    rolloverChangelog(options.changelogPath, nextVersion, releaseDate);
  }

  appendGithubOutput(options.githubOutput, {
    current_version: currentVersion,
    next_version: nextVersion,
    release_tag: `desktop-v${nextVersion}`,
    release_date: releaseDate,
  });

  process.stdout.write(`${nextVersion}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
