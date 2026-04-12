import type {
  BlueprintFile,
  BlueprintWizardForm,
  ConsoleState,
  CouncilEntry,
  ModelDef,
  OllamaStatus,
  RemoteProviderSetup,
  WizardAgentForm,
  WizardDeliverable,
  WizardGoal,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../types/console";
import { listOllamaModelNames } from "./ollama";

type WizardGoalOption = {
  id: WizardGoal;
  label: string;
  description: string;
  template: WizardTemplate;
};

type WizardDeliverableOption = {
  id: WizardDeliverable;
  goal: WizardGoal;
  label: string;
  description: string;
  template: WizardTemplate;
  language: string;
  targetFiles: string[];
  requireTestsPass: boolean;
};

const WIZARD_GOAL_OPTIONS: WizardGoalOption[] = [
  {
    id: "code_improvement",
    label: "Improve existing code",
    description:
      "Use this when you want to change existing source files and usually keep tests enabled.",
    template: "code_quality",
  },
  {
    id: "application_change",
    label: "Change an application",
    description:
      "Use this for workflows that span multiple source areas across an application.",
    template: "product_builder",
  },
  {
    id: "document_workflow",
    label: "Generate or refine a document",
    description:
      "Use this for one named markdown deliverable or a document-oriented prompt asset.",
    template: "prompt_optimization",
  },
  {
    id: "research_brief",
    label: "Produce a sourced research brief",
    description:
      "Use this for citation-backed markdown briefs and research notes.",
    template: "general_research",
  },
  {
    id: "lora_validation",
    label: "Validate a LoRA artefact package",
    description:
      "Use this to inspect adapter manifests, artefacts, and reproducibility metadata.",
    template: "lora_validation",
  },
  {
    id: "custom_workflow",
    label: "Custom advanced workflow",
    description:
      "Use this only when the guided workflow families do not fit what you need.",
    template: "custom",
  },
];

const WIZARD_DELIVERABLE_OPTIONS: WizardDeliverableOption[] = [
  {
    id: "source_files",
    goal: "code_improvement",
    label: "Existing source files",
    description:
      "Operate over current source trees without assuming tests live beside every target.",
    template: "code_quality",
    language: "rust",
    targetFiles: ["src/**/*.rs"],
    requireTestsPass: true,
  },
  {
    id: "source_files_with_tests",
    goal: "code_improvement",
    label: "Source files plus tests",
    description:
      "Keep both code and test areas in scope for code-improvement workflows.",
    template: "code_quality",
    language: "rust",
    targetFiles: ["src/**/*.rs", "tests/**/*.rs"],
    requireTestsPass: true,
  },
  {
    id: "application_code_areas",
    goal: "application_change",
    label: "Multiple code areas",
    description:
      "Target frontend and backend source trees without pulling docs into scope by default.",
    template: "product_builder",
    language: "application",
    targetFiles: ["src/**/*", "crates/**/*", "apps/**/*", "packages/**/*"],
    requireTestsPass: true,
  },
  {
    id: "application_plus_docs",
    goal: "application_change",
    label: "Application code plus docs",
    description:
      "Use this when the workflow should change source and documentation together.",
    template: "product_builder",
    language: "application",
    targetFiles: [
      "src/**/*",
      "crates/**/*",
      "apps/**/*",
      "packages/**/*",
      "docs/**/*",
    ],
    requireTestsPass: true,
  },
  {
    id: "named_document",
    goal: "document_workflow",
    label: "One named markdown file",
    description:
      "Create or refine one specific markdown output file using an exact relative path.",
    template: "prompt_optimization",
    language: "markdown",
    targetFiles: ["docs/project-brief.md"],
    requireTestsPass: false,
  },
  {
    id: "markdown_directory",
    goal: "document_workflow",
    label: "A directory of markdown files",
    description: "Operate across a document directory using markdown globs.",
    template: "prompt_optimization",
    language: "markdown",
    targetFiles: ["docs/**/*.md"],
    requireTestsPass: false,
  },
  {
    id: "prompt_asset",
    goal: "document_workflow",
    label: "One prompt asset file",
    description:
      "Target one prompt or prompt-like markdown asset with an exact file path.",
    template: "prompt_optimization",
    language: "prompt",
    targetFiles: ["prompts/support-escalation.md"],
    requireTestsPass: false,
  },
  {
    id: "named_research_brief",
    goal: "research_brief",
    label: "One named research brief",
    description:
      "Write a single citation-backed research brief to a named markdown file.",
    template: "general_research",
    language: "research",
    targetFiles: ["research/brief.md"],
    requireTestsPass: false,
  },
  {
    id: "research_notes_directory",
    goal: "research_brief",
    label: "Research notes directory",
    description:
      "Write research notes into a research-specific markdown directory.",
    template: "general_research",
    language: "research",
    targetFiles: ["research/**/*.md"],
    requireTestsPass: false,
  },
  {
    id: "research_docs_directory",
    goal: "research_brief",
    label: "Docs directory output",
    description:
      "Write the research output back into a docs directory using markdown globs.",
    template: "general_research",
    language: "research",
    targetFiles: ["docs/**/*.md"],
    requireTestsPass: false,
  },
  {
    id: "lora_manifest_and_artifacts",
    goal: "lora_validation",
    label: "Manifest plus artefacts",
    description:
      "Validate a manifest together with adapter artefacts and supporting metadata.",
    template: "lora_validation",
    language: "lora",
    targetFiles: ["adapters/**/*.json", "adapters/**/*.safetensors"],
    requireTestsPass: false,
  },
  {
    id: "lora_adapter_directory",
    goal: "lora_validation",
    label: "Adapter directory validation",
    description:
      "Target an adapter directory layout when validating packaging and reproducibility.",
    template: "lora_validation",
    language: "lora",
    targetFiles: ["adapters/**/*"],
    requireTestsPass: false,
  },
  {
    id: "custom_exact_file",
    goal: "custom_workflow",
    label: "One exact file",
    description:
      "Use an exact relative file path when none of the guided workflow families fit.",
    template: "custom",
    language: "text",
    targetFiles: ["notes/output.md"],
    requireTestsPass: false,
  },
  {
    id: "custom_glob_scope",
    goal: "custom_workflow",
    label: "Glob-based scope",
    description:
      "Use globs when the workflow needs to operate across many files in a custom shape.",
    template: "custom",
    language: "text",
    targetFiles: ["src/**/*"],
    requireTestsPass: false,
  },
];

function summarizePrompt(systemPrompt: string): string {
  const normalized = systemPrompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No system prompt configured.";
  }

  const firstSentence = normalized.match(/.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const summary = firstSentence || normalized;
  return summary.length > 140 ? `${summary.slice(0, 137)}...` : summary;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function buildCouncilEntries(
  blueprint: BlueprintFile | null,
): CouncilEntry[] {
  return (
    blueprint?.agents?.agents?.slice(0, 3).map((agent) => {
      const lower = `${agent.name} ${agent.role}`.toLowerCase();
      if (lower.includes("critic")) {
        return {
          title: `${toTitleCase(agent.name)} Agent`,
          subtitle: `${toTitleCase(agent.role)} • ${agent.model}`,
          accent: "amber" as const,
          copy: summarizePrompt(agent.system_prompt),
        };
      }
      if (lower.includes("engineer") || lower.includes("review")) {
        return {
          title: `${toTitleCase(agent.name)} Agent`,
          subtitle: `${toTitleCase(agent.role)} • ${agent.model}`,
          accent: "slate" as const,
          copy: summarizePrompt(agent.system_prompt),
        };
      }
      return {
        title: `${toTitleCase(agent.name)} Agent`,
        subtitle: `${toTitleCase(agent.role)} • ${agent.model}`,
        accent: "teal" as const,
        copy: summarizePrompt(agent.system_prompt),
      };
    }) ?? []
  );
}

export function formatBlueprintGroup(
  language: string | null,
  libraryKind?: "workflow" | "template" | null,
): string {
  const normalized = language?.trim().toUpperCase() || "UNSPECIFIED";

  if (libraryKind === "workflow" && normalized === "RUST") {
    return "CUSTOM";
  }

  return normalized;
}

export function buildBlueprintSummary(
  blueprint: BlueprintFile | null,
  blueprintError: string | null,
  evaluatorKind: string | null,
): string {
  if (!blueprint) {
    return blueprintError || "Blueprint unavailable";
  }

  return [
    `[blueprint]`,
    `name = "${blueprint.blueprint.name}"`,
    `version = "${blueprint.blueprint.version}"`,
    `language = "${blueprint.domain.language}"`,
    "",
    `[constraints]`,
    `max_iterations = ${blueprint.constraints.max_iterations}`,
    `timeout_seconds = ${blueprint.constraints.timeout_seconds}`,
    `require_tests_pass = ${blueprint.constraints.require_tests_pass}`,
    "",
    `[agents]`,
    `council_size = ${blueprint.agents.council_size}`,
    `debate_rounds = ${blueprint.agents.debate_rounds}`,
    "",
    `[runtime]`,
    `evaluator = "${evaluatorKind ?? "unknown"}"`,
  ].join("\n");
}

export function wizardTemplateDefaults(template: WizardTemplate) {
  switch (template) {
    case "code_quality":
      return {
        label: "Code Quality",
        description:
          "Use this when you want to improve existing source files and validate the result against tests, runtime behavior, and maintainability metrics.",
        language: "rust",
        targetFiles: ["src/**/*.rs", "tests/**/*.rs"],
        requireTestsPass: true,
      };
    case "product_builder":
      return {
        label: "Product Builder",
        description:
          "Use this when the workflow should change an application across multiple source trees. It is not the right fit for a single named markdown deliverable.",
        language: "application",
        targetFiles: ["src/**/*", "crates/**/*", "apps/**/*", "packages/**/*"],
        requireTestsPass: true,
      };
    case "general_research":
      return {
        label: "General Research",
        description:
          "Use this when the output is a sourced brief with citations, discovery traces, and markdown-style research notes rather than code changes.",
        language: "research",
        targetFiles: ["docs/**/*.md", "research/**/*.md", "notes/**/*.md"],
        requireTestsPass: false,
      };
    case "prompt_optimization":
      return {
        label: "Prompt Optimization",
        description:
          "Use this when the workflow should create or refine prompt or document assets. Point target files at an exact `.md` path when you want one specifically named output file.",
        language: "markdown",
        targetFiles: ["prompts/**/*.md"],
        requireTestsPass: false,
      };
    case "lora_validation":
      return {
        label: "LoRA Validation",
        description:
          "Create a blueprint for validating adapter packaging, manifests, and reproducibility metadata.",
        language: "lora",
        targetFiles: ["adapters/**/*.json", "adapters/**/*.safetensors"],
        requireTestsPass: false,
      };
    case "custom":
      return {
        label: "Custom",
        description:
          "Use this only when none of the guided workflow shapes fit. You will likely need to set language, target paths, evaluator expectations, and metrics manually.",
        language: "text",
        targetFiles: ["src/**/*"],
        requireTestsPass: false,
      };
  }
}

export function wizardGoalOptions(): WizardGoalOption[] {
  return WIZARD_GOAL_OPTIONS;
}

export function wizardDeliverableOptions(
  goal: WizardGoal,
): WizardDeliverableOption[] {
  return WIZARD_DELIVERABLE_OPTIONS.filter((option) => option.goal === goal);
}

export function goalToWizardTemplate(goal: WizardGoal): WizardTemplate {
  return (
    WIZARD_GOAL_OPTIONS.find((option) => option.id === goal)?.template ??
    "custom"
  );
}

export function parseWizardTargetFilesText(
  text: string | null | undefined,
): string[] {
  return (text ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isExactWizardTargetPath(target: string): boolean {
  return target.length > 0 && !target.includes("*") && !target.includes("?");
}

export function wizardTargetMode(
  targets: string[],
): "exact" | "glob" | "mixed" | "none" {
  if (targets.length === 0) {
    return "none";
  }

  const exactCount = targets.filter(isExactWizardTargetPath).length;
  if (exactCount === targets.length) {
    return "exact";
  }
  if (exactCount === 0) {
    return "glob";
  }
  return "mixed";
}

export function wizardEvaluatorLabel(
  language: string | null | undefined,
): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized === "research") {
    return "research";
  }
  if (normalized === "lora") {
    return "lora";
  }
  if (normalized === "markdown" || normalized === "prompt") {
    return "prompt";
  }
  return "code";
}

export function inferWizardGoalFromForm(
  form: Pick<BlueprintWizardForm, "template">,
): WizardGoal {
  switch (form.template) {
    case "code_quality":
      return "code_improvement";
    case "product_builder":
      return "application_change";
    case "prompt_optimization":
      return "document_workflow";
    case "general_research":
      return "research_brief";
    case "lora_validation":
      return "lora_validation";
    case "custom":
      return "custom_workflow";
  }
}

export function inferWizardDeliverableFromForm(
  form: Pick<BlueprintWizardForm, "template" | "language" | "targetFilesText">,
): WizardDeliverable {
  const targets = parseWizardTargetFilesText(form.targetFilesText);
  const mode = wizardTargetMode(targets);
  const language = (form.language ?? "").trim().toLowerCase();

  switch (inferWizardGoalFromForm(form)) {
    case "code_improvement":
      return targets.some((target) => target.includes("tests/"))
        ? "source_files_with_tests"
        : "source_files";
    case "application_change":
      return targets.some((target) => target.includes("docs/"))
        ? "application_plus_docs"
        : "application_code_areas";
    case "document_workflow":
      if (
        language === "prompt" ||
        targets.some((target) => target.includes("prompts/"))
      ) {
        return "prompt_asset";
      }
      return mode === "exact" ? "named_document" : "markdown_directory";
    case "research_brief":
      if (mode === "exact") {
        return "named_research_brief";
      }
      return targets.some(
        (target) => target.includes("research/") || target.includes("notes/"),
      )
        ? "research_notes_directory"
        : "research_docs_directory";
    case "lora_validation":
      return targets.some(
        (target) => target.endsWith(".json") || target.endsWith(".safetensors"),
      )
        ? "lora_manifest_and_artifacts"
        : "lora_adapter_directory";
    case "custom_workflow":
      return mode === "exact" ? "custom_exact_file" : "custom_glob_scope";
  }
}

export function applyWizardGoal(
  form: BlueprintWizardForm,
  goal: WizardGoal,
): BlueprintWizardForm {
  return applyWizardTemplate(
    normalizeWizardForm(form),
    goalToWizardTemplate(goal),
  );
}

export function applyWizardDeliverable(
  form: BlueprintWizardForm,
  deliverable: WizardDeliverable,
): BlueprintWizardForm {
  const normalizedForm = normalizeWizardForm(form);
  const option = WIZARD_DELIVERABLE_OPTIONS.find(
    (entry) => entry.id === deliverable,
  );
  if (!option) {
    return normalizedForm;
  }

  const next =
    option.template === normalizedForm.template
      ? normalizedForm
      : applyWizardTemplate(normalizedForm, option.template);
  return normalizeWizardForm({
    ...next,
    template: option.template,
    language: option.language,
    targetFilesText: option.targetFiles.join("\n"),
    requireTestsPass: option.requireTestsPass,
  });
}

function wizardTemplateMetrics(template: WizardTemplate): WizardMetricForm[] {
  switch (template) {
    case "code_quality":
      return [
        {
          name: "code_quality",
          weight: 0.4,
          direction: "maximize",
          description: "Overall code quality score",
        },
        {
          name: "performance",
          weight: 0.3,
          direction: "maximize",
          description: "Runtime performance score",
        },
        {
          name: "maintainability",
          weight: 0.3,
          direction: "maximize",
          description: "Ease of change and readability",
        },
      ];
    case "product_builder":
      return [
        {
          name: "correctness",
          weight: 0.3,
          direction: "maximize",
          description: "The resulting application behavior should be correct.",
        },
        {
          name: "product_coherence",
          weight: 0.2,
          direction: "maximize",
          description: "The work should align with product goals and flows.",
        },
        {
          name: "maintainability",
          weight: 0.2,
          direction: "maximize",
          description:
            "The application should remain understandable and easy to extend.",
        },
        {
          name: "ux_quality",
          weight: 0.15,
          direction: "maximize",
          description: "The user experience should feel polished and usable.",
        },
        {
          name: "shipping_readiness",
          weight: 0.15,
          direction: "maximize",
          description:
            "The feature set should move the product toward release readiness.",
        },
      ];
    case "general_research":
      return [
        {
          name: "factual_grounding",
          weight: 0.3,
          direction: "maximize",
          description: "Claims should remain grounded in verifiable evidence.",
        },
        {
          name: "citation_coverage",
          weight: 0.25,
          direction: "maximize",
          description:
            "Major claims should include explicit citations and source references.",
        },
        {
          name: "source_quality",
          weight: 0.25,
          direction: "maximize",
          description:
            "The work should prefer credible, diverse, and recent sources.",
        },
        {
          name: "synthesis_quality",
          weight: 0.2,
          direction: "maximize",
          description:
            "The final brief should synthesize findings clearly instead of listing disconnected facts.",
        },
      ];
    case "prompt_optimization":
      return [
        {
          name: "actionability",
          weight: 0.3,
          direction: "maximize",
          description: "How actionable is the prompt output?",
        },
        {
          name: "specificity",
          weight: 0.3,
          direction: "maximize",
          description: "How concrete and specific is the prompt?",
        },
        {
          name: "revenue_signal",
          weight: 0.2,
          direction: "maximize",
          description: "Does it drive meaningful business outcomes?",
        },
        {
          name: "brevity",
          weight: 0.2,
          direction: "maximize",
          description: "Is it concise without losing clarity?",
        },
      ];
    case "lora_validation":
      return [
        {
          name: "artifact_completeness",
          weight: 0.4,
          direction: "maximize",
          description: "Checks that the adapter package is complete",
        },
        {
          name: "metadata_hygiene",
          weight: 0.3,
          direction: "maximize",
          description: "Evaluates run metadata clarity and traceability",
        },
        {
          name: "reproducibility",
          weight: 0.3,
          direction: "maximize",
          description: "Assesses whether the run can be reproduced",
        },
      ];
    case "custom":
      return [
        {
          name: "quality",
          weight: 0.4,
          direction: "maximize",
          description: "Overall result quality",
        },
        {
          name: "impact",
          weight: 0.35,
          direction: "maximize",
          description: "Measured improvement against the goal",
        },
        {
          name: "safety",
          weight: 0.25,
          direction: "maximize",
          description: "Likelihood of avoiding regressions",
        },
      ];
  }
}

function wizardTemplateModels(): WizardModelForm[] {
  return [
    {
      name: "llama3",
      provider: "ollama",
      endpoint: "http://localhost:11434",
      apiKeyEnv: "",
      temperature: 0.7,
      maxTokens: 2048,
      requestsPerMinute: "60",
    },
  ];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );
}

function sanitizeWizardText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeWizardNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeWizardBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeWizardMetric(
  metric: unknown,
  fallback: WizardMetricForm,
): WizardMetricForm {
  const candidate =
    metric && typeof metric === "object"
      ? (metric as Partial<WizardMetricForm>)
      : null;

  return {
    name: sanitizeWizardText(candidate?.name, fallback.name),
    weight: sanitizeWizardNumber(candidate?.weight, fallback.weight),
    direction:
      candidate?.direction === "minimize" || candidate?.direction === "maximize"
        ? candidate.direction
        : fallback.direction,
    description: sanitizeWizardText(
      candidate?.description,
      fallback.description,
    ),
  };
}

function sanitizeWizardModel(
  model: unknown,
  fallback: WizardModelForm,
): WizardModelForm {
  const candidate =
    model && typeof model === "object"
      ? (model as Partial<WizardModelForm>)
      : null;

  return {
    name: sanitizeWizardText(candidate?.name, fallback.name),
    provider: sanitizeWizardText(candidate?.provider, fallback.provider),
    endpoint: sanitizeWizardText(candidate?.endpoint, fallback.endpoint),
    apiKeyEnv: sanitizeWizardText(candidate?.apiKeyEnv, fallback.apiKeyEnv),
    temperature: sanitizeWizardNumber(
      candidate?.temperature,
      fallback.temperature,
    ),
    maxTokens: sanitizeWizardNumber(candidate?.maxTokens, fallback.maxTokens),
    requestsPerMinute: sanitizeWizardText(
      candidate?.requestsPerMinute,
      fallback.requestsPerMinute,
    ),
  };
}

function sanitizeWizardAgent(
  agent: unknown,
  fallback: WizardAgentForm,
): WizardAgentForm {
  const candidate =
    agent && typeof agent === "object"
      ? (agent as Partial<WizardAgentForm>)
      : null;

  return {
    name: sanitizeWizardText(candidate?.name, fallback.name),
    role: sanitizeWizardText(candidate?.role, fallback.role),
    systemPrompt: sanitizeWizardText(
      candidate?.systemPrompt,
      fallback.systemPrompt,
    ),
    model: sanitizeWizardText(candidate?.model, fallback.model),
  };
}

function normalizeWizardTemplate(value: unknown): WizardTemplate {
  switch (value) {
    case "code_quality":
    case "product_builder":
    case "general_research":
    case "prompt_optimization":
    case "lora_validation":
    case "custom":
      return value;
    default:
      return "code_quality";
  }
}

export function normalizeWizardForm(
  form: BlueprintWizardForm,
): BlueprintWizardForm {
  const normalizedTemplate = normalizeWizardTemplate(form?.template);
  const defaults = wizardTemplateDefaults(normalizedTemplate);
  const fallbackMetrics = wizardTemplateMetrics(normalizedTemplate);
  const fallbackModels = wizardTemplateModels();

  const normalizedModelsSource = Array.isArray(form?.models) ? form.models : [];
  const normalizedModels =
    normalizedModelsSource.length > 0
      ? normalizedModelsSource.map((model, index) =>
          sanitizeWizardModel(
            model,
            fallbackModels[index] ?? fallbackModels[0],
          ),
        )
      : fallbackModels;

  const fallbackPrimaryModel = normalizedModels[0]?.name || "llama3";
  const fallbackAgents = wizardTemplateAgents(
    normalizedTemplate,
    fallbackPrimaryModel,
  );
  const normalizedAgentsSource = Array.isArray(form?.agents) ? form.agents : [];
  const normalizedAgents =
    normalizedAgentsSource.length > 0
      ? normalizedAgentsSource.map((agent, index) =>
          sanitizeWizardAgent(
            agent,
            fallbackAgents[index] ?? fallbackAgents[0],
          ),
        )
      : fallbackAgents;

  const normalizedMetricsSource = Array.isArray(form?.metrics)
    ? form.metrics
    : [];
  const normalizedMetrics =
    normalizedMetricsSource.length > 0
      ? normalizedMetricsSource.map((metric, index) =>
          sanitizeWizardMetric(
            metric,
            fallbackMetrics[index] ?? fallbackMetrics[0],
          ),
        )
      : fallbackMetrics;

  return normalizeWizardAgentModels({
    ...form,
    name: sanitizeWizardText(form?.name),
    description: sanitizeWizardText(form?.description),
    version: sanitizeWizardText(form?.version, "1.0.0"),
    template: normalizedTemplate,
    repoPath: sanitizeWizardText(form?.repoPath, "."),
    language: sanitizeWizardText(form?.language, defaults.language),
    targetFilesText: sanitizeWizardText(
      form?.targetFilesText,
      defaults.targetFiles.join("\n"),
    ),
    maxIterations: sanitizeWizardNumber(form?.maxIterations, 25),
    timeoutSeconds: sanitizeWizardNumber(form?.timeoutSeconds, 300),
    requireTestsPass: sanitizeWizardBoolean(
      form?.requireTestsPass,
      defaults.requireTestsPass,
    ),
    minImprovement: sanitizeWizardNumber(form?.minImprovement, 0.01),
    councilSize: sanitizeWizardNumber(
      form?.councilSize,
      Math.max(1, normalizedAgents.length),
    ),
    debateRounds: sanitizeWizardNumber(
      form?.debateRounds,
      wizardTemplateDebateRounds(normalizedTemplate),
    ),
    modelAssignment:
      form?.modelAssignment === "round_robin" ? "round_robin" : "explicit",
    metrics: normalizedMetrics,
    agents: normalizedAgents,
    models: normalizedModels,
  });
}

export function normalizeWizardAgentModels(
  form: BlueprintWizardForm,
): BlueprintWizardForm {
  const availableModelNames = uniqueStrings(
    form.models.map((model) => model.name),
  );
  const fallbackModelName = availableModelNames[0] ?? "llama3";

  return {
    ...form,
    agents: form.agents.map((agent) => {
      const selectedModel = agent.model.trim();
      return availableModelNames.includes(selectedModel)
        ? { ...agent, model: selectedModel }
        : { ...agent, model: fallbackModelName };
    }),
  };
}

function buildLocalWizardModels(
  ollama: OllamaStatus | undefined,
  selectedLocalModels: Array<string | null | undefined> = [],
): WizardModelForm[] {
  const localModelNames = listOllamaModelNames(ollama, selectedLocalModels);

  return localModelNames.map((name) => ({
    name,
    provider: "ollama",
    endpoint: "http://localhost:11434",
    apiKeyEnv: "",
    temperature: 0.7,
    maxTokens: 2048,
    requestsPerMinute: "60",
  }));
}

function buildRemoteWizardModels(
  remoteProviders: RemoteProviderSetup[] | undefined,
): WizardModelForm[] {
  return (remoteProviders ?? [])
    .filter(
      (provider) =>
        provider.supported &&
        provider.configured &&
        Boolean(provider.endpoint?.trim()) &&
        Boolean(provider.modelName?.trim()),
    )
    .map((provider) => ({
      name: provider.modelName?.trim() ?? provider.label,
      provider: provider.providerId,
      endpoint: provider.endpoint?.trim() ?? "",
      apiKeyEnv: "",
      temperature: 0.7,
      maxTokens: 4096,
      requestsPerMinute: "",
    }));
}

export function buildSuggestedWizardModels(
  state: ConsoleState | null,
): WizardModelForm[] {
  const setup = state?.desktopSetup;
  const runtimeStrategy = setup?.runtimeStrategy;
  const localModels = buildLocalWizardModels(
    state?.ollama,
    setup?.selectedLocalModels,
  );
  const remoteModels = buildRemoteWizardModels(setup?.remoteProviders);

  if (runtimeStrategy === "local") {
    return localModels.length > 0 ? localModels : wizardTemplateModels();
  }

  if (runtimeStrategy === "remote") {
    return remoteModels.length > 0 ? remoteModels : wizardTemplateModels();
  }

  if (runtimeStrategy === "mixed") {
    const mixedModels = [...localModels, ...remoteModels];
    return mixedModels.length > 0 ? mixedModels : wizardTemplateModels();
  }

  const suggestedModels = [...localModels, ...remoteModels];
  return suggestedModels.length > 0 ? suggestedModels : wizardTemplateModels();
}

export function buildSuggestedWizardModel(
  state: ConsoleState | null,
): WizardModelForm {
  return buildSuggestedWizardModels(state)[0] ?? wizardTemplateModels()[0];
}

function wizardTemplateCouncilSize(template: WizardTemplate): number {
  switch (template) {
    case "product_builder":
      return 4;
    default:
      return 3;
  }
}

function wizardTemplateDebateRounds(template: WizardTemplate): number {
  switch (template) {
    case "product_builder":
      return 3;
    default:
      return 2;
  }
}

function wizardTemplateAgents(
  template: WizardTemplate,
  modelName: string,
): WizardAgentForm[] {
  switch (template) {
    case "product_builder":
      return [
        {
          name: "product_strategist",
          role: "product strategist",
          systemPrompt:
            "You define scope, user value, feature priorities, and delivery sequencing for the software product.",
          model: modelName,
        },
        {
          name: "systems_architect",
          role: "systems architect",
          systemPrompt:
            "You shape architecture, module boundaries, and integration strategy so the application can scale cleanly.",
          model: modelName,
        },
        {
          name: "implementer",
          role: "implementer",
          systemPrompt:
            "You convert the plan into safe, concrete changes across frontend, backend, and supporting assets.",
          model: modelName,
        },
        {
          name: "reviewer",
          role: "release reviewer",
          systemPrompt:
            "You challenge unfinished edges, regressions, missing tests, and weak product decisions before a change is accepted.",
          model: modelName,
        },
      ];
    case "general_research":
      return [
        {
          name: "researcher",
          role: "lead researcher",
          systemPrompt:
            "You gather the best available evidence on the topic, keep a running list of concrete source URLs, and only propose research content when it is grounded in explicit citations. If live search is unavailable, say so and avoid unsupported claims. A runtime note will identify the active search provider; if it is a scraper-backed fallback, treat search results as leads and verify claims against the destination pages before using them.",
          model: modelName,
        },
        {
          name: "verifier",
          role: "source verifier",
          systemPrompt:
            "You reject unsupported claims, missing external URLs, weak source quality, and malformed patch plans. Demand exact attribution and call out when live source access is unavailable or too weak to support a conclusion. A runtime note will identify the active search provider; if it is a scraper-backed fallback, apply a stricter bar to evidence quality and call out scraper reliability limits when confidence should be reduced.",
          model: modelName,
        },
        {
          name: "synthesizer",
          role: "research synthesizer",
          systemPrompt:
            "You produce one narrow markdown brief patch with exact unified diff headers, explicit citation URLs for every major claim, and clear uncertainty where evidence is incomplete. Prefer creating or appending a single research file over broad rewrites. If the evidence is too weak, return no patch and explain the gap. A runtime note will identify the active search provider; if it is a scraper-backed fallback and that affects confidence, say so briefly in the research output.",
          model: modelName,
        },
      ];
    case "prompt_optimization":
      return [
        {
          name: "strategist",
          role: "prompt strategist",
          systemPrompt:
            "You design prompt changes that increase clarity, specificity, and usefulness without making the experience verbose.",
          model: modelName,
        },
        {
          name: "critic",
          role: "prompt critic",
          systemPrompt:
            "You challenge vague wording, weak calls to action, and claims that are not grounded in the source context.",
          model: modelName,
        },
        {
          name: "editor",
          role: "prompt editor",
          systemPrompt:
            "You rewrite prompts into concise, production-ready language while preserving product intent.",
          model: modelName,
        },
      ];
    case "lora_validation":
      return [
        {
          name: "packager",
          role: "artifact packager",
          systemPrompt:
            "You focus on adapter packaging completeness, manifests, and reproducible artifact layout.",
          model: modelName,
        },
        {
          name: "auditor",
          role: "reproducibility auditor",
          systemPrompt:
            "You identify missing metadata, unsupported assumptions, and gaps in reproducibility instructions.",
          model: modelName,
        },
        {
          name: "reviewer",
          role: "quality reviewer",
          systemPrompt:
            "You review the proposal for clarity, traceability, and downstream usability.",
          model: modelName,
        },
      ];
    case "code_quality":
    case "custom":
      return [
        {
          name: "strategist",
          role: "strategist",
          systemPrompt:
            "You focus on high-signal improvements with measurable upside and low regression risk.",
          model: modelName,
        },
        {
          name: "critic",
          role: "critic",
          systemPrompt:
            "You look for regressions, unnecessary complexity, and weak evidence behind a proposed change.",
          model: modelName,
        },
        {
          name: "engineer",
          role: "engineer",
          systemPrompt:
            "You turn the council direction into concrete, safe, and reviewable changes.",
          model: modelName,
        },
      ];
  }
}

function buildWizardModelForm(model: ModelDef): WizardModelForm {
  return {
    name: model.name,
    provider: model.provider,
    endpoint: model.endpoint,
    apiKeyEnv: model.api_key_env ?? "",
    temperature: model.temperature,
    maxTokens: model.max_tokens,
    requestsPerMinute:
      model.requests_per_minute !== undefined &&
      model.requests_per_minute !== null
        ? String(model.requests_per_minute)
        : "",
  };
}

export function buildWizardForm(
  state: ConsoleState | null,
  template: WizardTemplate = "code_quality",
): BlueprintWizardForm {
  const defaults = wizardTemplateDefaults(template);
  const activeBlueprint = state?.blueprint;
  const suggestedModels = buildSuggestedWizardModels(state);
  const models =
    suggestedModels.length > 0
      ? suggestedModels
      : activeBlueprint?.models?.models?.length
        ? activeBlueprint.models.models.map(buildWizardModelForm)
        : wizardTemplateModels();
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);
  const suggestedWorkspacePath =
    state?.desktopSetup.workspacePath?.trim() ||
    activeBlueprint?.domain.repo_path ||
    ".";

  return normalizeWizardForm({
    name: "",
    description: defaults.description,
    version: "1.0.0",
    template,
    repoPath: suggestedWorkspacePath,
    language: activeBlueprint?.domain.language || defaults.language,
    targetFilesText: defaults.targetFiles.join("\n"),
    maxIterations: 25,
    timeoutSeconds: 300,
    requireTestsPass: defaults.requireTestsPass,
    minImprovement: 0.01,
    councilSize: wizardTemplateCouncilSize(template),
    debateRounds: wizardTemplateDebateRounds(template),
    modelAssignment: activeBlueprint?.models?.assignment || "explicit",
    metrics: wizardTemplateMetrics(template),
    agents,
    models,
  });
}

function inferWizardTemplate(blueprint: BlueprintFile): WizardTemplate {
  const language = blueprint.domain.language.trim().toLowerCase();
  const targetFiles = blueprint.domain.target_files.map((value) =>
    value.trim().toLowerCase(),
  );

  if (language === "research") {
    return "general_research";
  }

  if (language === "lora") {
    return "lora_validation";
  }

  if (language === "application") {
    return "product_builder";
  }

  if (
    language === "markdown" &&
    targetFiles.some((value) => value.includes("prompts/"))
  ) {
    return "prompt_optimization";
  }

  if (language === "rust") {
    return "code_quality";
  }

  return "custom";
}

export function buildWizardFormFromBlueprint(
  blueprint: BlueprintFile,
): BlueprintWizardForm {
  const models =
    blueprint.models.models.length > 0
      ? blueprint.models.models.map(buildWizardModelForm)
      : wizardTemplateModels();
  const storedTemplate = blueprint.library?.template ?? null;

  return normalizeWizardForm({
    name: blueprint.blueprint.name,
    description: blueprint.blueprint.description,
    version: blueprint.blueprint.version,
    template: storedTemplate ?? inferWizardTemplate(blueprint),
    repoPath: blueprint.domain.repo_path,
    language: blueprint.domain.language,
    targetFilesText: blueprint.domain.target_files.join("\n"),
    maxIterations: blueprint.constraints.max_iterations,
    timeoutSeconds: blueprint.constraints.timeout_seconds,
    requireTestsPass: blueprint.constraints.require_tests_pass,
    minImprovement: blueprint.constraints.min_improvement,
    councilSize: blueprint.agents.council_size,
    debateRounds: blueprint.agents.debate_rounds,
    modelAssignment: blueprint.models.assignment,
    metrics: blueprint.metrics.metrics.map((metric) => ({
      name: metric.name,
      weight: metric.weight,
      direction: metric.direction === "minimize" ? "minimize" : "maximize",
      description: metric.description,
    })),
    agents: blueprint.agents.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      systemPrompt: agent.system_prompt,
      model: agent.model,
    })),
    models,
  });
}

export function applyWizardTemplate(
  form: BlueprintWizardForm,
  template: WizardTemplate,
): BlueprintWizardForm {
  const normalizedForm = normalizeWizardForm(form);
  const defaults = wizardTemplateDefaults(template);
  const currentDefaults = wizardTemplateDefaults(normalizedForm.template);
  const models =
    normalizedForm.models.length > 0
      ? normalizedForm.models
      : wizardTemplateModels();
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);
  const shouldResetDescription =
    normalizedForm.description.trim().length === 0 ||
    normalizedForm.description === currentDefaults.description;

  return normalizeWizardForm({
    ...normalizedForm,
    template,
    description: shouldResetDescription
      ? defaults.description
      : normalizedForm.description,
    language: defaults.language,
    targetFilesText: defaults.targetFiles.join("\n"),
    requireTestsPass: defaults.requireTestsPass,
    councilSize: wizardTemplateCouncilSize(template),
    debateRounds: wizardTemplateDebateRounds(template),
    metrics: wizardTemplateMetrics(template),
    agents,
    modelAssignment: "explicit",
    models,
  });
}
