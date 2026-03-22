import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(desktopRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

function parseArgs(argv) {
  const args = {
    artifactsDir: path.resolve(desktopRoot, "../../target/release/bundle"),
    output: path.resolve(desktopRoot, "release/latest.json"),
    version: packageJson.version,
    notes: process.env.MAABARIUM_RELEASE_NOTES ?? "",
    pubDate: new Date().toISOString(),
    baseUrl: process.env.MAABARIUM_UPDATE_BASE_URL ?? "",
    platforms: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--artifacts-dir" && next) {
      args.artifactsDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--output" && next) {
      args.output = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--version" && next) {
      args.version = next;
      index += 1;
      continue;
    }

    if (token === "--notes" && next) {
      args.notes = next;
      index += 1;
      continue;
    }

    if (token === "--notes-file" && next) {
      args.notes = fs
        .readFileSync(path.resolve(process.cwd(), next), "utf8")
        .trim();
      index += 1;
      continue;
    }

    if (token === "--pub-date" && next) {
      args.pubDate = next;
      index += 1;
      continue;
    }

    if (token === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
      continue;
    }

    if (token === "--platform" && next) {
      args.platforms.push(next);
      index += 1;
      continue;
    }

    if (token === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`Generate a Tauri static updater manifest.

Usage:
  pnpm build:release-manifest -- --base-url https://downloads.example.com/releases
  pnpm build:release-manifest -- --base-url https://downloads.example.com/releases --platform darwin-aarch64=macos/Maabarium Console.app.tar.gz

Required:
  --base-url <url> or MAABARIUM_UPDATE_BASE_URL

Optional:
  --artifacts-dir <path>   Defaults to ../../target/release/bundle
  --output <path>          Defaults to ./release/latest.json
  --version <semver>       Defaults to package.json version
  --notes <text>           Inline release notes
  --notes-file <path>      Read release notes from a file
  --pub-date <rfc3339>     Defaults to current time
  --platform <key=path>    Explicit platform mapping relative to artifacts dir

The generator auto-discovers updater artifacts when the platform can be inferred
from the filename or path. Use --platform when separate CI jobs produce ambiguous
artifact names such as macOS .app.tar.gz bundles without a target triple.
`);
}

function walkDirectory(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(absolutePath));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function inferPlatformKey(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const rules = [
    [
      /(darwin|apple-darwin|macos).*aarch64|aarch64.*(darwin|apple-darwin|macos)/,
      "darwin-aarch64",
    ],
    [
      /(darwin|apple-darwin|macos).*(x86_64|amd64)|x86_64.*(darwin|apple-darwin|macos)/,
      "darwin-x86_64",
    ],
    [/(linux|appimage).*aarch64|aarch64.*(linux|appimage)/, "linux-aarch64"],
    [
      /(linux|appimage).*(x86_64|amd64)|x86_64.*(linux|appimage)/,
      "linux-x86_64",
    ],
    [/(linux|appimage).*armv7|armv7.*(linux|appimage)/, "linux-armv7"],
    [/(linux|appimage).*i686|i686.*(linux|appimage)/, "linux-i686"],
    [
      /(windows|msi|nsis|setup).*aarch64|aarch64.*(windows|msi|nsis|setup)/,
      "windows-aarch64",
    ],
    [
      /(windows|msi|nsis|setup).*(x86_64|x64|amd64)|x86_64.*(windows|msi|nsis|setup)/,
      "windows-x86_64",
    ],
    [
      /(windows|msi|nsis|setup).*i686|i686.*(windows|msi|nsis|setup)/,
      "windows-i686",
    ],
  ];

  for (const [pattern, platformKey] of rules) {
    if (pattern.test(normalized)) {
      return platformKey;
    }
  }

  return null;
}

function encodeUrlPath(relativePath) {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function registerArtifact(
  platforms,
  platformKey,
  relativeArtifactPath,
  artifactsDir,
  baseUrl,
) {
  const artifactPath = path.resolve(artifactsDir, relativeArtifactPath);
  const signaturePath = `${artifactPath}.sig`;

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found for ${platformKey}: ${artifactPath}`);
  }

  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing signature for ${platformKey}: ${signaturePath}`);
  }

  const url = new URL(
    encodeUrlPath(relativeArtifactPath),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
  const signature = fs.readFileSync(signaturePath, "utf8").trim();

  platforms[platformKey] = {
    signature,
    url,
  };
}

function collectPlatforms({ artifactsDir, baseUrl, explicitMappings }) {
  const platforms = {};

  for (const mapping of explicitMappings) {
    const [platformKey, relativeArtifactPath] = mapping.split("=", 2);
    if (!platformKey || !relativeArtifactPath) {
      throw new Error(`Invalid --platform value: ${mapping}`);
    }
    registerArtifact(
      platforms,
      platformKey,
      relativeArtifactPath,
      artifactsDir,
      baseUrl,
    );
  }

  const files = walkDirectory(artifactsDir);
  const updaterArtifacts = files.filter((filePath) => {
    const normalized = filePath.replace(/\\/g, "/");
    return (
      !normalized.endsWith(".sig") &&
      (normalized.endsWith(".app.tar.gz") ||
        normalized.endsWith(".AppImage") ||
        normalized.endsWith(".msi") ||
        normalized.endsWith("-setup.exe"))
    );
  });

  for (const artifactPath of updaterArtifacts) {
    const relativeArtifactPath = path.relative(artifactsDir, artifactPath);
    const platformKey = inferPlatformKey(relativeArtifactPath);
    if (!platformKey || platforms[platformKey]) {
      continue;
    }
    registerArtifact(
      platforms,
      platformKey,
      relativeArtifactPath,
      artifactsDir,
      baseUrl,
    );
  }

  return platforms;
}

function validateSemver(version) {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Version must be a valid semver string, received: ${version}`,
    );
  }
}

function validatePubDate(pubDate) {
  if (Number.isNaN(Date.parse(pubDate))) {
    throw new Error(
      `pub_date must be RFC 3339 compatible, received: ${pubDate}`,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    throw new Error(
      "Missing required --base-url argument or MAABARIUM_UPDATE_BASE_URL environment variable.",
    );
  }

  validateSemver(args.version);
  validatePubDate(args.pubDate);

  if (!fs.existsSync(args.artifactsDir)) {
    throw new Error(`Artifacts directory does not exist: ${args.artifactsDir}`);
  }

  const platforms = collectPlatforms({
    artifactsDir: args.artifactsDir,
    baseUrl: args.baseUrl,
    explicitMappings: args.platforms,
  });

  if (Object.keys(platforms).length === 0) {
    throw new Error(
      "No updater artifacts were discovered. Run a signed Tauri release build first or pass explicit --platform mappings.",
    );
  }

  const manifest = {
    version: args.version,
    notes: args.notes,
    pub_date: new Date(args.pubDate).toISOString(),
    platforms,
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(
    args.output,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Wrote updater manifest with ${Object.keys(platforms).length} platform target(s) to ${args.output}`,
  );
}

main();
