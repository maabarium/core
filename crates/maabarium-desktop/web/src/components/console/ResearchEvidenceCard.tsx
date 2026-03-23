import { Search } from "lucide-react";
import {
  formatExperimentTimestamp,
  formatSourceHost,
} from "../../lib/formatters";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

export function ResearchEvidenceCard({
  latestResearchExperiment,
}: {
  latestResearchExperiment: PersistedExperiment | null;
}) {
  return (
    <GlassCard title="Research Evidence" icon={Search} className="h-full">
      {latestResearchExperiment?.research ? (
        <div className="flex h-full flex-col gap-4">
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="blue">
                Experiment #{latestResearchExperiment.id}
              </Badge>
              <Badge
                color={
                  latestResearchExperiment.research.sources.some(
                    (source) => source.verified,
                  )
                    ? "emerald"
                    : "rose"
                }
              >
                {
                  latestResearchExperiment.research.sources.filter(
                    (source) => source.verified,
                  ).length
                }
                /{latestResearchExperiment.research.sources.length} verified
              </Badge>
              <Badge color="slate">
                {
                  new Set(
                    latestResearchExperiment.research.sources
                      .map((source) => source.host)
                      .filter((host): host is string => Boolean(host)),
                  ).size
                }{" "}
                hosts
              </Badge>
            </div>
            <div className="mt-3 text-sm text-slate-300">
              {latestResearchExperiment.proposal_summary ||
                "No research summary recorded."}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Captured{" "}
              {formatExperimentTimestamp(latestResearchExperiment.created_at)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-slate-950/60">
              <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Sources
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
                {latestResearchExperiment.research.sources.map((source) => (
                  <div
                    key={`${source.url}-${source.label ?? ""}`}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-100">
                          {source.title ||
                            source.label ||
                            formatSourceHost(source)}
                        </div>
                        <div className="mt-1 truncate text-[11px] uppercase tracking-widest text-slate-500">
                          {formatSourceHost(source)}
                        </div>
                      </div>
                      <Badge color={source.verified ? "emerald" : "rose"}>
                        {source.verified ? "Verified" : "Failed"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge color="slate">
                        {source.citationCount} citations
                      </Badge>
                      {source.statusCode !== null ? (
                        <Badge color="slate">HTTP {source.statusCode}</Badge>
                      ) : null}
                    </div>
                    {source.fetchError ? (
                      <div className="mt-3 text-xs leading-relaxed text-rose-300">
                        {source.fetchError}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-slate-950/60">
              <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Citations
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
                {latestResearchExperiment.research.citations.map((citation) => (
                  <div
                    key={`${citation.filePath}-${citation.lineNumber}-${citation.sourceUrl}`}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color="blue">{citation.filePath}</Badge>
                      <Badge color="slate">Line {citation.lineNumber}</Badge>
                      {citation.label ? (
                        <Badge color="emerald">{citation.label}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-relaxed text-slate-300">
                      {citation.snippet}
                    </div>
                    <div className="mt-3 truncate font-mono text-[11px] text-slate-500">
                      {citation.sourceUrl}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-[18rem] items-center justify-center rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
          No persisted research evidence is available yet. Run a research
          blueprint to inspect verified sources and citation snippets here.
        </div>
      )}
    </GlassCard>
  );
}
