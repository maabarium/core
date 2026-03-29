import { useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  LifeBuoy,
  LoaderCircle,
  Rocket,
  Trash2,
} from "lucide-react";
import type {
  ExperimentBranchCleanupResult,
  ExperimentBranchInventory,
  GitDependencyState,
  OllamaStatus,
  ReadinessItem,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

function readinessBadgeColor(status: ReadinessItem["status"]) {
  switch (status) {
    case "ready":
      return "emerald" as const;
    case "optional":
      return "slate" as const;
    default:
      return "rose" as const;
  }
}

export function ReadinessCenterCard({
  readinessItems,
  experimentBranchInventory,
  gitDependency,
  ollama,
  onOpenSetup,
  onInstallGit,
  onInstallOllama,
  onStartOllama,
  onPreviewBranchCleanup,
  onCleanupBranches,
  embedded = false,
}: {
  readinessItems: ReadinessItem[];
  experimentBranchInventory: ExperimentBranchInventory | null;
  gitDependency: GitDependencyState;
  ollama: OllamaStatus | null;
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
  embedded?: boolean;
}) {
  const [thresholdMonths, setThresholdMonths] = useState(
    experimentBranchInventory?.defaultThresholdMonths ?? 3,
  );
  const [cleanupPreview, setCleanupPreview] =
    useState<ExperimentBranchCleanupResult | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "preview" | "cleanup" | null
  >(null);
  const requiredItems = readinessItems.filter(
    (item) => item.status !== "optional",
  );
  const readyCount = requiredItems.filter(
    (item) => item.status === "ready",
  ).length;
  const blockedItems = requiredItems.filter(
    (item) => item.status === "needs_attention",
  );
  const gitReadiness = readinessItems.find((item) => item.id === "git") ?? null;
  const availableThresholds = useMemo(
    () => experimentBranchInventory?.availableThresholdMonths ?? [1, 3, 6],
    [experimentBranchInventory],
  );
  const selectedStaleCount = useMemo(() => {
    if (!experimentBranchInventory) {
      return 0;
    }

    switch (thresholdMonths) {
      case 1:
        return experimentBranchInventory.ageMetrics.olderThan1Month;
      case 3:
        return experimentBranchInventory.ageMetrics.olderThan3Months;
      case 6:
        return experimentBranchInventory.ageMetrics.olderThan6Months;
      default:
        return experimentBranchInventory.branches.filter(
          (branch) => (branch.ageDays ?? -1) >= thresholdMonths * 30,
        ).length;
    }
  }, [experimentBranchInventory, thresholdMonths]);
  const previewBranches = cleanupPreview?.branches.slice(0, 5) ?? [];

  useEffect(() => {
    setCleanupPreview(null);
    setCleanupConfirmOpen(false);
  }, [thresholdMonths]);

  const handlePreview = async () => {
    setPendingAction("preview");
    const result = await onPreviewBranchCleanup(thresholdMonths);
    setCleanupPreview(result);
    setPendingAction(null);
  };

  const handleCleanup = async () => {
    setPendingAction("cleanup");
    const result = await onCleanupBranches(thresholdMonths);
    setCleanupPreview(result);
    setCleanupConfirmOpen(false);
    setPendingAction(null);
  };

  const handleOpenCleanupConfirm = () => {
    if (pendingAction !== null || selectedStaleCount === 0) {
      return;
    }

    setCleanupConfirmOpen(true);
  };

  const content = (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-100">
                {readyCount}/{requiredItems.length || 1} readiness checks passed
              </div>
              <div className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                {blockedItems.length === 0
                  ? "The desktop app is ready for guided setup and routine workflow runs."
                  : `${blockedItems.length} required setup area(s) still need attention.`}
              </div>
            </div>
            <div className="flex-none self-start">
              <Badge color={blockedItems.length === 0 ? "emerald" : "rose"}>
                {blockedItems.length === 0 ? "Ready" : "Needs Setup"}
              </Badge>
            </div>
          </div>
          {embedded ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onOpenSetup}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                Run Setup
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {readinessItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-100">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {item.summary}
                  </div>
                </div>
                <div className="flex-none self-start">
                  <Badge color={readinessBadgeColor(item.status)}>
                    {item.status === "needs_attention"
                      ? "Needs Attention"
                      : item.status === "optional"
                        ? "Optional"
                        : "Ready"}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                  <GitBranch size={14} className="text-teal-300" />
                  Branch Maintenance
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {experimentBranchInventory
                    ? "Track stale experiment branches in the current workspace repository before they accumulate across repeated runs."
                    : "Choose a git-backed workspace to surface stale experiment branches and maintenance actions."}
                </div>
              </div>
              <div className="flex-none self-start">
                <Badge
                  color={
                    !experimentBranchInventory
                      ? "slate"
                      : selectedStaleCount > 0
                        ? "rose"
                        : "emerald"
                  }
                >
                  {experimentBranchInventory
                    ? `${experimentBranchInventory.totalBranches} tracked`
                    : "Unavailable"}
                </Badge>
              </div>
            </div>

            {experimentBranchInventory ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      1 Month+
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">
                      {experimentBranchInventory.ageMetrics.olderThan1Month}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      3 Months+
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">
                      {experimentBranchInventory.ageMetrics.olderThan3Months}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      6 Months+
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">
                      {experimentBranchInventory.ageMetrics.olderThan6Months}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {availableThresholds.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setThresholdMonths(value)}
                      className={`rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition ${
                        value === thresholdMonths
                          ? "border-teal-400/30 bg-teal-500/10 text-teal-200"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      Older Than {value} Month{value === 1 ? "" : "s"}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void handlePreview()}
                    disabled={pendingAction !== null}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {pendingAction === "preview" ? (
                        <LoaderCircle size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Preview Cleanup
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenCleanupConfirm}
                    disabled={
                      pendingAction !== null || selectedStaleCount === 0
                    }
                    className="flex-1 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {pendingAction === "cleanup" ? (
                        <LoaderCircle size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Delete {selectedStaleCount} Stale Branch
                      {selectedStaleCount === 1 ? "" : "es"}
                    </span>
                  </button>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                  Repository: {experimentBranchInventory.repositoryRoot}
                  {experimentBranchInventory.currentBranch
                    ? ` | Current branch: ${experimentBranchInventory.currentBranch}`
                    : ""}
                </div>

                {cleanupPreview ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                    <div className="text-[11px] leading-relaxed text-slate-300">
                      {cleanupPreview.summary}
                    </div>
                    {cleanupPreview.currentBranchProtected ? (
                      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                        Current branch protection kept the checked-out
                        experiment branch intact.
                      </div>
                    ) : null}
                    {previewBranches.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {previewBranches.map((branch) => (
                          <div
                            key={`${branch.name}-${branch.action}`}
                            className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2"
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 flex-1 text-[11px] font-semibold text-slate-100">
                                {branch.name}
                              </div>
                              <div className="flex-none self-start">
                                <Badge
                                  color={
                                    branch.action === "delete"
                                      ? "emerald"
                                      : branch.action === "skip_current"
                                        ? "slate"
                                        : "rose"
                                  }
                                >
                                  {branch.action === "delete"
                                    ? cleanupPreview.dryRun
                                      ? "Would Delete"
                                      : "Deleted"
                                    : branch.action === "skip_current"
                                      ? "Protected"
                                      : "Skipped"}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
                              {branch.ageDays !== null
                                ? `${branch.ageDays} day(s) old`
                                : "Age unavailable"}
                              {branch.reason ? ` | ${branch.reason}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {gitReadiness?.status === "needs_attention" ? (
          <button
            type="button"
            onClick={onInstallGit}
            className="w-full rounded-lg border border-amber-300/20 bg-gradient-to-r from-amber-400/15 to-teal-500/15 px-3 py-3 text-left transition hover:brightness-110"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
              <GitBranch size={14} />
              {gitReadiness.actionLabel}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-300">
              {gitReadiness.summary}
            </div>
            {gitDependency.installerLabel || gitDependency.installCommand ? (
              <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                {gitDependency.installerLabel ?? "Manual setup"}
                {gitDependency.installCommand
                  ? ` • ${gitDependency.installCommand}`
                  : ""}
              </div>
            ) : null}
          </button>
        ) : null}

        {!ollama?.installed ? (
          <button
            type="button"
            onClick={onInstallOllama}
            className="w-full rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-3 text-left transition hover:brightness-110"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
              <Rocket size={14} />
              Install Ollama Locally
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-300">
              Guided local setup will shell out to the approved macOS install
              command after explicit consent.
            </div>
          </button>
        ) : !ollama.running ? (
          <button
            type="button"
            onClick={onStartOllama}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
              <Rocket size={14} />
              Start Ollama
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-300">
              Launch the local runtime so workflows can validate and use
              installed models.
            </div>
          </button>
        ) : null}
      </div>

      {cleanupConfirmOpen ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-rose-500/30 bg-slate-950/95 shadow-2xl shadow-rose-950/30">
            <div className="border-b border-white/5 bg-rose-500/10 px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full border border-rose-400/30 bg-rose-400/10 p-2 text-rose-300">
                  <Trash2 size={18} />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-200">
                    Confirm Cleanup
                  </div>
                  <h2 className="mt-2 text-xl font-black tracking-tight text-white">
                    Delete stale experiment branches?
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    This will delete {selectedStaleCount} experiment branch
                    {selectedStaleCount === 1 ? "" : "es"} older than{" "}
                    {thresholdMonths} month{thresholdMonths === 1 ? "" : "s"}.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-300">
                <div>
                  Repository:{" "}
                  {experimentBranchInventory?.repositoryRoot ?? "Unavailable"}
                </div>
                <div className="mt-2">
                  Current branch protection remains active, so the checked-out
                  branch will be skipped even if it matches the selected age
                  threshold.
                </div>
                <div className="mt-2 text-slate-400">
                  Preview cleanup first if you want to inspect the exact branch
                  list before deletion.
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCleanupConfirmOpen(false)}
                  disabled={pendingAction === "cleanup"}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleCleanup()}
                  disabled={pendingAction === "cleanup"}
                  className="rounded-lg border border-rose-400/25 bg-rose-500/15 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex items-center justify-center gap-2">
                    {pendingAction === "cleanup" ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Confirm Delete
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <GlassCard
      title="Readiness Center"
      icon={LifeBuoy}
      headerActions={
        <button
          type="button"
          onClick={onOpenSetup}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
        >
          Run Setup
        </button>
      }
    >
      {content}
    </GlassCard>
  );
}
