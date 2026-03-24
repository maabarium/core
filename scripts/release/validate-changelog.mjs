import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultChangelogPath = path.join(repoRoot, "CHANGELOG.md");
const placeholderPattern =
  /^(?:[-*]\s*)?(?:none|n\/a|na|not applicable|no breaking changes)\.?\s*$/i;

function parseArgs(argv) {
  const args = {
    bump: "patch",
    changelogPath: defaultChangelogPath,
    githubOutput: "",
    notesOutput: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--bump" && next) {
      args.bump = next;
      index += 1;
      continue;
    }

    if (token === "--changelog" && next) {
      args.changelogPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--github-output" && next) {
      args.githubOutput = next;
      index += 1;
      continue;
    }

    if (token === "--notes-output" && next) {
      args.notesOutput = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!["patch", "minor", "major"].includes(args.bump)) {
    throw new Error(`Unsupported bump value: ${args.bump}`);
  }

  return args;
}

function printHelp() {
  console.log(`Validate CHANGELOG.md before preparing a release.

Usage:
  node scripts/release/validate-changelog.mjs --bump patch

Options:
  --bump <patch|minor|major>   Release type being prepared
  --changelog <path>           Defaults to ./CHANGELOG.md
  --notes-output <path>        Writes the Unreleased section to a file
  --github-output <path>       Writes selected outputs for GitHub Actions
`);
}

function extractSection(lines, headingPattern, nextHeadingPattern) {
  const startIndex = lines.findIndex((line) =>
    headingPattern.test(line.trim()),
  );
  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index].trim())) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex);
}

function normalizeSection(lines) {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0].trim() === "") {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}

function hasMeaningfulContent(lines) {
  return lines.some((line) => {
    const value = line.trim();
    if (!value || /^###\s+/.test(value)) {
      return false;
    }
    return !placeholderPattern.test(value);
  });
}

function writeGitHubOutput(outputPath, values) {
  if (!outputPath) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.changelogPath)) {
    throw new Error(`Missing changelog file: ${args.changelogPath}`);
  }

  const changelog = fs.readFileSync(args.changelogPath, "utf8");
  const lines = changelog.split(/\r?\n/);
  const unreleasedLines = extractSection(
    lines,
    /^##\s+\[Unreleased\]\s*$/i,
    /^##\s+/,
  );

  if (!unreleasedLines) {
    throw new Error("CHANGELOG.md must contain a `## [Unreleased]` section.");
  }

  const normalizedUnreleased = normalizeSection(unreleasedLines);
  if (!hasMeaningfulContent(normalizedUnreleased)) {
    throw new Error(
      "The `## [Unreleased]` section must include at least one substantive release note before running release-prep.",
    );
  }

  const breakingLines = extractSection(
    normalizedUnreleased,
    /^###\s+Breaking Changes\s*$/i,
    /^###\s+/,
  );
  const hasBreakingChanges = breakingLines
    ? hasMeaningfulContent(normalizeSection(breakingLines))
    : false;

  if (args.bump === "major" && !hasBreakingChanges) {
    throw new Error(
      "Major releases require an explicit `### Breaking Changes` entry under `## [Unreleased]` in CHANGELOG.md.",
    );
  }

  if (args.notesOutput) {
    fs.mkdirSync(path.dirname(args.notesOutput), { recursive: true });
    fs.writeFileSync(
      args.notesOutput,
      `${normalizedUnreleased.join("\n").trim()}\n`,
      "utf8",
    );
  }

  writeGitHubOutput(args.githubOutput, {
    changelog_path: args.changelogPath,
    has_breaking_changes: String(hasBreakingChanges),
    release_notes_path: args.notesOutput,
  });

  console.log(
    `Validated ${path.relative(repoRoot, args.changelogPath)} for a ${args.bump} release.`,
  );
}

main();
