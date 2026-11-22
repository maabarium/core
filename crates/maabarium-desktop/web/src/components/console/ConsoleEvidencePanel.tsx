import { useEffect, useMemo, useState } from "react";
import { Archive, FlaskConical, Search } from "lucide-react";
import type { RetainedWinnerEntry } from "../../lib/winners";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";
import { ResearchRunHistory, type ResearchJob } from "../ResearchQueue";
import { LoraEvidenceCard } from "./LoraEvidenceCard";
import { ResearchEvidenceCard } from "./ResearchEvidenceCard";
import { RetainedArtifactExplorerCard } from "./RetainedArtifactExplorerCard";

type EvidenceTab = "retained" | "research" | "lora";

const EVIDENCE_TAB_STORAGE_KEY = "maabarium.console.evidenceTab";

function loadStoredEvidenceTab(): EvidenceTab | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(EVIDENCE_TAB_STORAGE_KEY);
    if (
      storedValue === "retained" ||
      storedValue === "research" ||
      storedValue === "lora"
    ) {
      return storedValue;
    }
  } catch {
    return null;
  }

  return null;
}

function defaultEvidenceTab(
  winnerHistory: RetainedWinnerEntry[],
  latestResearchExperiment: PersistedExperiment | null,
  latestLoraExperiment: PersistedExperiment | null,
): EvidenceTab {
  if (winnerHistory.length > 0) {
    return "retained";
  }

  if (latestResearchExperiment?.research) {
    return "research";
  }

  if (latestLoraExperiment?.lora) {
    return "lora";
  }

  return "retained";
}

export function ConsoleEvidencePanel({
  winnerHistory,
  selectedExperimentId,
  onSelectExperimentId,
  onExportFiles,
  latestResearchExperiment,
  currentResearchJob,
  latestLoraExperiment,
  className,
  collapsed = false,
  onToggleCollapsed,
}: {
  winnerHistory: RetainedWinnerEntry[];
  selectedExperimentId: number | null;
  onSelectExperimentId: (experimentId: number) => void;
  onExportFiles: (
    entry: RetainedWinnerEntry,
  ) =>
    | Promise<{ fileName: string; bytes: number[] } | null | void>
    | { fileName: string; bytes: number[] }
    | null
    | void;
  latestResearchExperiment: PersistedExperiment | null;
  currentResearchJob?: ResearchJob;
  latestLoraExperiment: PersistedExperiment | null;
  className?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const tabSummary = useMemo(
    () => ({
      retained: {
        label: currentResearchJob ? "Retained workflow winners" : "Retained",
        detail:
          winnerHistory.length > 0
            ? `${winnerHistory.length} winner${winnerHistory.length === 1 ? "" : "s"}`
            : "No winner",
        ready: winnerHistory.length > 0,
        icon: Archive,
      },
      research: {
        label: "Research",
        detail: currentResearchJob
          ? currentResearchJob.experiment_title ?? "Current experiment"
          : latestResearchExperiment?.research
          ? `${latestResearchExperiment.research.sources.length} sources`
          : "No evidence",
        fullDetail: currentResearchJob?.experiment_target ?? undefined,
        ready: currentResearchJob ? Boolean(currentResearchJob.result) : Boolean(latestResearchExperiment?.research),
        icon: Search,
      },
      lora: {
        label: "LoRA",
        detail: latestLoraExperiment?.lora
          ? `${latestLoraExperiment.lora.stages.length} stages`
          : "No runtime",
        ready: Boolean(latestLoraExperiment?.lora),
        icon: FlaskConical,
      },
    }),
    [currentResearchJob, latestLoraExperiment, latestResearchExperiment, winnerHistory],
  );
  const [workflowTab, setWorkflowTab] = useState<EvidenceTab>(
    () =>
      loadStoredEvidenceTab() ??
      defaultEvidenceTab(
        winnerHistory,
        latestResearchExperiment,
        latestLoraExperiment,
      ),
  );
  const [researchSelection, setResearchSelection] = useState<{ id: string; tab: EvidenceTab } | null>(null);
  const activeTab = currentResearchJob
    ? (researchSelection?.id === currentResearchJob.id ? researchSelection.tab : "research")
    : workflowTab;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(EVIDENCE_TAB_STORAGE_KEY, workflowTab);
    } catch {
      return;
    }
  }, [workflowTab]);

  return (
    <GlassCard
      title="Evidence"
      icon={Search}
      glow
      className={className}
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
    >
      <div className="flex h-full flex-col gap-4">
        <div className="evidence-selector rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {(["retained", "research", "lora"] as const).map((tabId) => {
            const tab = tabSummary[tabId];
            const Icon = tab.icon;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => currentResearchJob
                  ? setResearchSelection({ id: currentResearchJob.id, tab: tabId })
                  : setWorkflowTab(tabId)}
                aria-pressed={activeTab === tabId}
                className={`evidence-card min-w-0 rounded-lg border px-3 py-3 text-left transition ${
                  activeTab === tabId
                    ? "border-amber-400/35 bg-amber-500/10"
                    : "border-white/10 bg-slate-950/50 hover:bg-white/[0.05]"
                }`}
              >
                {/* One column in reading order: label, a summary capped at two
                    lines, then the status badge pinned to the bottom so badges
                    line up across equal-height cards and never squeeze the label. */}
                <span className="flex max-w-full items-start gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  <Icon size={13} className="mt-px shrink-0 text-teal-300" aria-hidden="true" />
                  <span className="min-w-0">{tab.label}</span>
                </span>
                {" "}
                <span data-testid={`evidence-summary-${tabId}`}
                  title={"fullDetail" in tab && tab.fullDetail ? tab.fullDetail : tab.detail}
                  className="line-clamp-2 min-h-[2lh] w-full break-words text-xs leading-snug text-slate-500">
                  {tab.detail}
                </span>
                {" "}
                <span className="max-w-full shrink-0 self-end whitespace-nowrap pt-1">
                  <Badge color={tabId === "research" && currentResearchJob?.review_pending ? "amber" : tab.ready ? "emerald" : "slate"}>
                    {tabId === "research" && currentResearchJob?.review_pending
                      ? "Awaiting review" : tab.ready ? "Ready" : "Idle"}
                  </Badge>
                </span>
              </button>
            );
          })}
        </div>

        <div
          data-testid="evidence-panel-retained"
          aria-hidden={activeTab !== "retained"}
          className={activeTab === "retained" ? "block" : "hidden"}
        >
          <RetainedArtifactExplorerCard
            winnerHistory={winnerHistory}
            selectedExperimentId={selectedExperimentId}
            onSelectExperimentId={onSelectExperimentId}
            onExportFiles={onExportFiles}
            embedded
          />
        </div>

        <div
          data-testid="evidence-panel-research"
          aria-hidden={activeTab !== "research"}
          className={activeTab === "research" ? "block" : "hidden"}
        >
          {currentResearchJob ? <>
            {(currentResearchJob.experiment_target ?? currentResearchJob.experiment_title) && (
              <p className="mb-3 break-words text-sm">
                <span className="font-semibold">Experiment: </span>
                {currentResearchJob.experiment_target ?? currentResearchJob.experiment_title}
              </p>
            )}
            <ResearchRunHistory jobs={[currentResearchJob]} />
          </> : <ResearchEvidenceCard
            latestResearchExperiment={latestResearchExperiment}
            embedded
          />}
        </div>

        <div
          data-testid="evidence-panel-lora"
          aria-hidden={activeTab !== "lora"}
          className={activeTab === "lora" ? "block" : "hidden"}
        >
          <LoraEvidenceCard
            latestLoraExperiment={latestLoraExperiment}
            embedded
          />
        </div>
      </div>
    </GlassCard>
  );
}
