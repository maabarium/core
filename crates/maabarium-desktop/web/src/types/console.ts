export type MetricDef = {
  name: string;
  weight: number;
  direction: string;
  description: string;
};

export type MetricScore = {
  name: string;
  value: number;
  weight: number;
};

export type ResearchSource = {
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

export type ResearchCitation = {
  filePath: string;
  sourceUrl: string;
  label: string | null;
  lineNumber: number;
  snippet: string;
};

export type ResearchArtifacts = {
  sources: ResearchSource[];
  citations: ResearchCitation[];
};

export type AgentDef = {
  name: string;
  role: string;
  system_prompt: string;
  model: string;
};

export type ModelDef = {
  name: string;
  provider: string;
  endpoint: string;
  api_key_env?: string | null;
  temperature: number;
  max_tokens: number;
  requests_per_minute?: number | null;
};

export type BlueprintFile = {
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

export type PersistedExperiment = {
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

export type FilePatch = {
  path: string;
  operation: "Create" | "Modify" | "Delete" | string;
  content?: string | null;
};

export type PersistedProposal = {
  id: number;
  experiment_id: number;
  summary: string;
  created_at: string;
  file_patches: FilePatch[];
};

export type AnalyticsBucket = {
  label: string;
  experiments: number;
  tokenUsage: number;
};

export type RunAnalytics = {
  daily: AnalyticsBucket[];
  weekly: AnalyticsBucket[];
  monthly: AnalyticsBucket[];
};

export type UpdaterConfigurationState = {
  currentVersion: string;
  channel: string;
  endpoint: string | null;
  configured: boolean;
};

export type UpdateCheckResult = {
  currentVersion: string;
  channel: string;
  endpoint: string | null;
  configured: boolean;
  available: boolean;
  version: string | null;
  date: string | null;
  body: string | null;
};

export type InstallUpdateResult = {
  installed: boolean;
  version: string | null;
  shouldRestart: boolean;
};

export type AnalyticsRange = "daily" | "weekly" | "monthly";

export type ConsoleTab = "history" | "diff" | "logs";

export type HardwareSensorStatus = "live" | "partial" | "unavailable";

export type HardwareSensor = {
  status: HardwareSensorStatus;
  utilizationPercent: number | null;
  temperatureCelsius: number | null;
  logicalCores: number | null;
  statusDetail: string;
};

export type HardwareTelemetry = {
  sampledAtEpochMs: number;
  platform: string;
  cpu: HardwareSensor;
  gpu: HardwareSensor;
  npu: HardwareSensor;
  notes: string[];
};

export type HistoryRow = {
  experimentId: number;
  score: number;
  delta: number;
  summary: string;
  promoted: boolean;
};

export type CouncilEntry = {
  title: string;
  subtitle: string;
  copy: string;
  accent: "teal" | "amber" | "slate";
};

export type WizardTemplate =
  | "code_quality"
  | "prompt_optimization"
  | "product_builder"
  | "general_research"
  | "lora_validation"
  | "custom";

export type AvailableBlueprint = {
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
};

export type ConsoleState = {
  engineRunning: boolean;
  blueprintPath: string;
  dbPath: string;
  logPath: string;
  hardwareTelemetry: HardwareTelemetry | null;
  blueprint: BlueprintFile | null;
  blueprintError: string | null;
  evaluatorKind: string | null;
  availableBlueprints: AvailableBlueprint[];
  runAnalytics: RunAnalytics;
  updater: UpdaterConfigurationState;
  experiments: PersistedExperiment[];
  proposals: PersistedProposal[];
  logs: string[];
};

export type BlueprintWizardRequest = {
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

export type WizardMetricForm = {
  name: string;
  weight: number;
  direction: "maximize" | "minimize";
  description: string;
};

export type WizardAgentForm = {
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
};

export type WizardModelForm = {
  name: string;
  provider: string;
  endpoint: string;
  apiKeyEnv: string;
  temperature: number;
  maxTokens: number;
  requestsPerMinute: string;
};

export type BlueprintWizardForm = {
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
