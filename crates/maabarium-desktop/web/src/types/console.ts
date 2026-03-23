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

export type ResearchQueryTrace = {
  provider: string;
  queryText: string;
  resultCount: number;
  topUrls: string[];
  latencyMs: number;
  executedAt: string;
  error: string | null;
};

export type ResearchArtifacts = {
  sources: ResearchSource[];
  citations: ResearchCitation[];
  queryTraces: ResearchQueryTrace[];
};

export type LoraStageArtifact = {
  name: string;
  command: string;
  args: string[];
  workingDir: string;
  timeoutSeconds: number;
  expectedArtifacts: string[];
  verifiedArtifacts: string[];
};

export type LoraArtifacts = {
  trainer: string;
  baseModel: string;
  dataset: string;
  adapterPath: string;
  outputDir: string | null;
  evalCommand: string | null;
  epochs: number | null;
  learningRate: number | null;
  adapterRatio: number;
  metadataRatio: number;
  reproducibilityRatio: number;
  trainerSignal: number;
  executionSignal: number;
  sandboxFileCount: number;
  sandboxTotalBytes: number;
  stages: LoraStageArtifact[];
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
  lora: LoraArtifacts | null;
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

export type PluginRuntimeStatus = "ready" | "needs_attention";

export type PluginRuntimeState = {
  pluginId: string;
  displayName: string | null;
  manifestPath: string;
  command: string | null;
  args: string[];
  workingDir: string | null;
  timeoutSeconds: number | null;
  environmentKeys: string[];
  status: PluginRuntimeStatus;
  summary: string;
  error: string | null;
};

export type InstallUpdateResult = {
  installed: boolean;
  version: string | null;
  shouldRestart: boolean;
};

export type RuntimeStrategy = "local" | "remote" | "mixed";

export type RemoteProviderSetup = {
  providerId: string;
  label: string;
  endpoint: string | null;
  modelName: string | null;
  fallbackOnly: boolean;
  configured: boolean;
};

export type DesktopSetupState = {
  guidedMode: boolean;
  onboardingCompleted: boolean;
  runtimeStrategy: RuntimeStrategy | null;
  workspacePath: string | null;
  selectedLocalModels: string[];
  remoteProviders: RemoteProviderSetup[];
  preferredUpdateChannel: string | null;
  remindLaterUntil: string | null;
  remindLaterVersion: string | null;
  lastSetupCompletedAt: string | null;
};

export type ReadinessStatus = "ready" | "needs_attention" | "optional";

export type ReadinessItem = {
  id: string;
  title: string;
  status: ReadinessStatus;
  summary: string;
  actionLabel: string;
  lastCheckedAtEpochMs: number;
};

export type OllamaModelInfo = {
  name: string;
  sizeLabel: string | null;
  modifiedAt: string | null;
};

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  commandAvailable: boolean;
  launchAtLoginSupported: boolean;
  installCommand: string | null;
  startCommand: string | null;
  statusDetail: string;
  models: OllamaModelInfo[];
  recommendedModels: string[];
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
  pluginRuntime: PluginRuntimeState | null;
  availableBlueprints: AvailableBlueprint[];
  runAnalytics: RunAnalytics;
  updater: UpdaterConfigurationState;
  desktopSetup: DesktopSetupState;
  readinessItems: ReadinessItem[];
  ollama: OllamaStatus;
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
