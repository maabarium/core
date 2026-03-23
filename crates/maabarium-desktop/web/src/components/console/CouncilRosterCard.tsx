import { Activity, Cpu, Sparkles, Terminal, ZapOff } from "lucide-react";
import { GlassCard } from "../ui/GlassCard";
import type { CouncilEntry } from "../../types/console";

export function CouncilRosterCard({
  councilEntries,
  engineRunning,
}: {
  councilEntries: CouncilEntry[];
  engineRunning: boolean;
}) {
  return (
    <GlassCard
      title="Council Roster"
      icon={Cpu}
      glow={engineRunning}
      className="xl:col-span-2 h-full"
    >
      <div className="relative h-full rounded-lg border border-white/5 bg-slate-950/50 p-4 space-y-4">
        {councilEntries.length > 0 ? (
          councilEntries.map((entry, index) => (
            <div
              key={entry.title}
              className={
                index === 0
                  ? "flex items-start gap-4"
                  : "flex items-start gap-4 border-t border-white/5 pt-4"
              }
            >
              <div
                className={`w-8 h-8 rounded flex items-center justify-center shrink-0 border ${entry.accent === "amber" ? "bg-amber-500/20 border-amber-500/40" : entry.accent === "slate" ? "bg-slate-500/20 border-slate-500/40" : "bg-teal-500/20 border-teal-500/40"}`}
              >
                {entry.accent === "amber" ? (
                  <ZapOff size={16} className="text-amber-300" />
                ) : entry.accent === "slate" ? (
                  <Terminal size={16} className="text-slate-300" />
                ) : (
                  <Sparkles size={16} className="text-teal-300" />
                )}
              </div>
              <div className="space-y-1">
                <p
                  className={`text-xs font-black uppercase tracking-[0.18em] ${entry.accent === "amber" ? "text-amber-300" : entry.accent === "slate" ? "text-slate-300" : "text-teal-300"}`}
                >
                  {entry.title}
                </p>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {entry.subtitle}
                </p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {entry.copy}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            Load a blueprint to inspect the configured council agents.
          </div>
        )}

        {engineRunning ? (
          <div className="absolute top-2 right-2">
            <div className="flex items-center gap-2 rounded bg-teal-500/10 border border-teal-500/20 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-teal-300 animate-pulse">
              <Activity size={10} /> Active Reasoning
            </div>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}
