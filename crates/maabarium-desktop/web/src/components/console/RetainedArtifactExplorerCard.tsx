import { useEffect, useMemo, useState } from "react";
import { Archive, Download, FileText, Trophy } from "lucide-react";
import { buildPatchPreview } from "../../lib/analytics";
import {
  formatCountLabel,
  formatExperimentTimestamp,
} from "../../lib/formatters";
import type { RetainedWinnerEntry } from "../../lib/winners";
import type { FilePatch } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

const MAX_PREVIEW_LINES = 24;

function triggerDownload(
  content: BlobPart,
  fileName: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function sanitizeDownloadName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function fileNameFromPath(value: string): string {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

function exportPatchset(entry: RetainedWinnerEntry) {
  const fileName = `maabarium-retained-winner-${entry.experiment.id}.json`;
  triggerDownload(
    JSON.stringify(
      {
        experiment: entry.experiment,
        proposal: entry.proposal,
      },
      null,
      2,
    ),
    fileName,
    "application/json;charset=utf-8",
  );

  return fileName;
}

function downloadPatchContent(experimentId: number, patch: FilePatch) {
  if (!patch.content) {
    return;
  }

  const fileName = `winner-${experimentId}-${sanitizeDownloadName(patch.path.split("/").pop() || patch.path)}`;

  triggerDownload(patch.content, fileName, "text/plain;charset=utf-8");

  return fileName;
}

function patchBadgeColor(
  operation: string,
): "blue" | "emerald" | "rose" | "slate" {
  const normalized = operation.toLowerCase();
  if (normalized === "create") {
    return "emerald";
  }
  if (normalized === "delete") {
    return "rose";
  }
  if (normalized === "modify") {
    return "blue";
  }
  return "slate";
}

function WinnerPatchPreview({ patch }: { patch: FilePatch }) {
  const previewLines = buildPatchPreview(patch);
  const truncated = previewLines.length > MAX_PREVIEW_LINES;
  const visiblePreviewLines = previewLines.slice(0, MAX_PREVIEW_LINES);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={patchBadgeColor(patch.operation)}>
          {patch.operation}
        </Badge>
        <div className="text-sm font-semibold text-slate-100">{patch.path}</div>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[11px] leading-loose text-slate-500">
        {visiblePreviewLines.length > 0 ? (
          visiblePreviewLines.map((previewLine, index) => (
            <div
              key={`${patch.path}-${previewLine.line}-${index}`}
              className={previewLine.color}
            >
              {previewLine.line}
            </div>
          ))
        ) : (
          <div className="text-slate-500">
            Persisted proposal metadata recorded this file change without inline
            content.
          </div>
        )}
        {truncated ? (
          <div className="pt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Showing first {MAX_PREVIEW_LINES} changed lines.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RetainedArtifactExplorerCard({
  winnerHistory,
  selectedExperimentId,
  onSelectExperimentId,
  onExportFiles,
  embedded = false,
}: {
  winnerHistory: RetainedWinnerEntry[];
  selectedExperimentId: number | null;
  onSelectExperimentId: (experimentId: number) => void;
  onExportFiles: (
    entry: RetainedWinnerEntry,
  ) =>
    | Promise<{ fileName: string; bytes: number[] } | null | void>
    | { fileName: string; bytes: number[] }
    | null
    | void;
  embedded?: boolean;
}) {
  const selectedEntry = useMemo(
    () =>
      winnerHistory.find(
        (entry) => entry.experiment.id === selectedExperimentId,
      ) ??
      winnerHistory[0] ??
      null,
    [selectedExperimentId, winnerHistory],
  );
  const [selectedPatchPath, setSelectedPatchPath] = useState<string | null>(
    null,
  );
  const [exportingExperimentId, setExportingExperimentId] = useState<
    number | null
  >(null);
  const [latestExport, setLatestExport] = useState<{
    experimentId: number;
    fileName: string;
  } | null>(null);
  const [latestDownload, setLatestDownload] = useState<{
    experimentId: number;
    title: string;
    fileName: string;
  } | null>(null);

  useEffect(() => {
    const nextPath = selectedEntry?.proposal?.file_patches[0]?.path ?? null;
    if (
      selectedPatchPath === null ||
      !selectedEntry?.proposal?.file_patches.some(
        (patch) => patch.path === selectedPatchPath,
      )
    ) {
      setSelectedPatchPath(nextPath);
    }
  }, [selectedEntry, selectedPatchPath]);

  const selectedPatch =
    selectedEntry?.proposal?.file_patches.find(
      (patch) => patch.path === selectedPatchPath,
    ) ??
    selectedEntry?.proposal?.file_patches[0] ??
    null;

  const handleExportFiles = async (entry: RetainedWinnerEntry) => {
    setLatestExport(null);
    setLatestDownload(null);
    setExportingExperimentId(entry.experiment.id);

    try {
      const exportedArchive = await onExportFiles(entry);
      if (
        exportedArchive &&
        typeof exportedArchive.fileName === "string" &&
        Array.isArray(exportedArchive.bytes)
      ) {
        triggerDownload(
          new Uint8Array(exportedArchive.bytes),
          exportedArchive.fileName,
          "application/gzip",
        );
        setLatestExport({
          experimentId: entry.experiment.id,
          fileName: exportedArchive.fileName,
        });
      }
    } finally {
      setExportingExperimentId((current) =>
        current === entry.experiment.id ? null : current,
      );
    }
  };

  const exportInFlight = selectedEntry
    ? exportingExperimentId === selectedEntry.experiment.id
    : false;
  const latestExportForSelection =
    selectedEntry && latestExport?.experimentId === selectedEntry.experiment.id
      ? latestExport
      : null;
  const latestDownloadForSelection =
    selectedEntry &&
    latestDownload?.experimentId === selectedEntry.experiment.id
      ? latestDownload
      : null;

  const content = (
    <>
      {winnerHistory.length === 0 || !selectedEntry ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-500">
          No retained winner is loaded in the current snapshot yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Retained Winner History
            </div>
            <div className="mt-3 space-y-2">
              {winnerHistory.map((entry, index) => {
                const active =
                  entry.experiment.id === selectedEntry.experiment.id;
                return (
                  <button
                    key={entry.experiment.id}
                    type="button"
                    onClick={() => onSelectExperimentId(entry.experiment.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-amber-400/35 bg-amber-500/10"
                        : "border-white/10 bg-slate-950/50 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                        {index === 0
                          ? "Current winner"
                          : `Earlier winner ${index}`}
                      </div>
                      <Badge color="emerald">#{entry.experiment.id}</Badge>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {entry.experiment.weighted_total.toFixed(2)} score
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatExperimentTimestamp(entry.experiment.created_at)}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatCountLabel(
                        entry.proposal?.file_patches.length ?? 0,
                        "file",
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Trophy size={16} className="text-amber-300" />
                    Retained winner experiment #{selectedEntry.experiment.id}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-slate-300">
                    {selectedEntry.proposal?.summary ||
                      selectedEntry.experiment.proposal_summary ||
                      "No retained proposal summary recorded."}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExportFiles(selectedEntry)}
                    disabled={
                      !selectedEntry.experiment.promoted_commit_oid ||
                      exportInFlight
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-950/60 disabled:text-slate-500"
                  >
                    <Archive size={14} />
                    {exportInFlight
                      ? "Exporting Archive..."
                      : "Export Files (.tar.gz)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const fileName = exportPatchset(selectedEntry);
                      setLatestExport(null);
                      setLatestDownload({
                        experimentId: selectedEntry.experiment.id,
                        title: "Patchset download started.",
                        fileName,
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                  >
                    <Download size={14} />
                    Export Patchset
                  </button>
                  <div className="text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      Winner Score
                    </div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-white">
                      {selectedEntry.experiment.weighted_total.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Badge color="emerald">Promoted</Badge>
                <Badge color="slate">
                  {formatExperimentTimestamp(
                    selectedEntry.experiment.created_at,
                  )}
                </Badge>
                <Badge color="blue">
                  {formatCountLabel(
                    selectedEntry.proposal?.file_patches.length ?? 0,
                    "file",
                  )}
                </Badge>
              </div>

              {exportInFlight ? (
                <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
                  Packaging the retained winner files into a tar.gz archive...
                </div>
              ) : null}

              {latestExportForSelection ? (
                <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100/90">
                  <div className="font-semibold text-emerald-100">
                    Archive download started.
                  </div>
                  <div className="mt-1 break-all text-emerald-100/70">
                    {fileNameFromPath(latestExportForSelection.fileName)}
                  </div>
                </div>
              ) : null}

              {latestDownloadForSelection ? (
                <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100/90">
                  <div className="font-semibold text-sky-100">
                    {latestDownloadForSelection.title}
                  </div>
                  <div className="mt-1 break-all text-sky-100/70">
                    {latestDownloadForSelection.fileName}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedEntry.proposal ? (
              selectedEntry.proposal.file_patches.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      <FileText size={13} className="text-teal-300" />
                      Winner Output Preview
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      One file at a time keeps large multi-file winners
                      readable.
                    </div>
                  </div>

                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    {selectedEntry.proposal.file_patches.map((patch) => {
                      const active = patch.path === selectedPatch?.path;
                      return (
                        <button
                          key={`${selectedEntry.proposal?.id}-${patch.path}`}
                          type="button"
                          onClick={() => setSelectedPatchPath(patch.path)}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                            active
                              ? "border-teal-400/35 bg-teal-500/10"
                              : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="min-w-0 flex-1 text-sm text-slate-200">
                            <div className="truncate">{patch.path}</div>
                          </div>
                          <Badge color={patchBadgeColor(patch.operation)}>
                            {patch.operation}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>

                  {selectedPatch ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-100">
                          {selectedPatch.path}
                        </div>
                        {selectedPatch.content ? (
                          <button
                            type="button"
                            onClick={() => {
                              const fileName = downloadPatchContent(
                                selectedEntry.experiment.id,
                                selectedPatch,
                              );
                              if (!fileName) {
                                return;
                              }

                              setLatestExport(null);
                              setLatestDownload({
                                experimentId: selectedEntry.experiment.id,
                                title: "Persisted preview download started.",
                                fileName,
                              });
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                          >
                            <Download size={14} />
                            Download Persisted Preview
                          </button>
                        ) : null}
                      </div>
                      <WinnerPatchPreview patch={selectedPatch} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-500">
                  The retained winner was loaded, but its persisted proposal
                  contains no file patch data.
                </div>
              )
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-500">
                Waiting for the retained winner&apos;s persisted proposal
                patchset.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <GlassCard title="Retained Artifacts" icon={Archive} glow>
      {content}
    </GlassCard>
  );
}
