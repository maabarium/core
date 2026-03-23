import type {
  BlueprintFile,
  ConsoleState,
  HardwareSensor,
  HardwareTelemetry,
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

export function normalizeConsoleState(snapshot: ConsoleState): ConsoleState {
  return {
    engineRunning: Boolean(snapshot.engineRunning),
    blueprintPath: snapshot.blueprintPath ?? "",
    dbPath: snapshot.dbPath ?? "",
    logPath: snapshot.logPath ?? "",
    hardwareTelemetry: normalizeHardwareTelemetry(snapshot.hardwareTelemetry),
    blueprint: normalizeBlueprintFile(snapshot.blueprint),
    blueprintError: snapshot.blueprintError ?? null,
    evaluatorKind: snapshot.evaluatorKind ?? null,
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
    experiments: Array.isArray(snapshot.experiments)
      ? snapshot.experiments.map((experiment) => ({
          ...experiment,
          metrics: Array.isArray(experiment.metrics) ? experiment.metrics : [],
          research: normalizeResearchArtifacts(experiment.research),
        }))
      : [],
    proposals: Array.isArray(snapshot.proposals) ? snapshot.proposals : [],
    logs: Array.isArray(snapshot.logs) ? snapshot.logs : [],
  };
}
