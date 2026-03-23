import { LifeBuoy, Rocket } from "lucide-react";
import type { OllamaStatus, ReadinessItem } from "../../types/console";
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
  ollama,
  onOpenSetup,
  onInstallOllama,
  onStartOllama,
}: {
  readinessItems: ReadinessItem[];
  ollama: OllamaStatus | null;
  onOpenSetup: () => void;
  onInstallOllama: () => void;
  onStartOllama: () => void;
}) {
  const requiredItems = readinessItems.filter(
    (item) => item.status !== "optional",
  );
  const readyCount = requiredItems.filter(
    (item) => item.status === "ready",
  ).length;
  const blockedItems = requiredItems.filter(
    (item) => item.status === "needs_attention",
  );

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
      <div className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-100">
                {readyCount}/{requiredItems.length || 1} readiness checks passed
              </div>
              <div className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                {blockedItems.length === 0
                  ? "The desktop app is ready for guided setup and routine workflow runs."
                  : `${blockedItems.length} required setup area(s) still need attention.`}
              </div>
            </div>
            <Badge color={blockedItems.length === 0 ? "emerald" : "rose"}>
              {blockedItems.length === 0 ? "Ready" : "Needs Setup"}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          {readinessItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-100">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {item.summary}
                  </div>
                </div>
                <Badge color={readinessBadgeColor(item.status)}>
                  {item.status === "needs_attention"
                    ? "Needs Attention"
                    : item.status === "optional"
                      ? "Optional"
                      : "Ready"}
                </Badge>
              </div>
            </div>
          ))}
        </div>

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
    </GlassCard>
  );
}
