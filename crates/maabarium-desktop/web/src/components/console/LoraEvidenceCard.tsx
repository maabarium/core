import { FlaskConical } from "lucide-react";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

function formatScore(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function LoraEvidenceCard({
  latestLoraExperiment,
}: {
  latestLoraExperiment: PersistedExperiment | null;
}) {
  const lora = latestLoraExperiment?.lora;

  return (
    <GlassCard title="LoRA Runtime" icon={FlaskConical} className="h-full">
      {lora ? (
        <div className="flex h-full flex-col gap-4">
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {lora.trainer || "LoRA run"}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Base model: {lora.baseModel || "Unknown"}
                </div>
              </div>
              <Badge color="blue">Experiment #{latestLoraExperiment?.id}</Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
              <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                Reproducibility {formatScore(lora.reproducibilityRatio)}
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                Execution {formatScore(lora.executionSignal)}
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                Metadata {formatScore(lora.metadataRatio)}
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                Adapter {formatScore(lora.adapterRatio)}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/60 px-4 py-4">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              Reproducibility Metadata
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-300">
              <div>Dataset: {lora.dataset || "Not recorded"}</div>
              <div>Adapter path: {lora.adapterPath || "Not recorded"}</div>
              <div>Output dir: {lora.outputDir || "Not recorded"}</div>
              <div>
                Epochs: {lora.epochs ?? "n/a"} • Learning rate:{" "}
                {lora.learningRate ?? "n/a"}
              </div>
              <div>Eval command: {lora.evalCommand || "Not recorded"}</div>
              <div>
                Sandbox: {lora.sandboxFileCount} files •{" "}
                {lora.sandboxTotalBytes} bytes
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/60">
            <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              Execution Stages
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
              {lora.stages.length > 0 ? (
                lora.stages.map((stage) => (
                  <div
                    key={`${stage.name}-${stage.command}`}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color="emerald">{stage.name}</Badge>
                      <Badge color="slate">{stage.timeoutSeconds}s</Badge>
                      <Badge color="slate">
                        {stage.verifiedArtifacts.length}/
                        {stage.expectedArtifacts.length ||
                          stage.verifiedArtifacts.length}{" "}
                        artifacts
                      </Badge>
                    </div>
                    <div className="mt-3 break-all font-mono text-[11px] text-slate-300">
                      {stage.command}
                      {stage.args.length > 0 ? ` ${stage.args.join(" ")}` : ""}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      Working dir: {stage.workingDir}
                    </div>
                    {stage.verifiedArtifacts.length > 0 ? (
                      <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                        {stage.verifiedArtifacts.map((artifact) => (
                          <div key={artifact}>{artifact}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                  No train or evaluate subprocess stages were recorded for this
                  experiment.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
          No persisted LoRA runtime metadata is available yet.
        </div>
      )}
    </GlassCard>
  );
}
