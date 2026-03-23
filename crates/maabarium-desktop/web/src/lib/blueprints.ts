import type {
  BlueprintFile,
  BlueprintWizardForm,
  ConsoleState,
  CouncilEntry,
  DesktopSetupState,
  ModelDef,
  OllamaStatus,
  RemoteProviderSetup,
  WizardAgentForm,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../types/console";

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

export function formatBlueprintGroup(language: string | null): string {
  return language && language.trim().length > 0
    ? language.trim().toUpperCase()
    : "UNSPECIFIED";
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
          "Create a starter blueprint for code changes with tests, runtime constraints, and maintainability-focused evaluation.",
        language: "rust",
        targetFiles: ["src/**/*.rs", "tests/**/*.rs"],
        requireTestsPass: true,
      };
    case "product_builder":
      return {
        label: "Product Builder",
        description:
          "Create a full-application blueprint that can plan, build, and refine product scope across frontend, backend, and docs.",
        language: "application",
        targetFiles: ["src/**/*", "crates/**/*", "apps/**/*", "packages/**/*"],
        requireTestsPass: true,
      };
    case "general_research":
      return {
        label: "General Research",
        description:
          "Create a research blueprint for sourced briefs, internet-backed lookups when available, and explicit citations for major claims.",
        language: "research",
        targetFiles: ["docs/**/*.md", "research/**/*.md", "notes/**/*.md"],
        requireTestsPass: false,
      };
    case "prompt_optimization":
      return {
        label: "Prompt Optimization",
        description:
          "Create a prompt-focused blueprint tuned for clarity, actionability, and concise editing loops.",
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
          "Create a general-purpose starter blueprint you can refine later in the TOML file.",
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

function buildLocalWizardModels(
  setup: DesktopSetupState | undefined,
  ollama: OllamaStatus | undefined,
): WizardModelForm[] {
  const localModelNames = uniqueStrings([
    ...(setup?.selectedLocalModels ?? []),
    ...(ollama?.models.map((model) => model.name) ?? []),
    ...(ollama?.recommendedModels ?? []),
  ]);

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
  const localModels = buildLocalWizardModels(setup, state?.ollama);
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
            "You gather the best available evidence on the topic, perform internet lookups when tool access exists, and keep a running list of sources.",
          model: modelName,
        },
        {
          name: "verifier",
          role: "source verifier",
          systemPrompt:
            "You challenge unsupported claims, demand attribution, and call out when live source access is unavailable or too weak to support a conclusion.",
          model: modelName,
        },
        {
          name: "synthesizer",
          role: "research synthesizer",
          systemPrompt:
            "You produce a concise research brief with explicit citations for major claims and clear uncertainty when evidence is incomplete.",
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
  const models = activeBlueprint?.models?.models?.length
    ? activeBlueprint.models.models.map(buildWizardModelForm)
    : suggestedModels;
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);
  const suggestedWorkspacePath =
    state?.desktopSetup.workspacePath?.trim() ||
    activeBlueprint?.domain.repo_path ||
    ".";

  return {
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
  };
}

export function applyWizardTemplate(
  form: BlueprintWizardForm,
  template: WizardTemplate,
): BlueprintWizardForm {
  const defaults = wizardTemplateDefaults(template);
  const models = form.models.length > 0 ? form.models : wizardTemplateModels();
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);

  return {
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
  };
}
