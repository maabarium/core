import { Download, Search } from "lucide-react";
import {
  formatExperimentTimestamp,
  formatSourceHost,
} from "../../lib/formatters";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

function buildResearchMarkdown(experiment: PersistedExperiment) {
  const createdAt = formatExperimentTimestamp(experiment.created_at);
  const lines = [
    `# Research Experiment ${experiment.id}`,
    "",
    `- Captured: ${createdAt}`,
    `- Weighted score: ${experiment.weighted_total.toFixed(2)}`,
    `- Duration: ${experiment.duration_ms}ms`,
    "",
    "## Summary",
    "",
    experiment.proposal_summary || "No research summary recorded.",
    "",
  ];

  if (experiment.research?.sources.length) {
    lines.push("## Sources", "");
    for (const source of experiment.research.sources) {
      const title = source.title || source.label || formatSourceHost(source);
      lines.push(`- [${title}](${source.url})`);
      lines.push(`  - Host: ${formatSourceHost(source)}`);
      lines.push(`  - Verified: ${source.verified ? "yes" : "no"}`);
      lines.push(`  - Citations: ${source.citationCount}`);
      if (source.fetchError) {
        lines.push(`  - Fetch error: ${source.fetchError}`);
      }
    }
    lines.push("");
  }

  if (experiment.research?.citations.length) {
    lines.push("## Citations", "");
    for (const citation of experiment.research.citations) {
      lines.push(`- ${citation.filePath}:${citation.lineNumber}`);
      lines.push(`  - Source: ${citation.sourceUrl}`);
      lines.push(`  - Snippet: ${citation.snippet}`);
    }
    lines.push("");
  }

  if (experiment.research?.queryTraces.length) {
    lines.push("## Query Traces", "");
    for (const trace of experiment.research.queryTraces) {
      lines.push(`- ${trace.provider}: ${trace.queryText}`);
      lines.push(
        `  - Executed: ${formatExperimentTimestamp(trace.executedAt)}`,
      );
      lines.push(`  - Result count: ${trace.resultCount}`);
      lines.push(`  - Latency: ${trace.latencyMs}ms`);
      if (trace.topUrls.length) {
        lines.push(`  - Top URLs: ${trace.topUrls.join(", ")}`);
      }
      if (trace.error) {
        lines.push(`  - Error: ${trace.error}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function downloadResearchMarkdown(experiment: PersistedExperiment) {
  const markdown = buildResearchMarkdown(experiment);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `maabarium-research-experiment-${experiment.id}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

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
            <div className="flex flex-wrap items-start justify-between gap-3">
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
                <Badge color="slate">
                  {latestResearchExperiment.research.queryTraces.length} queries
                </Badge>
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadResearchMarkdown(latestResearchExperiment)
                }
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                <Download size={14} />
                Export Markdown
              </button>
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

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
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

            <div className="rounded-lg border border-white/10 bg-slate-950/60">
              <div className="border-b border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Query Traces
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4">
                {latestResearchExperiment.research.queryTraces.length > 0 ? (
                  latestResearchExperiment.research.queryTraces.map((trace) => (
                    <div
                      key={`${trace.provider}-${trace.executedAt}-${trace.queryText}`}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge color="blue">{trace.provider}</Badge>
                        <Badge color={trace.error ? "rose" : "emerald"}>
                          {trace.error
                            ? "Failed"
                            : `${trace.resultCount} results`}
                        </Badge>
                        <Badge color="slate">{trace.latencyMs}ms</Badge>
                      </div>
                      <div className="mt-3 text-sm leading-relaxed text-slate-200">
                        {trace.queryText}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        {formatExperimentTimestamp(trace.executedAt)}
                      </div>
                      {trace.error ? (
                        <div className="mt-3 text-xs leading-relaxed text-rose-300">
                          {trace.error}
                        </div>
                      ) : trace.topUrls.length > 0 ? (
                        <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                          {trace.topUrls.slice(0, 3).map((url) => (
                            <div key={url} className="truncate font-mono">
                              {url}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                    No search-provider query traces were captured for this run.
                  </div>
                )}
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
