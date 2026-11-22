import { researchStepLabel } from "../../lib/titles";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Activity, History, Terminal } from "lucide-react";
import { buildPatchPreview } from "../../lib/analytics";
import type {
  ConsoleTab,
  HistoryRow,
  PersistedProposal,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { ResearchRunHistory, type ResearchJob } from "../ResearchQueue";

const ResearchOutput = lazy(() => import("../ResearchOutput"));

const historyBadge: Record<
  HistoryRow["status"],
  { color: "blue" | "emerald" | "rose" | "slate"; label: string }
> = {
  promoted: { color: "emerald", label: "Promoted" },
  rejected: { color: "rose", label: "Rejected" },
  cancelled: { color: "slate", label: "Cancelled" },
  promotion_failed: { color: "rose", label: "Promotion Failed" },
  unknown: { color: "blue", label: "Legacy" },
  failed: { color: "rose", label: "Failed" },
};

const ACTIVITY_TABS = [
  { id: "history" as const, label: "History", icon: History },
  { id: "diff" as const, label: "Diff View", icon: Terminal },
  { id: "logs" as const, label: "Logs", icon: Activity },
];

export function ConsoleActivityPanel({
  activeTab,
  history,
  researchJobs = [],
  reportingJob,
  currentResearchJob,
  latestProposal,
  winnerProposal,
  selectedWinnerProposal,
  logs,
  logPath,
  onChangeTab,
  onOpenLogFile,
}: {
  activeTab: ConsoleTab;
  history: HistoryRow[];
  researchJobs?: ResearchJob[];
  reportingJob?: ResearchJob;
  currentResearchJob?: ResearchJob;
  latestProposal: PersistedProposal | null;
  winnerProposal: PersistedProposal | null;
  selectedWinnerProposal: PersistedProposal | null;
  logs: string[];
  logPath: string;
  onChangeTab: (tab: ConsoleTab) => void;
  onOpenLogFile: () => void;
}) {
  const focusedWinnerProposal = selectedWinnerProposal ?? winnerProposal;
  const diffOptions = useMemo(() => {
    const options: Array<{
      id: "latest" | "winner";
      label: string;
      proposal: PersistedProposal;
    }> = [];

    if (latestProposal) {
      options.push({
        id: "latest",
        label:
          focusedWinnerProposal &&
          focusedWinnerProposal.id === latestProposal.id
            ? "Latest • Winner"
            : "Latest Proposal",
        proposal: latestProposal,
      });
    }

    if (
      focusedWinnerProposal &&
      focusedWinnerProposal.id !== latestProposal?.id
    ) {
      options.push({
        id: "winner",
        label: selectedWinnerProposal
          ? "Selected Retained Winner"
          : "Winning Proposal",
        proposal: focusedWinnerProposal,
      });
    }

    return options;
  }, [focusedWinnerProposal, latestProposal, selectedWinnerProposal]);
  const [selectedDiffSource, setSelectedDiffSource] = useState<
    "latest" | "winner"
  >("latest");

  useEffect(() => {
    if (!diffOptions.length) {
      setSelectedDiffSource("latest");
      return;
    }

    if (!diffOptions.some((option) => option.id === selectedDiffSource)) {
      setSelectedDiffSource(diffOptions[0].id);
    }
  }, [diffOptions, selectedDiffSource]);

  useEffect(() => {
    if (
      selectedWinnerProposal &&
      diffOptions.some((option) => option.id === "winner")
    ) {
      setSelectedDiffSource("winner");
    }
  }, [diffOptions, selectedWinnerProposal]);

  const activeDiffProposal =
    diffOptions.find((option) => option.id === selectedDiffSource)?.proposal ??
    diffOptions[0]?.proposal ??
    null;
  const [selectedPatchPath, setSelectedPatchPath] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const nextPath = activeDiffProposal?.file_patches[0]?.path ?? null;
    if (
      selectedPatchPath === null ||
      !activeDiffProposal?.file_patches.some(
        (patch) => patch.path === selectedPatchPath,
      )
    ) {
      setSelectedPatchPath(nextPath);
    }
  }, [activeDiffProposal, selectedPatchPath]);

  const activePatch =
    activeDiffProposal?.file_patches.find(
      (patch) => patch.path === selectedPatchPath,
    ) ??
    activeDiffProposal?.file_patches[0] ??
    null;
  const activePatchPreview = activePatch ? buildPatchPreview(activePatch) : [];
  const truncatedPatchPreview = activePatchPreview.slice(0, 40);

  return (
    <div id="console-activity" className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
      <div className="flex overflow-x-auto border-b border-slate-800" role="tablist" aria-label="Console activity">
        {ACTIVITY_TABS.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            id={`console-tab-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="console-activity-content"
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => onChangeTab(id)}
            onKeyDown={(event) => {
              // Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
              const last = ACTIVITY_TABS.length - 1;
              const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
                : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
                : event.key === "Home" ? 0 : event.key === "End" ? last : null;
              if (target === null) return;
              event.preventDefault();
              const next = ACTIVITY_TABS[target].id;
              onChangeTab(next);
              document.getElementById(`console-tab-${next}`)?.focus();
            }}
            className={`flex shrink-0 items-center gap-2 px-3 py-3 text-xs font-black uppercase tracking-[0.2em] transition-all sm:px-6 ${activeTab === id ? "text-teal-300 bg-white/5 border-b border-amber-400" : "text-slate-500 hover:text-slate-300"}`}
            type="button"
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
      <div className="p-4" id="console-activity-content" data-testid="console-activity-content"
        role="tabpanel" aria-labelledby={`console-tab-${activeTab}`} tabIndex={0}>
        {activeTab === "history" ? (
          <div className="space-y-5">
          {researchJobs.length > 0 && <section aria-label="Research history">
            <h3 className="mb-2 font-semibold">Research queue experiments</h3>
            <ResearchRunHistory jobs={researchJobs} />
          </section>}
          {!reportingJob && <section aria-label="Workflow history">
            <h3 className="mb-2 font-semibold">Workflow engine runs</h3>
          {history.length > 0 ? (
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-white/5">
                {history.map((entry) => (
                  <tr key={entry.experimentId} className="hover:bg-white/5">
                    <td className="p-4 font-mono text-slate-400">
                      #exp-{entry.experimentId}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">
                          {entry.score !== null ? entry.score.toFixed(2) : "--"}
                        </span>
                        {entry.delta !== null ? (
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
                        ) : (
                          <span className="text-slate-500">
                            {entry.status === "failed"
                              ? "failed"
                              : "first scored run"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge color={historyBadge[entry.status].color}>
                        {historyBadge[entry.status].label}
                      </Badge>
                    </td>
                    <td className="p-4 text-slate-500 italic truncate max-w-[180px]">
                      {entry.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
              No persisted experiments yet. Start the engine to populate real
              history rows.
            </div>
          )}
          </section>}
          </div>
        ) : activeTab === "diff" ? (
          currentResearchJob ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">{currentResearchJob.experiment_title ?? "Current research experiment"}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">This run recorded evaluation results, not a file patch.</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                {currentResearchJob.review_pending && <div className="mb-3"><Badge color="amber">Awaiting human review</Badge></div>}
                {currentResearchJob.result ? (
                  <Suspense fallback={<p className="text-sm">Loading report…</p>}>
                    <ResearchOutput text={currentResearchJob.result} />
                  </Suspense>
                ) : <p className="text-sm text-[var(--muted)]">No result has been recorded for this run yet.</p>}
              </div>
            </div>
          ) : activeDiffProposal ? (
            <div className="space-y-4 font-mono text-[11px] text-slate-500 leading-loose">
              {diffOptions.length > 1 ? (
                <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
                  {diffOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedDiffSource(option.id)}
                      className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${selectedDiffSource === option.id ? "bg-amber-500/15 text-amber-200" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div>
                <div className="text-white font-bold">
                  {diffOptions.find(
                    (option) => option.id === selectedDiffSource,
                  )?.label ?? "Latest Proposal"}{" "}
                  #{activeDiffProposal.id}
                </div>
                <div className="text-slate-400 not-italic font-sans text-sm mt-1">
                  {activeDiffProposal.summary}
                </div>
              </div>

              {activeDiffProposal.file_patches.length === 0 ? (
                <div>No saved changes to show yet.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/60 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {activeDiffProposal.file_patches.length} files changed
                    </div>
                    {activeDiffProposal.file_patches.map((patch) => (
                      <button
                        key={`${patch.path}-${patch.operation}`}
                        type="button"
                        onClick={() => setSelectedPatchPath(patch.path)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${activePatch?.path === patch.path ? "border-teal-400/35 bg-teal-500/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"}`}
                      >
                        <div className="min-w-0 flex-1 truncate text-slate-300">
                          {patch.path}
                        </div>
                        <Badge color="slate">{patch.operation}</Badge>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                    {activePatch ? (
                      <>
                        <div className="text-white">
                          {activePatch.operation.toUpperCase()}{" "}
                          {activePatch.path}
                        </div>
                        <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                          {activePatchPreview.length >
                          truncatedPatchPreview.length
                            ? `Showing first ${truncatedPatchPreview.length} changed lines for readability`
                            : "Full preview loaded"}
                        </div>
                        <div className="mt-4 space-y-1">
                          {truncatedPatchPreview.length > 0 ? (
                            truncatedPatchPreview.map((previewLine, index) => (
                              <div
                                key={`${previewLine.line}-${index}`}
                                className={previewLine.color}
                              >
                                {previewLine.line}
                              </div>
                            ))
                          ) : (
                            <div>
                              Persisted patch metadata has no inline content for
                              this file.
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div>
                        Select a changed file to inspect its diff preview.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="font-mono text-[11px] text-slate-500 leading-loose">
              Waiting for persisted proposal patch data in SQLite.
            </div>
          )
        ) : reportingJob ? (
          <div className="space-y-2">
            <h3 className="font-semibold">{reportingJob.experiment_title ?? "Current experiment"}</h3>
            <p className="text-sm text-[var(--muted)]">Only activity recorded for this research run is shown here.</p>
            {researchJobs.length ? <ol className="divide-y divide-[var(--line)]">
              {[...researchJobs].reverse().map((job) => {
                const step = job.id.endsWith(":review") ? "AI review"
                  : job.lane === "Local evidence" ? "Local benchmark and audit" : researchStepLabel(job.id);
                const status = ({ done: "Completed", failed: "Failed", running: "Running", queued: "Waiting to run" } as Record<string, string>)[job.state] ?? job.state;
                const provider = job.lane === "codex" ? "Codex" : job.lane;
                return <li key={job.id} className="py-2 text-sm">
                  <p className="font-semibold">{step} · {status}</p>
                  <p className="text-[var(--muted)]">{provider} · {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</p>
                  {job.detail && (job.state !== "done" || job.lane === "Local evidence") &&
                    <p className="break-words text-sm">{job.detail}</p>}
                </li>;
              })}
            </ol> : <p className="text-sm">No research activity was recorded.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={onOpenLogFile}
                className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all"
                type="button"
              >
                Open Log File
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-500 leading-loose space-y-1">
              {logs.length ? (
                logs
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))
              ) : (
                <div>Waiting for activity in {logPath}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
