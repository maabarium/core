import type {
  BlueprintFile,
  BlueprintWizardForm,
  ConsoleState,
  CouncilEntry,
  ModelDef,
  OllamaStatus,
  RemoteProviderSetup,
  WizardAgentForm,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../types/console";
import { listOllamaModelNames } from "./ollama";

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
): WizardModelForm[] {
  const localModelNames = listOllamaModelNames(ollama);

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
  const localModels = buildLocalWizardModels(state?.ollama);
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

  return normalizeWizardAgentModels({
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

  return normalizeWizardAgentModels({
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
  const defaults = wizardTemplateDefaults(template);
  const models = form.models.length > 0 ? form.models : wizardTemplateModels();
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);

  return normalizeWizardAgentModels({
    ...form,
    template,
    description: defaults.description,
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
