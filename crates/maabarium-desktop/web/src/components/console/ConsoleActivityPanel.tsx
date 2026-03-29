import { useEffect, useMemo, useState } from "react";
import { Activity, History, Terminal } from "lucide-react";
import { buildPatchPreview } from "../../lib/analytics";
import type {
  ConsoleTab,
  HistoryRow,
  PersistedProposal,
} from "../../types/console";
import { Badge } from "../ui/Badge";

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

export function ConsoleActivityPanel({
  activeTab,
  history,
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
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
      <div className="flex border-b border-slate-800">
        {[
          { id: "history" as const, label: "History", icon: History },
          { id: "diff" as const, label: "Diff View", icon: Terminal },
          { id: "logs" as const, label: "Logs", icon: Activity },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChangeTab(id)}
            className={`px-6 py-3 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${activeTab === id ? "text-teal-300 bg-white/5 border-b border-amber-400" : "text-slate-500 hover:text-slate-300"}`}
            type="button"
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
      <div className="p-4 max-h-80 overflow-y-auto">
        {activeTab === "history" ? (
          history.length > 0 ? (
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
          )
        ) : activeTab === "diff" ? (
          activeDiffProposal ? (
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
                <div>Waiting for persisted proposal patch data.</div>
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
                <div>Waiting for tracing output in {logPath}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
