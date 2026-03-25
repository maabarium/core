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
  logs,
  logPath,
  onChangeTab,
  onOpenLogFile,
}: {
  activeTab: ConsoleTab;
  history: HistoryRow[];
  latestProposal: PersistedProposal | null;
  logs: string[];
  logPath: string;
  onChangeTab: (tab: ConsoleTab) => void;
  onOpenLogFile: () => void;
}) {
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
          latestProposal ? (
            <div className="space-y-4 font-mono text-[11px] text-slate-500 leading-loose">
              <div>
                <div className="text-white font-bold">
                  Latest proposal #{latestProposal.id}
                </div>
                <div className="text-slate-400 not-italic font-sans text-sm mt-1">
                  {latestProposal.summary}
                </div>
              </div>
              {latestProposal.file_patches.length === 0 ? (
                <div>Waiting for persisted proposal patch data.</div>
              ) : (
                latestProposal.file_patches.map((patch) => (
                  <div key={`${patch.path}-${patch.operation}`}>
                    <div className="text-white">
                      {patch.operation.toUpperCase()} {patch.path}
                    </div>
                    {buildPatchPreview(patch)
                      .slice(0, 8)
                      .map((previewLine, index) => (
                        <div
                          key={`${previewLine.line}-${index}`}
                          className={previewLine.color}
                        >
                          {previewLine.line}
                        </div>
                      ))}
                  </div>
                ))
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
