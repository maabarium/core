import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  AlertCircle,
  ChevronUp,
  CheckCircle2,
  Play,
  Square,
  X,
} from "lucide-react";
import appLogo from "../../icons/maabariumLogo.png";
import { MiniSparkline } from "./components/charts/MiniSparkline";
import { ActiveBlueprintCard } from "./components/console/ActiveBlueprintCard";
import { AboutModal } from "./components/console/AboutModal";
import { BlueprintWizardModal } from "./components/console/BlueprintWizardModal";
import { ConsoleActivityPanel } from "./components/console/ConsoleActivityPanel";
import { CouncilRosterCard } from "./components/console/CouncilRosterCard";
import { DesktopSetupModal } from "./components/console/DesktopSetupModal";
import { LoraEvidenceCard } from "./components/console/LoraEvidenceCard";
import { MetricPanelCard } from "./components/console/MetricPanelCard";
import { PersistedStackCard } from "./components/console/PersistedStackCard";
import { ReadinessCenterCard } from "./components/console/ReadinessCenterCard";
import { ResearchEvidenceCard } from "./components/console/ResearchEvidenceCard";
import { RunLoopModal } from "./components/console/RunLoopModal";
import { UpdatesCard } from "./components/console/UpdatesCard";
import { WorkflowLibraryCard } from "./components/console/WorkflowLibraryCard";
import { Badge } from "./components/ui/Badge";
import { GlassCard } from "./components/ui/GlassCard";
import { ValidationErrorModal } from "./components/ui/ValidationErrorModal";
import { buildBlueprintSummary, buildCouncilEntries } from "./lib/blueprints";
import {
  buildHistory,
  formatPercentageDelta,
  invertDelta,
  parseTokenUsage,
} from "./lib/analytics";
import {
  formatDuration,
  formatTelemetryPercent,
  formatTelemetryTemperature,
  formatTelemetryTimestamp,
  formatTokenUsage,
  telemetryBadgeColor,
} from "./lib/formatters";
import { listOllamaModelNames } from "./lib/ollama";
import { useBlueprintLibraryViewModel } from "./lib/useBlueprintLibraryViewModel";
import { useDesktopConsole } from "./lib/useDesktopConsole";
import { useBlueprintWizard } from "./lib/useBlueprintWizard";
import type {
  AnalyticsBucket,
  AnalyticsRange,
  BlueprintFile,
  ConsoleTab,
  DesktopSetupState,
  WorkspaceGitStatus,
} from "./types/console";

const SCRAPER_DISCOVERY_MARKER = "[scraper_discovery]";
const ABOUT_MENU_EVENT = "maabarium://open-about";
const AreaComparisonChart = lazy(() =>
  import("./components/charts/AreaComparisonChart").then((module) => ({
    default: module.AreaComparisonChart,
  })),
);

function isScraperDiscoveryError(error: string | null | undefined): boolean {
  return Boolean(error?.includes(SCRAPER_DISCOVERY_MARKER));
}

type WorkflowWorkspacePromptState = {
  workflowName: string;
  workspacePath: string;
  workspaceStatus: WorkspaceGitStatus | null;
  saveAsDefault: boolean;
  initializeGitNow: boolean;
};

function ConfirmationToggle({
  checked,
  onToggle,
  title,
  description,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-start justify-between gap-4 rounded-xl border px-4 py-4 text-left transition ${disabled ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-70" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
    >
      <div>
        <div className="text-sm font-bold text-slate-100">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">
          {description}
        </div>
      </div>
      <span className="mt-0.5 flex shrink-0 items-center gap-3">
        <span
          className={`text-[10px] font-black uppercase tracking-[0.16em] ${checked ? "text-teal-200" : "text-slate-500"}`}
        >
          {checked ? "On" : "Off"}
        </span>
        <span
          className={`relative inline-flex h-7 w-12 rounded-full border transition ${checked ? "border-teal-300/50 bg-teal-500/70" : "border-white/15 bg-slate-900"}`}
        >
          <span
            className={`absolute top-[3px] h-5 w-5 rounded-full shadow transition ${checked ? "left-[1.45rem] bg-slate-950" : "left-[3px] bg-white"}`}
          />
        </span>
      </span>
    </button>
  );
}

export default function App() {
  const allowWindowCloseRef = useRef(false);
  const cpuInfoPopoverRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("history");
  const [cpuInfoOpen, setCpuInfoOpen] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("daily");
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [runLoopModalOpen, setRunLoopModalOpen] = useState(false);
  const [runLoopStarting, setRunLoopStarting] = useState(false);
  const [updatePreferencesSaving, setUpdatePreferencesSaving] = useState(false);
  const [autoOpenedSetup, setAutoOpenedSetup] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [workflowWorkspacePrompt, setWorkflowWorkspacePrompt] =
    useState<WorkflowWorkspacePromptState | null>(null);
  const [workflowWorkspaceApplying, setWorkflowWorkspaceApplying] =
    useState(false);
  const {
    state,
    loading,
    actionError,
    desktopError,
    presentDesktopError,
    dismissDesktopError,
    updateCheck,
    checkingForUpdates,
    installingUpdate,
    switchingBlueprintPath,
    startEngine,
    stopEngine,
    openLogFile,
    openBlueprintFile,
    openBlueprintDirectory,
    openRepositoryLicense,
    selectBlueprint,
    selectBlueprintFromLibrary,
    checkForUpdates,
    installAvailableUpdate,
    createBlueprintFromWizard,
    updateBlueprintFromWizard,
    loadBlueprintForWizard,
    inspectWorkspaceGitStatus,
    initializeWorkspaceGit,
    saveDesktopSetup,
    setProviderApiKey,
    installGit,
    installOllama,
    startOllama,
    pullRecommendedOllamaModels,
    installCliLink,
    removeCliLink,
    previewExperimentBranchCleanup,
    cleanupExperimentBranches,
  } = useDesktopConsole();
  const {
    blueprintQuery,
    setBlueprintQuery,
    blueprintLanguageFilter,
    setBlueprintLanguageFilter,
    blueprintDensity,
    setBlueprintDensity,
    collapsedBlueprintGroups,
    blueprintLanguageOptions,
    filteredBlueprints,
    groupedBlueprints,
    activeBlueprintFilters,
    toggleBlueprintGroup,
    resetBlueprintLibraryFilters,
  } = useBlueprintLibraryViewModel({
    availableBlueprints: state?.availableBlueprints ?? [],
  });

  const {
    wizardOpen,
    setWizardOpen,
    wizardCreating,
    setWizardCreating,
    wizardMode,
    wizardEditingPath,
    wizardForm,
    setWizardForm,
    wizardMetricWeightTotal,
    wizardModelNames,
    updateWizardMetric,
    updateWizardAgent,
    updateWizardModel,
    addWizardMetric,
    addWizardAgent,
    addWizardModel,
    removeWizardMetric,
    removeWizardAgent,
    removeWizardModel,
    openBlueprintWizard,
    openTemplateWizard,
    openExistingBlueprintWizard,
    closeBlueprintWizard,
    buildWizardRequest,
  } = useBlueprintWizard({
    state,
    presentDesktopError,
    dismissDesktopError,
  });

  const wizardLocalModelOptions = useMemo(
    () => listOllamaModelNames(state?.ollama),
    [state?.ollama],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: null | (() => void) = null;

    void listen(ABOUT_MENU_EVENT, () => {
      setAboutOpen(true);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const wizardProviderOptions = useMemo(
    () => [
      {
        id: "ollama",
        label: "Ollama Local",
        endpoint: "http://localhost:11434",
        defaultModelName: wizardLocalModelOptions[0] ?? "llama3",
      },
      ...(state?.desktopSetup.remoteProviders ?? [])
        .filter((provider) => Boolean(provider.providerId.trim()))
        .map((provider) => ({
          id: provider.providerId,
          label: provider.label,
          endpoint: provider.endpoint ?? "",
          defaultModelName: provider.modelName ?? "",
        })),
    ],
    [state, wizardLocalModelOptions],
  );

  const runState = state?.runState ?? null;
  const runStatus = runState?.status ?? "idle";
  const runPhaseLabel = runState?.phase
    ? runState.phase.replace(/_/g, " ")
    : runStatus;
  const runIterationLabel =
    runState?.currentIteration && runState?.maxIterations
      ? `Iteration ${runState.currentIteration}/${runState.maxIterations}`
      : runState?.currentIteration
        ? `Iteration ${runState.currentIteration}`
        : "Run idle";
  const runWorkspaceDefault =
    state?.blueprint?.domain.repo_path?.trim() ||
    state?.desktopSetup.workspacePath?.trim() ||
    ".";
  const researchWorkflowActive =
    state?.blueprint?.library?.template === "general_research" ||
    state?.blueprint?.domain.language?.trim().toLowerCase() === "research";
  const researchSearchMode = state?.desktopSetup.researchSearchMode ?? null;
  const workflowActionsLocked =
    Boolean(state?.engineRunning) ||
    runStatus === "stopping" ||
    runLoopStarting;

  const dashboard = useMemo(() => {
    const experiments = state?.experiments ?? [];
    const successful = experiments.filter((experiment) => !experiment.error);
    const promotedSuccessful = successful.filter(
      (experiment) => experiment.promotion_outcome === "promoted",
    );
    const legacySuccessful = successful.filter(
      (experiment) => experiment.promotion_outcome === "unknown",
    );
    const logs = state?.logs ?? [];
    const tokenSamples = logs
      .map(parseTokenUsage)
      .filter((value): value is number => value !== null);

    const current = successful[0];
    const previous = successful[1];
    const winner =
      promotedSuccessful[0] ??
      legacySuccessful.reduce<(typeof successful)[number] | null>(
        (best, experiment) => {
          if (!best || experiment.weighted_total > best.weighted_total) {
            return experiment;
          }
          return best;
        },
        null,
      );
    const previousWinner =
      promotedSuccessful.length > 1 ? promotedSuccessful[1] : null;
    const currentScoreSeries = successful
      .slice(0, 6)
      .map((experiment) =>
        Math.max(0, Math.min(100, experiment.weighted_total * 100)),
      )
      .reverse();
    const winnerScoreSeries =
      promotedSuccessful.length > 0
        ? promotedSuccessful
            .slice(0, 6)
            .map((experiment) =>
              Math.max(0, Math.min(100, experiment.weighted_total * 100)),
            )
            .reverse()
        : legacySuccessful
            .slice()
            .sort((left, right) => left.id - right.id)
            .slice(-6)
            .map((experiment) =>
              Math.max(0, Math.min(100, experiment.weighted_total * 100)),
            );
    const avgDurationSeries = successful
      .slice(0, 6)
      .map((experiment) => experiment.duration_ms / 1000)
      .reverse();
    const tokenSeries = tokenSamples.slice(-6);
    const liveRunActive =
      runState?.status === "running" || runState?.status === "stopping";
    const liveScoreValue =
      runState?.currentIteration && runState?.maxIterations
        ? `${runState.currentIteration}/${runState.maxIterations}`
        : runState?.currentIteration
          ? `#${runState.currentIteration}`
          : typeof runState?.latestScore === "number"
            ? runState.latestScore.toFixed(2)
            : current
              ? current.weighted_total.toFixed(2)
              : "--";
    const liveDurationValue =
      typeof runState?.currentIterationElapsedMs === "number"
        ? formatDuration(runState.currentIterationElapsedMs)
        : successful.length > 0
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
          : "--";

    return {
      currentScoreLabel: liveRunActive ? "Live Iteration" : "Latest Score",
      currentScore: liveScoreValue,
      currentScoreTrend: liveRunActive
        ? `${runIterationLabel} • ${runPhaseLabel}`
        : current && previous
          ? formatPercentageDelta(
              current.weighted_total,
              previous.weighted_total,
            )
          : successful.length > 0
            ? "Single run"
            : "No persisted runs",
      currentScoreSeries: currentScoreSeries,
      winnerScoreLabel: "Winner Score",
      winnerScore: winner ? winner.weighted_total.toFixed(2) : "--",
      winnerScoreTrend:
        promotedSuccessful.length > 1 && winner && previousWinner
          ? formatPercentageDelta(
              winner.weighted_total,
              previousWinner.weighted_total,
            )
          : promotedSuccessful.length === 1
            ? `Retained via experiment #${winner?.id ?? "--"}`
            : legacySuccessful.length > 0
              ? "Legacy winner inferred"
              : "No retained winner",
      winnerScoreSeries,
      avgIterationLabel: liveRunActive ? "Iteration Elapsed" : "Avg Iteration",
      avgIteration: liveDurationValue,
      avgIterationTrend: liveRunActive
        ? (runState?.message ?? `${runStatus} • ${runPhaseLabel}`)
        : current && previous
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
  }, [runIterationLabel, runPhaseLabel, runState, runStatus, state]);

  const history = useMemo(
    () => buildHistory(state?.experiments ?? []),
    [state],
  );
  const latestSuccessfulExperiment = useMemo(
    () => state?.experiments.find((experiment) => !experiment.error) ?? null,
    [state],
  );
  const failedExperiments = useMemo(
    () =>
      (state?.experiments ?? []).filter((experiment) =>
        Boolean(experiment.error),
      ),
    [state],
  );
  const recentResearchScraperIssueSummary = useMemo(() => {
    const recentExperiments = state?.experiments ?? [];
    const affectedRuns = recentExperiments.filter((experiment) =>
      experiment.research?.queryTraces.some((trace) =>
        isScraperDiscoveryError(trace.error),
      ),
    );
    const issueCount = affectedRuns.reduce(
      (total, experiment) =>
        total +
        (experiment.research?.queryTraces.filter((trace) =>
          isScraperDiscoveryError(trace.error),
        ).length ?? 0),
      0,
    );

    return {
      affectedRunCount: affectedRuns.length,
      issueCount,
    };
  }, [state]);
  const interruptedRunNotice = state?.desktopSetup.interruptedRunNotice ?? null;
  const interruptedRunTimestamp = interruptedRunNotice
    ? new Date(interruptedRunNotice.interruptedAt).toLocaleString()
    : null;
  const latestFailedExperiment = failedExperiments[0] ?? null;
  const latestLoraExperiment = useMemo(
    () =>
      state?.experiments.find(
        (experiment) => !experiment.error && Boolean(experiment.lora),
      ) ?? null,
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
  const activeWorkflowLabel =
    state?.blueprint?.blueprint.name ??
    activeBlueprintOption?.fileName.replace(/\.toml$/i, "") ??
    "No active workflow";
  const activeWorkflowMeta = activeBlueprintOption
    ? [
        activeBlueprintOption.libraryKind === "template"
          ? "template"
          : "workflow",
        activeBlueprintOption.language,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" • ")
    : null;
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
  const latestAnalyticsBucket = useMemo(
    () => selectedAnalytics[selectedAnalytics.length - 1] ?? null,
    [selectedAnalytics],
  );

  useEffect(() => {
    if (
      autoOpenedSetup ||
      loading ||
      !state?.desktopSetup ||
      state.desktopSetup.onboardingCompleted
    ) {
      return;
    }

    setSetupOpen(true);
    setAutoOpenedSetup(true);
  }, [autoOpenedSetup, loading, state?.desktopSetup]);

  useEffect(() => {
    if (!successToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccessToast(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [successToast]);

  useEffect(() => {
    const updateScrollState = () => {
      setShowScrollToTop(window.scrollY > 560);
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  useEffect(() => {
    if (!cpuInfoOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (cpuInfoPopoverRef.current?.contains(target)) {
        return;
      }

      setCpuInfoOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCpuInfoOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cpuInfoOpen]);

  useEffect(() => {
    let removeCloseListener: (() => void) | undefined;

    void (async () => {
      try {
        const currentWindow = getCurrentWindow();
        removeCloseListener = await currentWindow.onCloseRequested(
          async (event) => {
            if (allowWindowCloseRef.current) {
              return;
            }

            const closeWindow = async () => {
              event.preventDefault();
              allowWindowCloseRef.current = true;

              try {
                await currentWindow.close();
              } catch {
                allowWindowCloseRef.current = false;
                throw new Error("The desktop window could not be closed.");
              }
            };

            const flowRunning =
              Boolean(state?.engineRunning) ||
              runStatus === "running" ||
              runStatus === "stopping";

            if (!flowRunning) {
              await closeWindow();
              return;
            }

            event.preventDefault();
            const confirmed = window.confirm(
              "A flow is still running. Closing the app will stop it immediately, and reopening the app will start a new run rather than resume this one. Close anyway?",
            );

            if (!confirmed) {
              return;
            }

            if (state?.desktopSetup) {
              await saveDesktopSetup({
                ...state.desktopSetup,
                interruptedRunNotice: {
                  blueprintName:
                    runState?.blueprintName ??
                    state.blueprint?.blueprint.name ??
                    "Active workflow",
                  workspacePath:
                    runState?.workspacePath ??
                    state.blueprint?.domain.repo_path ??
                    state.desktopSetup.workspacePath ??
                    ".",
                  interruptedAt: new Date().toISOString(),
                  reason:
                    runStatus === "stopping"
                      ? "The app was closed while the flow was already unwinding."
                      : "The app was closed while the flow was still running.",
                },
              });
            }

            await stopEngine();
            await closeWindow();
          },
        );
      } catch {
        // Ignore unsupported window lifecycle hooks and fall back to default close behavior.
      }
    })();

    return () => {
      removeCloseListener?.();
    };
  }, [runStatus, state?.engineRunning, stopEngine]);

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleCreateBlueprintFromWizard = async () => {
    const request = buildWizardRequest();

    if (!request) {
      return;
    }

    try {
      setWizardCreating(true);
      const wasEditingExistingWorkflow = Boolean(wizardEditingPath);
      const normalizedRequestedWorkspace = request.repoPath.trim();
      const normalizedSavedWorkspace =
        state?.desktopSetup.workspacePath?.trim() ?? "";
      const saved = wizardEditingPath
        ? await updateBlueprintFromWizard(wizardEditingPath, request)
        : await createBlueprintFromWizard(request);
      if (!saved) {
        return;
      }

      let nextWorkflowWorkspacePrompt: WorkflowWorkspacePromptState | null =
        null;
      if (normalizedRequestedWorkspace.length > 0) {
        const workspaceStatus = await inspectWorkspaceGitStatus(
          normalizedRequestedWorkspace,
        );
        const workspaceNeedsFollowUp = Boolean(
          normalizedRequestedWorkspace !== normalizedSavedWorkspace ||
          (workspaceStatus &&
            workspaceStatus.exists &&
            workspaceStatus.isDirectory &&
            !workspaceStatus.isGitRepository),
        );

        if (workspaceNeedsFollowUp) {
          nextWorkflowWorkspacePrompt = {
            workflowName: request.name,
            workspacePath: normalizedRequestedWorkspace,
            workspaceStatus,
            saveAsDefault:
              normalizedRequestedWorkspace !== normalizedSavedWorkspace,
            initializeGitNow: Boolean(
              workspaceStatus &&
              workspaceStatus.exists &&
              workspaceStatus.isDirectory &&
              !workspaceStatus.isGitRepository,
            ),
          };
        }
      }

      if (wasEditingExistingWorkflow) {
        setSuccessToast(`Saved workflow changes for ${request.name}.`);
      }

      setWorkflowWorkspacePrompt(nextWorkflowWorkspacePrompt);

      setWizardOpen(false);
      resetBlueprintLibraryFilters();
    } finally {
      setWizardCreating(false);
    }
  };

  const handleEditBlueprintInWizard = async (path: string) => {
    let blueprint: BlueprintFile | null = null;

    if (path === state?.blueprintPath && state.blueprint) {
      blueprint = state.blueprint;
    } else {
      blueprint = await loadBlueprintForWizard(path);
    }

    if (!blueprint) {
      return;
    }

    openExistingBlueprintWizard(path, blueprint);
  };

  const openPersistedPanel = (tab: ConsoleTab) => {
    setActiveTab(tab);
    scrollToSection("console-section");
  };

  const handleSaveDesktopSetup = async (
    nextSetup: DesktopSetupState,
    apiKeys: Record<string, string>,
  ) => {
    setSetupSaving(true);
    try {
      const saved = await saveDesktopSetup(nextSetup);
      if (!saved) {
        return;
      }

      for (const [providerId, apiKey] of Object.entries(apiKeys)) {
        if (!apiKey.trim()) {
          continue;
        }

        const stored = await setProviderApiKey(providerId, apiKey.trim());
        if (!stored) {
          return;
        }
      }

      setSetupOpen(false);
    } finally {
      setSetupSaving(false);
    }
  };

  const handlePersistUpdatePreferences = async (
    updater: (current: DesktopSetupState) => DesktopSetupState,
  ) => {
    if (!state?.desktopSetup) {
      return;
    }

    setUpdatePreferencesSaving(true);
    try {
      await saveDesktopSetup(updater(state.desktopSetup));
    } finally {
      setUpdatePreferencesSaving(false);
    }
  };

  const handleDismissInterruptedRunNotice = async () => {
    if (!state?.desktopSetup?.interruptedRunNotice) {
      return;
    }

    await saveDesktopSetup({
      ...state.desktopSetup,
      interruptedRunNotice: null,
    });
  };

  const handleStartRunLoop = async (
    workspacePath: string,
    initializeGitIfNeeded: boolean,
    saveWorkspaceAsDefault: boolean,
  ) => {
    setRunLoopStarting(true);
    try {
      const started = await startEngine({
        workspacePath,
        initializeGitIfNeeded,
        saveWorkspaceAsDefault,
      });
      if (started) {
        setRunLoopModalOpen(false);
      }
    } finally {
      setRunLoopStarting(false);
    }
  };

  const handleRunFlowClick = async () => {
    if (runStatus === "running") {
      void stopEngine();
      return;
    }

    if (runStatus !== "idle" || runLoopStarting) {
      return;
    }

    const workflowWorkspacePath =
      state?.blueprint?.domain.repo_path?.trim() ?? "";
    if (!workflowWorkspacePath) {
      setRunLoopModalOpen(true);
      return;
    }

    const workspaceStatus = await inspectWorkspaceGitStatus(
      workflowWorkspacePath,
    );
    if (
      workspaceStatus &&
      workspaceStatus.exists &&
      workspaceStatus.isDirectory &&
      workspaceStatus.isGitRepository
    ) {
      await handleStartRunLoop(workflowWorkspacePath, false, false);
      return;
    }

    setRunLoopModalOpen(true);
  };

  const handleSelectUpdateChannel = async (channel: string) => {
    await handlePersistUpdatePreferences((current) => ({
      ...current,
      preferredUpdateChannel: channel,
      remindLaterUntil: null,
      remindLaterVersion: null,
    }));
  };

  const handleRemindLater = async () => {
    if (!updateCheck?.version) {
      return;
    }

    await handlePersistUpdatePreferences((current) => ({
      ...current,
      remindLaterUntil: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      remindLaterVersion: updateCheck.version,
    }));
  };

  const handleClearUpdateReminder = async () => {
    await handlePersistUpdatePreferences((current) => ({
      ...current,
      remindLaterUntil: null,
      remindLaterVersion: null,
    }));
  };

  const handleJumpToActiveWorkflow = () => {
    scrollToSection("active-workflow-card");
  };

  const handleScrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleApplyWorkflowWorkspacePrompt = async () => {
    if (!workflowWorkspacePrompt) {
      return;
    }

    setWorkflowWorkspaceApplying(true);
    try {
      if (workflowWorkspacePrompt.initializeGitNow) {
        const initialized = await initializeWorkspaceGit(
          workflowWorkspacePrompt.workspacePath,
        );
        if (!initialized) {
          return;
        }
      }

      if (workflowWorkspacePrompt.saveAsDefault && state?.desktopSetup) {
        const saved = await saveDesktopSetup({
          ...state.desktopSetup,
          workspacePath: workflowWorkspacePrompt.workspacePath,
        });
        if (!saved) {
          return;
        }
      }

      setSuccessToast(
        workflowWorkspacePrompt.initializeGitNow &&
          workflowWorkspacePrompt.saveAsDefault
          ? `Initialized git for ${workflowWorkspacePrompt.workflowName} and saved this workspace as the default.`
          : workflowWorkspacePrompt.initializeGitNow
            ? `Initialized git for ${workflowWorkspacePrompt.workflowName}.`
            : workflowWorkspacePrompt.saveAsDefault
              ? `Saved ${workflowWorkspacePrompt.workspacePath} as the default workspace.`
              : `Kept ${workflowWorkspacePrompt.workspacePath} as a workflow-specific workspace only.`,
      );
      setWorkflowWorkspacePrompt(null);
    } finally {
      setWorkflowWorkspaceApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1220] text-slate-100 font-sans selection:bg-teal-500/40 selection:text-teal-50">
      <ValidationErrorModal
        title={desktopError?.title ?? "Desktop Error"}
        heading={desktopError?.heading ?? "The desktop action failed"}
        description={
          desktopError?.description ??
          "Review the error details below, then dismiss this dialog to continue."
        }
        message={desktopError?.message ?? null}
        onClose={dismissDesktopError}
      />

      <AboutModal
        isOpen={aboutOpen}
        version={state?.updater.currentVersion ?? "0.1.0"}
        dbPath={state?.dbPath ?? null}
        logPath={state?.logPath ?? null}
        onClose={() => setAboutOpen(false)}
        onOpenLicense={() => void openRepositoryLicense()}
      />

      {successToast ? (
        <div className="fixed right-6 top-6 z-[180] max-w-sm rounded-2xl border border-emerald-400/25 bg-slate-950/95 px-4 py-3 shadow-2xl shadow-emerald-950/40 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1.5 text-emerald-300">
              <CheckCircle2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                Workflow Updated
              </div>
              <div className="mt-1 text-sm leading-relaxed text-slate-200">
                {successToast}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuccessToast(null)}
              className="rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              aria-label="Dismiss success message"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {interruptedRunNotice ? (
        <div className="mx-auto mt-6 max-w-7xl px-8">
          <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-5 py-4 shadow-[0_0_30px_rgba(245,158,11,0.08)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-amber-400/15 p-1.5 text-amber-200">
                <AlertCircle size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
                  Interrupted Run
                </div>
                <div className="mt-1 text-sm leading-relaxed text-slate-100">
                  {interruptedRunNotice.blueprintName} was interrupted on{" "}
                  {interruptedRunTimestamp ??
                    interruptedRunNotice.interruptedAt}
                  . Reopening the app does not resume that loop automatically;
                  the next Run Flow action starts a fresh run.
                </div>
                <div className="mt-2 text-xs leading-relaxed text-amber-100/80">
                  Workspace: {interruptedRunNotice.workspacePath}
                  {interruptedRunNotice.reason
                    ? ` • ${interruptedRunNotice.reason}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDismissInterruptedRunNotice()}
                className="rounded-md p-1 text-amber-100/70 transition hover:bg-white/5 hover:text-slate-50"
                aria-label="Dismiss interrupted run notice"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {state?.desktopSetup ? (
        <DesktopSetupModal
          isOpen={setupOpen}
          setupState={state.desktopSetup}
          readinessItems={state.readinessItems}
          gitDependency={state.gitDependency}
          cliLink={state.cliLink}
          ollama={state.ollama}
          pluginRuntime={state.pluginRuntime}
          saving={setupSaving}
          onClose={() => setSetupOpen(false)}
          onInspectWorkspace={inspectWorkspaceGitStatus}
          onSave={handleSaveDesktopSetup}
          onInstallGit={async () => {
            await installGit();
          }}
          onInstallCliLink={async () => {
            await installCliLink();
          }}
          onRemoveCliLink={async () => {
            await removeCliLink();
          }}
          onInstallOllama={async () => {
            await installOllama();
          }}
          onStartOllama={async () => {
            await startOllama();
          }}
          onPullRecommendedOllamaModels={async () => {
            await pullRecommendedOllamaModels();
          }}
        />
      ) : null}

      <RunLoopModal
        isOpen={runLoopModalOpen}
        activeBlueprintName={state?.blueprint?.blueprint.name ?? null}
        defaultWorkspacePath={runWorkspaceDefault}
        savedWorkspacePath={state?.desktopSetup.workspacePath ?? null}
        submitting={runLoopStarting}
        onClose={() => setRunLoopModalOpen(false)}
        onInspectWorkspace={inspectWorkspaceGitStatus}
        onStart={handleStartRunLoop}
      />

      {workflowWorkspacePrompt ? (
        <div className="fixed inset-0 z-[150] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
            <div className="border-b border-white/5 bg-white/5 px-6 py-4">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                Workspace Follow-up
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                Review the workspace change for{" "}
                {workflowWorkspacePrompt.workflowName}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                This workflow now points at a different folder. Decide whether
                Maabarium should prepare it for git-based runs and whether it
                should replace your saved default workspace.
              </p>
            </div>

            <div className="space-y-5 px-6 py-5">
              <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Workflow Workspace
                </div>
                <div className="mt-2 break-all text-sm text-slate-200">
                  {workflowWorkspacePrompt.workspacePath}
                </div>
                <div className="mt-3 text-xs leading-relaxed text-slate-400">
                  {workflowWorkspacePrompt.workspaceStatus?.isGitRepository
                    ? `Repository detected${workflowWorkspacePrompt.workspaceStatus.repositoryRoot ? ` at ${workflowWorkspacePrompt.workspaceStatus.repositoryRoot}` : "."}`
                    : workflowWorkspacePrompt.workspaceStatus?.exists === false
                      ? "This path does not exist yet. The workspace cannot become a working default until it exists."
                      : workflowWorkspacePrompt.workspaceStatus &&
                          !workflowWorkspacePrompt.workspaceStatus.isDirectory
                        ? "The selected path is not a folder. Pick a directory inside the workflow wizard instead."
                        : "No git repository was found for this folder yet."}
                </div>
              </section>

              <ConfirmationToggle
                checked={workflowWorkspacePrompt.initializeGitNow}
                onToggle={() =>
                  setWorkflowWorkspacePrompt((current) =>
                    current
                      ? {
                          ...current,
                          initializeGitNow: !current.initializeGitNow,
                        }
                      : current,
                  )
                }
                title="Initialize git in this workspace now"
                description="Create a repository and initial commit immediately so this workflow is ready for branching on the next run."
                disabled={Boolean(
                  workflowWorkspacePrompt.workspaceStatus?.isGitRepository ||
                  workflowWorkspacePrompt.workspaceStatus?.exists === false ||
                  (workflowWorkspacePrompt.workspaceStatus &&
                    !workflowWorkspacePrompt.workspaceStatus.isDirectory),
                )}
              />

              <ConfirmationToggle
                checked={workflowWorkspacePrompt.saveAsDefault}
                onToggle={() =>
                  setWorkflowWorkspacePrompt((current) =>
                    current
                      ? {
                          ...current,
                          saveAsDefault: !current.saveAsDefault,
                        }
                      : current,
                  )
                }
                title="Save this as the global default workspace"
                description="Replace the desktop setup workspace so future runs start from this folder by default."
              />

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setWorkflowWorkspacePrompt(null)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                  disabled={workflowWorkspaceApplying}
                >
                  Not Now
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyWorkflowWorkspacePrompt()}
                  className="rounded-lg border border-teal-300/20 bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={workflowWorkspaceApplying}
                >
                  {workflowWorkspaceApplying ? "Applying..." : "Apply Choices"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="sticky top-0 left-0 right-0 z-[100] border-b border-white/5 bg-[#0b1220]/88 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-8">
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

          <div className="hidden items-center gap-2 rounded-xl border border-white/5 bg-white/5 p-1 shadow-inner md:flex">
            <button
              onClick={handleScrollToTop}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all"
              type="button"
            >
              Overview
            </button>
            <button
              onClick={() => scrollToSection("console-section")}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] bg-gradient-to-r from-teal-500 to-amber-400 text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.22)]"
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
            <button
              onClick={() => scrollToSection("maintenance-section")}
              className="px-6 py-2 rounded-lg text-xs font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all"
              type="button"
            >
              Maintenance
            </button>
          </div>

          <button
            type="button"
            onClick={handleJumpToActiveWorkflow}
            className="order-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_0_24px_rgba(8,15,27,0.25)] transition hover:border-teal-300/30 hover:bg-white/[0.07] md:order-3 md:w-auto md:min-w-[18rem] md:max-w-[24rem]"
          >
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-200">
              Active Workflow
            </div>
            <div className="mt-1 truncate text-sm font-black tracking-[0.02em] text-white md:text-base">
              {activeWorkflowLabel}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {activeWorkflowMeta ?? blueprintSummary}
            </div>
            <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Jump to active workflow
            </div>
          </button>

          <div className="order-3 flex shrink-0 items-center justify-end gap-2 md:order-4">
            <button
              onClick={() => void handleRunFlowClick()}
              className={`relative overflow-hidden rounded-lg px-4 py-2 transition-all duration-300 group flex items-center justify-center gap-2 font-black uppercase tracking-[0.16em] border text-xs whitespace-nowrap ${runStatus === "idle" ? "bg-gradient-to-r from-teal-500 to-amber-400 border-teal-300/20 text-slate-950 shadow-[0_0_30px_rgba(45,212,191,0.18)]" : "bg-slate-900 border-rose-500/50 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.2)]"}`}
              type="button"
              disabled={loading || runStatus === "stopping" || runLoopStarting}
            >
              {runStatus === "idle" ? (
                <Play size={16} fill="currentColor" />
              ) : (
                <Square size={16} fill="currentColor" />
              )}
              {runStatus === "idle"
                ? runLoopStarting
                  ? "STARTING"
                  : "RUN FLOW"
                : runStatus === "stopping"
                  ? "STOPPING"
                  : "STOP"}
            </button>
            <button
              onClick={openBlueprintWizard}
              className={`px-4 py-2 rounded-lg border text-xs font-black tracking-[0.14em] transition-all whitespace-nowrap ${workflowActionsLocked ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-500" : "bg-gradient-to-r from-teal-500 to-amber-400 border-teal-300/20 text-slate-950 hover:brightness-110"}`}
              type="button"
              disabled={workflowActionsLocked}
            >
              NEW FLOW
            </button>
            <button
              onClick={() => void selectBlueprint()}
              className={`px-4 py-2 rounded-lg border text-xs font-black tracking-[0.14em] transition-all whitespace-nowrap ${workflowActionsLocked ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-500" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
              type="button"
              disabled={workflowActionsLocked}
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
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5"
          >
            {[
              {
                label: dashboard.currentScoreLabel,
                val: dashboard.currentScore,
                trend: dashboard.currentScoreTrend,
                color: "teal",
                data: dashboard.currentScoreSeries,
                providerBadge:
                  (runState?.status === "running" ||
                    runState?.status === "stopping") &&
                  researchWorkflowActive &&
                  researchSearchMode
                    ? {
                        label:
                          researchSearchMode === "duckduckgo_scrape"
                            ? "DuckDuckGo Scrape"
                            : "Brave API",
                        color:
                          researchSearchMode === "duckduckgo_scrape"
                            ? ("rose" as const)
                            : ("emerald" as const),
                      }
                    : null,
              },
              {
                label: dashboard.winnerScoreLabel,
                val: dashboard.winnerScore,
                trend: dashboard.winnerScoreTrend,
                color: "blue",
                data: dashboard.winnerScoreSeries,
              },
              {
                label: dashboard.avgIterationLabel,
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
                    {stat.providerBadge ? (
                      <div className="mt-2">
                        <Badge color={stat.providerBadge.color}>
                          {stat.providerBadge.label}
                        </Badge>
                      </div>
                    ) : null}
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

            <GlassCard className="relative min-h-[10.75rem]" allowOverflow>
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
                  <div
                    ref={cpuInfoPopoverRef}
                    className="relative flex items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => setCpuInfoOpen((current) => !current)}
                      className="rounded-full border border-white/10 bg-white/5 p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                      aria-label="Explain CPU telemetry"
                      aria-expanded={cpuInfoOpen}
                      aria-haspopup="dialog"
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

                    {cpuInfoOpen ? (
                      <div className="absolute right-0 top-full z-30 mt-3 w-80 rounded-lg border border-white/10 bg-slate-950/95 px-3 py-3 text-left text-xs leading-relaxed text-slate-300 shadow-2xl shadow-black/40 backdrop-blur-xl">
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
                  </div>
                </div>

                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-900/80">
                  <div
                    className={`h-full rounded-full ${cpuSensor?.utilizationPercent !== null ? "bg-gradient-to-r from-teal-400 to-amber-400" : "bg-slate-700"}`}
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
            <GlassCard className="border-white/10 bg-white/[0.04]">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-rose-200">
                    <AlertCircle size={14} />
                    Run Failures
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-6">
                    <div>
                      <div className="text-3xl font-mono font-black tracking-tight text-white">
                        {failedExperiments.length}
                      </div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        Recent failed experiments
                      </div>
                    </div>
                    <div className="max-w-3xl min-w-0 flex-1">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        Latest failure reason
                      </div>
                      <div className="mt-2 text-sm leading-relaxed text-slate-200">
                        {latestFailedExperiment?.error ??
                          "No failed experiments are currently recorded."}
                      </div>
                    </div>
                    {recentResearchScraperIssueSummary.issueCount > 0 ? (
                      <div className="min-w-[16rem] rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-200">
                          Research Discovery Instability
                        </div>
                        <div className="mt-1 text-2xl font-black tracking-tight text-white">
                          {recentResearchScraperIssueSummary.issueCount}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-rose-100">
                          {recentResearchScraperIssueSummary.issueCount === 1
                            ? "1 scraper issue captured"
                            : `${recentResearchScraperIssueSummary.issueCount} scraper issues captured`}{" "}
                          across{" "}
                          {recentResearchScraperIssueSummary.affectedRunCount}{" "}
                          recent research{" "}
                          {recentResearchScraperIssueSummary.affectedRunCount ===
                          1
                            ? "run"
                            : "runs"}
                          .
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Successful runs
                    </div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-white">
                      {state?.experiments.filter(
                        (experiment) => !experiment.error,
                      ).length ?? 0}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPersistedPanel("history")}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                  >
                    Open History
                  </button>
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
                      Persisted experiments and traced token usage.
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
                        className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${analyticsRange === range ? "bg-amber-500/15 text-amber-200" : "text-slate-500 hover:text-slate-300"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="-mx-5">
                  <Suspense
                    fallback={
                      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4">
                        <div className="h-72 w-full animate-pulse rounded-lg bg-white/5" />
                      </div>
                    }
                  >
                    <AreaComparisonChart buckets={selectedAnalytics} />
                  </Suspense>
                </div>

                {latestAnalyticsBucket ? (
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Latest Bucket
                    </div>
                    <div className="mt-2 flex flex-col gap-2 text-sm text-slate-200 md:flex-row md:items-center md:justify-between">
                      <div className="font-semibold text-slate-100">
                        {latestAnalyticsBucket.label}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                        <span>
                          {latestAnalyticsBucket.experiments} experiments
                        </span>
                        <span>•</span>
                        <span>
                          {formatTokenUsage(latestAnalyticsBucket.tokenUsage)}{" "}
                          tokens
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

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
                      <div className="h-2 w-2 rounded-full bg-amber-400" />
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
            <div className="lg:col-span-9 flex flex-col gap-6 lg:h-full">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
                <MetricPanelCard metricPanel={metricPanel} />
                <CouncilRosterCard
                  councilEntries={councilEntries}
                  engineRunning={Boolean(state?.engineRunning)}
                />
              </div>

              <ConsoleActivityPanel
                activeTab={activeTab}
                history={history}
                latestProposal={latestProposal}
                logs={state?.logs ?? []}
                logPath={state?.logPath ?? "loading"}
                onChangeTab={setActiveTab}
                onOpenLogFile={() => void openLogFile()}
              />

              <div className="lg:flex-1">
                <ResearchEvidenceCard
                  latestResearchExperiment={latestResearchExperiment}
                />
              </div>

              <div className="lg:flex-1">
                <LoraEvidenceCard latestLoraExperiment={latestLoraExperiment} />
              </div>
            </div>

            <div className="lg:col-span-3 space-y-6 self-start pb-2">
              <div id="active-workflow-card">
                <ActiveBlueprintCard
                  blueprintSummary={blueprintSummary}
                  activeBlueprintOption={activeBlueprintOption}
                  engineRunning={Boolean(state?.engineRunning)}
                  onOpenBlueprintWizard={openBlueprintWizard}
                  onEditBlueprintWizard={() => {
                    if (activeBlueprintOption) {
                      void handleEditBlueprintInWizard(
                        activeBlueprintOption.path,
                      );
                    }
                  }}
                  onSelectBlueprint={() => void selectBlueprint()}
                  onOpenBlueprintFile={() => void openBlueprintFile()}
                  onOpenBlueprintDirectory={() => void openBlueprintDirectory()}
                />
              </div>

              <UpdatesCard
                updater={state?.updater}
                desktopSetup={state?.desktopSetup}
                updateCheck={updateCheck}
                checkingForUpdates={checkingForUpdates}
                installingUpdate={installingUpdate}
                savingPreferences={updatePreferencesSaving}
                onCheckForUpdates={() => void checkForUpdates()}
                onInstallUpdate={() => void installAvailableUpdate()}
                onSelectChannel={(channel) =>
                  void handleSelectUpdateChannel(channel)
                }
                onRemindLater={() => void handleRemindLater()}
                onClearReminder={() => void handleClearUpdateReminder()}
              />
            </div>
          </section>

          <section id="blueprint-section" className="pt-2">
            <WorkflowLibraryCard
              totalBlueprintCount={state?.availableBlueprints.length ?? 0}
              visibleBlueprintCount={filteredBlueprints.length}
              blueprintGroups={groupedBlueprints}
              density={blueprintDensity}
              searchQuery={blueprintQuery}
              selectedLanguageGroup={blueprintLanguageFilter}
              languageGroupOptions={blueprintLanguageOptions}
              activeFilters={activeBlueprintFilters}
              collapsedGroups={collapsedBlueprintGroups}
              pendingBlueprintPath={switchingBlueprintPath}
              isEngineRunning={Boolean(state?.engineRunning)}
              activeBlueprintPath={state?.blueprintPath ?? ""}
              onOpenWizard={openBlueprintWizard}
              onDensityChange={setBlueprintDensity}
              onSearchQueryChange={setBlueprintQuery}
              onLanguageGroupChange={setBlueprintLanguageFilter}
              onResetFilters={resetBlueprintLibraryFilters}
              onToggleGroup={toggleBlueprintGroup}
              onSelectBlueprint={(path) =>
                void selectBlueprintFromLibrary(path)
              }
              onEditBlueprint={(path) => void handleEditBlueprintInWizard(path)}
              onOpenTemplateWizard={openTemplateWizard}
            />
          </section>

          <section id="maintenance-section" className="pt-2">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="xl:col-span-8">
                <ReadinessCenterCard
                  readinessItems={state?.readinessItems ?? []}
                  experimentBranchInventory={
                    state?.experimentBranchInventory ?? null
                  }
                  gitDependency={
                    state?.gitDependency ?? {
                      installed: false,
                      commandPath: null,
                      autoInstallSupported: false,
                      installerLabel: null,
                      installCommand: null,
                      statusDetail: "Git status is unavailable.",
                    }
                  }
                  ollama={state?.ollama ?? null}
                  onOpenSetup={() => setSetupOpen(true)}
                  onInstallGit={() => void installGit()}
                  onInstallOllama={() => void installOllama()}
                  onStartOllama={() => void startOllama()}
                  onPreviewBranchCleanup={(thresholdMonths) =>
                    previewExperimentBranchCleanup(thresholdMonths)
                  }
                  onCleanupBranches={(thresholdMonths) =>
                    cleanupExperimentBranches(thresholdMonths)
                  }
                />
              </div>
              <div className="xl:col-span-4">
                <PersistedStackCard
                  experimentCount={state?.experiments.length ?? 0}
                  proposalCount={state?.proposals.length ?? 0}
                  logCount={state?.logs.length ?? 0}
                  onOpenPanel={openPersistedPanel}
                />
              </div>
            </div>
          </section>

          <BlueprintWizardModal
            open={wizardOpen}
            isCreating={wizardCreating}
            isEngineRunning={Boolean(state?.engineRunning)}
            mode={wizardMode}
            form={wizardForm}
            metricWeightTotal={wizardMetricWeightTotal}
            modelNames={wizardModelNames}
            localModelOptions={wizardLocalModelOptions}
            providerOptions={wizardProviderOptions}
            savedWorkspacePath={state?.desktopSetup.workspacePath ?? null}
            onInspectWorkspace={inspectWorkspaceGitStatus}
            setForm={setWizardForm}
            addMetric={addWizardMetric}
            updateMetric={updateWizardMetric}
            removeMetric={removeWizardMetric}
            addAgent={addWizardAgent}
            updateAgent={updateWizardAgent}
            removeAgent={removeWizardAgent}
            addModel={addWizardModel}
            updateModel={updateWizardModel}
            removeModel={removeWizardModel}
            onClose={closeBlueprintWizard}
            onSubmit={() => void handleCreateBlueprintFromWizard()}
          />
        </div>

        <div className="mt-8 text-[11px] text-slate-500 flex flex-wrap gap-4">
          <span>Blueprint: {state?.blueprintPath ?? "loading"}</span>
          <span>Database: {state?.dbPath ?? "loading"}</span>
          <span>Logs: {state?.logPath ?? "loading"}</span>
        </div>
      </main>

      {showScrollToTop ? (
        <button
          type="button"
          onClick={handleScrollToTop}
          className="fixed bottom-6 right-6 z-[120] flex items-center gap-2 rounded-full border border-teal-300/20 bg-slate-950/90 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-100 shadow-[0_0_24px_rgba(8,15,27,0.45)] backdrop-blur-xl transition hover:border-teal-300/40 hover:bg-slate-900"
          aria-label="Scroll to top"
        >
          <ChevronUp size={14} />
          Top
        </button>
      ) : null}
    </div>
  );
}
