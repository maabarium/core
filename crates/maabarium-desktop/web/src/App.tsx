import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Cpu,
  Download,
  FileText,
  FolderOpen,
  Flame,
  History,
  Layers,
  Play,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  ZapOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import appLogo from "../../icons/maabariumLogo.png";

type MetricDef = {
  name: string;
  weight: number;
  direction: string;
  description: string;
};

type MetricScore = {
  name: string;
  value: number;
  weight: number;
};

type ResearchSource = {
  url: string;
  finalUrl: string | null;
  host: string | null;
  label: string | null;
  title: string | null;
  citationCount: number;
  verified: boolean;
  statusCode: number | null;
  fetchError: string | null;
};

type ResearchCitation = {
  filePath: string;
  sourceUrl: string;
  label: string | null;
  lineNumber: number;
  snippet: string;
};

type ResearchArtifacts = {
  sources: ResearchSource[];
  citations: ResearchCitation[];
};

type AgentDef = {
  name: string;
  role: string;
  system_prompt: string;
  model: string;
};

type ModelDef = {
  name: string;
  provider: string;
  endpoint: string;
  api_key_env?: string | null;
  temperature: number;
  max_tokens: number;
  requests_per_minute?: number | null;
};

type BlueprintFile = {
  blueprint: {
    name: string;
    version: string;
    description: string;
  };
  domain: {
    repo_path: string;
    target_files: string[];
    language: string;
  };
  constraints: {
    max_iterations: number;
    timeout_seconds: number;
    require_tests_pass: boolean;
    min_improvement: number;
  };
  metrics: {
    metrics: MetricDef[];
  };
  agents: {
    council_size: number;
    debate_rounds: number;
    agents: AgentDef[];
  };
  models: {
    assignment: "explicit" | "round_robin";
    models: ModelDef[];
  };
};

type PersistedExperiment = {
  id: number;
  iteration: number;
  blueprint_name: string;
  proposal_summary: string;
  weighted_total: number;
  duration_ms: number;
  error: string | null;
  created_at: string;
  metrics: MetricScore[];
  research: ResearchArtifacts | null;
};

type FilePatch = {
  path: string;
  operation: "Create" | "Modify" | "Delete" | string;
  content?: string | null;
};

type PersistedProposal = {
  id: number;
  experiment_id: number;
  summary: string;
  created_at: string;
  file_patches: FilePatch[];
};

type ConsoleState = {
  engineRunning: boolean;
  blueprintPath: string;
  dbPath: string;
  logPath: string;
  hardwareTelemetry: HardwareTelemetry | null;
  blueprint: BlueprintFile | null;
  blueprintError: string | null;
  evaluatorKind: string | null;
  availableBlueprints: {
    path: string;
    fileName: string;
    displayName: string;
    description: string | null;
    loadError: string | null;
    version: string | null;
    language: string | null;
    repoPath: string | null;
    councilSize: number | null;
    metricCount: number | null;
    targetFileCount: number | null;
    maxIterations: number | null;
    isLoadable: boolean;
    isActive: boolean;
    libraryKind: "workflow" | "template";
    requiresSetup: boolean;
    wizardTemplate: WizardTemplate | null;
  }[];
  runAnalytics: RunAnalytics;
  updater: UpdaterConfigurationState;
  experiments: PersistedExperiment[];
  proposals: PersistedProposal[];
  logs: string[];
};

type AnalyticsBucket = {
  label: string;
  experiments: number;
  tokenUsage: number;
};

type RunAnalytics = {
  daily: AnalyticsBucket[];
  weekly: AnalyticsBucket[];
  monthly: AnalyticsBucket[];
};

type UpdaterConfigurationState = {
  currentVersion: string;
  channel: string;
  endpoint: string | null;
  configured: boolean;
};

type UpdateCheckResult = {
  currentVersion: string;
  channel: string;
  endpoint: string | null;
  configured: boolean;
  available: boolean;
  version: string | null;
  date: string | null;
  body: string | null;
};

type InstallUpdateResult = {
  installed: boolean;
  version: string | null;
  shouldRestart: boolean;
};

type AnalyticsRange = "daily" | "weekly" | "monthly";

type HardwareSensorStatus = "live" | "partial" | "unavailable";

type HardwareSensor = {
  status: HardwareSensorStatus;
  utilizationPercent: number | null;
  temperatureCelsius: number | null;
  logicalCores: number | null;
  statusDetail: string;
};

type HardwareTelemetry = {
  sampledAtEpochMs: number;
  platform: string;
  cpu: HardwareSensor;
  gpu: HardwareSensor;
  npu: HardwareSensor;
  notes: string[];
};

type HistoryRow = {
  experimentId: number;
  score: number;
  delta: number;
  summary: string;
  promoted: boolean;
};

type CouncilEntry = {
  title: string;
  subtitle: string;
  copy: string;
  accent: "teal" | "purple" | "slate";
};

type WizardTemplate =
  | "code_quality"
  | "prompt_optimization"
  | "product_builder"
  | "general_research"
  | "lora_validation"
  | "custom";

type BlueprintWizardRequest = {
  name: string;
  description: string;
  version: string;
  template: WizardTemplate;
  repoPath: string;
  language: string;
  targetFiles: string[];
  maxIterations: number;
  timeoutSeconds: number;
  requireTestsPass: boolean;
  minImprovement: number;
  councilSize: number;
  debateRounds: number;
  metrics: MetricDef[];
  agents: AgentDef[];
  modelAssignment: "explicit" | "round_robin";
  models: ModelDef[];
};

type WizardMetricForm = {
  name: string;
  weight: number;
  direction: "maximize" | "minimize";
  description: string;
};

type WizardAgentForm = {
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
};

type WizardModelForm = {
  name: string;
  provider: string;
  endpoint: string;
  apiKeyEnv: string;
  temperature: number;
  maxTokens: number;
  requestsPerMinute: string;
};

type BlueprintWizardForm = {
  name: string;
  description: string;
  version: string;
  template: WizardTemplate;
  repoPath: string;
  language: string;
  targetFilesText: string;
  maxIterations: number;
  timeoutSeconds: number;
  requireTestsPass: boolean;
  minImprovement: number;
  councilSize: number;
  debateRounds: number;
  modelAssignment: "explicit" | "round_robin";
  metrics: WizardMetricForm[];
  agents: WizardAgentForm[];
  models: WizardModelForm[];
};

const Badge = ({
  children,
  color = "blue",
}: {
  children: React.ReactNode;
  color?: "blue" | "emerald" | "rose" | "slate";
}) => {
  const colors = {
    blue: "bg-teal-500/10 text-teal-300 border-teal-500/20",
    emerald: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-[0.16em] ${colors[color]}`}
    >
      {children}
    </span>
  );
};

const GlassCard = ({
  children,
  className = "",
  title,
  icon: Icon,
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: LucideIcon;
  glow?: boolean;
}) => (
  <div className={`relative group transition-all duration-500 ${className}`}>
    {glow && (
      <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500/40 to-purple-500/40 rounded-xl blur opacity-20 group-hover:opacity-35 transition duration-1000" />
    )}
    <div className="relative h-full bg-[#0d1117]/88 backdrop-blur-2xl border border-slate-800/70 rounded-xl overflow-hidden shadow-2xl before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-gradient-to-b before:from-teal-500/70 before:via-purple-500/20 before:to-transparent before:opacity-70 after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-teal-500/70 after:via-purple-500/40 after:to-transparent after:opacity-70">
      {(title || Icon) && (
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em] flex items-center gap-2">
            {Icon ? <Icon size={14} className="text-teal-300" /> : null}
            {title}
          </h3>
          <div className="flex gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
          </div>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const MiniSparkline = ({
  data,
  color = "#2dd4bf",
}: {
  data: number[];
  color?: string;
}) => {
  if (data.length < 2) {
    return (
      <div className="w-16 h-8 rounded-md border border-dashed border-white/10 text-[8px] font-bold uppercase tracking-widest text-slate-600 flex items-center justify-center">
        No data
      </div>
    );
  }

  const points = data
    .map(
      (value, index) =>
        `${(index / Math.max(data.length - 1, 1)) * 100},${100 - value}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="w-16 h-8 overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="drop-shadow-[0_0_8px_rgba(45,212,191,0.28)]"
      />
    </svg>
  );
};

const AreaComparisonChart = ({ buckets }: { buckets: AnalyticsBucket[] }) => {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
        No persisted experiment or token data is available for this time window.
      </div>
    );
  }

  const experimentMax = Math.max(
    1,
    ...buckets.map((bucket) => bucket.experiments),
  );
  const tokenMax = Math.max(1, ...buckets.map((bucket) => bucket.tokenUsage));
  const width = 100;
  const height = 100;
  const buildPoints = (series: number[], max: number) =>
    series.map((value, index) => {
      const x =
        buckets.length === 1
          ? width / 2
          : (index / Math.max(buckets.length - 1, 1)) * width;
      const y = height - (value / max) * 78 - 8;
      return [x, y] as const;
    });
  const buildLinePath = (points: ReadonlyArray<readonly [number, number]>) =>
    points
      .map(
        ([x, y], index) =>
          `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");
  const buildAreaPath = (points: ReadonlyArray<readonly [number, number]>) => {
    const line = buildLinePath(points);
    const firstX = points[0]?.[0] ?? 0;
    const lastX = points[points.length - 1]?.[0] ?? width;
    return `${line} L${lastX.toFixed(2)},${height} L${firstX.toFixed(2)},${height} Z`;
  };

  const experimentPoints = buildPoints(
    buckets.map((bucket) => bucket.experiments),
    experimentMax,
  );
  const tokenPoints = buildPoints(
    buckets.map((bucket) => bucket.tokenUsage),
    tokenMax,
  );

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4">
      <svg viewBox="0 0 100 100" className="h-56 w-full overflow-visible">
        <defs>
          <linearGradient
            id="analytics-experiments-fill"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient
            id="analytics-tokens-fill"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((line) => (
          <line
            key={line}
            x1="0"
            y1={line}
            x2="100"
            y2={line}
            stroke="rgba(148,163,184,0.16)"
            strokeDasharray="2 3"
            strokeWidth="0.6"
          />
        ))}
        <path
          d={buildAreaPath(tokenPoints)}
          fill="url(#analytics-tokens-fill)"
        />
        <path
          d={buildAreaPath(experimentPoints)}
          fill="url(#analytics-experiments-fill)"
        />
        <path
          d={buildLinePath(tokenPoints)}
          fill="none"
          stroke="#a855f7"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={buildLinePath(experimentPoints)}
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {experimentPoints.map(([x, y], index) => (
          <circle key={`exp-${index}`} cx={x} cy={y} r="1.4" fill="#2dd4bf" />
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 sm:grid-cols-7">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="truncate text-center">
            {bucket.label}
          </div>
        ))}
      </div>
    </div>
  );
};

const RadarChart = ({ values }: { values: number[] }) => {
  const axisCount = Math.max(values.length, 3);
  const points = values
    .map((value, index) => {
      const angle = (Math.PI * 2 * index) / axisCount - Math.PI / 2;
      const x = 50 + Math.cos(angle) * 40 * value;
      const y = 50 + Math.sin(angle) * 40 * value;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full opacity-40">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
        <circle
          cx="50"
          cy="50"
          r="25"
          fill="none"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
        <path
          d="M50 10 L50 90 M10 50 L90 50"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient
            id="desktop-radar-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <polygon
          points={points}
          fill="url(#desktop-radar-gradient)"
          fillOpacity="0.22"
          stroke="url(#desktop-radar-gradient)"
          strokeWidth="1.5"
        />
        {points.split(" ").map((point, index) => {
          const [x, y] = point.split(",");
          return <circle key={index} cx={x} cy={y} r="1.8" fill="#2dd4bf" />;
        })}
      </svg>
    </div>
  );
};

function parseTokenUsage(line: string): number | null {
  const match = line.match(/tokens_used=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function formatPercentageDelta(current: number, previous: number): string {
  if (!previous) {
    return "Baseline";
  }
  return `${((current - previous) / previous) * 100 >= 0 ? "+" : ""}${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

function invertDelta(delta: string): string {
  if (delta.startsWith("+")) {
    return `-${delta.slice(1)}`;
  }
  if (delta.startsWith("-")) {
    return `+${delta.slice(1)}`;
  }
  return delta;
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${durationMs}ms`;
}

function formatTokenUsage(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return `${tokens}`;
}

function buildHistory(experiments: PersistedExperiment[]): HistoryRow[] {
  const successful = experiments.filter((experiment) => !experiment.error);
  const rows = experiments.slice(0, 8).map((experiment) => {
    const currentIndex = successful.findIndex(
      (candidate) => candidate.id === experiment.id,
    );
    const previous =
      currentIndex >= 0 ? successful[currentIndex + 1] : undefined;
    const delta = previous
      ? experiment.weighted_total - previous.weighted_total
      : 0;

    return {
      experimentId: experiment.id,
      score: experiment.weighted_total,
      delta,
      summary:
        experiment.error ||
        experiment.proposal_summary ||
        "No proposal summary recorded",
      promoted: !experiment.error && delta >= 0,
    };
  });

  if (rows.length > 0) {
    return rows;
  }

  return [];
}

function summarizePrompt(systemPrompt: string): string {
  const normalized = systemPrompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No system prompt configured.";
  }

  const firstSentence = normalized.match(/.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const summary = firstSentence || normalized;
  return summary.length > 140 ? `${summary.slice(0, 137)}...` : summary;
}

function buildCouncilEntries(blueprint: BlueprintFile | null): CouncilEntry[] {
  return (
    blueprint?.agents?.agents?.slice(0, 3).map((agent) => {
      const lower = `${agent.name} ${agent.role}`.toLowerCase();
      if (lower.includes("critic")) {
        return {
          title: `${toTitleCase(agent.name)} Agent`,
          subtitle: `${toTitleCase(agent.role)} • ${agent.model}`,
          accent: "purple" as const,
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

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatBlueprintGroup(language: string | null): string {
  return language && language.trim().length > 0
    ? language.trim().toUpperCase()
    : "UNSPECIFIED";
}

function buildBlueprintSummary(
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

function buildPatchPreview(
  patch: FilePatch,
): { color: string; line: string }[] {
  const op = patch.operation.toLowerCase();
  if (op === "delete") {
    return [{ color: "text-rose-400", line: `- removed ${patch.path}` }];
  }

  const prefix = op === "create" ? "+" : "~";
  const color = op === "create" ? "text-teal-300" : "text-purple-300";
  return (patch.content || "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({ color, line: `${prefix}${line}` }));
}

function wizardTemplateDefaults(template: WizardTemplate) {
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

function buildWizardForm(
  state: ConsoleState | null,
  template: WizardTemplate = "code_quality",
): BlueprintWizardForm {
  const defaults = wizardTemplateDefaults(template);
  const activeBlueprint = state?.blueprint;
  const models = activeBlueprint?.models?.models?.length
    ? activeBlueprint.models.models.map(buildWizardModelForm)
    : wizardTemplateModels();
  const primaryModelName = models[0]?.name || "llama3";
  const agents = wizardTemplateAgents(template, primaryModelName);

  return {
    name: "",
    description: defaults.description,
    version: "1.0.0",
    template,
    repoPath: activeBlueprint?.domain.repo_path || ".",
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

function applyWizardTemplate(
  form: BlueprintWizardForm,
  template: WizardTemplate,
): BlueprintWizardForm {
  const defaults = wizardTemplateDefaults(template);
  const models = wizardTemplateModels();
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

function normalizeConsoleState(snapshot: ConsoleState): ConsoleState {
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

function telemetryBadgeColor(
  status: HardwareSensorStatus,
): "blue" | "emerald" | "rose" {
  if (status === "live") {
    return "emerald";
  }
  if (status === "partial") {
    return "blue";
  }
  return "rose";
}

function formatTelemetryPercent(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function formatTelemetryTemperature(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}°C`;
}

function formatTelemetryTimestamp(epochMs: number): string {
  if (!epochMs) {
    return "Awaiting sample";
  }

  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSourceHost(source: ResearchSource): string {
  return source.host || source.finalUrl || source.url;
}

function formatExperimentTimestamp(timestamp: string): string {
  if (!timestamp) {
    return "Unknown time";
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }

  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [activeTab, setActiveTab] = useState<"history" | "diff" | "logs">(
    "history",
  );
  const [blueprintQuery, setBlueprintQuery] = useState("");
  const [blueprintLanguageFilter, setBlueprintLanguageFilter] =
    useState<string>("all");
  const [blueprintDensity, setBlueprintDensity] = useState<
    "detailed" | "compact"
  >("detailed");
  const [collapsedBlueprintGroups, setCollapsedBlueprintGroups] = useState<
    Record<string, boolean>
  >({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCreating, setWizardCreating] = useState(false);
  const [cpuInfoOpen, setCpuInfoOpen] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("daily");
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(
    null,
  );
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [wizardForm, setWizardForm] = useState<BlueprintWizardForm>(
    buildWizardForm(null),
  );
  const [switchingBlueprintPath, setSwitchingBlueprintPath] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const snapshot = await invoke<ConsoleState>("get_console_state");
      setState(normalizeConsoleState(snapshot));
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(interval);
  }, []);

  const dashboard = useMemo(() => {
    const experiments = state?.experiments ?? [];
    const successful = experiments.filter((experiment) => !experiment.error);
    const logs = state?.logs ?? [];
    const tokenSamples = logs
      .map(parseTokenUsage)
      .filter((value): value is number => value !== null);

    const current = successful[0];
    const previous = successful[1];
    const currentScoreSeries = successful
      .slice(0, 6)
      .map((experiment) =>
        Math.max(0, Math.min(100, experiment.weighted_total * 100)),
      )
      .reverse();
    const avgDurationSeries = successful
      .slice(0, 6)
      .map((experiment) => experiment.duration_ms / 1000)
      .reverse();
    const tokenSeries = tokenSamples.slice(-6);

    return {
      currentScore: current ? current.weighted_total.toFixed(2) : "--",
      currentScoreTrend:
        current && previous
          ? formatPercentageDelta(
              current.weighted_total,
              previous.weighted_total,
            )
          : successful.length > 0
            ? "Single run"
            : "No persisted runs",
      currentScoreSeries: currentScoreSeries,
      avgIteration:
        successful.length > 0
          ? formatDuration(
              Math.round(
                successful
                  .slice(0, 6)
                  .reduce(
                    (sum, experiment) => sum + experiment.duration_ms,
                    0,
                  ) / successful.slice(0, 6).length,
              ),
            )
          : "--",
      avgIterationTrend:
        current && previous
          ? invertDelta(
              formatPercentageDelta(current.duration_ms, previous.duration_ms),
            )
          : successful.length > 0
            ? "Single run"
            : "No persisted runs",
      avgIterationSeries: avgDurationSeries,
      tokenUsage:
        tokenSamples.length > 0
          ? formatTokenUsage(
              tokenSamples.reduce((sum, value) => sum + value, 0),
            )
          : "0",
      tokenUsageTrend:
        tokenSamples.length > 0
          ? `${tokenSamples.length} recent completions`
          : "No recent LLM traffic",
      tokenUsageSeries: tokenSeries,
    };
  }, [state]);

  const history = useMemo(
    () => buildHistory(state?.experiments ?? []),
    [state],
  );
  const latestSuccessfulExperiment = useMemo(
    () => state?.experiments.find((experiment) => !experiment.error) ?? null,
    [state],
  );
  const councilEntries = useMemo(
    () => buildCouncilEntries(state?.blueprint ?? null),
    [state],
  );
  const blueprintSummary = useMemo(
    () =>
      buildBlueprintSummary(
        state?.blueprint ?? null,
        state?.blueprintError ?? null,
        state?.evaluatorKind ?? null,
      ),
    [state],
  );
  const metricPanel = useMemo(() => {
    if (latestSuccessfulExperiment?.metrics.length) {
      const metrics = latestSuccessfulExperiment.metrics.slice(0, 5);
      return {
        title: "Latest Evaluator Metrics",
        subtitle: `Experiment #${latestSuccessfulExperiment.id}`,
        points: metrics.map((metric) =>
          Math.max(0.15, Math.min(1, metric.value)),
        ),
        labels: metrics.map((metric) => metric.name.replace(/_/g, " ")),
      };
    }

    const configuredMetrics =
      state?.blueprint?.metrics.metrics.slice(0, 5) ?? [];
    return {
      title: "Blueprint Metric Weights",
      subtitle: "Configuration values until experiments are recorded",
      points: configuredMetrics.map((metric) =>
        Math.max(0.15, Math.min(1, metric.weight)),
      ),
      labels: configuredMetrics.map((metric) => metric.name.replace(/_/g, " ")),
    };
  }, [latestSuccessfulExperiment, state]);
  const latestProposal = state?.proposals[0] ?? null;
  const latestResearchExperiment = useMemo(
    () =>
      state?.experiments.find(
        (experiment) =>
          !experiment.error &&
          experiment.research !== null &&
          (experiment.research.sources.length > 0 ||
            experiment.research.citations.length > 0),
      ) ?? null,
    [state],
  );
  const hardwareTelemetry = state?.hardwareTelemetry ?? null;
  const cpuSensor = hardwareTelemetry?.cpu ?? null;
  const activeBlueprintOption = useMemo(
    () =>
      state?.availableBlueprints.find(
        (blueprint) => blueprint.path === state.blueprintPath,
      ) ?? null,
    [state],
  );
  const blueprintLanguageOptions = useMemo(() => {
    const languages = Array.from(
      new Set(
        (state?.availableBlueprints ?? []).map((blueprint) =>
          formatBlueprintGroup(blueprint.language),
        ),
      ),
    );

    return languages.sort((left, right) => left.localeCompare(right));
  }, [state]);
  const filteredBlueprints = useMemo(() => {
    const query = blueprintQuery.trim().toLowerCase();

    return (state?.availableBlueprints ?? []).filter((blueprint) => {
      const group = formatBlueprintGroup(blueprint.language);
      const matchesLanguage =
        blueprintLanguageFilter === "all" || group === blueprintLanguageFilter;

      if (!matchesLanguage) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        blueprint.displayName,
        blueprint.fileName,
        blueprint.description,
        blueprint.language,
        blueprint.version,
        blueprint.repoPath,
        blueprint.path,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [blueprintLanguageFilter, blueprintQuery, state]);
  const groupedBlueprints = useMemo(() => {
    const groups = new Map<
      string,
      NonNullable<ConsoleState["availableBlueprints"]>
    >();

    for (const blueprint of filteredBlueprints) {
      const key = formatBlueprintGroup(blueprint.language);
      const existing = groups.get(key);
      if (existing) {
        existing.push(blueprint);
      } else {
        groups.set(key, [blueprint]);
      }
    }

    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, blueprints]) => ({
        group,
        blueprints: blueprints.sort((left, right) => {
          if (left.isActive !== right.isActive) {
            return left.isActive ? -1 : 1;
          }

          return left.displayName.localeCompare(right.displayName);
        }),
      }));
  }, [filteredBlueprints]);
  const activeBlueprintFilters = useMemo(() => {
    const filters: string[] = [];
    if (blueprintLanguageFilter !== "all") {
      filters.push(`Language: ${blueprintLanguageFilter}`);
    }
    if (blueprintQuery.trim()) {
      filters.push(`Query: ${blueprintQuery.trim()}`);
    }
    return filters;
  }, [blueprintLanguageFilter, blueprintQuery]);
  const wizardMetricWeightTotal = useMemo(
    () =>
      wizardForm.metrics.reduce(
        (sum, metric) =>
          sum + (Number.isFinite(metric.weight) ? metric.weight : 0),
        0,
      ),
    [wizardForm.metrics],
  );
  const wizardModelNames = useMemo(
    () =>
      wizardForm.models
        .map((model) => model.name.trim())
        .filter((name) => name.length > 0),
    [wizardForm.models],
  );
  const selectedAnalytics = useMemo(() => {
    const analytics = state?.runAnalytics;
    if (!analytics) {
      return [] as AnalyticsBucket[];
    }

    if (analyticsRange === "weekly") {
      return analytics.weekly;
    }
    if (analyticsRange === "monthly") {
      return analytics.monthly;
    }
    return analytics.daily;
  }, [analyticsRange, state]);
  const selectedAnalyticsTotals = useMemo(
    () => ({
      experiments: selectedAnalytics.reduce(
        (sum, bucket) => sum + bucket.experiments,
        0,
      ),
      tokenUsage: selectedAnalytics.reduce(
        (sum, bucket) => sum + bucket.tokenUsage,
        0,
      ),
    }),
    [selectedAnalytics],
  );

  const updateWizardMetric = (
    index: number,
    field: keyof WizardMetricForm,
    value: string | number,
  ) => {
    setWizardForm((current) => ({
      ...current,
      metrics: current.metrics.map((metric, metricIndex) =>
        metricIndex === index ? { ...metric, [field]: value } : metric,
      ),
    }));
  };

  const updateWizardAgent = (
    index: number,
    field: keyof WizardAgentForm,
    value: string,
  ) => {
    setWizardForm((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, [field]: value } : agent,
      ),
    }));
  };

  const updateWizardModel = (
    index: number,
    field: keyof WizardModelForm,
    value: string | number,
  ) => {
    setWizardForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, [field]: value } : model,
      ),
    }));
  };

  const addWizardMetric = () => {
    setWizardForm((current) => ({
      ...current,
      metrics: [
        ...current.metrics,
        {
          name: "new_metric",
          weight: 0.1,
          direction: "maximize",
          description: "Describe how this metric should be judged.",
        },
      ],
    }));
  };

  const addWizardAgent = () => {
    const fallbackModel = wizardModelNames[0] || "llama3";
    setWizardForm((current) => ({
      ...current,
      councilSize: current.agents.length + 1,
      agents: [
        ...current.agents,
        {
          name: `agent_${current.agents.length + 1}`,
          role: "specialist",
          systemPrompt: "Describe how this agent should contribute.",
          model: fallbackModel,
        },
      ],
    }));
  };

  const addWizardModel = () => {
    setWizardForm((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          name: `model_${current.models.length + 1}`,
          provider: "ollama",
          endpoint: "http://localhost:11434",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "",
        },
      ],
    }));
  };

  const removeWizardMetric = (index: number) => {
    setWizardForm((current) => ({
      ...current,
      metrics: current.metrics.filter(
        (_, metricIndex) => metricIndex !== index,
      ),
    }));
  };

  const removeWizardAgent = (index: number) => {
    setWizardForm((current) => {
      const nextAgents = current.agents.filter(
        (_, agentIndex) => agentIndex !== index,
      );
      return {
        ...current,
        councilSize: Math.max(1, nextAgents.length),
        agents: nextAgents,
      };
    });
  };

  const removeWizardModel = (index: number) => {
    setWizardForm((current) => ({
      ...current,
      models: current.models.filter((_, modelIndex) => modelIndex !== index),
    }));
  };

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const toggleBlueprintGroup = (group: string) => {
    setCollapsedBlueprintGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  };

  const toggleEngine = async () => {
    try {
      const snapshot = await invoke<ConsoleState>(
        state?.engineRunning ? "stop_engine" : "start_engine",
      );
      setState(normalizeConsoleState(snapshot));
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const openLogFile = async () => {
    try {
      await invoke("open_log_file");
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const openBlueprintFile = async () => {
    try {
      await invoke("open_blueprint_file");
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const openBlueprintDirectory = async () => {
    try {
      await invoke("open_blueprint_directory");
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const openBlueprintWizard = () => {
    setWizardForm(buildWizardForm(state));
    setActionError(null);
    setWizardOpen(true);
  };

  const openTemplateWizard = (
    template: WizardTemplate,
    displayName: string,
    description: string | null,
  ) => {
    const initial = buildWizardForm(state, template);
    setWizardForm({
      ...initial,
      name: displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
      description: description ?? initial.description,
    });
    setActionError(null);
    setWizardOpen(true);
  };

  const closeBlueprintWizard = () => {
    if (wizardCreating) {
      return;
    }

    setWizardOpen(false);
  };

  const setBlueprintPath = async (path: string) => {
    const snapshot = await invoke<ConsoleState>("set_blueprint_path", {
      path,
    });
    setState(normalizeConsoleState(snapshot));
    setActionError(null);
  };

  const selectBlueprint = async () => {
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Blueprint", extensions: ["toml"] }],
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }

      await setBlueprintPath(selectedPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const selectBlueprintFromLibrary = async (path: string) => {
    if (
      !path ||
      path === state?.blueprintPath ||
      switchingBlueprintPath !== null
    ) {
      return;
    }

    try {
      setSwitchingBlueprintPath(path);
      await setBlueprintPath(path);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingBlueprintPath(null);
    }
  };

  const checkForUpdates = async () => {
    try {
      setCheckingForUpdates(true);
      const result = await invoke<UpdateCheckResult>("check_for_updates");
      setUpdateCheck(result);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const installAvailableUpdate = async () => {
    try {
      setInstallingUpdate(true);
      const result = await invoke<InstallUpdateResult>(
        "install_available_update",
      );

      if (result.installed) {
        setActionError(null);
        setUpdateCheck((current) =>
          current
            ? {
                ...current,
                available: false,
              }
            : current,
        );
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstallingUpdate(false);
    }
  };

  const createBlueprintFromWizard = async () => {
    const targetFiles = wizardForm.targetFilesText
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const metrics = wizardForm.metrics.map((metric) => ({
      name: metric.name.trim(),
      weight: metric.weight,
      direction: metric.direction,
      description: metric.description.trim(),
    }));
    const agents = wizardForm.agents.map((agent) => ({
      name: agent.name.trim(),
      role: agent.role.trim(),
      system_prompt: agent.systemPrompt.trim(),
      model: agent.model.trim(),
    }));
    const models = wizardForm.models.map((model) => ({
      name: model.name.trim(),
      provider: model.provider.trim(),
      endpoint: model.endpoint.trim(),
      api_key_env: model.apiKeyEnv.trim() || null,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      requests_per_minute: model.requestsPerMinute.trim()
        ? Number(model.requestsPerMinute)
        : null,
    }));

    if (!wizardForm.name.trim()) {
      setActionError("Blueprint name is required");
      return;
    }

    if (!wizardForm.description.trim()) {
      setActionError("Blueprint description is required");
      return;
    }

    if (targetFiles.length === 0) {
      setActionError("Add at least one target file pattern");
      return;
    }

    if (metrics.length === 0) {
      setActionError("Add at least one metric");
      return;
    }

    if (agents.length === 0) {
      setActionError("Add at least one agent");
      return;
    }

    if (models.length === 0) {
      setActionError("Add at least one model");
      return;
    }

    if (metrics.some((metric) => !metric.name || !metric.description)) {
      setActionError("Each metric needs a name and description");
      return;
    }

    if (
      agents.some((agent) => !agent.name || !agent.role || !agent.system_prompt)
    ) {
      setActionError("Each agent needs a name, role, and system prompt");
      return;
    }

    if (
      models.some((model) => !model.name || !model.provider || !model.endpoint)
    ) {
      setActionError("Each model needs a name, provider, and endpoint");
      return;
    }

    if (
      models.some(
        (model) =>
          model.requests_per_minute !== null &&
          (!Number.isFinite(model.requests_per_minute) ||
            model.requests_per_minute <= 0),
      )
    ) {
      setActionError(
        "Each requests-per-minute value must be blank or greater than zero",
      );
      return;
    }

    if (
      !agents.every((agent) =>
        models.some((model) => model.name === agent.model),
      )
    ) {
      setActionError("Each agent must reference one of the configured models");
      return;
    }

    if (Math.abs(wizardMetricWeightTotal - 1) > 0.01) {
      setActionError("Metric weights must sum to 1.0");
      return;
    }

    try {
      setWizardCreating(true);
      const snapshot = await invoke<ConsoleState>(
        "create_blueprint_from_wizard",
        {
          request: {
            name: wizardForm.name.trim(),
            description: wizardForm.description.trim(),
            version: wizardForm.version.trim(),
            template: wizardForm.template,
            repoPath: wizardForm.repoPath.trim(),
            language: wizardForm.language.trim(),
            targetFiles,
            maxIterations: wizardForm.maxIterations,
            timeoutSeconds: wizardForm.timeoutSeconds,
            requireTestsPass: wizardForm.requireTestsPass,
            minImprovement: wizardForm.minImprovement,
            councilSize: wizardForm.councilSize,
            debateRounds: wizardForm.debateRounds,
            metrics,
            agents,
            modelAssignment: wizardForm.modelAssignment,
            models,
          } satisfies BlueprintWizardRequest,
        },
      );

      setState(normalizeConsoleState(snapshot));
      setWizardOpen(false);
      setBlueprintQuery("");
      setBlueprintLanguageFilter("all");
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setWizardCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100 font-sans selection:bg-teal-500/40 selection:text-teal-50">
      <nav className="sticky top-0 left-0 right-0 z-[100] bg-[#050608]/85 backdrop-blur-2xl border-b border-white/5 py-4">
        <div className="max-w-7xl mx-auto px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 cursor-default group">
            <img
              src={appLogo}
              alt="Maabarium logo"
              className="w-11 h-11 rounded-xl shadow-[0_0_20px_rgba(12,74,110,0.35)]"
            />
            <div>
              <span className="text-xl font-black tracking-tighter block leading-none">
                MAABARIUM
              </span>
              <span className="text-[10px] font-black text-slate-500 tracking-[0.28em] uppercase">
                Research Lab
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 bg-white/5 border border-white/5 p-1 rounded-xl shadow-inner">
            <button
              onClick={() => scrollToSection("overview-section")}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all"
              type="button"
            >
              Overview
            </button>
            <button
              onClick={() => scrollToSection("console-section")}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] bg-gradient-to-r from-teal-500 to-purple-500 text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.22)]"
              type="button"
            >
              Console
            </button>
            <button
              onClick={() => scrollToSection("blueprint-section")}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all"
              type="button"
            >
              Blueprints
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={() => void toggleEngine()}
              className={`relative overflow-hidden rounded-lg px-4 py-2 transition-all duration-300 group flex items-center justify-center gap-2 font-black uppercase tracking-[0.16em] border text-xs whitespace-nowrap ${state?.engineRunning ? "bg-slate-900 border-rose-500/50 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.2)]" : "bg-gradient-to-r from-teal-500 to-purple-500 border-teal-300/20 text-slate-950 shadow-[0_0_30px_rgba(45,212,191,0.18)]"}`}
              type="button"
              disabled={loading}
            >
              {state?.engineRunning ? (
                <Square size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {state?.engineRunning ? "STOP" : "RUN LOOP"}
            </button>
            <button
              onClick={openBlueprintWizard}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-purple-500 border border-teal-300/20 text-xs font-black tracking-[0.14em] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap"
              type="button"
              disabled={state?.engineRunning}
            >
              NEW FLOW
            </button>
            <button
              onClick={() => void selectBlueprint()}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-black tracking-[0.14em] hover:bg-white/10 transition-all whitespace-nowrap"
              type="button"
              disabled={state?.engineRunning}
            >
              OPEN FLOW
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 pt-10 pb-12">
        {actionError ? (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {actionError}
          </div>
        ) : null}

        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <section
            id="overview-section"
            className="grid grid-cols-1 md:grid-cols-4 gap-4"
          >
            {[
              {
                label: "Current Score",
                val: dashboard.currentScore,
                trend: dashboard.currentScoreTrend,
                color: "indigo",
                data: dashboard.currentScoreSeries,
              },
              {
                label: "Avg Iteration",
                val: dashboard.avgIteration,
                trend: dashboard.avgIterationTrend,
                color: "emerald",
                data: dashboard.avgIterationSeries,
              },
              {
                label: "Token Usage",
                val: dashboard.tokenUsage,
                trend: dashboard.tokenUsageTrend,
                color: "amber",
                data: dashboard.tokenUsageSeries,
              },
            ].map((stat) => (
              <GlassCard
                key={stat.label}
                className="relative min-h-[10.75rem] overflow-hidden"
              >
                <div className="flex h-full flex-col justify-between">
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                      {stat.label}
                    </p>
                    <h2 className="text-3xl font-mono font-black tracking-tight text-white mt-1">
                      {stat.val}
                    </h2>
                    <span
                      className={`text-[10px] font-black tracking-[0.14em] uppercase ${stat.trend.includes("+") ? "text-teal-300" : stat.trend.includes("-") ? "text-rose-400" : "text-slate-500"}`}
                    >
                      {stat.trend}
                    </span>
                  </div>
                  <div className="pt-6 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">
                    {stat.data.length > 0
                      ? `${stat.data.length} recent points`
                      : "Awaiting persisted data"}
                  </div>
                </div>
              </GlassCard>
            ))}

            <GlassCard className="relative min-h-[10.75rem] overflow-hidden">
              <div className="flex h-full flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                      CPU Load
                    </p>
                    <h2 className="mt-1 text-3xl font-mono font-black tracking-tight text-white">
                      {formatTelemetryPercent(
                        cpuSensor?.utilizationPercent ?? null,
                      )}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCpuInfoOpen((current) => !current)}
                      className="rounded-full border border-white/10 bg-white/5 p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                      aria-label="Explain CPU telemetry"
                    >
                      <AlertCircle size={14} />
                    </button>
                    <Badge
                      color={telemetryBadgeColor(
                        cpuSensor?.status ?? "unavailable",
                      )}
                    >
                      {cpuSensor?.status ?? "unavailable"}
                    </Badge>
                  </div>
                </div>

                {cpuInfoOpen ? (
                  <div className="absolute right-5 top-14 z-20 w-72 rounded-lg border border-white/10 bg-slate-950/95 px-3 py-3 text-xs leading-relaxed text-slate-300 shadow-2xl">
                    <div className="font-black uppercase tracking-[0.16em] text-slate-400">
                      CPU Telemetry
                    </div>
                    <div className="mt-2">
                      {cpuSensor?.statusDetail ??
                        "Telemetry is unavailable in the current build."}
                    </div>
                    <div className="mt-3 space-y-1 text-slate-500">
                      {(hardwareTelemetry?.notes.length
                        ? hardwareTelemetry.notes
                        : [
                            "The desktop app samples CPU utilization locally and does not use privileged macOS APIs.",
                          ]
                      ).map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-900/80">
                  <div
                    className={`h-full rounded-full ${cpuSensor?.utilizationPercent !== null ? "bg-gradient-to-r from-teal-400 to-purple-500" : "bg-slate-700"}`}
                    style={{
                      width:
                        cpuSensor?.utilizationPercent !== null
                          ? `${Math.max(4, Math.min(cpuSensor?.utilizationPercent ?? 0, 100))}%`
                          : "18%",
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  <div>
                    Temp{" "}
                    {formatTelemetryTemperature(
                      cpuSensor?.temperatureCelsius ?? null,
                    )}
                  </div>
                  <span>•</span>
                  <span>
                    {cpuSensor?.logicalCores
                      ? `${cpuSensor.logicalCores} logical cores`
                      : "No core map"}
                  </span>
                  <span>•</span>
                  <span>
                    Sampled{" "}
                    {formatTelemetryTimestamp(
                      hardwareTelemetry?.sampledAtEpochMs ?? 0,
                    )}
                  </span>
                </div>
              </div>
            </GlassCard>
          </section>

          <section>
            <GlassCard title="Run Analytics" icon={Activity} glow>
              <div className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      One chart, two signals: persisted experiments and traced
                      token usage.
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {analyticsRange === "daily"
                        ? "Daily buckets for the past week"
                        : analyticsRange === "weekly"
                          ? "Weekly buckets for the past two months"
                          : "Monthly buckets for the past year"}
                    </div>
                  </div>
                  <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
                    {(
                      [
                        ["daily", "7D"],
                        ["weekly", "8W"],
                        ["monthly", "12M"],
                      ] as const
                    ).map(([range, label]) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setAnalyticsRange(range)}
                        className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${analyticsRange === range ? "bg-purple-500/15 text-purple-200" : "text-slate-500 hover:text-slate-300"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <AreaComparisonChart buckets={selectedAnalytics} />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      <div className="h-2 w-2 rounded-full bg-teal-400" />
                      Experiments in window
                    </div>
                    <div className="mt-2 text-2xl font-black tracking-tight text-white">
                      {selectedAnalyticsTotals.experiments}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      <div className="h-2 w-2 rounded-full bg-purple-400" />
                      Token usage in window
                    </div>
                    <div className="mt-2 text-2xl font-black tracking-tight text-white">
                      {formatTokenUsage(selectedAnalyticsTotals.tokenUsage)}
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          </section>

          <section
            id="console-section"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <div className="lg:col-span-9 space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
                <GlassCard
                  title={metricPanel.title}
                  icon={Activity}
                  className="h-full"
                >
                  <div className="flex h-full flex-col justify-between">
                    <div>
                      {metricPanel.points.length > 0 ? (
                        <RadarChart values={metricPanel.points} />
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                          No configured metrics available yet.
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 text-center">
                        {metricPanel.subtitle}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] uppercase font-black tracking-[0.14em] text-slate-500">
                        {metricPanel.labels.map((label) => (
                          <div key={label} className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                            {label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard
                  title="Council Roster"
                  icon={Cpu}
                  glow={Boolean(state?.engineRunning)}
                  className="xl:col-span-2 h-full"
                >
                  <div className="relative h-full p-4 rounded-lg bg-slate-950/50 border border-white/5 space-y-4">
                    {councilEntries.length > 0 ? (
                      councilEntries.map((entry, index) => (
                        <div
                          key={entry.title}
                          className={
                            index === 0
                              ? "flex items-start gap-4"
                              : "flex items-start gap-4 border-t border-white/5 pt-4"
                          }
                        >
                          <div
                            className={`w-8 h-8 rounded flex items-center justify-center shrink-0 border ${entry.accent === "purple" ? "bg-purple-500/20 border-purple-500/40" : entry.accent === "slate" ? "bg-slate-500/20 border-slate-500/40" : "bg-teal-500/20 border-teal-500/40"}`}
                          >
                            {entry.accent === "purple" ? (
                              <ZapOff size={16} className="text-purple-300" />
                            ) : entry.accent === "slate" ? (
                              <Terminal size={16} className="text-slate-300" />
                            ) : (
                              <Sparkles size={16} className="text-teal-300" />
                            )}
                          </div>
                          <div className="space-y-1">
                            <p
                              className={`text-xs font-black uppercase tracking-[0.18em] ${entry.accent === "purple" ? "text-purple-300" : entry.accent === "slate" ? "text-slate-300" : "text-teal-300"}`}
                            >
                              {entry.title}
                            </p>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                              {entry.subtitle}
                            </p>
                            <p className="text-sm text-slate-300 leading-relaxed">
                              {entry.copy}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                        Load a blueprint to inspect the configured council
                        agents.
                      </div>
                    )}

                    {state?.engineRunning ? (
                      <div className="absolute top-2 right-2">
                        <div className="flex items-center gap-2 px-2 py-1 rounded bg-teal-500/10 border border-teal-500/20 text-[10px] text-teal-300 font-black uppercase tracking-[0.16em] animate-pulse">
                          <Activity size={10} /> Active Reasoning
                        </div>
                      </div>
                    ) : null}
                  </div>
                </GlassCard>
              </div>

              <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                <div className="flex border-b border-slate-800">
                  {[
                    { id: "history", label: "History", icon: History },
                    { id: "diff", label: "Diff View", icon: Terminal },
                    { id: "logs", label: "Logs", icon: Activity },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() =>
                        setActiveTab(id as "history" | "diff" | "logs")
                      }
                      className={`px-6 py-3 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${activeTab === id ? "text-teal-300 bg-white/5 border-b border-purple-400" : "text-slate-500 hover:text-slate-300"}`}
                      type="button"
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-4 max-h-80 overflow-y-auto">
                  {activeTab === "history" ? (
                    history.length > 0 ? (
                      <table className="w-full text-left text-xs">
                        <tbody className="divide-y divide-white/5">
                          {history.map((entry) => (
                            <tr
                              key={entry.experimentId}
                              className="hover:bg-white/5 group"
                            >
                              <td className="p-4 font-mono text-slate-400">
                                #exp-{entry.experimentId}
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-bold">
                                    {entry.score.toFixed(2)}
                                  </span>
                                  <span
                                    className={
                                      entry.delta >= 0
                                        ? "text-teal-300"
                                        : "text-rose-400"
                                    }
                                  >
                                    {entry.delta >= 0 ? "+" : ""}
                                    {entry.delta.toFixed(2)}
                                  </span>
                                </div>
                              </td>
                              <td className="p-4">
                                <Badge color={entry.promoted ? "blue" : "rose"}>
                                  {entry.promoted ? "Promoted" : "Rejected"}
                                </Badge>
                              </td>
                              <td className="p-4 text-slate-500 italic truncate max-w-[180px]">
                                {entry.summary}
                              </td>
                              <td className="p-4 text-right">
                                <ArrowUpRight
                                  size={14}
                                  className="text-slate-700 group-hover:text-teal-300 transition-colors inline"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                        No persisted experiments yet. Start the engine to
                        populate real history rows.
                      </div>
                    )
                  ) : activeTab === "diff" ? (
                    latestProposal ? (
                      <div className="space-y-4 font-mono text-[11px] text-slate-500 leading-loose">
                        <div>
                          <div className="text-white font-bold">
                            Latest proposal #{latestProposal.id}
                          </div>
                          <div className="text-slate-400 not-italic font-sans text-sm mt-1">
                            {latestProposal.summary}
                          </div>
                        </div>
                        {latestProposal.file_patches.length === 0 ? (
                          <div>Waiting for persisted proposal patch data.</div>
                        ) : (
                          latestProposal.file_patches.map((patch) => (
                            <div key={`${patch.path}-${patch.operation}`}>
                              <div className="text-white">
                                {patch.operation.toUpperCase()} {patch.path}
                              </div>
                              {buildPatchPreview(patch)
                                .slice(0, 8)
                                .map((previewLine, index) => (
                                  <div
                                    key={`${previewLine.line}-${index}`}
                                    className={previewLine.color}
                                  >
                                    {previewLine.line}
                                  </div>
                                ))}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] text-slate-500 leading-loose">
                        Waiting for persisted proposal patch data in SQLite.
                      </div>
                    )
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => void openLogFile()}
                          className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all"
                          type="button"
                        >
                          Open Log File
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 leading-loose space-y-1">
                        {state?.logs.length ? (
                          state.logs
                            .slice()
                            .reverse()
                            .slice(0, 12)
                            .map((line, index) => (
                              <div key={`${line}-${index}`}>{line}</div>
                            ))
                        ) : (
                          <div>
                            Waiting for tracing output in {state?.logPath}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch">
                <GlassCard
                  title="Hardware Heat"
                  icon={Flame}
                  className="h-full"
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3">
                      {[
                        {
                          label: "GPU",
                          sensor: hardwareTelemetry?.gpu ?? null,
                        },
                        {
                          label: "NPU",
                          sensor: hardwareTelemetry?.npu ?? null,
                        },
                      ].map(({ label, sensor }) => {
                        const utilization = sensor?.utilizationPercent ?? null;

                        return (
                          <div
                            key={label}
                            className="rounded-lg border border-white/10 bg-white/5 px-4 py-4"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                  {label}
                                </div>
                                <div className="mt-1 text-2xl font-black tracking-tight text-white">
                                  {formatTelemetryPercent(utilization)}
                                </div>
                              </div>
                              <Badge
                                color={telemetryBadgeColor(
                                  sensor?.status ?? "unavailable",
                                )}
                              >
                                {sensor?.status ?? "unavailable"}
                              </Badge>
                            </div>

                            <div className="mt-3 h-2 rounded-full bg-slate-900/80 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${utilization !== null ? "bg-gradient-to-r from-teal-400 to-purple-500" : "bg-slate-700"}`}
                                style={{
                                  width:
                                    utilization !== null
                                      ? `${Math.max(4, Math.min(utilization, 100))}%`
                                      : "18%",
                                }}
                              />
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              <span>
                                Temp{" "}
                                {formatTelemetryTemperature(
                                  sensor?.temperatureCelsius ?? null,
                                )}
                              </span>
                              <span>
                                {sensor?.logicalCores
                                  ? `${sensor.logicalCores} logical cores`
                                  : "No core map"}
                              </span>
                            </div>

                            <p className="mt-3 text-xs leading-relaxed text-slate-400">
                              {sensor?.statusDetail ??
                                "Telemetry is unavailable for this device."}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-lg border border-teal-500/10 bg-slate-950/50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                        <span>
                          Sampled{" "}
                          {formatTelemetryTimestamp(
                            hardwareTelemetry?.sampledAtEpochMs ?? 0,
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          {hardwareTelemetry?.platform ?? "unknown platform"}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-slate-400">
                        {(hardwareTelemetry?.notes.length
                          ? hardwareTelemetry.notes
                          : [
                              "Persisted experiment scores, timings, proposal diffs, and inferred token usage remain available even when sensor data is partial.",
                            ]
                        ).map((note) => (
                          <p key={note}>{note}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard
                  title="Research Evidence"
                  icon={Search}
                  className="h-full"
                >
                  {latestResearchExperiment?.research ? (
                    <div className="flex h-full flex-col gap-4">
                      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge color="blue">
                            Experiment #{latestResearchExperiment.id}
                          </Badge>
                          <Badge
                            color={
                              latestResearchExperiment.research.sources.some(
                                (source) => source.verified,
                              )
                                ? "emerald"
                                : "rose"
                            }
                          >
                            {
                              latestResearchExperiment.research.sources.filter(
                                (source) => source.verified,
                              ).length
                            }
                            /{latestResearchExperiment.research.sources.length}{" "}
                            verified
                          </Badge>
                          <Badge color="slate">
                            {
                              new Set(
                                latestResearchExperiment.research.sources
                                  .map((source) => source.host)
                                  .filter((host): host is string =>
                                    Boolean(host),
                                  ),
                              ).size
                            }{" "}
                            hosts
                          </Badge>
                        </div>
                        <div className="mt-3 text-sm text-slate-300">
                          {latestResearchExperiment.proposal_summary ||
                            "No research summary recorded."}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          Captured{" "}
                          {formatExperimentTimestamp(
                            latestResearchExperiment.created_at,
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-slate-950/60">
                          <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                            Sources
                          </div>
                          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
                            {latestResearchExperiment.research.sources.map(
                              (source) => (
                                <div
                                  key={`${source.url}-${source.label ?? ""}`}
                                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-slate-100">
                                        {source.title ||
                                          source.label ||
                                          formatSourceHost(source)}
                                      </div>
                                      <div className="mt-1 truncate text-[11px] uppercase tracking-widest text-slate-500">
                                        {formatSourceHost(source)}
                                      </div>
                                    </div>
                                    <Badge
                                      color={
                                        source.verified ? "emerald" : "rose"
                                      }
                                    >
                                      {source.verified ? "Verified" : "Failed"}
                                    </Badge>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Badge color="slate">
                                      {source.citationCount} citations
                                    </Badge>
                                    {source.statusCode !== null ? (
                                      <Badge color="slate">
                                        HTTP {source.statusCode}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {source.fetchError ? (
                                    <div className="mt-3 text-xs leading-relaxed text-rose-300">
                                      {source.fetchError}
                                    </div>
                                  ) : null}
                                </div>
                              ),
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-slate-950/60">
                          <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                            Citations
                          </div>
                          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
                            {latestResearchExperiment.research.citations.map(
                              (citation) => (
                                <div
                                  key={`${citation.filePath}-${citation.lineNumber}-${citation.sourceUrl}`}
                                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge color="blue">
                                      {citation.filePath}
                                    </Badge>
                                    <Badge color="slate">
                                      Line {citation.lineNumber}
                                    </Badge>
                                    {citation.label ? (
                                      <Badge color="emerald">
                                        {citation.label}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="mt-3 text-sm leading-relaxed text-slate-300">
                                    {citation.snippet}
                                  </div>
                                  <div className="mt-3 truncate font-mono text-[11px] text-slate-500">
                                    {citation.sourceUrl}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                      No persisted research evidence is available yet. Run a
                      research blueprint to inspect verified sources and
                      citation snippets here.
                    </div>
                  )}
                </GlassCard>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-6 self-start pb-2">
              <GlassCard title="Active Blueprint" icon={FileText}>
                <div className="bg-slate-950/80 p-4 rounded-lg border border-white/5 border-l border-l-purple-500/35 font-mono text-[10px] text-slate-400 mb-4 leading-relaxed relative overflow-hidden whitespace-pre-wrap">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Terminal size={40} />
                  </div>
                  {blueprintSummary}
                </div>
                {activeBlueprintOption ? (
                  <div className="mb-4 rounded-lg border border-white/5 bg-white/5 px-3 py-3 text-xs text-slate-400 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-200">
                        {activeBlueprintOption.fileName}
                      </div>
                      <Badge color="blue">Active</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {activeBlueprintOption.language ? (
                        <Badge color="slate">
                          {formatBlueprintGroup(activeBlueprintOption.language)}
                        </Badge>
                      ) : null}
                      {activeBlueprintOption.version ? (
                        <Badge color="emerald">
                          v{activeBlueprintOption.version}
                        </Badge>
                      ) : null}
                      {activeBlueprintOption.councilSize !== null ? (
                        <Badge color="slate">
                          {activeBlueprintOption.councilSize} agents
                        </Badge>
                      ) : null}
                      {activeBlueprintOption.metricCount !== null ? (
                        <Badge color="slate">
                          {activeBlueprintOption.metricCount} metrics
                        </Badge>
                      ) : null}
                      {activeBlueprintOption.maxIterations !== null ? (
                        <Badge color="slate">
                          {activeBlueprintOption.maxIterations} loops
                        </Badge>
                      ) : null}
                    </div>
                    <div>
                      {activeBlueprintOption.description ||
                        "No blueprint description provided."}
                    </div>
                    {activeBlueprintOption.repoPath ? (
                      <div className="truncate text-[11px] text-slate-500">
                        Repo: {activeBlueprintOption.repoPath}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={openBlueprintWizard}
                    className="w-full py-2 bg-gradient-to-r from-teal-500 to-purple-500 hover:brightness-110 border border-teal-300/20 rounded-lg text-xs font-black tracking-[0.16em] text-slate-950 transition-all flex items-center justify-center gap-2"
                    type="button"
                    disabled={state?.engineRunning}
                  >
                    <Layers size={14} />
                    CREATE WITH WIZARD
                  </button>
                  <button
                    onClick={() => void selectBlueprint()}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                    type="button"
                    disabled={state?.engineRunning}
                  >
                    <Settings size={14} />
                    SELECT BLUEPRINT
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void openBlueprintFile()}
                      className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                      type="button"
                    >
                      <FileText size={14} />
                      OPEN FILE
                    </button>
                    <button
                      onClick={() => void openBlueprintDirectory()}
                      className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                      type="button"
                    >
                      <FolderOpen size={14} />
                      OPEN FOLDER
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                  The wizard is the default path for creating a valid starter
                  blueprint. Power users can still load or hand-edit
                  <span className="font-mono"> .toml </span>
                  files directly.
                </p>
              </GlassCard>

              <GlassCard
                title="Persisted Stack"
                icon={Layers}
                className="h-full min-h-[18rem]"
              >
                <div className="flex h-full flex-col">
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      {
                        label: "Experiments",
                        value: state?.experiments.length ?? 0,
                      },
                      {
                        label: "Proposals",
                        value: state?.proposals.length ?? 0,
                      },
                      {
                        label: "Logs",
                        value: state?.logs.length ?? 0,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-lg border border-white/5 bg-white/5 px-3 py-3"
                      >
                        <div className="text-lg font-bold text-white">
                          {item.value}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          {item.label}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 mt-auto">
                    {[
                      {
                        id: "history" as const,
                        label: "Open History",
                        copy: "Review promoted and rejected persisted experiments.",
                      },
                      {
                        id: "diff" as const,
                        label: "Open Diff View",
                        copy: "Inspect the latest persisted proposal patches.",
                      },
                      {
                        id: "logs" as const,
                        label: "Open Logs",
                        copy: "Jump to recent runtime output and log-file actions.",
                      },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.id);
                          scrollToSection("console-section");
                        }}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition-all"
                      >
                        <div className="text-xs font-bold uppercase tracking-widest text-white">
                          {item.label}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.copy}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </GlassCard>

              <GlassCard title="Updates" icon={RefreshCw}>
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-100">
                        v{state?.updater.currentVersion ?? "0.0.0"}
                      </div>
                      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                        {state?.updater.channel ?? "stable"} channel
                      </div>
                    </div>
                    <Badge
                      color={state?.updater.configured ? "emerald" : "rose"}
                    >
                      {state?.updater.configured ? "Ready" : "Unconfigured"}
                    </Badge>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-400">
                    {state?.updater.configured ? (
                      <>
                        Manifest
                        <div className="mt-2 truncate font-mono text-[11px] text-slate-500">
                          {state.updater.endpoint}
                        </div>
                      </>
                    ) : (
                      <>
                        Set MAABARIUM_UPDATE_BASE_URL or
                        MAABARIUM_UPDATE_MANIFEST_URL plus
                        MAABARIUM_UPDATE_PUBKEY to enable in-app updates.
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => void checkForUpdates()}
                      disabled={checkingForUpdates}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                        <RefreshCw
                          size={14}
                          className={checkingForUpdates ? "animate-spin" : ""}
                        />
                        {checkingForUpdates ? "Checking..." : "Check Updates"}
                      </div>
                    </button>

                    {updateCheck?.available ? (
                      <button
                        type="button"
                        onClick={() => void installAvailableUpdate()}
                        disabled={installingUpdate}
                        className="w-full rounded-lg border border-teal-400/25 bg-gradient-to-r from-teal-500/15 to-purple-500/15 px-3 py-3 text-left hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                          <Download size={14} />
                          {installingUpdate
                            ? "Installing..."
                            : `Install ${updateCheck.version}`}
                        </div>
                      </button>
                    ) : null}
                  </div>

                  {updateCheck ? (
                    <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3 text-xs text-slate-400 space-y-2">
                      {updateCheck.available ? (
                        <>
                          <div className="font-semibold text-slate-100">
                            Update {updateCheck.version} is available
                          </div>
                          {updateCheck.date ? (
                            <div>
                              {formatExperimentTimestamp(updateCheck.date)}
                            </div>
                          ) : null}
                          {updateCheck.body ? (
                            <div className="leading-relaxed text-slate-300">
                              {updateCheck.body}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div>
                          No newer desktop release is available right now.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            </div>
          </section>

          <section id="blueprint-section" className="pt-2">
            <GlassCard title="Workflow Library" icon={FileText} glow>
              <div className="space-y-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      Load runnable workflows or hydrate setup-required
                      templates without leaving the main console.
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {filteredBlueprints.length}/
                      {state?.availableBlueprints.length ?? 0} visible
                      {switchingBlueprintPath
                        ? " • applying selection"
                        : state?.engineRunning
                          ? " • stop the engine to switch"
                          : ""}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
                      {(["detailed", "compact"] as const).map((density) => (
                        <button
                          key={density}
                          type="button"
                          onClick={() => setBlueprintDensity(density)}
                          className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${blueprintDensity === density ? "bg-purple-500/15 text-purple-200" : "text-slate-500 hover:text-slate-300"}`}
                        >
                          {density}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={openBlueprintWizard}
                      disabled={state?.engineRunning}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-purple-500 hover:brightness-110 border border-teal-300/20 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Create With Wizard
                    </button>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-2 focus-within:border-teal-400/60 transition xl:min-w-[22rem]">
                      <Search size={14} className="text-slate-500" />
                      <input
                        value={blueprintQuery}
                        onChange={(event) =>
                          setBlueprintQuery(event.target.value)
                        }
                        placeholder="Search name, file, path, repo, version"
                        className="w-full bg-transparent border-0 outline-none text-sm text-slate-200 placeholder:text-slate-600"
                        type="search"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">
                    <SlidersHorizontal size={12} />
                    Filter
                  </div>
                  <button
                    type="button"
                    onClick={() => setBlueprintLanguageFilter("all")}
                    className={`px-2 py-1 rounded-md border text-[10px] font-black uppercase tracking-[0.18em] transition shrink-0 ${blueprintLanguageFilter === "all" ? "border-purple-400/40 bg-purple-500/10 text-purple-200" : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300"}`}
                  >
                    All
                  </button>
                  {blueprintLanguageOptions.map((language) => (
                    <button
                      key={language}
                      type="button"
                      onClick={() => setBlueprintLanguageFilter(language)}
                      className={`px-2 py-1 rounded-md border text-[10px] font-black uppercase tracking-[0.18em] transition shrink-0 ${blueprintLanguageFilter === language ? "border-purple-400/40 bg-purple-500/10 text-purple-200" : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300"}`}
                    >
                      {language}
                    </button>
                  ))}
                </div>

                {activeBlueprintFilters.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeBlueprintFilters.map((filter) => (
                      <Badge key={filter} color="slate">
                        {filter}
                      </Badge>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setBlueprintQuery("");
                        setBlueprintLanguageFilter("all");
                      }}
                      className="px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200 transition"
                    >
                      Clear Filters
                    </button>
                  </div>
                ) : null}

                {groupedBlueprints.length > 0 ? (
                  <div className="max-h-[58rem] space-y-5 overflow-y-auto pr-1">
                    {groupedBlueprints.map((group) => {
                      const isCollapsed = Boolean(
                        collapsedBlueprintGroups[group.group],
                      );

                      return (
                        <div key={group.group} className="space-y-3">
                          <div className="flex items-center justify-between gap-3 px-1">
                            <button
                              type="button"
                              onClick={() => toggleBlueprintGroup(group.group)}
                              className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300 transition"
                            >
                              {isCollapsed ? "+" : "-"} {group.group}
                            </button>
                            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                              <span>{group.blueprints.length} entries</span>
                              <span>
                                {isCollapsed ? "collapsed" : "expanded"}
                              </span>
                            </div>
                          </div>
                          {!isCollapsed ? (
                            <div
                              className={`grid grid-cols-1 gap-3 ${blueprintDensity === "compact" ? "" : "xl:grid-cols-2"}`}
                            >
                              {group.blueprints.map((blueprint) => {
                                const isSelected =
                                  blueprint.path ===
                                  (state?.blueprintPath ?? "");
                                const isSwitching =
                                  switchingBlueprintPath === blueprint.path;
                                const isDisabled =
                                  Boolean(state?.engineRunning) ||
                                  isSelected ||
                                  isSwitching ||
                                  !blueprint.isLoadable ||
                                  switchingBlueprintPath !== null;

                                return (
                                  <div
                                    key={blueprint.path}
                                    className={`w-full rounded-lg border text-left transition ${blueprintDensity === "compact" ? "px-3 py-3" : "px-4 py-4"} ${isSelected ? "border-teal-400/40 bg-teal-500/10" : !blueprint.isLoadable ? "border-rose-500/30 bg-rose-500/5" : blueprint.requiresSetup ? "border-amber-400/20 bg-amber-500/[0.04]" : "border-white/5 bg-white/[0.03] hover:border-purple-400/20 hover:bg-white/[0.06]"}`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-100 truncate">
                                          {blueprint.displayName}
                                        </div>
                                        <div className="mt-1 text-[11px] uppercase tracking-widest text-slate-500 truncate">
                                          {blueprint.fileName}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <Badge
                                          color={
                                            blueprint.libraryKind === "template"
                                              ? "rose"
                                              : "slate"
                                          }
                                        >
                                          {blueprint.libraryKind}
                                        </Badge>
                                        {blueprint.requiresSetup ? (
                                          <Badge color="rose">
                                            Setup Required
                                          </Badge>
                                        ) : null}
                                        {isSelected ? (
                                          <Badge color="blue">Loaded</Badge>
                                        ) : isSwitching ? (
                                          <Badge color="emerald">Loading</Badge>
                                        ) : !blueprint.isLoadable ? (
                                          <Badge color="rose">Invalid</Badge>
                                        ) : blueprint.isActive ? (
                                          <Badge color="emerald">Current</Badge>
                                        ) : null}
                                      </div>
                                    </div>
                                    {blueprintDensity === "detailed" ? (
                                      <>
                                        <div className="mt-2 text-xs text-slate-400 line-clamp-2">
                                          {blueprint.description ||
                                            "No blueprint description provided."}
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {blueprint.version ? (
                                            <Badge color="slate">
                                              v{blueprint.version}
                                            </Badge>
                                          ) : null}
                                          {blueprint.councilSize !== null ? (
                                            <Badge color="slate">
                                              {blueprint.councilSize} agents
                                            </Badge>
                                          ) : null}
                                          {blueprint.metricCount !== null ? (
                                            <Badge color="slate">
                                              {blueprint.metricCount} metrics
                                            </Badge>
                                          ) : null}
                                          {blueprint.targetFileCount !==
                                          null ? (
                                            <Badge color="slate">
                                              {blueprint.targetFileCount} files
                                            </Badge>
                                          ) : null}
                                          {blueprint.maxIterations !== null ? (
                                            <Badge color="slate">
                                              {blueprint.maxIterations} loops
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="mt-3 grid gap-1 text-[11px] text-slate-500">
                                          {blueprint.repoPath ? (
                                            <div className="truncate">
                                              Repo: {blueprint.repoPath}
                                            </div>
                                          ) : null}
                                          <div className="truncate">
                                            Path: {blueprint.path}
                                          </div>
                                          {!blueprint.isLoadable &&
                                          blueprint.loadError ? (
                                            <div className="text-rose-300 line-clamp-2">
                                              {blueprint.loadError}
                                            </div>
                                          ) : null}
                                        </div>
                                      </>
                                    ) : (
                                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                        {blueprint.version ? (
                                          <span>v{blueprint.version}</span>
                                        ) : null}
                                        {blueprint.language ? (
                                          <span>
                                            {formatBlueprintGroup(
                                              blueprint.language,
                                            )}
                                          </span>
                                        ) : null}
                                        {blueprint.metricCount !== null ? (
                                          <span>
                                            {blueprint.metricCount} metrics
                                          </span>
                                        ) : null}
                                        {blueprint.maxIterations !== null ? (
                                          <span>
                                            {blueprint.maxIterations} loops
                                          </span>
                                        ) : null}
                                      </div>
                                    )}

                                    <div className="mt-4 flex flex-wrap gap-2">
                                      {blueprint.requiresSetup ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openTemplateWizard(
                                              blueprint.wizardTemplate ??
                                                "custom",
                                              blueprint.displayName,
                                              blueprint.description,
                                            )
                                          }
                                          className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200 transition hover:bg-amber-500/15"
                                        >
                                          Setup Required
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void selectBlueprintFromLibrary(
                                              blueprint.path,
                                            )
                                          }
                                          disabled={isDisabled}
                                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                          {isSelected
                                            ? "Loaded"
                                            : isSwitching
                                              ? "Loading"
                                              : "Load Workflow"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                    No blueprints match the current search and filter.
                  </div>
                )}
              </div>
            </GlassCard>
          </section>

          {wizardOpen ? (
            <div className="fixed inset-0 z-[140] bg-slate-950/80 backdrop-blur-sm px-4 py-8 overflow-y-auto">
              <div className="max-w-5xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex items-start justify-between gap-6">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-purple-200">
                        Blueprint Wizard
                      </div>
                      <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                        Create a valid starter blueprint
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm text-slate-400">
                        Start from a template, generate a working TOML file in
                        the blueprints directory, and load it immediately.
                        Direct file loading stays available for manual edits.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeBlueprintWizard}
                      disabled={wizardCreating}
                      className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs font-black uppercase tracking-[0.18em] text-slate-300 hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Close
                    </button>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {(
                        [
                          "code_quality",
                          "product_builder",
                          "general_research",
                          "prompt_optimization",
                          "lora_validation",
                          "custom",
                        ] as WizardTemplate[]
                      ).map((template) => {
                        const defaults = wizardTemplateDefaults(template);
                        const active = wizardForm.template === template;

                        return (
                          <button
                            key={template}
                            type="button"
                            onClick={() =>
                              setWizardForm((current) =>
                                applyWizardTemplate(current, template),
                              )
                            }
                            className={`rounded-xl border px-4 py-4 text-left transition ${active ? "border-purple-400/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                          >
                            <div className="text-sm font-semibold text-slate-100">
                              {defaults.label}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              {defaults.description}
                            </div>
                            <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              {defaults.language} • {defaults.targetFiles[0]}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                            Blueprint Name
                          </label>
                          <input
                            value={wizardForm.name}
                            onChange={(event) =>
                              setWizardForm((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                            placeholder="my-awesome-blueprint"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                            type="text"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                            Description
                          </label>
                          <textarea
                            value={wizardForm.description}
                            onChange={(event) =>
                              setWizardForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            rows={4}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                              Repo Path
                            </label>
                            <input
                              value={wizardForm.repoPath}
                              onChange={(event) =>
                                setWizardForm((current) => ({
                                  ...current,
                                  repoPath: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                              type="text"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                              Version
                            </label>
                            <input
                              value={wizardForm.version}
                              onChange={(event) =>
                                setWizardForm((current) => ({
                                  ...current,
                                  version: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                              type="text"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                              Language
                            </label>
                            <input
                              value={wizardForm.language}
                              onChange={(event) =>
                                setWizardForm((current) => ({
                                  ...current,
                                  language: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                              type="text"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                              Min Improvement
                            </label>
                            <input
                              value={wizardForm.minImprovement}
                              onChange={(event) =>
                                setWizardForm((current) => ({
                                  ...current,
                                  minImprovement: Number(event.target.value),
                                }))
                              }
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                              type="number"
                              min="0"
                              max="1"
                              step="0.01"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                            Target Files
                          </label>
                          <textarea
                            value={wizardForm.targetFilesText}
                            onChange={(event) =>
                              setWizardForm((current) => ({
                                ...current,
                                targetFilesText: event.target.value,
                              }))
                            }
                            rows={5}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                          />
                          <div className="mt-2 text-xs text-slate-500">
                            Use one glob per line or separate multiple patterns
                            with commas.
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                                Max Iterations
                              </label>
                              <input
                                value={wizardForm.maxIterations}
                                onChange={(event) =>
                                  setWizardForm((current) => ({
                                    ...current,
                                    maxIterations: Number(event.target.value),
                                  }))
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                type="number"
                                min="1"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                                Timeout Seconds
                              </label>
                              <input
                                value={wizardForm.timeoutSeconds}
                                onChange={(event) =>
                                  setWizardForm((current) => ({
                                    ...current,
                                    timeoutSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                type="number"
                                min="1"
                                step="1"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                                Council Size
                              </label>
                              <input
                                value={wizardForm.councilSize}
                                onChange={(event) =>
                                  setWizardForm((current) => ({
                                    ...current,
                                    councilSize: Number(event.target.value),
                                  }))
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                type="number"
                                min="1"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                                Debate Rounds
                              </label>
                              <input
                                value={wizardForm.debateRounds}
                                onChange={(event) =>
                                  setWizardForm((current) => ({
                                    ...current,
                                    debateRounds: Number(event.target.value),
                                  }))
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                type="number"
                                min="1"
                                step="1"
                              />
                            </div>
                          </div>

                          <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                            <input
                              checked={wizardForm.requireTestsPass}
                              onChange={(event) =>
                                setWizardForm((current) => ({
                                  ...current,
                                  requireTestsPass: event.target.checked,
                                }))
                              }
                              type="checkbox"
                              className="rounded border-white/20 bg-slate-900"
                            />
                            Require evaluator-backed test success before keeping
                            a change
                          </label>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                Metrics
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Weight total:{" "}
                                {wizardMetricWeightTotal.toFixed(2)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={addWizardMetric}
                              className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-200 hover:bg-white/10 transition"
                            >
                              Add Metric
                            </button>
                          </div>
                          <div className="space-y-3">
                            {wizardForm.metrics.map((metric, index) => (
                              <div
                                key={`${metric.name}-${index}`}
                                className="rounded-lg border border-white/10 bg-slate-950/50 p-3 space-y-3"
                              >
                                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_8rem_9rem_auto] gap-3 items-start">
                                  <input
                                    value={metric.name}
                                    onChange={(event) =>
                                      updateWizardMetric(
                                        index,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Metric name"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <input
                                    value={metric.weight}
                                    onChange={(event) =>
                                      updateWizardMetric(
                                        index,
                                        "weight",
                                        Number(event.target.value),
                                      )
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                  />
                                  <select
                                    value={metric.direction}
                                    onChange={(event) =>
                                      updateWizardMetric(
                                        index,
                                        "direction",
                                        event.target.value,
                                      )
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                  >
                                    <option value="maximize">maximize</option>
                                    <option value="minimize">minimize</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeWizardMetric(index)}
                                    disabled={wizardForm.metrics.length === 1}
                                    className="px-3 py-2 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[10px] font-bold uppercase tracking-widest text-rose-300 hover:bg-rose-500/20 transition disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={metric.description}
                                  onChange={(event) =>
                                    updateWizardMetric(
                                      index,
                                      "description",
                                      event.target.value,
                                    )
                                  }
                                  rows={2}
                                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                Agents
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Configure who participates in the council and
                                which model each agent uses.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={addWizardAgent}
                              className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-200 hover:bg-white/10 transition"
                            >
                              Add Agent
                            </button>
                          </div>
                          <div className="space-y-3">
                            {wizardForm.agents.map((agent, index) => (
                              <div
                                key={`${agent.name}-${index}`}
                                className="rounded-lg border border-white/10 bg-slate-950/50 p-3 space-y-3"
                              >
                                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] gap-3 items-start">
                                  <input
                                    value={agent.name}
                                    onChange={(event) =>
                                      updateWizardAgent(
                                        index,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Agent name"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <input
                                    value={agent.role}
                                    onChange={(event) =>
                                      updateWizardAgent(
                                        index,
                                        "role",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Role"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <select
                                    value={agent.model}
                                    onChange={(event) =>
                                      updateWizardAgent(
                                        index,
                                        "model",
                                        event.target.value,
                                      )
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                  >
                                    {wizardModelNames.map((modelName) => (
                                      <option key={modelName} value={modelName}>
                                        {modelName}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeWizardAgent(index)}
                                    disabled={wizardForm.agents.length === 1}
                                    className="px-3 py-2 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[10px] font-bold uppercase tracking-widest text-rose-300 hover:bg-rose-500/20 transition disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={agent.systemPrompt}
                                  onChange={(event) =>
                                    updateWizardAgent(
                                      index,
                                      "systemPrompt",
                                      event.target.value,
                                    )
                                  }
                                  rows={3}
                                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                Models
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Add one or more backends and choose how the
                                runtime assigns them.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={addWizardModel}
                              className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-200 hover:bg-white/10 transition"
                            >
                              Add Model
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">
                                Model Assignment
                              </label>
                              <select
                                value={wizardForm.modelAssignment}
                                onChange={(event) =>
                                  setWizardForm((current) => ({
                                    ...current,
                                    modelAssignment: event.target.value as
                                      | "explicit"
                                      | "round_robin",
                                  }))
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                              >
                                <option value="explicit">explicit</option>
                                <option value="round_robin">round_robin</option>
                              </select>
                            </div>
                            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-3 text-xs text-slate-300">
                              Use explicit when each agent should pin to a
                              specific model. Use round-robin to spread requests
                              across the configured model list.
                            </div>
                          </div>
                          <div className="space-y-3">
                            {wizardForm.models.map((model, index) => (
                              <div
                                key={`${model.name}-${index}`}
                                className="rounded-lg border border-white/10 bg-slate-950/50 p-3 space-y-3"
                              >
                                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_auto] gap-3 items-start">
                                  <input
                                    value={model.name}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Model name"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <input
                                    value={model.provider}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "provider",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Provider"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeWizardModel(index)}
                                    disabled={wizardForm.models.length === 1}
                                    className="px-3 py-2 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[10px] font-bold uppercase tracking-widest text-rose-300 hover:bg-rose-500/20 transition disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <input
                                    value={model.endpoint}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "endpoint",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Endpoint"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <input
                                    value={model.apiKeyEnv}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "apiKeyEnv",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="API key env var (optional)"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="text"
                                  />
                                  <input
                                    value={model.temperature}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "temperature",
                                        Number(event.target.value),
                                      )
                                    }
                                    placeholder="Temperature"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                  />
                                  <input
                                    value={model.maxTokens}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "maxTokens",
                                        Number(event.target.value),
                                      )
                                    }
                                    placeholder="Max tokens"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60"
                                    type="number"
                                    min="1"
                                    step="1"
                                  />
                                  <input
                                    value={model.requestsPerMinute}
                                    onChange={(event) =>
                                      updateWizardModel(
                                        index,
                                        "requestsPerMinute",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Requests per minute"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60 md:col-span-2"
                                    type="text"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 py-4 text-sm text-slate-300">
                          The wizard now writes exactly the metrics, agents, and
                          model pool you configure here, while still generating
                          a valid TOML blueprint that loads immediately.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-6 py-4 border-t border-white/5 bg-white/[0.03] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-xs text-slate-500">
                      The generated file is saved in the workspace blueprints
                      directory and becomes the active blueprint.
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={closeBlueprintWizard}
                        disabled={wizardCreating}
                        className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-xs font-black uppercase tracking-[0.18em] text-slate-300 hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void createBlueprintFromWizard()}
                        disabled={wizardCreating || state?.engineRunning}
                        className="px-4 py-2 rounded-lg border border-teal-300/20 bg-gradient-to-r from-teal-500 to-purple-500 text-xs font-black uppercase tracking-[0.18em] text-slate-950 hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {wizardCreating ? "Creating..." : "Create Blueprint"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-8 text-[11px] text-slate-500 flex flex-wrap gap-4">
          <span>Blueprint: {state?.blueprintPath ?? "loading"}</span>
          <span>Database: {state?.dbPath ?? "loading"}</span>
          <span>Logs: {state?.logPath ?? "loading"}</span>
        </div>
      </main>
    </div>
  );
}
