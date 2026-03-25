import type {
  BlueprintFile,
  ConsoleState,
  DesktopSetupState,
  ExperimentBranchCleanupResult,
  ExperimentBranchInventory,
  GitDependencyState,
  HardwareSensor,
  HardwareTelemetry,
  LoraArtifacts,
  OllamaStatus,
  ReadinessItem,
  ResearchArtifacts,
} from "../types/console";

function normalizeBlueprintFile(
  blueprint: BlueprintFile | null | undefined,
): BlueprintFile | null {
  if (!blueprint) {
    return null;
  }

  return {
    blueprint: {
      name: blueprint.blueprint?.name ?? "",
      version: blueprint.blueprint?.version ?? "",
      description: blueprint.blueprint?.description ?? "",
    },
    domain: {
      repo_path: blueprint.domain?.repo_path ?? ".",
      target_files: Array.isArray(blueprint.domain?.target_files)
        ? blueprint.domain.target_files
        : [],
      language: blueprint.domain?.language ?? "",
    },
    constraints: {
      max_iterations: blueprint.constraints?.max_iterations ?? 0,
      timeout_seconds: blueprint.constraints?.timeout_seconds ?? 0,
      require_tests_pass: blueprint.constraints?.require_tests_pass ?? false,
      min_improvement: blueprint.constraints?.min_improvement ?? 0,
    },
    metrics: {
      metrics: Array.isArray(blueprint.metrics?.metrics)
        ? blueprint.metrics.metrics.map((metric) => ({
            name: metric.name ?? "",
            weight: metric.weight ?? 0,
            direction: metric.direction ?? "maximize",
            description: metric.description ?? "",
          }))
        : [],
    },
    agents: {
      council_size: blueprint.agents?.council_size ?? 0,
      debate_rounds: blueprint.agents?.debate_rounds ?? 0,
      agents: Array.isArray(blueprint.agents?.agents)
        ? blueprint.agents.agents.map((agent) => ({
            name: agent.name ?? "",
            role: agent.role ?? "",
            system_prompt: agent.system_prompt ?? "",
            model: agent.model ?? "",
          }))
        : [],
    },
    models: {
      assignment:
        blueprint.models?.assignment === "round_robin"
          ? "round_robin"
          : "explicit",
      models: Array.isArray(blueprint.models?.models)
        ? blueprint.models.models.map((model) => ({
            name: model.name ?? "",
            provider: model.provider ?? "",
            endpoint: model.endpoint ?? "",
            api_key_env: model.api_key_env ?? null,
            temperature: model.temperature ?? 0.7,
            max_tokens: model.max_tokens ?? 2048,
            requests_per_minute: model.requests_per_minute ?? null,
          }))
        : [],
    },
    library: blueprint.library
      ? {
          kind: blueprint.library.kind === "template" ? "template" : "workflow",
          setup_required: Boolean(blueprint.library.setup_required),
          template:
            blueprint.library.template === "code_quality" ||
            blueprint.library.template === "prompt_optimization" ||
            blueprint.library.template === "product_builder" ||
            blueprint.library.template === "general_research" ||
            blueprint.library.template === "lora_validation" ||
            blueprint.library.template === "custom"
              ? blueprint.library.template
              : null,
        }
      : null,
  };
}

function normalizeResearchArtifacts(
  research: ResearchArtifacts | null | undefined,
): ResearchArtifacts | null {
  if (!research) {
    return null;
  }

  return {
    sources: Array.isArray(research.sources)
      ? research.sources.map((source) => ({
          url: source.url ?? "",
          finalUrl: source.finalUrl ?? null,
          host: source.host ?? null,
          label: source.label ?? null,
          title: source.title ?? null,
          citationCount:
            typeof source.citationCount === "number" ? source.citationCount : 0,
          verified: Boolean(source.verified),
          statusCode:
            typeof source.statusCode === "number" ? source.statusCode : null,
          fetchError: source.fetchError ?? null,
        }))
      : [],
    citations: Array.isArray(research.citations)
      ? research.citations.map((citation) => ({
          filePath: citation.filePath ?? "",
          sourceUrl: citation.sourceUrl ?? "",
          label: citation.label ?? null,
          lineNumber:
            typeof citation.lineNumber === "number" ? citation.lineNumber : 0,
          snippet: citation.snippet ?? "",
        }))
      : [],
    queryTraces: Array.isArray(research.queryTraces)
      ? research.queryTraces.map((trace) => ({
          provider: trace.provider ?? "unknown",
          queryText: trace.queryText ?? "",
          resultCount:
            typeof trace.resultCount === "number" ? trace.resultCount : 0,
          topUrls: Array.isArray(trace.topUrls)
            ? trace.topUrls.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          latencyMs: typeof trace.latencyMs === "number" ? trace.latencyMs : 0,
          executedAt: trace.executedAt ?? "",
          error: trace.error ?? null,
        }))
      : [],
  };
}

function normalizeLoraArtifacts(
  lora: LoraArtifacts | null | undefined,
): LoraArtifacts | null {
  if (!lora) {
    return null;
  }

  return {
    trainer: lora.trainer ?? "",
    baseModel: lora.baseModel ?? "",
    dataset: lora.dataset ?? "",
    adapterPath: lora.adapterPath ?? "",
    outputDir: lora.outputDir ?? null,
    evalCommand: lora.evalCommand ?? null,
    epochs: typeof lora.epochs === "number" ? lora.epochs : null,
    learningRate:
      typeof lora.learningRate === "number" ? lora.learningRate : null,
    adapterRatio: typeof lora.adapterRatio === "number" ? lora.adapterRatio : 0,
    metadataRatio:
      typeof lora.metadataRatio === "number" ? lora.metadataRatio : 0,
    reproducibilityRatio:
      typeof lora.reproducibilityRatio === "number"
        ? lora.reproducibilityRatio
        : 0,
    trainerSignal:
      typeof lora.trainerSignal === "number" ? lora.trainerSignal : 0,
    executionSignal:
      typeof lora.executionSignal === "number" ? lora.executionSignal : 0,
    sandboxFileCount:
      typeof lora.sandboxFileCount === "number" ? lora.sandboxFileCount : 0,
    sandboxTotalBytes:
      typeof lora.sandboxTotalBytes === "number" ? lora.sandboxTotalBytes : 0,
    stages: Array.isArray(lora.stages)
      ? lora.stages.map((stage) => ({
          name: stage.name ?? "",
          command: stage.command ?? "",
          args: Array.isArray(stage.args)
            ? stage.args.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          workingDir: stage.workingDir ?? "",
          timeoutSeconds:
            typeof stage.timeoutSeconds === "number" ? stage.timeoutSeconds : 0,
          expectedArtifacts: Array.isArray(stage.expectedArtifacts)
            ? stage.expectedArtifacts.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          verifiedArtifacts: Array.isArray(stage.verifiedArtifacts)
            ? stage.verifiedArtifacts.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }))
      : [],
  };
}

function normalizeHardwareSensor(
  sensor: HardwareSensor | null | undefined,
): HardwareSensor {
  return {
    status:
      sensor?.status === "live" ||
      sensor?.status === "partial" ||
      sensor?.status === "unavailable"
        ? sensor.status
        : "unavailable",
    utilizationPercent:
      typeof sensor?.utilizationPercent === "number"
        ? sensor.utilizationPercent
        : null,
    temperatureCelsius:
      typeof sensor?.temperatureCelsius === "number"
        ? sensor.temperatureCelsius
        : null,
    logicalCores:
      typeof sensor?.logicalCores === "number" ? sensor.logicalCores : null,
    statusDetail: sensor?.statusDetail ?? "Telemetry is unavailable.",
  };
}

function normalizeHardwareTelemetry(
  telemetry: HardwareTelemetry | null | undefined,
): HardwareTelemetry | null {
  if (!telemetry) {
    return null;
  }

  return {
    sampledAtEpochMs:
      typeof telemetry.sampledAtEpochMs === "number"
        ? telemetry.sampledAtEpochMs
        : 0,
    platform: telemetry.platform ?? "unknown",
    cpu: normalizeHardwareSensor(telemetry.cpu),
    gpu: normalizeHardwareSensor(telemetry.gpu),
    npu: normalizeHardwareSensor(telemetry.npu),
    notes: Array.isArray(telemetry.notes) ? telemetry.notes : [],
  };
}

function normalizeGitDependency(
  dependency: GitDependencyState | null | undefined,
): GitDependencyState {
  return {
    installed: Boolean(dependency?.installed),
    commandPath: dependency?.commandPath ?? null,
    autoInstallSupported: Boolean(dependency?.autoInstallSupported),
    installerLabel: dependency?.installerLabel ?? null,
    installCommand: dependency?.installCommand ?? null,
    statusDetail: dependency?.statusDetail ?? "Git status is unavailable.",
  };
}

function normalizeDesktopSetup(
  setup: DesktopSetupState | null | undefined,
): DesktopSetupState {
  return {
    guidedMode: Boolean(setup?.guidedMode ?? true),
    onboardingCompleted: Boolean(setup?.onboardingCompleted),
    runtimeStrategy:
      setup?.runtimeStrategy === "local" ||
      setup?.runtimeStrategy === "remote" ||
      setup?.runtimeStrategy === "mixed"
        ? setup.runtimeStrategy
        : null,
    researchSearchMode:
      setup?.researchSearchMode === "brave_api" ||
      setup?.researchSearchMode === "duckduckgo_scrape"
        ? setup.researchSearchMode
        : "duckduckgo_scrape",
    workspacePath: setup?.workspacePath ?? null,
    selectedBlueprintPath: setup?.selectedBlueprintPath ?? null,
    selectedLocalModels: Array.isArray(setup?.selectedLocalModels)
      ? setup.selectedLocalModels.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    remoteProviders: Array.isArray(setup?.remoteProviders)
      ? setup.remoteProviders.map((provider) => ({
          providerId: provider.providerId ?? "",
          label: provider.label ?? provider.providerId ?? "Provider",
          endpoint: provider.endpoint ?? null,
          modelName: provider.modelName ?? null,
          fallbackOnly: Boolean(provider.fallbackOnly),
          configured: Boolean(provider.configured),
        }))
      : [],
    preferredUpdateChannel: setup?.preferredUpdateChannel ?? null,
    remindLaterUntil: setup?.remindLaterUntil ?? null,
    remindLaterVersion: setup?.remindLaterVersion ?? null,
    lastSetupCompletedAt: setup?.lastSetupCompletedAt ?? null,
    interruptedRunNotice:
      setup?.interruptedRunNotice &&
      typeof setup.interruptedRunNotice.blueprintName === "string" &&
      typeof setup.interruptedRunNotice.workspacePath === "string" &&
      typeof setup.interruptedRunNotice.interruptedAt === "string"
        ? {
            blueprintName: setup.interruptedRunNotice.blueprintName,
            workspacePath: setup.interruptedRunNotice.workspacePath,
            interruptedAt: setup.interruptedRunNotice.interruptedAt,
            reason: setup.interruptedRunNotice.reason ?? null,
          }
        : null,
  };
}

function normalizeRunState(
  snapshot: ConsoleState["runState"],
): ConsoleState["runState"] {
  return {
    status:
      snapshot?.status === "running" ||
      snapshot?.status === "stopping" ||
      snapshot?.status === "idle"
        ? snapshot.status
        : "idle",
    blueprintName: snapshot?.blueprintName ?? null,
    workspacePath: snapshot?.workspacePath ?? null,
    currentIteration:
      typeof snapshot?.currentIteration === "number"
        ? snapshot.currentIteration
        : null,
    maxIterations:
      typeof snapshot?.maxIterations === "number"
        ? snapshot.maxIterations
        : null,
    phase: snapshot?.phase ?? null,
    latestScore:
      typeof snapshot?.latestScore === "number" ? snapshot.latestScore : null,
    latestDurationMs:
      typeof snapshot?.latestDurationMs === "number"
        ? snapshot.latestDurationMs
        : null,
    currentIterationElapsedMs:
      typeof snapshot?.currentIterationElapsedMs === "number"
        ? snapshot.currentIterationElapsedMs
        : null,
    startedAtEpochMs:
      typeof snapshot?.startedAtEpochMs === "number"
        ? snapshot.startedAtEpochMs
        : null,
    message: snapshot?.message ?? null,
  };
}

function normalizeReadinessItems(
  items: ReadinessItem[] | null | undefined,
): ReadinessItem[] {
  return Array.isArray(items)
    ? items.map((item) => ({
        id: item.id ?? "",
        title: item.title ?? "Readiness",
        status:
          item.status === "ready" ||
          item.status === "needs_attention" ||
          item.status === "optional"
            ? item.status
            : "needs_attention",
        summary: item.summary ?? "",
        actionLabel: item.actionLabel ?? "Review",
        lastCheckedAtEpochMs:
          typeof item.lastCheckedAtEpochMs === "number"
            ? item.lastCheckedAtEpochMs
            : 0,
      }))
    : [];
}

function normalizeExperimentBranchInventory(
  inventory: ExperimentBranchInventory | null | undefined,
): ExperimentBranchInventory | null {
  if (!inventory) {
    return null;
  }

  return {
    workspacePath: inventory.workspacePath ?? "",
    repositoryRoot: inventory.repositoryRoot ?? "",
    currentBranch: inventory.currentBranch ?? null,
    totalBranches:
      typeof inventory.totalBranches === "number" ? inventory.totalBranches : 0,
    ageMetrics: {
      olderThan1Month:
        typeof inventory.ageMetrics?.olderThan1Month === "number"
          ? inventory.ageMetrics.olderThan1Month
          : 0,
      olderThan3Months:
        typeof inventory.ageMetrics?.olderThan3Months === "number"
          ? inventory.ageMetrics.olderThan3Months
          : 0,
      olderThan6Months:
        typeof inventory.ageMetrics?.olderThan6Months === "number"
          ? inventory.ageMetrics.olderThan6Months
          : 0,
    },
    availableThresholdMonths: Array.isArray(inventory.availableThresholdMonths)
      ? inventory.availableThresholdMonths.filter(
          (value): value is number => typeof value === "number",
        )
      : [],
    defaultThresholdMonths:
      typeof inventory.defaultThresholdMonths === "number"
        ? inventory.defaultThresholdMonths
        : 3,
    branches: Array.isArray(inventory.branches)
      ? inventory.branches.map((branch) => ({
          name: branch.name ?? "",
          runId: branch.runId ?? null,
          iteration:
            typeof branch.iteration === "number" ? branch.iteration : null,
          lastCommitAt: branch.lastCommitAt ?? null,
          ageDays: typeof branch.ageDays === "number" ? branch.ageDays : null,
          isCurrent: Boolean(branch.isCurrent),
        }))
      : [],
  };
}

export function normalizeExperimentBranchCleanupResult(
  result: ExperimentBranchCleanupResult,
): ExperimentBranchCleanupResult {
  return {
    thresholdMonths:
      typeof result.thresholdMonths === "number" ? result.thresholdMonths : 3,
    dryRun: Boolean(result.dryRun),
    matchedBranchCount:
      typeof result.matchedBranchCount === "number"
        ? result.matchedBranchCount
        : 0,
    deletedBranchCount:
      typeof result.deletedBranchCount === "number"
        ? result.deletedBranchCount
        : 0,
    skippedBranchCount:
      typeof result.skippedBranchCount === "number"
        ? result.skippedBranchCount
        : 0,
    currentBranchProtected: Boolean(result.currentBranchProtected),
    summary: result.summary ?? "",
    branches: Array.isArray(result.branches)
      ? result.branches.map((branch) => ({
          name: branch.name ?? "",
          ageDays: typeof branch.ageDays === "number" ? branch.ageDays : null,
          lastCommitAt: branch.lastCommitAt ?? null,
          action:
            branch.action === "delete" ||
            branch.action === "skip_current" ||
            branch.action === "skip_error"
              ? branch.action
              : "skip_error",
          reason: branch.reason ?? null,
        }))
      : [],
  };
}

function normalizeOllamaStatus(
  ollama: OllamaStatus | null | undefined,
): OllamaStatus {
  return {
    installed: Boolean(ollama?.installed),
    running: Boolean(ollama?.running),
    commandAvailable: Boolean(ollama?.commandAvailable),
    launchAtLoginSupported: Boolean(ollama?.launchAtLoginSupported),
    installCommand: ollama?.installCommand ?? null,
    startCommand: ollama?.startCommand ?? null,
    statusDetail: ollama?.statusDetail ?? "Ollama is unavailable.",
    models: Array.isArray(ollama?.models)
      ? ollama.models.map((model) => ({
          name: model.name ?? "",
          sizeLabel: model.sizeLabel ?? null,
          modifiedAt: model.modifiedAt ?? null,
        }))
      : [],
    recommendedModels: Array.isArray(ollama?.recommendedModels)
      ? ollama.recommendedModels.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

function normalizePromotionOutcome(
  outcome: string | null | undefined,
): "unknown" | "promoted" | "rejected" | "cancelled" | "promotion_failed" {
  return outcome === "promoted" ||
    outcome === "rejected" ||
    outcome === "cancelled" ||
    outcome === "promotion_failed"
    ? outcome
    : "unknown";
}

export function normalizeConsoleState(snapshot: ConsoleState): ConsoleState {
  return {
    engineRunning: Boolean(snapshot.engineRunning),
    runState: normalizeRunState(snapshot.runState),
    blueprintPath: snapshot.blueprintPath ?? "",
    dbPath: snapshot.dbPath ?? "",
    logPath: snapshot.logPath ?? "",
    hardwareTelemetry: normalizeHardwareTelemetry(snapshot.hardwareTelemetry),
    gitDependency: normalizeGitDependency(snapshot.gitDependency),
    blueprint: normalizeBlueprintFile(snapshot.blueprint),
    blueprintError: snapshot.blueprintError ?? null,
    evaluatorKind: snapshot.evaluatorKind ?? null,
    pluginRuntime: snapshot.pluginRuntime
      ? {
          pluginId: snapshot.pluginRuntime.pluginId ?? "process-plugin",
          displayName: snapshot.pluginRuntime.displayName ?? null,
          manifestPath: snapshot.pluginRuntime.manifestPath ?? "",
          command: snapshot.pluginRuntime.command ?? null,
          args: Array.isArray(snapshot.pluginRuntime.args)
            ? snapshot.pluginRuntime.args.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          workingDir: snapshot.pluginRuntime.workingDir ?? null,
          timeoutSeconds: snapshot.pluginRuntime.timeoutSeconds ?? null,
          environmentKeys: Array.isArray(snapshot.pluginRuntime.environmentKeys)
            ? snapshot.pluginRuntime.environmentKeys.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          status:
            snapshot.pluginRuntime.status === "ready"
              ? "ready"
              : "needs_attention",
          summary: snapshot.pluginRuntime.summary ?? "",
          error: snapshot.pluginRuntime.error ?? null,
        }
      : null,
    availableBlueprints: Array.isArray(snapshot.availableBlueprints)
      ? snapshot.availableBlueprints.map((blueprint) => ({
          path: blueprint.path ?? "",
          fileName: blueprint.fileName ?? "",
          displayName: blueprint.displayName ?? blueprint.fileName ?? "",
          description: blueprint.description ?? null,
          loadError: blueprint.loadError ?? null,
          version: blueprint.version ?? null,
          language: blueprint.language ?? null,
          repoPath: blueprint.repoPath ?? null,
          councilSize: blueprint.councilSize ?? null,
          metricCount: blueprint.metricCount ?? null,
          targetFileCount: blueprint.targetFileCount ?? null,
          maxIterations: blueprint.maxIterations ?? null,
          isLoadable: Boolean(blueprint.isLoadable),
          isActive: Boolean(blueprint.isActive),
          libraryKind:
            blueprint.libraryKind === "template" ? "template" : "workflow",
          requiresSetup: Boolean(blueprint.requiresSetup),
          wizardTemplate:
            blueprint.wizardTemplate === "code_quality" ||
            blueprint.wizardTemplate === "prompt_optimization" ||
            blueprint.wizardTemplate === "product_builder" ||
            blueprint.wizardTemplate === "general_research" ||
            blueprint.wizardTemplate === "lora_validation" ||
            blueprint.wizardTemplate === "custom"
              ? blueprint.wizardTemplate
              : null,
        }))
      : [],
    runAnalytics: {
      daily: Array.isArray(snapshot.runAnalytics?.daily)
        ? snapshot.runAnalytics.daily.map((bucket) => ({
            label: bucket.label ?? "",
            experiments: bucket.experiments ?? 0,
            tokenUsage: bucket.tokenUsage ?? 0,
          }))
        : [],
      weekly: Array.isArray(snapshot.runAnalytics?.weekly)
        ? snapshot.runAnalytics.weekly.map((bucket) => ({
            label: bucket.label ?? "",
            experiments: bucket.experiments ?? 0,
            tokenUsage: bucket.tokenUsage ?? 0,
          }))
        : [],
      monthly: Array.isArray(snapshot.runAnalytics?.monthly)
        ? snapshot.runAnalytics.monthly.map((bucket) => ({
            label: bucket.label ?? "",
            experiments: bucket.experiments ?? 0,
            tokenUsage: bucket.tokenUsage ?? 0,
          }))
        : [],
    },
    updater: {
      currentVersion: snapshot.updater?.currentVersion ?? "0.0.0",
      channel: snapshot.updater?.channel ?? "stable",
      endpoint: snapshot.updater?.endpoint ?? null,
      configured: Boolean(snapshot.updater?.configured),
    },
    desktopSetup: normalizeDesktopSetup(snapshot.desktopSetup),
    readinessItems: normalizeReadinessItems(snapshot.readinessItems),
    experimentBranchInventory: normalizeExperimentBranchInventory(
      snapshot.experimentBranchInventory,
    ),
    ollama: normalizeOllamaStatus(snapshot.ollama),
    experiments: Array.isArray(snapshot.experiments)
      ? snapshot.experiments.map((experiment) => ({
          ...experiment,
          promotion_outcome: normalizePromotionOutcome(
            experiment.promotion_outcome,
          ),
          metrics: Array.isArray(experiment.metrics) ? experiment.metrics : [],
          research: normalizeResearchArtifacts(experiment.research),
          lora: normalizeLoraArtifacts(experiment.lora),
        }))
      : [],
    proposals: Array.isArray(snapshot.proposals) ? snapshot.proposals : [],
    logs: Array.isArray(snapshot.logs) ? snapshot.logs : [],
  };
}
