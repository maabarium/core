import { useMemo, useState } from "react";
import { Activity, AlertCircle, FileText, Play, Square } from "lucide-react";
import appLogo from "../../icons/maabariumLogo.png";
import { AreaComparisonChart } from "./components/charts/AreaComparisonChart";
import { MiniSparkline } from "./components/charts/MiniSparkline";
import { ActiveBlueprintCard } from "./components/console/ActiveBlueprintCard";
import { BlueprintWizardModal } from "./components/console/BlueprintWizardModal";
import { ConsoleActivityPanel } from "./components/console/ConsoleActivityPanel";
import { CouncilRosterCard } from "./components/console/CouncilRosterCard";
import { HardwareHeatCard } from "./components/console/HardwareHeatCard";
import { MetricPanelCard } from "./components/console/MetricPanelCard";
import { PersistedStackCard } from "./components/console/PersistedStackCard";
import { ResearchEvidenceCard } from "./components/console/ResearchEvidenceCard";
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
import { useBlueprintLibraryViewModel } from "./lib/useBlueprintLibraryViewModel";
import { useDesktopConsole } from "./lib/useDesktopConsole";
import { useBlueprintWizard } from "./lib/useBlueprintWizard";
import type {
  AnalyticsBucket,
  AnalyticsRange,
  ConsoleTab,
} from "./types/console";

export default function App() {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("history");
  const [cpuInfoOpen, setCpuInfoOpen] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("daily");
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
    toggleEngine,
    openLogFile,
    openBlueprintFile,
    openBlueprintDirectory,
    selectBlueprint,
    selectBlueprintFromLibrary,
    checkForUpdates,
    installAvailableUpdate,
    createBlueprintFromWizard,
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
    closeBlueprintWizard,
    buildWizardRequest,
  } = useBlueprintWizard({
    state,
    presentDesktopError,
    dismissDesktopError,
  });

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
      const created = await createBlueprintFromWizard(request);
      if (!created) {
        return;
      }

      setWizardOpen(false);
      resetBlueprintLibraryFilters();
    } finally {
      setWizardCreating(false);
    }
  };

  const openPersistedPanel = (tab: ConsoleTab) => {
    setActiveTab(tab);
    scrollToSection("console-section");
  };

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100 font-sans selection:bg-teal-500/40 selection:text-teal-50">
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
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={() => void toggleEngine()}
              className={`relative overflow-hidden rounded-lg px-4 py-2 transition-all duration-300 group flex items-center justify-center gap-2 font-black uppercase tracking-[0.16em] border text-xs whitespace-nowrap ${state?.engineRunning ? "bg-slate-900 border-rose-500/50 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.2)]" : "bg-gradient-to-r from-teal-500 to-amber-400 border-teal-300/20 text-slate-950 shadow-[0_0_30px_rgba(45,212,191,0.18)]"}`}
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
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-amber-400 border border-teal-300/20 text-xs font-black tracking-[0.14em] text-slate-950 hover:brightness-110 transition-all whitespace-nowrap"
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
                color: "teal",
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
                        className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${analyticsRange === range ? "bg-amber-500/15 text-amber-200" : "text-slate-500 hover:text-slate-300"}`}
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

              <div className="grid grid-cols-1 gap-6 items-stretch xl:grid-cols-2 lg:flex-1">
                <HardwareHeatCard hardwareTelemetry={hardwareTelemetry} />
                <ResearchEvidenceCard
                  latestResearchExperiment={latestResearchExperiment}
                />
              </div>
            </div>

            <div className="lg:col-span-3 space-y-6 self-start pb-2">
              <ActiveBlueprintCard
                blueprintSummary={blueprintSummary}
                activeBlueprintOption={activeBlueprintOption}
                engineRunning={Boolean(state?.engineRunning)}
                onOpenBlueprintWizard={openBlueprintWizard}
                onSelectBlueprint={() => void selectBlueprint()}
                onOpenBlueprintFile={() => void openBlueprintFile()}
                onOpenBlueprintDirectory={() => void openBlueprintDirectory()}
              />

              <PersistedStackCard
                experimentCount={state?.experiments.length ?? 0}
                proposalCount={state?.proposals.length ?? 0}
                logCount={state?.logs.length ?? 0}
                onOpenPanel={openPersistedPanel}
              />

              <UpdatesCard
                updater={state?.updater}
                updateCheck={updateCheck}
                checkingForUpdates={checkingForUpdates}
                installingUpdate={installingUpdate}
                onCheckForUpdates={() => void checkForUpdates()}
                onInstallUpdate={() => void installAvailableUpdate()}
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
              onOpenTemplateWizard={openTemplateWizard}
            />
          </section>

          <BlueprintWizardModal
            open={wizardOpen}
            isCreating={wizardCreating}
            isEngineRunning={Boolean(state?.engineRunning)}
            form={wizardForm}
            metricWeightTotal={wizardMetricWeightTotal}
            modelNames={wizardModelNames}
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
            onCreate={() => void handleCreateBlueprintFromWizard()}
          />
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
