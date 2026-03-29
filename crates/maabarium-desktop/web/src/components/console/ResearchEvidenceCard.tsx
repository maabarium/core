import { Download, Search } from "lucide-react";
import {
  formatCountLabel,
  formatExperimentTimestamp,
  formatSourceHost,
} from "../../lib/formatters";
import type { PersistedExperiment } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

const SCRAPER_DISCOVERY_MARKER = "[scraper_discovery]";

function isScraperDiscoveryError(error: string | null): boolean {
  return Boolean(error?.includes(SCRAPER_DISCOVERY_MARKER));
}

function formatQueryTraceProvider(provider: string): string {
  if (provider === "duckduckgo_html") {
    return "DuckDuckGo Scrape";
  }

  if (provider === "brave") {
    return "Brave API";
  }

  return provider;
}

function summarizeResearchProviders(
  experiment: PersistedExperiment,
): string | null {
  const providers = Array.from(
    new Set(
      (experiment.research?.queryTraces ?? []).map((trace) =>
        formatQueryTraceProvider(trace.provider),
      ),
    ),
  );

  if (providers.length === 0) {
    return null;
  }

  return providers.join(", ");
}

function formatQueryTraceError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  return error.replace(SCRAPER_DISCOVERY_MARKER, "").trim();
}

function summarizeVerifiedSources(experiment: PersistedExperiment): string {
  const totalSourceCount = experiment.research?.sources.length ?? 0;
  const verifiedSourceCount =
    experiment.research?.sources.filter((source) => source.verified).length ??
    0;

  return `${verifiedSourceCount}/${totalSourceCount} verified sources`;
}

function latestDiscoveryQuery(experiment: PersistedExperiment): string | null {
  const traces = experiment.research?.queryTraces ?? [];
  const query = traces[traces.length - 1]?.queryText?.trim();
  return query && query.length > 0 ? query : null;
}

function isThinResearchSummary(summary: string): boolean {
  const lowered = summary.toLowerCase();

  return (
    lowered.includes("no patch") ||
    lowered.includes("no patch is generated") ||
    lowered.includes("no patch generated") ||
    lowered.includes("no existing evidence") ||
    lowered.includes("insufficient evidence") ||
    lowered.includes("initial research brief created")
  );
}

function buildSourceHighlight(experiment: PersistedExperiment): string | null {
  const sources = experiment.research?.sources ?? [];
  if (sources.length === 0) {
    return null;
  }

  const preferredSources = sources.some((source) => source.verified)
    ? sources.filter((source) => source.verified)
    : sources;
  const highlights = preferredSources.slice(0, 3).map((source) => {
    const title = source.title || source.label || formatSourceHost(source);
    const verificationLabel = source.verified ? "verified" : "discovered";
    return `${title} (${formatSourceHost(source)}, ${verificationLabel})`;
  });

  if (highlights.length === 0) {
    return null;
  }

  return `Top source signals: ${highlights.join("; ")}.`;
}

function buildQueryTraceHighlight(
  experiment: PersistedExperiment,
): string | null {
  const traces = experiment.research?.queryTraces ?? [];
  if (traces.length === 0) {
    return null;
  }

  const latestTrace = traces[traces.length - 1];
  const provider = formatQueryTraceProvider(latestTrace.provider);
  const base = `${provider} ran ${formatCountLabel(traces.length, "discovery query")}; the latest returned ${formatCountLabel(latestTrace.resultCount, "result")} in ${latestTrace.latencyMs}ms.`;
  const error = formatQueryTraceError(latestTrace.error);

  return error ? `${base} Latest issue: ${error}.` : base;
}

function buildResearchBriefing(experiment: PersistedExperiment): string[] {
  const paragraphs: string[] = [];
  const proposalSummary = experiment.proposal_summary.trim();
  const discoveryQuery = latestDiscoveryQuery(experiment);
  const sources = experiment.research?.sources ?? [];
  const citations = experiment.research?.citations ?? [];
  const verifiedCount = sources.filter((source) => source.verified).length;

  if (proposalSummary && !isThinResearchSummary(proposalSummary)) {
    paragraphs.push(proposalSummary);
  }

  if (discoveryQuery) {
    paragraphs.push(`Research focus: ${discoveryQuery}.`);
  }

  if (sources.length > 0) {
    const evidenceState =
      verifiedCount > 0
        ? `${verifiedCount} of ${sources.length} discovered or cited source URLs were successfully verified during the run.`
        : `${sources.length} candidate sources were gathered, but none of their URLs were successfully verified during the run.`;
    paragraphs.push(evidenceState);
  }

  const sourceHighlight = buildSourceHighlight(experiment);
  if (sourceHighlight) {
    paragraphs.push(sourceHighlight);
  }

  const queryTraceHighlight = buildQueryTraceHighlight(experiment);
  if (queryTraceHighlight) {
    paragraphs.push(queryTraceHighlight);
  }

  if (citations.length === 0 && sources.length > 0) {
    paragraphs.push(
      "No inline citations were written into a persisted research note during this run, so the evidence remains exploratory rather than grounded in an applied markdown patch.",
    );
  }

  if (proposalSummary && isThinResearchSummary(proposalSummary)) {
    paragraphs.push(`Run note: ${proposalSummary}`);
  }

  return paragraphs.length > 0 ? paragraphs : ["No research summary recorded."];
}

function buildResearchMarkdown(experiment: PersistedExperiment) {
  const createdAt = formatExperimentTimestamp(experiment.created_at);
  const providerSummary = summarizeResearchProviders(experiment);
  const scraperIssueCount =
    experiment.research?.queryTraces.filter((trace) =>
      isScraperDiscoveryError(trace.error),
    ).length ?? 0;
  const summaryParagraphs = buildResearchBriefing(experiment);
  const lines = [
    `# Research Experiment ${experiment.id}`,
    "",
    `- Captured: ${createdAt}`,
    `- Weighted score: ${experiment.weighted_total.toFixed(2)}`,
    `- Duration: ${experiment.duration_ms}ms`,
    ...(providerSummary ? [`- Discovery providers: ${providerSummary}`] : []),
    ...(scraperIssueCount > 0
      ? [`- Scraper issues: ${scraperIssueCount}`]
      : []),
    "",
    "## Summary",
    "",
    ...summaryParagraphs.flatMap((paragraph) => [paragraph, ""]),
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
      lines.push(
        `- ${formatQueryTraceProvider(trace.provider)}: ${trace.queryText}`,
      );
      lines.push(
        `  - Executed: ${formatExperimentTimestamp(trace.executedAt)}`,
      );
      lines.push(`  - Result count: ${trace.resultCount}`);
      lines.push(`  - Latency: ${trace.latencyMs}ms`);
      if (trace.topUrls.length) {
        lines.push(`  - Top URLs: ${trace.topUrls.join(", ")}`);
      }
      if (trace.error) {
        lines.push(`  - Error: ${formatQueryTraceError(trace.error)}`);
        if (isScraperDiscoveryError(trace.error)) {
          lines.push("  - Marker: scraper_discovery");
        }
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
  embedded = false,
}: {
  latestResearchExperiment: PersistedExperiment | null;
  embedded?: boolean;
}) {
  const providerSummary = latestResearchExperiment
    ? summarizeResearchProviders(latestResearchExperiment)
    : null;
  const scraperDiscoveryFailures =
    latestResearchExperiment?.research?.queryTraces.filter((trace) =>
      isScraperDiscoveryError(trace.error),
    ).length ?? 0;
  const discoveryQuery = latestResearchExperiment
    ? latestDiscoveryQuery(latestResearchExperiment)
    : null;
  const summaryParagraphs = latestResearchExperiment
    ? buildResearchBriefing(latestResearchExperiment)
    : [];

  const content = (
    <>
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
                  {summarizeVerifiedSources(latestResearchExperiment)}
                </Badge>
                <Badge color="slate">
                  {formatCountLabel(
                    new Set(
                      latestResearchExperiment.research.sources
                        .map((source) => source.host)
                        .filter((host): host is string => Boolean(host)),
                    ).size,
                    "host",
                  )}
                </Badge>
                <Badge color="slate">
                  {formatCountLabel(
                    latestResearchExperiment.research.queryTraces.length,
                    "query",
                  )}
                </Badge>
                {providerSummary ? (
                  <Badge color="slate">{providerSummary}</Badge>
                ) : null}
                {scraperDiscoveryFailures > 0 ? (
                  <Badge color="rose">
                    {formatCountLabel(
                      scraperDiscoveryFailures,
                      "scraper issue",
                    )}
                  </Badge>
                ) : null}
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
            {discoveryQuery ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                <Badge color="blue">Discovery Query</Badge>
                <div
                  className="min-w-0 flex-1 truncate text-xs text-slate-300"
                  title={discoveryQuery}
                >
                  {discoveryQuery}
                </div>
              </div>
            ) : null}
            <div className="mt-3 space-y-2">
              {summaryParagraphs.map((paragraph, index) => (
                <div
                  key={`${latestResearchExperiment.id}-summary-${index}`}
                  className="text-sm leading-relaxed text-slate-300"
                >
                  {paragraph}
                </div>
              ))}
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
                      <Badge
                        color={
                          source.verified
                            ? "emerald"
                            : source.fetchError
                              ? "rose"
                              : "slate"
                        }
                      >
                        {source.verified
                          ? "Verified"
                          : source.fetchError
                            ? "Failed"
                            : "Unverified"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge color="slate">
                        {formatCountLabel(source.citationCount, "citation")}
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
                        <Badge color="blue">
                          {formatQueryTraceProvider(trace.provider)}
                        </Badge>
                        <Badge color={trace.error ? "rose" : "emerald"}>
                          {trace.error
                            ? "Failed"
                            : `${trace.resultCount} results`}
                        </Badge>
                        {isScraperDiscoveryError(trace.error) ? (
                          <Badge color="rose">Scraper Issue</Badge>
                        ) : null}
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
                          {formatQueryTraceError(trace.error)}
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
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <GlassCard title="Research Evidence" icon={Search} className="h-full">
      {content}
    </GlassCard>
  );
}
