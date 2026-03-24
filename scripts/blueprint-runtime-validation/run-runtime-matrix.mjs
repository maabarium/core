import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureDirectory,
  ensureStrategyPrerequisites,
  generateMatrix,
  parseArgs,
  repoLogPath,
  repoRoot,
  runsRoot,
} from "./harness.mjs";

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
  });
}

function newLogTail(previousBytes) {
  if (!fs.existsSync(repoLogPath)) {
    return "";
  }
  const content = fs.readFileSync(repoLogPath, "utf8");
  return content.slice(previousBytes);
}

function extractProviders(logTail) {
  return [...logTail.matchAll(/provider=([^\s]+)/g)].map((match) =>
    match[1].replaceAll('"', ""),
  );
}

function extractModels(logTail) {
  return [...logTail.matchAll(/model=([^\s]+)/g)].map((match) =>
    match[1].replaceAll('"', ""),
  );
}

function statusPasses(summary, caseEntry) {
  if (summary.exitCode !== 0) {
    return false;
  }
  if (!summary.statusOutput.includes(caseEntry.blueprintName)) {
    return false;
  }
  if (!summary.statusOutput.includes("error=none")) {
    return false;
  }

  if (caseEntry.strategyId === "local") {
    const uniqueProviders = new Set(summary.providers);
    const uniqueModels = new Set(summary.models);
    return (
      uniqueProviders.size === 1 &&
      uniqueProviders.has("ollama") &&
      uniqueModels.has("qwen2.5:7b") &&
      uniqueModels.has("gemma2:9b")
    );
  }

  if (caseEntry.strategyId === "remote") {
    const uniqueProviders = new Set(summary.providers);
    const uniqueModels = new Set(summary.models);
    return (
      uniqueProviders.has("openai-compat") &&
      ([...uniqueModels].some((model) =>
        model.startsWith("grok-4-1-fast-reasoning"),
      ) ||
        [...uniqueModels].some((model) =>
          model.startsWith(
            process.env.MAABARIUM_DEEPSEEK_MODEL || "deepseek-chat",
          ),
        ))
    );
  }

  if (caseEntry.strategyId === "mixed") {
    const uniqueModels = new Set(summary.models);
    return (
      uniqueModels.has("qwen2.5:7b") &&
      uniqueModels.has("gemma2:9b") &&
      summary.models.some((model) =>
        model.startsWith("grok-4-1-fast-reasoning"),
      ) &&
      summary.models.some((model) =>
        model.startsWith(
          process.env.MAABARIUM_DEEPSEEK_MODEL || "deepseek-chat",
        ),
      )
    );
  }

  return true;
}

function summarizeCase(
  caseEntry,
  runRoot,
  result,
  statusResult,
  exportResult,
  logTail,
) {
  const providers = extractProviders(logTail);
  const models = extractModels(logTail);
  const summary = {
    caseId: caseEntry.caseId,
    strategyId: caseEntry.strategyId,
    templateId: caseEntry.templateId,
    blueprintName: caseEntry.blueprintName,
    exitCode: result.status ?? -1,
    providers,
    models,
    stdoutPath: path.join(runRoot, "stdout.log"),
    stderrPath: path.join(runRoot, "stderr.log"),
    statusPath: path.join(runRoot, "status.log"),
    exportPath: path.join(runRoot, "export.json"),
    logTailPath: path.join(runRoot, "runtime.log"),
    statusOutput: statusResult.stdout || statusResult.stderr || "",
    exportOutput: exportResult.stdout || exportResult.stderr || "",
  };
  summary.passed = statusPasses(summary, caseEntry);
  return summary;
}

function markdownSummary(results) {
  const lines = [
    "# Blueprint Runtime Matrix Results",
    "",
    `Generated at ${new Date().toISOString()}`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.caseId}`);
    lines.push("");
    lines.push(`- status: ${result.passed ? "pass" : "fail"}`);
    lines.push(`- exit code: ${result.exitCode}`);
    lines.push(`- providers seen: ${result.providers.join(", ") || "none"}`);
    lines.push(`- models seen: ${result.models.join(", ") || "none"}`);
    lines.push(
      `- artifacts: ${result.stdoutPath}, ${result.stderrPath}, ${result.statusPath}, ${result.exportPath}, ${result.logTailPath}`,
    );
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const manifest = generateMatrix({
  strategyId: args.strategy,
  templateId: args.template,
});
const timestamp = new Date().toISOString().replaceAll(":", "-");
const runBase = path.join(runsRoot, timestamp);
ensureDirectory(runBase);

const results = [];
for (const strategyId of [
  ...new Set(manifest.cases.map((entry) => entry.strategyId)),
]) {
  ensureStrategyPrerequisites(strategyId);
}

for (const caseEntry of manifest.cases) {
  const runRoot = path.join(runBase, caseEntry.caseId);
  ensureDirectory(runRoot);
  const dbPath = path.join(runRoot, "runtime.db");
  const exportPath = path.join(runRoot, "export.json");
  const logStart = fs.existsSync(repoLogPath)
    ? fs.statSync(repoLogPath).size
    : 0;

  const runResult = runCommand(
    "cargo",
    [
      "run",
      "-p",
      "maabarium-cli",
      "--",
      "run",
      caseEntry.workflowPath,
      "--db",
      dbPath,
    ],
    {
      env: {
        MAABARIUM_RESEARCH_SEARCH_PROVIDER:
          process.env.MAABARIUM_RESEARCH_SEARCH_PROVIDER || "duckduckgo_scrape",
      },
    },
  );

  fs.writeFileSync(
    path.join(runRoot, "stdout.log"),
    runResult.stdout || "",
    "utf8",
  );
  fs.writeFileSync(
    path.join(runRoot, "stderr.log"),
    runResult.stderr || "",
    "utf8",
  );

  const statusResult = runCommand("cargo", [
    "run",
    "-p",
    "maabarium-cli",
    "--",
    "status",
    "--db",
    dbPath,
  ]);
  fs.writeFileSync(
    path.join(runRoot, "status.log"),
    statusResult.stdout || statusResult.stderr || "",
    "utf8",
  );

  const exportResult = runCommand("cargo", [
    "run",
    "-p",
    "maabarium-cli",
    "--",
    "export",
    "--db",
    dbPath,
    "--format",
    "json",
    "--output",
    exportPath,
  ]);

  const logTail = newLogTail(logStart);
  fs.writeFileSync(path.join(runRoot, "runtime.log"), logTail, "utf8");

  results.push(
    summarizeCase(
      caseEntry,
      runRoot,
      runResult,
      statusResult,
      exportResult,
      logTail,
    ),
  );
}

fs.writeFileSync(
  path.join(runBase, "summary.json"),
  `${JSON.stringify(results, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(runBase, "summary.md"),
  markdownSummary(results),
  "utf8",
);

const failed = results.filter((entry) => !entry.passed);
console.log(
  JSON.stringify(
    { runBase, total: results.length, failed: failed.length, results },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exit(1);
}
