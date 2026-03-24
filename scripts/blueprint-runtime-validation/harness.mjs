import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "../..");
export const templatesRoot = path.join(repoRoot, "blueprints");
export const artifactsRoot = path.join(
  repoRoot,
  ".tmp-blueprint-runtime-validation",
);
export const generatedRoot = path.join(artifactsRoot, "generated");
export const workspacesRoot = path.join(artifactsRoot, "workspaces");
export const runsRoot = path.join(artifactsRoot, "runs");
export const manifestPath = path.join(artifactsRoot, "manifest.json");
export const repoLogPath = path.join(repoRoot, "data", "maabarium.log");

const defaultXaiModel =
  process.env.MAABARIUM_XAI_MODEL || "grok-4-1-fast-reasoning";
const defaultDeepSeekModel =
  process.env.MAABARIUM_DEEPSEEK_MODEL || "deepseek-chat";

const localModelPool = ["qwen2.5:7b", "gemma2:9b"];

export const templateCatalog = [
  {
    id: "example",
    source: path.join(templatesRoot, "example.toml"),
    fixtureKind: "code",
    targetFiles: ["docs/**/*.md"],
    timeoutSeconds: 180,
  },
  {
    id: "code-quality",
    source: path.join(templatesRoot, "code-quality.toml"),
    fixtureKind: "code",
    targetFiles: ["docs/**/*.md"],
    timeoutSeconds: 180,
  },
  {
    id: "prompt-improvement",
    source: path.join(templatesRoot, "prompt-improvement.toml"),
    fixtureKind: "prompt",
    targetFiles: ["prompts/**/*.md", "docs/**/*.md"],
    timeoutSeconds: 150,
  },
  {
    id: "product-builder",
    source: path.join(templatesRoot, "product-builder.toml"),
    fixtureKind: "application",
    targetFiles: ["docs/**/*.md"],
    timeoutSeconds: 240,
  },
  {
    id: "general-research",
    source: path.join(templatesRoot, "general-research.toml"),
    fixtureKind: "research",
    targetFiles: ["research/**/*.md", "notes/**/*.md"],
    timeoutSeconds: 240,
  },
  {
    id: "lora-adapter",
    source: path.join(templatesRoot, "lora-adapter.toml"),
    fixtureKind: "lora",
    targetFiles: ["adapters/**/*.json", "README.md"],
    timeoutSeconds: 180,
  },
];

export const strategyCatalog = {
  local: {
    id: "local",
    runtimeStrategy: "local_only",
    models: [
      {
        name: "qwen2.5:7b",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        temperature: 0.4,
        max_tokens: 2048,
        requests_per_minute: 20,
      },
      {
        name: "gemma2:9b",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        temperature: 0.4,
        max_tokens: 2048,
        requests_per_minute: 20,
      },
    ],
  },
  remote: {
    id: "remote",
    runtimeStrategy: "remote_only",
    models: [
      {
        name: defaultXaiModel,
        provider: "xai",
        endpoint: "https://api.x.ai/v1",
        api_key_env: "XAI_API_KEY",
        temperature: 0.3,
        max_tokens: 2048,
        requests_per_minute: 10,
      },
      {
        name: defaultDeepSeekModel,
        provider: "deepseek",
        endpoint: "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        temperature: 0.3,
        max_tokens: 2048,
        requests_per_minute: 10,
      },
    ],
  },
  mixed: {
    id: "mixed",
    runtimeStrategy: "mixed",
    models: [
      {
        name: "qwen2.5:7b",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        temperature: 0.4,
        max_tokens: 2048,
        requests_per_minute: 20,
      },
      {
        name: "gemma2:9b",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        temperature: 0.4,
        max_tokens: 2048,
        requests_per_minute: 20,
      },
      {
        name: defaultXaiModel,
        provider: "xai",
        endpoint: "https://api.x.ai/v1",
        api_key_env: "XAI_API_KEY",
        temperature: 0.3,
        max_tokens: 2048,
        requests_per_minute: 10,
      },
      {
        name: defaultDeepSeekModel,
        provider: "deepseek",
        endpoint: "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        temperature: 0.3,
        max_tokens: 2048,
        requests_per_minute: 10,
      },
    ],
  },
};

export function parseArgs(argv) {
  const args = {
    strategy: "all",
    template: "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--strategy") {
      args.strategy = argv[index + 1] || "all";
      index += 1;
    } else if (token === "--template") {
      args.template = argv[index + 1] || "all";
      index += 1;
    }
  }

  return args;
}

export function selectedStrategies(strategyId) {
  if (strategyId === "all") {
    return Object.values(strategyCatalog);
  }

  const strategy = strategyCatalog[strategyId];
  if (!strategy) {
    throw new Error(`Unknown strategy '${strategyId}'`);
  }

  return [strategy];
}

export function selectedTemplates(templateId) {
  if (templateId === "all") {
    return templateCatalog;
  }

  const template = templateCatalog.find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) {
    throw new Error(`Unknown template '${templateId}'`);
  }

  return [template];
}

export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resetDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDirectory(dirPath);
}

function writeFile(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}\n${result.stderr || result.stdout || ""}`,
    );
  }

  return result;
}

function createFixtureFiles(fixtureRoot, fixtureKind) {
  switch (fixtureKind) {
    case "code":
      writeFile(
        path.join(fixtureRoot, "Cargo.toml"),
        `[package]\nname = "runtime-blueprint-sample"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n`,
      );
      writeFile(
        path.join(fixtureRoot, "src", "lib.rs"),
        `pub fn classify_score(value: i32) -> &'static str {\n    if value > 10 {\n        \"large\"\n    } else {\n        \"small\"\n    }\n}\n\n#[cfg(test)]\nmod tests {\n    use super::classify_score;\n\n    #[test]\n    fn classifies_values() {\n        assert_eq!(classify_score(4), \"small\");\n    }\n}\n`,
      );
      writeFile(
        path.join(fixtureRoot, "docs", "notes.md"),
        `# Runtime validation fixture\n\nThis repository exists to validate Maabarium blueprint execution on a compact Rust codebase.\n`,
      );
      break;
    case "application":
      writeFile(
        path.join(fixtureRoot, "Cargo.toml"),
        `[package]\nname = "runtime-product-sample"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n`,
      );
      writeFile(
        path.join(fixtureRoot, "src", "lib.rs"),
        `pub struct WelcomeCard<'a> {\n    pub heading: &'a str,\n    pub body: &'a str,\n}\n\npub fn default_card() -> WelcomeCard<'static> {\n    WelcomeCard {\n        heading: \"Hello\",\n        body: \"This fixture is intentionally plain so product-builder can improve it.\",\n    }\n}\n`,
      );
      writeFile(
        path.join(fixtureRoot, "docs", "product-brief.md"),
        `# Product Brief\n\nImprove the starter application so it feels more intentional and easier to ship.\n`,
      );
      break;
    case "prompt":
      writeFile(
        path.join(fixtureRoot, "prompts", "support-assistant.md"),
        `You help customers. Be useful. Answer quickly.\n`,
      );
      writeFile(
        path.join(fixtureRoot, "docs", "prompt-review.md"),
        `# Prompt Review Notes\n\nThe current prompt is too vague and should become more specific and reusable.\n`,
      );
      break;
    case "research":
      writeFile(
        path.join(fixtureRoot, "research", "brief.md"),
        `# Research Brief\n\nTopic: compare local-first AI workflow consoles and note evidence-backed strengths and trade-offs.\n`,
      );
      writeFile(
        path.join(fixtureRoot, "notes", "scope.md"),
        `# Scope\n\nCapture only sourced claims and prefer concise synthesis.\n`,
      );
      break;
    case "lora":
      writeFile(
        path.join(fixtureRoot, "README.md"),
        `# LoRA Adapter Fixture\n\nThis fixture simulates an externally trained adapter package that needs metadata cleanup and reproducibility notes.\n`,
      );
      writeFile(
        path.join(fixtureRoot, "adapters", "adapter_config.json"),
        `{"base_model":"gemma2:9b","format":"gguf","notes":"starter metadata"}\n`,
      );
      writeFile(
        path.join(fixtureRoot, "maabarium-lora-run.json"),
        `${JSON.stringify(
          {
            trainer: "external-python",
            base_model: "gemma2:9b",
            dataset: "sample-dataset",
            adapter_path: "adapters/adapter_config.json",
            output_dir: "adapters",
            eval_command: "python3 -m json.tool adapters/adapter_config.json",
          },
          null,
          2,
        )}\n`,
      );
      break;
    default:
      throw new Error(`Unknown fixture kind '${fixtureKind}'`);
  }
}

function initializeGitRepository(repoPath) {
  runCommand("git", ["init"], { cwd: repoPath });
  runCommand("git", ["config", "user.name", "Maabarium Test Harness"], {
    cwd: repoPath,
  });
  runCommand(
    "git",
    ["config", "user.email", "maabarium-tests@example.invalid"],
    { cwd: repoPath },
  );
  runCommand("git", ["add", "."], { cwd: repoPath });
  runCommand("git", ["commit", "-m", "Initial fixture"], { cwd: repoPath });
}

function renderTomlArray(values) {
  return `[${values.map((value) => `"${value}"`).join(", ")}]`;
}

function renderModelsBlock(models) {
  const entries = models
    .map((model) => {
      const fields = [
        `name = "${model.name}"`,
        `provider = "${model.provider}"`,
        `endpoint = "${model.endpoint}"`,
      ];
      if (model.api_key_env) {
        fields.push(`api_key_env = "${model.api_key_env}"`);
      }
      fields.push(`temperature = ${model.temperature}`);
      fields.push(`max_tokens = ${model.max_tokens}`);
      fields.push(`requests_per_minute = ${model.requests_per_minute}`);
      return `    { ${fields.join(", ")} },`;
    })
    .join("\n");

  return `[models]\nassignment = "round_robin"\nmodels = [\n${entries}\n]`;
}

function replaceWithinSection(
  content,
  sectionName,
  fieldName,
  replacementValue,
) {
  const sectionPattern = new RegExp(
    `(\\[${sectionName}\\][\\s\\S]*?\\n${fieldName} = )[^\\n]+`,
  );
  return content.replace(sectionPattern, `$1${replacementValue}`);
}

function replaceModelsSection(content, modelsBlock) {
  return content.replace(/\[models\][\s\S]*?(?=\n\[library\]|$)/, modelsBlock);
}

function replaceAgentsSection(content, agentsBlock) {
  return content.replace(/\[agents\][\s\S]*?(?=\n\[models\]|$)/, agentsBlock);
}

function replaceLibrarySection(content) {
  return content
    .replace(/(\[library\][\s\S]*?\nkind = )"[^"]+"/, '$1"workflow"')
    .replace(/(\[library\][\s\S]*?\nsetup_required = )(true|false)/, "$1false");
}

function deriveWorkflow(template, strategy, fixtureRepoPath) {
  const source = fs.readFileSync(template.source, "utf8");
  const blueprintName = `${template.id}-${strategy.id}-runtime-validation`;
  const descriptionSuffix = `Generated runtime-validation workflow for ${strategy.id}.`;
  let workflow = source;
  workflow = replaceWithinSection(
    workflow,
    "blueprint",
    "name",
    `"${blueprintName}"`,
  );
  workflow = replaceWithinSection(
    workflow,
    "blueprint",
    "description",
    `"${descriptionSuffix}"`,
  );
  workflow = replaceWithinSection(
    workflow,
    "domain",
    "repo_path",
    `"${fixtureRepoPath.replaceAll("\\", "\\\\")}"`,
  );
  workflow = replaceWithinSection(
    workflow,
    "domain",
    "target_files",
    renderTomlArray(template.targetFiles),
  );
  workflow = replaceWithinSection(
    workflow,
    "constraints",
    "max_iterations",
    "1",
  );
  workflow = replaceWithinSection(
    workflow,
    "constraints",
    "timeout_seconds",
    String(template.timeoutSeconds),
  );

  if (template.id === "product-builder" && strategy.id === "local") {
    workflow = replaceAgentsSection(
      workflow,
      `[agents]\ncouncil_size = 2\ndebate_rounds = 0\nagents = [\n    { name = "implementer", role = "Implementer", system_prompt = "You turn product direction into concrete, safe, and reviewable changes across the sample application.", model = "llama3" },\n    { name = "reviewer", role = "Release Reviewer", system_prompt = "You focus on regressions, unfinished edges, and whether the proposed change is specific and shippable.", model = "llama3" },\n]`,
    );
  }

  workflow = replaceModelsSection(workflow, renderModelsBlock(strategy.models));
  workflow = replaceLibrarySection(workflow);
  return { blueprintName, workflow };
}

function createCaseArtifacts(template, strategy) {
  const caseId = `${template.id}-${strategy.id}`;
  const fixtureRepoPath = path.join(
    workspacesRoot,
    strategy.id,
    caseId,
    "repo",
  );
  resetDirectory(fixtureRepoPath);
  createFixtureFiles(fixtureRepoPath, template.fixtureKind);
  initializeGitRepository(fixtureRepoPath);

  const { blueprintName, workflow } = deriveWorkflow(
    template,
    strategy,
    fixtureRepoPath,
  );
  const workflowPath = path.join(generatedRoot, strategy.id, `${caseId}.toml`);
  writeFile(workflowPath, workflow);

  return {
    caseId,
    blueprintName,
    templateId: template.id,
    strategyId: strategy.id,
    runtimeStrategy: strategy.runtimeStrategy,
    workflowPath,
    fixtureRepoPath,
    expectedModels: strategy.models.map((model) => model.name),
    expectedProviders: [
      ...new Set(strategy.models.map((model) => model.provider)),
    ],
  };
}

export function generateMatrix({
  strategyId = "all",
  templateId = "all",
} = {}) {
  ensureDirectory(artifactsRoot);
  ensureDirectory(generatedRoot);
  ensureDirectory(workspacesRoot);
  ensureDirectory(runsRoot);

  const strategies = selectedStrategies(strategyId);
  const templates = selectedTemplates(templateId);
  const cases = [];

  for (const strategy of strategies) {
    for (const template of templates) {
      cases.push(createCaseArtifacts(template, strategy));
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    strategyId,
    templateId,
    cases,
  };

  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function ensureLocalPrerequisites() {
  const whichOllama = spawnSync("sh", ["-lc", "command -v ollama"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (whichOllama.status !== 0) {
    throw new Error(
      "Ollama is required for local or mixed runtime validation.",
    );
  }

  const ollamaList = runCommand("ollama", ["list"], { cwd: repoRoot }).stdout;
  for (const model of localModelPool) {
    if (!ollamaList.includes(model)) {
      throw new Error(
        `Required local model '${model}' is not installed in Ollama.`,
      );
    }
  }
}

export function ensureRemotePrerequisites() {
  if (!process.env.XAI_API_KEY || !process.env.XAI_API_KEY.trim()) {
    throw new Error(
      "XAI_API_KEY must be exported for remote or mixed runtime validation.",
    );
  }
  if (!process.env.DEEPSEEK_API_KEY || !process.env.DEEPSEEK_API_KEY.trim()) {
    throw new Error(
      "DEEPSEEK_API_KEY must be exported for remote or mixed runtime validation.",
    );
  }
}

export function ensureStrategyPrerequisites(strategyId) {
  if (strategyId === "local") {
    ensureLocalPrerequisites();
  } else if (strategyId === "remote") {
    ensureRemotePrerequisites();
  } else if (strategyId === "mixed") {
    ensureLocalPrerequisites();
    ensureRemotePrerequisites();
  }
}
