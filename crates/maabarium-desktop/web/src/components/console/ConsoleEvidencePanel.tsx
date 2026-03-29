import { useEffect, useMemo, useState } from "react";
import { Archive, FlaskConical, Search } from "lucide-react";
import type { RetainedWinnerEntry } from "../../lib/winners";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";
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
  latestLoraExperiment: PersistedExperiment | null;
  className?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const tabSummary = useMemo(
    () => ({
      retained: {
        label: "Retained",
        detail:
          winnerHistory.length > 0
            ? `${winnerHistory.length} winner${winnerHistory.length === 1 ? "" : "s"}`
            : "No winner",
        ready: winnerHistory.length > 0,
        icon: Archive,
      },
      research: {
        label: "Research",
        detail: latestResearchExperiment?.research
          ? `${latestResearchExperiment.research.sources.length} sources`
          : "No evidence",
        ready: Boolean(latestResearchExperiment?.research),
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
    [latestLoraExperiment, latestResearchExperiment, winnerHistory],
  );
  const [activeTab, setActiveTab] = useState<EvidenceTab>(
    () =>
      loadStoredEvidenceTab() ??
      defaultEvidenceTab(
        winnerHistory,
        latestResearchExperiment,
        latestLoraExperiment,
      ),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(EVIDENCE_TAB_STORAGE_KEY, activeTab);
    } catch {
      return;
    }
  }, [activeTab]);

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
        <div className="inline-flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {(["retained", "research", "lora"] as const).map((tabId) => {
            const tab = tabSummary[tabId];
            const Icon = tab.icon;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                aria-pressed={activeTab === tabId}
                className={`flex min-w-[10rem] flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                  activeTab === tabId
                    ? "border-amber-400/35 bg-amber-500/10"
                    : "border-white/10 bg-slate-950/50 hover:bg-white/[0.05]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <Icon size={13} className="text-teal-300" />
                    {tab.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {tab.detail}
                  </div>
                </div>
                <Badge color={tab.ready ? "emerald" : "slate"}>
                  {tab.ready ? "Ready" : "Idle"}
                </Badge>
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
          <ResearchEvidenceCard
            latestResearchExperiment={latestResearchExperiment}
            embedded
          />
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
