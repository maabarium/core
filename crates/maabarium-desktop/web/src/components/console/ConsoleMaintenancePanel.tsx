import { useEffect, useState } from "react";
import { Layers, LifeBuoy, RefreshCw, Wrench } from "lucide-react";
import type {
  ExperimentBranchCleanupResult,
  ExperimentBranchInventory,
  GitDependencyState,
  OllamaStatus,
  ReadinessItem,
  UpdateCheckResult,
  UpdaterConfigurationState,
  DesktopSetupState,
  ConsoleTab,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";
import { PersistedStackCard } from "./PersistedStackCard";
import { ReadinessCenterCard } from "./ReadinessCenterCard";
import { UpdatesCard } from "./UpdatesCard";

type MaintenanceTab = "readiness" | "updates" | "stack";

const MAINTENANCE_TAB_STORAGE_KEY = "maabarium.console.maintenanceTab";

function loadStoredMaintenanceTab(): MaintenanceTab | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(
      MAINTENANCE_TAB_STORAGE_KEY,
    );
    if (
      storedValue === "readiness" ||
      storedValue === "updates" ||
      storedValue === "stack"
    ) {
      return storedValue;
    }
  } catch {
    return null;
  }

  return null;
}

export function ConsoleMaintenancePanel({
  readinessItems,
  experimentBranchInventory,
  gitDependency,
  ollama,
  updater,
  desktopSetup,
  updateCheck,
  checkingForUpdates,
  installingUpdate,
  savingPreferences,
  experimentCount,
  proposalCount,
  logCount,
  onOpenSetup,
  onInstallGit,
  onInstallOllama,
  onStartOllama,
  onPreviewBranchCleanup,
  onCleanupBranches,
  onCheckForUpdates,
  onInstallUpdate,
  onSelectChannel,
  onRemindLater,
  onClearReminder,
  onOpenPanel,
  collapsed = false,
  onToggleCollapsed,
}: {
  readinessItems: ReadinessItem[];
  experimentBranchInventory: ExperimentBranchInventory | null;
  gitDependency: GitDependencyState;
  ollama: OllamaStatus | null;
  updater: UpdaterConfigurationState | null | undefined;
  desktopSetup: DesktopSetupState | null | undefined;
  updateCheck: UpdateCheckResult | null;
  checkingForUpdates: boolean;
  installingUpdate: boolean;
  savingPreferences: boolean;
  experimentCount: number;
  proposalCount: number;
  logCount: number;
  onOpenSetup: () => void;
  onInstallGit: () => void;
  onInstallOllama: () => void;
  onStartOllama: () => void;
  onPreviewBranchCleanup: (
    thresholdMonths: number,
  ) => Promise<ExperimentBranchCleanupResult | null>;
  onCleanupBranches: (
    thresholdMonths: number,
  ) => Promise<ExperimentBranchCleanupResult | null>;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onSelectChannel: (channel: string) => void;
  onRemindLater: () => void;
  onClearReminder: () => void;
  onOpenPanel: (tab: ConsoleTab) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<MaintenanceTab>(
    () => loadStoredMaintenanceTab() ?? "readiness",
  );
  const requiredReadinessItems = readinessItems.filter(
    (item) => item.status !== "optional",
  );
  const blockedReadinessItems = requiredReadinessItems.filter(
    (item) => item.status === "needs_attention",
  );
  const updateReady = Boolean(updater?.configured);
  const pendingUpdate = Boolean(updateCheck?.available);

  const tabs: Array<{
    id: MaintenanceTab;
    label: string;
    detail: string;
    ready: boolean;
    icon: typeof LifeBuoy;
  }> = [
    {
      id: "readiness",
      label: "Readiness",
      detail:
        blockedReadinessItems.length === 0
          ? "System ready"
          : `${blockedReadinessItems.length} needs attention`,
      ready: blockedReadinessItems.length === 0,
      icon: LifeBuoy,
    },
    {
      id: "updates",
      label: "Updates",
      detail: pendingUpdate
        ? `Release ${updateCheck?.version ?? "available"}`
        : updateReady
          ? "Channel ready"
          : "Updater idle",
      ready: updateReady,
      icon: RefreshCw,
    },
    {
      id: "stack",
      label: "Persisted Stack",
      detail: `${experimentCount} experiments`,
      ready: experimentCount > 0 || proposalCount > 0 || logCount > 0,
      icon: Layers,
    },
  ];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(MAINTENANCE_TAB_STORAGE_KEY, activeTab);
    } catch {
      return;
    }
  }, [activeTab]);

  return (
    <GlassCard
      title="Maintenance"
      icon={Wrench}
      glow
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
    >
      <div className="space-y-4">
        <div className="inline-flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={activeTab === tab.id}
                className={`flex min-w-[12rem] flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                  activeTab === tab.id
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
          data-testid="maintenance-panel-readiness"
          aria-hidden={activeTab !== "readiness"}
          className={activeTab === "readiness" ? "block" : "hidden"}
        >
          <ReadinessCenterCard
            readinessItems={readinessItems}
            experimentBranchInventory={experimentBranchInventory}
            gitDependency={gitDependency}
            ollama={ollama}
            onOpenSetup={onOpenSetup}
            onInstallGit={onInstallGit}
            onInstallOllama={onInstallOllama}
            onStartOllama={onStartOllama}
            onPreviewBranchCleanup={onPreviewBranchCleanup}
            onCleanupBranches={onCleanupBranches}
            embedded
          />
        </div>

        <div
          data-testid="maintenance-panel-updates"
          aria-hidden={activeTab !== "updates"}
          className={activeTab === "updates" ? "block" : "hidden"}
        >
          <UpdatesCard
            updater={updater}
            desktopSetup={desktopSetup}
            updateCheck={updateCheck}
            checkingForUpdates={checkingForUpdates}
            installingUpdate={installingUpdate}
            savingPreferences={savingPreferences}
            onCheckForUpdates={onCheckForUpdates}
            onInstallUpdate={onInstallUpdate}
            onSelectChannel={onSelectChannel}
            onRemindLater={onRemindLater}
            onClearReminder={onClearReminder}
            embedded
          />
        </div>

        <div
          data-testid="maintenance-panel-stack"
          aria-hidden={activeTab !== "stack"}
          className={activeTab === "stack" ? "block" : "hidden"}
        >
          <PersistedStackCard
            experimentCount={experimentCount}
            proposalCount={proposalCount}
            logCount={logCount}
            onOpenPanel={onOpenPanel}
            embedded
          />
        </div>
      </div>
    </GlassCard>
  );
}
