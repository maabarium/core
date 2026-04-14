import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, LoaderCircle, Wrench } from "lucide-react";
import type {
  CliLinkState,
  DesktopSetupState,
  GitDependencyState,
  OllamaStatus,
  PluginRuntimeState,
  ProfileConfig,
  ProviderValidationResult,
  ReadinessItem,
  ResearchSearchMode,
  RemoteProviderSetup,
  RuntimeStrategy,
  WorkspaceAnalysis,
  WorkspaceGitStatus,
} from "../../types/console";
import { listOllamaModelNames } from "../../lib/ollama";
import { Badge } from "../ui/Badge";

type ProviderModelSuggestion = {
  label: string;
  value: string;
};

const REMOTE_PROVIDER_MODEL_SUGGESTIONS: Record<
  string,
  ProviderModelSuggestion[]
> = {
  anthropic: [
    { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
    { label: "Claude Opus 4.1", value: "claude-opus-4-1" },
  ],
  gemini: [
    { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
    { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  ],
};

const GUIDED_DEFAULT_RESEARCH_SEARCH_MODE: ResearchSearchMode =
  "duckduckgo_scrape";

function uniqueModelNames(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );
}

type DesktopSetupModalProps = {
  isOpen: boolean;
  setupState: DesktopSetupState;
  readinessItems: ReadinessItem[];
  gitDependency: GitDependencyState;
  cliLink: CliLinkState;
  ollama: OllamaStatus | null;
  pluginRuntime: PluginRuntimeState | null;
  saving: boolean;
  onClose: () => void;
  onInspectWorkspace: (path: string) => Promise<WorkspaceGitStatus | null>;
  onSave: (
    nextSetup: DesktopSetupState,
    apiKeys: Record<string, string>,
  ) => Promise<void>;
  onInstallGit: () => Promise<void>;
  onInstallCliLink: () => Promise<void>;
  onRemoveCliLink: () => Promise<void>;
  onInstallOllama: () => Promise<void>;
  onStartOllama: () => Promise<void>;
  onPullRecommendedOllamaModels: () => Promise<void>;
  onAnalyzeWorkspace: (path: string) => Promise<WorkspaceAnalysis | null>;
  onValidateProvider: (
    providerId: string,
    endpoint: string,
    apiKey?: string | null,
    testModel?: string | null,
  ) => Promise<ProviderValidationResult | null>;
  onGetRecommendedProfile: () => Promise<string | null>;
  onApplyProfile: (profileName: string) => Promise<ProfileConfig | null>;
};

export function DesktopSetupModal({
  isOpen,
  setupState,
  readinessItems,
  gitDependency,
  cliLink,
  ollama,
  pluginRuntime,
  saving,
  onClose,
  onInspectWorkspace,
  onSave,
  onInstallGit,
  onInstallCliLink,
  onRemoveCliLink,
  onInstallOllama,
  onStartOllama,
  onPullRecommendedOllamaModels,
  onAnalyzeWorkspace,
  onValidateProvider,
  onGetRecommendedProfile,
  onApplyProfile,
}: DesktopSetupModalProps) {
  const [form, setForm] = useState<DesktopSetupState>(setupState);
  const wasOpenRef = useRef(false);
  const inspectWorkspaceRef = useRef(onInspectWorkspace);
  const analyzeWorkspaceRef = useRef(onAnalyzeWorkspace);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceGitStatus | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false);
  const [pullingRecommendedModels, setPullingRecommendedModels] =
    useState(false);
  const [workspaceAnalysis, setWorkspaceAnalysis] =
    useState<WorkspaceAnalysis | null>(null);
  const [analyzingWorkspace, setAnalyzingWorkspace] = useState(false);
  const [recommendedProfile, setRecommendedProfile] = useState<string | null>(
    null,
  );
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [providerValidationResults, setProviderValidationResults] = useState<
    Record<string, ProviderValidationResult>
  >({});
  const [validatingProviderId, setValidatingProviderId] = useState<
    string | null
  >(null);
  const [openProviderModelPickerId, setOpenProviderModelPickerId] = useState<
    string | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    inspectWorkspaceRef.current = onInspectWorkspace;
  }, [onInspectWorkspace]);

  useEffect(() => {
    analyzeWorkspaceRef.current = onAnalyzeWorkspace;
  }, [onAnalyzeWorkspace]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;

    setForm(setupState);
    setApiKeys({});
    setWorkspaceStatus(null);
    setPullingRecommendedModels(false);
    setWorkspaceAnalysis(null);
    setRecommendedProfile(null);
    setApplyingProfile(false);
    setProviderValidationResults({});
    setValidatingProviderId(null);
    setOpenProviderModelPickerId(null);
    setSaveError(null);

    void onGetRecommendedProfile().then((profile) => {
      if (profile) {
        setRecommendedProfile(profile);
      }
    });
  }, [isOpen, onGetRecommendedProfile, setupState]);

  const handlePullRecommendedModels = async () => {
    if (pullingRecommendedModels) {
      return;
    }

    setPullingRecommendedModels(true);
    try {
      await onPullRecommendedOllamaModels();
    } finally {
      setPullingRecommendedModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const normalizedWorkspace = form.workspacePath?.trim() ?? "";
    if (!normalizedWorkspace) {
      setWorkspaceStatus(null);
      setInspectingWorkspace(false);
      setWorkspaceAnalysis(null);
      setAnalyzingWorkspace(false);
      return;
    }

    let cancelled = false;
    setInspectingWorkspace(true);
    setAnalyzingWorkspace(true);

    void inspectWorkspaceRef
      .current(normalizedWorkspace)
      .then((status) => {
        if (!cancelled) {
          setWorkspaceStatus(status);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInspectingWorkspace(false);
        }
      });

    void analyzeWorkspaceRef
      .current(normalizedWorkspace)
      .then((analysis) => {
        if (!cancelled) {
          setWorkspaceAnalysis(analysis);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAnalyzingWorkspace(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form.workspacePath, isOpen]);

  if (!isOpen) {
    return null;
  }

  const workspaceMissing = Boolean(
    workspaceStatus && form.workspacePath?.trim() && !workspaceStatus.exists,
  );
  const workspaceNotDirectory = Boolean(
    workspaceStatus && workspaceStatus.exists && !workspaceStatus.isDirectory,
  );
  const workspaceNeedsGitInit = Boolean(
    workspaceStatus &&
    workspaceStatus.exists &&
    workspaceStatus.isDirectory &&
    !workspaceStatus.isGitRepository,
  );
  const researchSearchReadiness =
    readinessItems.find((item) => item.id === "research_search") ?? null;
  const gitReadiness = readinessItems.find((item) => item.id === "git") ?? null;
  const cliLinkBadgeColor =
    cliLink.status === "healthy"
      ? "emerald"
      : cliLink.status === "unsupported"
        ? "slate"
        : cliLink.status === "conflict"
          ? "rose"
          : "blue";
  const cliLinkBadgeLabel =
    cliLink.status === "healthy"
      ? "Ready"
      : cliLink.status === "unsupported"
        ? "Unsupported"
        : cliLink.status === "conflict"
          ? "Blocked"
          : cliLink.status === "not_installed"
            ? "Not Installed"
            : "Needs Attention";
  const cliLinkNeedsInstallAction =
    cliLink.installationSupported &&
    (cliLink.status === "not_installed" ||
      cliLink.status === "broken" ||
      cliLink.status === "needs_refresh");
  const cliLinkCanRemove =
    cliLink.installationSupported &&
    (cliLink.status === "healthy" ||
      cliLink.status === "broken" ||
      cliLink.status === "needs_refresh");
  const cliLinkActionLabel =
    cliLink.status === "healthy"
      ? "Refresh CLI Link"
      : cliLink.status === "not_installed"
        ? "Install CLI Link"
        : "Repair CLI Link";
  const showMacPathGuidance =
    cliLink.platform === "macos" &&
    cliLink.installationSupported &&
    !cliLink.pathContainsManagedDir &&
    cliLink.managedLinkDirectory.length > 0;
  const searchMode = form.researchSearchMode;
  const isGuidedMode = form.guidedMode;
  const researchSearchOptions: Array<{
    value: ResearchSearchMode;
    label: string;
    copy: string;
  }> = [
    {
      value: "duckduckgo_scrape",
      label: "Free Scraper",
      copy: "Uses DuckDuckGo HTML scraping with no API key. It works out of the box, but results can be less stable or blocked without warning.",
    },
    {
      value: "brave_api",
      label: "Brave API",
      copy: "Uses the official Brave Search API. It is more reliable, but requires a configured API key.",
    },
  ];

  const availableModelNames = listOllamaModelNames(
    ollama,
    form.selectedLocalModels,
  );
  const recommendedModelNames = Array.from(
    new Set(
      (ollama?.recommendedModels ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const missingRecommendedModelNames = recommendedModelNames.filter(
    (modelName) =>
      !(ollama?.models.some((model) => model.name === modelName) ?? false),
  );
  const discoveredNonRecommendedModels = (ollama?.models ?? []).filter(
    (model) => !recommendedModelNames.includes(model.name),
  );
  const savedOnlyModelNames = form.selectedLocalModels.filter(
    (modelName) =>
      !recommendedModelNames.includes(modelName) &&
      !discoveredNonRecommendedModels.some((model) => model.name === modelName),
  );

  const toggleModel = (modelName: string) => {
    setForm((current) => ({
      ...current,
      selectedLocalModels: current.selectedLocalModels.includes(modelName)
        ? current.selectedLocalModels.filter((value) => value !== modelName)
        : [...current.selectedLocalModels, modelName],
    }));
  };

  const updateProvider = (
    providerId: string,
    updater: (provider: RemoteProviderSetup) => RemoteProviderSetup,
  ) => {
    setSaveError(null);
    setProviderValidationResults((current) => {
      if (!(providerId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setForm((current) => ({
      ...current,
      remoteProviders: current.remoteProviders.map((provider) =>
        provider.providerId === providerId
          ? {
              ...updater(provider),
              configured: false,
            }
          : provider,
      ),
    }));
  };

  const setProviderConfigured = (providerId: string, configured: boolean) => {
    setForm((current) => ({
      ...current,
      remoteProviders: current.remoteProviders.map((provider) =>
        provider.providerId === providerId
          ? {
              ...provider,
              configured,
            }
          : provider,
      ),
    }));
  };

  const profileLabel = (profileName: string | null) => {
    switch (profileName) {
      case "local":
        return "Local Only";
      case "mixed":
        return "Mixed";
      case "remote":
      case "research_heavy":
        return "Research Heavy";
      default:
        return profileName;
    }
  };

  const providerModelSuggestions = (providerId: string) =>
    REMOTE_PROVIDER_MODEL_SUGGESTIONS[providerId] ?? [];

  const providerDiscoveredModels = (provider: RemoteProviderSetup) =>
    uniqueModelNames(provider.availableModelNames ?? []);

  const filteredProviderModels = (provider: RemoteProviderSetup) => {
    const query = provider.modelName?.trim().toLowerCase() ?? "";
    const models = providerDiscoveredModels(provider);

    if (!query) {
      return models.slice(0, 12);
    }

    return models
      .filter((modelName) => modelName.toLowerCase().includes(query))
      .slice(0, 12);
  };

  const providerModelPlaceholder = (provider: RemoteProviderSetup) => {
    if (providerDiscoveredModels(provider).length > 0) {
      return "Search discovered model ids";
    }

    const firstSuggestion = providerModelSuggestions(provider.providerId)[0]
      ?.value;
    return firstSuggestion
      ? `Default model name (for example ${firstSuggestion})`
      : "Default model name";
  };

  const validateProviderSetup = async (
    provider: RemoteProviderSetup,
    apiKeyOverride?: string | null,
  ) => {
    if (!provider.supported) {
      const result: ProviderValidationResult = {
        providerId: provider.providerId,
        success: false,
        latencyMs: 0,
        modelCount: null,
        availableModels: [],
        error: "This provider preset is not supported by the runtime yet.",
        diagnosis:
          provider.supportSummary ??
          "Use OpenRouter or a custom OpenAI-compatible gateway instead.",
      };
      setProviderValidationResults((current) => ({
        ...current,
        [provider.providerId]: result,
      }));
      setProviderConfigured(provider.providerId, false);
      return result;
    }

    const endpoint = provider.endpoint?.trim() ?? "";
    const modelName = provider.modelName?.trim() ?? "";
    if (!endpoint) {
      const result: ProviderValidationResult = {
        providerId: provider.providerId,
        success: false,
        latencyMs: 0,
        modelCount: null,
        availableModels: [],
        error: "Provider endpoint is required.",
        diagnosis: "Complete the provider endpoint before validating.",
      };
      setProviderValidationResults((current) => ({
        ...current,
        [provider.providerId]: result,
      }));
      setProviderConfigured(provider.providerId, false);
      return result;
    }

    setValidatingProviderId(provider.providerId);
    try {
      const result = await onValidateProvider(
        provider.providerId,
        endpoint,
        apiKeyOverride ?? null,
        modelName || null,
      );
      if (result) {
        const discoveredModels = uniqueModelNames(result.availableModels ?? []);
        setProviderValidationResults((current) => ({
          ...current,
          [provider.providerId]: result,
        }));
        setProviderConfigured(provider.providerId, result.success);
        setForm((current) => ({
          ...current,
          remoteProviders: current.remoteProviders.map((currentProvider) =>
            currentProvider.providerId === provider.providerId
              ? {
                  ...currentProvider,
                  configured: result.success,
                  availableModelNames: discoveredModels,
                }
              : currentProvider,
          ),
        }));
      }
      return result;
    } finally {
      setValidatingProviderId((current) =>
        current === provider.providerId ? null : current,
      );
    }
  };

  const prepareValidatedSetup = async () => {
    const requiresRemoteProviders =
      form.runtimeStrategy === "remote" || form.runtimeStrategy === "mixed";
    let nextProviders = form.remoteProviders;

    for (const provider of form.remoteProviders) {
      const typedApiKey = apiKeys[provider.providerId]?.trim() ?? "";
      const hasTypedCredentials = typedApiKey.length > 0;
      const hasModelName = Boolean(provider.modelName?.trim());
      const wantsValidation =
        provider.configured || hasTypedCredentials || hasModelName;

      if (!wantsValidation) {
        continue;
      }

      const result = await validateProviderSetup(
        provider,
        hasTypedCredentials ? typedApiKey : null,
      );
      const validated = Boolean(result?.success);
      nextProviders = nextProviders.map((current) =>
        current.providerId === provider.providerId
          ? {
              ...current,
              configured: validated,
              availableModelNames:
                result?.availableModels ?? current.availableModelNames ?? [],
            }
          : current,
      );

      if (!validated) {
        setSaveError(
          result?.diagnosis ??
            `${provider.label} could not be validated. Fix the provider configuration before saving.`,
        );
        return null;
      }
    }

    const configuredWithoutDefaultModel = nextProviders.find(
      (provider) =>
        provider.supported &&
        provider.configured &&
        !(provider.modelName?.trim() ?? ""),
    );

    if (configuredWithoutDefaultModel) {
      setSaveError(
        `Choose a default model for ${configuredWithoutDefaultModel.label} before saving setup.`,
      );
      return null;
    }

    if (
      requiresRemoteProviders &&
      nextProviders.filter(
        (provider) =>
          provider.supported &&
          provider.configured &&
          Boolean(provider.modelName?.trim()),
      ).length === 0
    ) {
      setSaveError(
        "Remote and mixed strategies need at least one validated provider with a default model selected.",
      );
      return null;
    }

    setSaveError(null);
    return {
      ...form,
      remoteProviders: nextProviders,
    };
  };

  const chooseWorkspace = async () => {
    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    setForm((current) => ({
      ...current,
      workspacePath: selectedPath,
    }));
  };

  return (
    <div className="fixed inset-0 z-[145] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="flex items-start justify-between gap-6 border-b border-white/5 bg-white/5 px-6 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
              Guided Setup
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
              Prepare Maabarium to run real workflows
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Choose a runtime strategy, point the app at a workspace, configure
              providers, and make sure at least one model path is ready.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10"
          >
            Skip For Now
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Experience Mode
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    [true, "Guided"],
                    [false, "Advanced"],
                  ] as const
                ).map(([guidedMode, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        guidedMode,
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left transition ${form.guidedMode === guidedMode ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                  >
                    <div className="text-xs font-bold uppercase tracking-[0.18em]">
                      {label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed">
                      {guidedMode
                        ? "Plain-language defaults with the next action kept obvious."
                        : "Keep blueprint terminology and lower-level controls visible."}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                {isGuidedMode ? "Environment Profile" : "Advanced Controls"}
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {isGuidedMode
                  ? "Quick presets that configure runtime strategy and research mode for common workflows."
                  : "Directly choose runtime behavior instead of relying on presets."}
              </div>
              {isGuidedMode ? (
                <>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    {(
                      [
                        [
                          "local",
                          "Local Only",
                          "Uses only local Ollama models. No API keys required.",
                        ],
                        [
                          "mixed",
                          "Mixed",
                          "Local models with remote fallbacks for stronger models.",
                        ],
                        [
                          "research_heavy",
                          "Research Heavy",
                          "Prioritizes remote providers for research quality.",
                        ],
                      ] as const
                    ).map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setApplyingProfile(true);
                          void onApplyProfile(value).then((config) => {
                            if (config) {
                              setForm((current) => ({
                                ...current,
                                environmentProfile: value,
                                runtimeStrategy:
                                  config.runtimeStrategy as RuntimeStrategy,
                                researchSearchMode:
                                  GUIDED_DEFAULT_RESEARCH_SEARCH_MODE,
                                selectedLocalModels: config.recommendedModels,
                              }));
                            }
                            setApplyingProfile(false);
                          });
                        }}
                        disabled={applyingProfile}
                        className={`rounded-lg border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          form.environmentProfile === value
                            ? "border-teal-400/30 bg-teal-500/10 text-white"
                            : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"
                        }`}
                      >
                        <div className="text-xs font-bold uppercase tracking-[0.18em]">
                          {label}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed">
                          {description}
                        </div>
                      </button>
                    ))}
                  </div>
                  {recommendedProfile ? (
                    <div className="mt-3 rounded-lg border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-[11px] leading-relaxed text-teal-100">
                      Recommended for your system:{" "}
                      <strong>{profileLabel(recommendedProfile)}</strong>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-3 space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      Runtime Strategy
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                      {(
                        [
                          ["local", "Local"],
                          ["remote", "Remote"],
                          ["mixed", "Mixed"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              runtimeStrategy: value as RuntimeStrategy,
                              environmentProfile: null,
                            }))
                          }
                          className={`rounded-lg border px-3 py-3 text-left transition ${form.runtimeStrategy === value ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                        >
                          <div className="text-xs font-bold uppercase tracking-[0.18em]">
                            {label}
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed">
                            {value === "local"
                              ? "Prefer Ollama-hosted local models."
                              : value === "remote"
                                ? "Use managed API providers only."
                                : "Use local models first, with remote fallbacks where needed."}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-3 text-[11px] leading-relaxed text-slate-400">
                    Advanced mode keeps the lower-level runtime strategy
                    controls visible and stops applying preset labels unless you
                    explicitly switch back to Guided.
                  </div>
                </div>
              )}
            </section>
          </div>

          {gitReadiness ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Git Dependency
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {gitReadiness.summary}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
                    <div>
                      Installer: {gitDependency.installerLabel ?? "Unavailable"}
                    </div>
                    <div>
                      Command:{" "}
                      {gitDependency.installCommand ??
                        "Manual installation required"}
                    </div>
                    {gitDependency.commandPath ? (
                      <div>Resolved binary: {gitDependency.commandPath}</div>
                    ) : null}
                  </div>
                </div>
                <Badge
                  color={
                    gitReadiness.status === "ready"
                      ? "emerald"
                      : gitReadiness.status === "optional"
                        ? "slate"
                        : "rose"
                  }
                >
                  {gitReadiness.status === "needs_attention"
                    ? "Needs Attention"
                    : gitReadiness.status === "optional"
                      ? "Optional"
                      : "Ready"}
                </Badge>
              </div>

              {gitReadiness.status === "needs_attention" ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void onInstallGit()}
                    className="rounded-lg border border-amber-300/20 bg-gradient-to-r from-amber-400/15 to-teal-500/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
                  >
                    {gitReadiness.actionLabel}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Shell CLI
                </div>
                <div className="mt-2 text-sm text-slate-300">
                  {cliLink.statusDetail}
                </div>
                <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500">
                  <div>
                    Managed link: {cliLink.managedLinkPath || "Unavailable"}
                  </div>
                  <div>
                    Bundled target: {cliLink.targetPath || "Unavailable"}
                  </div>
                  {cliLink.currentLinkTarget ? (
                    <div>Current target: {cliLink.currentLinkTarget}</div>
                  ) : null}
                </div>
              </div>
              <Badge color={cliLinkBadgeColor}>{cliLinkBadgeLabel}</Badge>
            </div>

            {cliLinkNeedsInstallAction || cliLinkCanRemove ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {cliLinkNeedsInstallAction ? (
                  <button
                    type="button"
                    onClick={() => void onInstallCliLink()}
                    className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
                  >
                    {cliLinkActionLabel}
                  </button>
                ) : null}
                {cliLinkCanRemove ? (
                  <button
                    type="button"
                    onClick={() => void onRemoveCliLink()}
                    className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                  >
                    Remove CLI Link
                  </button>
                ) : null}
              </div>
            ) : null}

            {showMacPathGuidance ? (
              <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-100">
                <div className="font-semibold text-amber-50">
                  Your shell PATH does not include{" "}
                  {cliLink.managedLinkDirectory}.
                </div>
                <div className="mt-2 text-amber-100/85">
                  Add the managed CLI directory to your
                  {cliLink.shellName ? ` ${cliLink.shellName}` : " shell"}
                  {cliLink.shellConfigPath
                    ? ` profile at ${cliLink.shellConfigPath}`
                    : " profile"}
                  , then open a new terminal.
                </div>
                {cliLink.exportCommand ? (
                  <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-100">
                    {cliLink.exportCommand}
                  </div>
                ) : null}
              </div>
            ) : cliLink.installationSupported ? (
              <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-xs leading-relaxed text-emerald-100">
                {cliLink.pathContainsManagedDir
                  ? `${cliLink.managedLinkDirectory} is already on your shell PATH.`
                  : "Shell PATH guidance is unavailable for this platform."}
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Workspace
                </div>
                <div className="mt-2 text-sm text-slate-300">
                  {form.workspacePath ?? "No workspace selected yet."}
                </div>
                <div className="mt-3 text-xs leading-relaxed text-slate-400">
                  {inspectingWorkspace
                    ? "Inspecting folder and repository status..."
                    : workspaceMissing
                      ? "This saved workspace path does not exist. Choose an existing folder before you rely on it as the default workspace."
                      : workspaceNotDirectory
                        ? "The selected path is not a folder. Choose a workspace directory instead."
                        : workspaceStatus?.isGitRepository
                          ? `Repository detected${workspaceStatus.repositoryRoot ? ` at ${workspaceStatus.repositoryRoot}` : "."}`
                          : workspaceNeedsGitInit
                            ? "This default workspace is not inside a git repository yet. The run modal can initialize it before an experiment starts."
                            : "Choose a workspace to inspect its repository status."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void chooseWorkspace()}
                className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                Choose Workspace
              </button>
            </div>

            {workspaceStatus && !inspectingWorkspace ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-3 text-xs leading-relaxed ${workspaceStatus.isGitRepository ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : workspaceMissing || workspaceNotDirectory ? "border-rose-400/20 bg-rose-500/10 text-rose-100" : "border-amber-300/20 bg-amber-500/10 text-amber-100"}`}
              >
                {workspaceStatus.isGitRepository
                  ? `Git repository ready. Runs can branch safely from ${workspaceStatus.repositoryRoot ?? workspaceStatus.path}.`
                  : workspaceMissing
                    ? "The saved workspace path could not be found. Update setup before using it as the default run location."
                    : workspaceNotDirectory
                      ? "The selected path is not a directory. Pick a workspace folder instead of a file."
                      : "No git repository was found for this folder. That is allowed, but you will need the run modal's git initialization option enabled before a run can prepare experiment branches safely."}
              </div>
            ) : null}

            {workspaceAnalysis && !analyzingWorkspace ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Auto-Detected Project Info
                </div>
                <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-300">
                  <div>{workspaceAnalysis.projectSummary}</div>
                  {workspaceAnalysis.language ? (
                    <div>
                      Language: <strong>{workspaceAnalysis.language}</strong>
                    </div>
                  ) : null}
                  {workspaceAnalysis.testCommand ? (
                    <div>
                      Test command:{" "}
                      <code className="text-teal-200">
                        {workspaceAnalysis.testCommand}
                      </code>
                    </div>
                  ) : null}
                  {workspaceAnalysis.suggestedTargetFiles.length > 0 ? (
                    <div>
                      Suggested targets:{" "}
                      {workspaceAnalysis.suggestedTargetFiles.join(", ")}
                    </div>
                  ) : null}
                  {workspaceAnalysis.hasCiConfig ? (
                    <div className="text-emerald-300">
                      CI configuration detected
                    </div>
                  ) : null}
                </div>
              </div>
            ) : analyzingWorkspace ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3 text-[11px] leading-relaxed text-slate-400">
                Analyzing project structure...
              </div>
            ) : null}
          </section>

          {pluginRuntime ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Evaluator Plugin
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {pluginRuntime.displayName ?? pluginRuntime.pluginId}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {pluginRuntime.summary}
                  </div>
                </div>
                <Badge
                  color={pluginRuntime.status === "ready" ? "emerald" : "rose"}
                >
                  {pluginRuntime.status === "ready"
                    ? "Ready"
                    : "Needs Attention"}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Manifest
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.manifestPath}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Command
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.command ?? "Unavailable"}
                  </div>
                  {pluginRuntime.args.length > 0 ? (
                    <div className="mt-2 break-all text-[11px] text-slate-500">
                      Args: {pluginRuntime.args.join(" ")}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Working Directory
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.workingDir ?? "Uses manifest directory"}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Runtime Settings
                  </div>
                  <div className="mt-2 text-xs text-slate-200">
                    Timeout: {pluginRuntime.timeoutSeconds ?? 0}s
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Environment keys:{" "}
                    {pluginRuntime.environmentKeys.join(", ") || "None"}
                  </div>
                </div>
              </div>

              {pluginRuntime.error ? (
                <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-3 text-xs leading-relaxed text-rose-100">
                  {pluginRuntime.error}
                </div>
              ) : null}
            </section>
          ) : null}

          {form.runtimeStrategy === "local" ||
          form.runtimeStrategy === "mixed" ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Local Runtime
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {ollama?.statusDetail ?? "Ollama status unavailable."}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!ollama?.installed ? (
                    <button
                      type="button"
                      onClick={() => void onInstallOllama()}
                      className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
                    >
                      Install Ollama
                    </button>
                  ) : !ollama.running ? (
                    <button
                      type="button"
                      onClick={() => void onStartOllama()}
                      className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                    >
                      Start Ollama
                    </button>
                  ) : missingRecommendedModelNames.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handlePullRecommendedModels()}
                      disabled={pullingRecommendedModels}
                      className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <span className="inline-flex items-center gap-2">
                        {pullingRecommendedModels ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : null}
                        {pullingRecommendedModels
                          ? "Pulling Models..."
                          : "Pull Recommended Models"}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>

              {ollama?.installed &&
              ollama.running &&
              missingRecommendedModelNames.length > 0 ? (
                <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-100">
                  Pull the missing recommended models into Ollama so local
                  workflows can use the suggested defaults without manual
                  `ollama pull` commands.
                </div>
              ) : null}

              {pullingRecommendedModels ? (
                <div className="mt-4 rounded-lg border border-teal-300/20 bg-teal-500/10 px-3 py-3 text-xs leading-relaxed text-teal-100">
                  Maabarium is asking Ollama to download the missing recommended
                  models now. Large models can take a while, especially on the
                  first pull.
                </div>
              ) : null}

              <div className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Recommended Models
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recommendedModelNames.map((modelName) => {
                  const selected = form.selectedLocalModels.includes(modelName);
                  const installed =
                    ollama?.models.some((model) => model.name === modelName) ??
                    false;
                  return (
                    <button
                      key={modelName}
                      type="button"
                      onClick={() => toggleModel(modelName)}
                      className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}
                    >
                      {modelName}
                      {installed ? " • installed" : " • recommended"}
                    </button>
                  );
                })}
              </div>

              {recommendedModelNames.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-white/10 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
                  No recommended Ollama models are configured for this build.
                </div>
              ) : null}

              {discoveredNonRecommendedModels.length > 0 ? (
                <>
                  <div className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Other Discovered Local Models
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {discoveredNonRecommendedModels.map((model) => {
                      const selected = form.selectedLocalModels.includes(
                        model.name,
                      );
                      const metadata = [model.sizeLabel, model.modifiedAt]
                        .filter(Boolean)
                        .join(" • ");
                      return (
                        <button
                          key={model.name}
                          type="button"
                          onClick={() => toggleModel(model.name)}
                          className={`rounded-2xl border px-3 py-2 text-left text-xs transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}
                        >
                          <div className="font-bold">{model.name}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            installed locally
                            {metadata ? ` • ${metadata}` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {savedOnlyModelNames.length > 0 ? (
                <>
                  <div className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Saved Local Selections
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {savedOnlyModelNames.map((modelName) => {
                      const selected =
                        form.selectedLocalModels.includes(modelName);
                      return (
                        <button
                          key={modelName}
                          type="button"
                          onClick={() => toggleModel(modelName)}
                          className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}
                        >
                          {modelName} • saved
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {availableModelNames.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-white/10 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
                  Install and start Ollama, then pull at least one local model
                  to make local runtime selection available here.
                </div>
              ) : null}
            </section>
          ) : null}

          {form.runtimeStrategy === "remote" ||
          form.runtimeStrategy === "mixed" ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Remote Providers
              </div>
              <div className="mt-4 space-y-3">
                {form.remoteProviders.map((provider) => (
                  <div
                    key={provider.providerId}
                    className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">
                          {provider.label}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {provider.endpoint ?? "Custom endpoint required"}
                        </div>
                      </div>
                      <Badge
                        color={
                          !provider.supported
                            ? "slate"
                            : provider.configured
                              ? "emerald"
                              : "rose"
                        }
                      >
                        {!provider.supported
                          ? "Unsupported"
                          : provider.configured
                            ? "Configured"
                            : "Needs Validation"}
                      </Badge>
                    </div>

                    {!provider.supported && provider.supportSummary ? (
                      <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-[11px] leading-relaxed text-amber-100">
                        {provider.supportSummary}
                      </div>
                    ) : null}

                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        value={provider.endpoint ?? ""}
                        onChange={(event) =>
                          updateProvider(provider.providerId, (current) => ({
                            ...current,
                            endpoint: event.target.value,
                            availableModelNames: [],
                          }))
                        }
                        disabled={!provider.supported}
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                        placeholder="Provider endpoint"
                      />
                      {providerDiscoveredModels(provider).length > 0 ? (
                        <div className="relative">
                          <input
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={
                              openProviderModelPickerId === provider.providerId
                            }
                            aria-controls={`provider-models-${provider.providerId}`}
                            value={provider.modelName ?? ""}
                            onChange={(event) =>
                              updateProvider(
                                provider.providerId,
                                (current) => ({
                                  ...current,
                                  modelName: event.target.value,
                                }),
                              )
                            }
                            onFocus={() =>
                              setOpenProviderModelPickerId(provider.providerId)
                            }
                            onBlur={() => {
                              setTimeout(() => {
                                setOpenProviderModelPickerId((current) =>
                                  current === provider.providerId
                                    ? null
                                    : current,
                                );
                              }, 120);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setOpenProviderModelPickerId((current) =>
                                  current === provider.providerId
                                    ? null
                                    : current,
                                );
                              }
                            }}
                            disabled={!provider.supported}
                            className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                            placeholder={providerModelPlaceholder(provider)}
                          />
                          {openProviderModelPickerId === provider.providerId ? (
                            <div
                              id={`provider-models-${provider.providerId}`}
                              role="listbox"
                              className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-slate-950/95 p-1 shadow-2xl"
                            >
                              {filteredProviderModels(provider).length > 0 ? (
                                filteredProviderModels(provider).map(
                                  (modelName) => {
                                    const selected =
                                      (provider.modelName?.trim() ?? "") ===
                                      modelName;

                                    return (
                                      <button
                                        key={modelName}
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        onMouseDown={(event) => {
                                          event.preventDefault();
                                          updateProvider(
                                            provider.providerId,
                                            (current) => ({
                                              ...current,
                                              modelName,
                                            }),
                                          );
                                          setOpenProviderModelPickerId(null);
                                        }}
                                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition ${selected ? "bg-teal-500/15 text-teal-100" : "text-slate-200 hover:bg-white/5"}`}
                                      >
                                        <span className="truncate">
                                          {modelName}
                                        </span>
                                        {selected ? (
                                          <span className="ml-3 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-300">
                                            selected
                                          </span>
                                        ) : null}
                                      </button>
                                    );
                                  },
                                )
                              ) : (
                                <div className="px-3 py-2 text-xs text-slate-500">
                                  No discovered models match your search.
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {providerDiscoveredModels(provider).length}{" "}
                            discovered model
                            {providerDiscoveredModels(provider).length === 1
                              ? ""
                              : "s"}
                          </div>
                        </div>
                      ) : (
                        <input
                          value={provider.modelName ?? ""}
                          onChange={(event) =>
                            updateProvider(provider.providerId, (current) => ({
                              ...current,
                              modelName: event.target.value,
                            }))
                          }
                          disabled={!provider.supported}
                          className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                          placeholder={providerModelPlaceholder(provider)}
                        />
                      )}
                      <input
                        value={apiKeys[provider.providerId] ?? ""}
                        onChange={(event) => {
                          setSaveError(null);
                          setProviderValidationResults((current) => {
                            if (!(provider.providerId in current)) {
                              return current;
                            }
                            const next = { ...current };
                            delete next[provider.providerId];
                            return next;
                          });
                          setForm((current) => ({
                            ...current,
                            remoteProviders: current.remoteProviders.map(
                              (currentProvider) =>
                                currentProvider.providerId ===
                                provider.providerId
                                  ? {
                                      ...currentProvider,
                                      configured: false,
                                      availableModelNames: [],
                                    }
                                  : currentProvider,
                            ),
                          }));
                          setApiKeys((current) => ({
                            ...current,
                            [provider.providerId]: event.target.value,
                          }));
                        }}
                        disabled={!provider.supported}
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40 md:col-span-2"
                        placeholder="Paste API key to store in the OS keychain"
                      />
                    </div>

                    {providerModelSuggestions(provider.providerId).length >
                    0 ? (
                      <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                          Suggested Models
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {providerModelSuggestions(provider.providerId).map(
                            (suggestion) => {
                              const selected =
                                provider.modelName === suggestion.value;
                              return (
                                <button
                                  key={suggestion.value}
                                  type="button"
                                  onClick={() =>
                                    updateProvider(
                                      provider.providerId,
                                      (current) => ({
                                        ...current,
                                        modelName: suggestion.value,
                                      }),
                                    )
                                  }
                                  disabled={!provider.supported}
                                  className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}
                                >
                                  {suggestion.label}
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>
                    ) : null}

                    {providerDiscoveredModels(provider).length > 0 ? (
                      <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-[11px] leading-relaxed text-emerald-100">
                        Validation discovered{" "}
                        {providerDiscoveredModels(provider).length} model
                        {providerDiscoveredModels(provider).length === 1
                          ? ""
                          : "s"}
                        . Search or paste one of those ids in the model field to
                        set the provider default.
                      </div>
                    ) : null}

                    <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={provider.fallbackOnly}
                        onChange={(event) =>
                          updateProvider(provider.providerId, (current) => ({
                            ...current,
                            fallbackOnly: event.target.checked,
                          }))
                        }
                        disabled={!provider.supported}
                      />
                      Use as fallback only
                    </label>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void validateProviderSetup(
                            provider,
                            apiKeys[provider.providerId]?.trim() ?? null,
                          )
                        }
                        disabled={
                          !provider.supported ||
                          validatingProviderId === provider.providerId
                        }
                        className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="inline-flex items-center gap-2">
                          {validatingProviderId === provider.providerId ? (
                            <LoaderCircle size={14} className="animate-spin" />
                          ) : null}
                          {validatingProviderId === provider.providerId
                            ? "Validating..."
                            : "Validate Provider"}
                        </span>
                      </button>
                      {providerValidationResults[provider.providerId] ? (
                        <Badge
                          color={
                            providerValidationResults[provider.providerId]
                              ?.success
                              ? "emerald"
                              : "rose"
                          }
                        >
                          {providerValidationResults[provider.providerId]
                            ?.success
                            ? "Validated"
                            : "Validation Failed"}
                        </Badge>
                      ) : null}
                    </div>

                    {providerValidationResults[provider.providerId] ? (
                      <div
                        className={`mt-3 rounded-lg border px-3 py-3 text-[11px] leading-relaxed ${providerValidationResults[provider.providerId]?.success ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-rose-400/20 bg-rose-500/10 text-rose-100"}`}
                      >
                        {
                          providerValidationResults[provider.providerId]
                            ?.diagnosis
                        }
                        {providerValidationResults[provider.providerId]
                          ?.latencyMs
                          ? ` (${providerValidationResults[provider.providerId]?.latencyMs}ms)`
                          : ""}
                        {providerValidationResults[provider.providerId]
                          ?.error ? (
                          <div className="mt-2 text-rose-100/80">
                            {
                              providerValidationResults[provider.providerId]
                                ?.error
                            }
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!isGuidedMode ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Research Search
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    Choose how internet-backed research discovery should work.
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    General Research workflows can use an official API-backed
                    provider or a free scraper-backed fallback with lower
                    reliability.
                  </div>
                </div>
                {researchSearchReadiness ? (
                  <Badge
                    color={
                      researchSearchReadiness.status === "ready"
                        ? "emerald"
                        : researchSearchReadiness.status === "optional"
                          ? "slate"
                          : "rose"
                    }
                  >
                    {researchSearchReadiness.status === "needs_attention"
                      ? "Needs Attention"
                      : researchSearchReadiness.status === "optional"
                        ? "Optional"
                        : "Ready"}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {researchSearchOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          researchSearchMode: option.value,
                        }))
                      }
                      className={`rounded-lg border px-3 py-3 text-left transition ${searchMode === option.value ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                    >
                      <div className="text-xs font-bold uppercase tracking-[0.18em]">
                        {option.label}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed">
                        {option.copy}
                      </div>
                    </button>
                  ))}
                </div>

                {searchMode === "brave_api" ? (
                  <>
                    <input
                      value={apiKeys.brave ?? ""}
                      onChange={(event) =>
                        setApiKeys((current) => ({
                          ...current,
                          brave: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                      placeholder="Paste Brave Search API key to store in the OS keychain"
                    />
                    <div className="text-[11px] leading-relaxed text-slate-500">
                      Leave this blank to keep the existing key unchanged. The
                      runtime resolves it as BRAVE_SEARCH_API_KEY for research
                      discovery.
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-[11px] leading-relaxed text-amber-100">
                    Free scraper mode is unofficial. Search results may be
                    slower, lower quality, rate-limited, or unavailable if the
                    upstream HTML layout changes. Use it for out-of-the-box
                    discovery, not for high-assurance research.
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {!isGuidedMode ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                <CheckCircle2 size={14} className="text-teal-300" />
                Readiness Snapshot
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {readinessItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">
                          {item.title}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                          {item.summary}
                        </div>
                      </div>
                      <Badge
                        color={
                          item.status === "ready"
                            ? "emerald"
                            : item.status === "optional"
                              ? "slate"
                              : "rose"
                        }
                      >
                        {item.status === "needs_attention"
                          ? "Needs Attention"
                          : item.status === "optional"
                            ? "Optional"
                            : "Ready"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Wrench size={14} />
              Setup is saved to the desktop app data directory and provider keys
              go into the OS keychain.
            </div>
            {saveError ? (
              <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-100">
                {saveError}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const validatedSetup = await prepareValidatedSetup();
                  if (!validatedSetup) {
                    return;
                  }

                  await onSave(
                    {
                      ...validatedSetup,
                      onboardingCompleted: true,
                      lastSetupCompletedAt: new Date().toISOString(),
                    },
                    apiKeys,
                  );
                })();
              }}
              disabled={saving}
              className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving..." : "Save Setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
