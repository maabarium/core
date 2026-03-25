import { Layers } from "lucide-react";
import type { ConsoleTab } from "../../types/console";
import { GlassCard } from "../ui/GlassCard";

export function PersistedStackCard({
  experimentCount,
  proposalCount,
  logCount,
  onOpenPanel,
}: {
  experimentCount: number;
  proposalCount: number;
  logCount: number;
  onOpenPanel: (tab: ConsoleTab) => void;
}) {
  return (
    <GlassCard
      title="Persisted Stack"
      icon={Layers}
      className="h-full min-h-[18rem]"
    >
      <div className="flex h-full flex-col">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Experiments", value: experimentCount },
            { label: "Proposals", value: proposalCount },
            { label: "Logs", value: logCount },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-white/5 bg-white/5 px-3 py-3"
            >
              <div className="text-lg font-bold text-white">{item.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {item.label}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 mt-auto">
          {[
            {
              id: "history" as const,
              label: "Open History",
              copy: "Review recent persisted experiments and their actual promotion outcomes.",
            },
            {
              id: "diff" as const,
              label: "Open Diff View",
              copy: "Inspect the latest persisted proposal patches.",
            },
            {
              id: "logs" as const,
              label: "Open Logs",
              copy: "Jump to recent runtime output and log-file actions.",
            },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPanel(item.id)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition-all"
            >
              <div className="text-xs font-bold uppercase tracking-widest text-white">
                {item.label}
              </div>
              <div className="mt-1 text-xs text-slate-500">{item.copy}</div>
            </button>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
