import type {
  FilePatch,
  HistoryRow,
  PersistedExperiment,
} from "../types/console";

export function parseTokenUsage(line: string): number | null {
  const match = line.match(/tokens_used=(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function formatPercentageDelta(
  current: number,
  previous: number,
): string {
  if (!previous) {
    return "Baseline";
  }
  return `${((current - previous) / previous) * 100 >= 0 ? "+" : ""}${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export function invertDelta(delta: string): string {
  if (delta.startsWith("+")) {
    return `-${delta.slice(1)}`;
  }
  if (delta.startsWith("-")) {
    return `+${delta.slice(1)}`;
  }
  return delta;
}

export function buildHistory(experiments: PersistedExperiment[]): HistoryRow[] {
  const successful = experiments.filter((experiment) => !experiment.error);
  const rows = experiments.slice(0, 8).map((experiment) => {
    if (experiment.error) {
      return {
        experimentId: experiment.id,
        score: null,
        delta: null,
        summary: experiment.error,
        status: "failed" as const,
      };
    }

    const currentIndex = successful.findIndex(
      (candidate) => candidate.id === experiment.id,
    );
    const previous =
      currentIndex >= 0 ? successful[currentIndex + 1] : undefined;
    const delta = previous
      ? experiment.weighted_total - previous.weighted_total
      : 0;

    return {
      experimentId: experiment.id,
      score: experiment.weighted_total,
      delta,
      summary: experiment.proposal_summary || "No proposal summary recorded",
      status: delta >= 0 ? ("promoted" as const) : ("rejected" as const),
    };
  });

  if (rows.length > 0) {
    return rows;
  }

  return [];
}

export function buildPatchPreview(
  patch: FilePatch,
): { color: string; line: string }[] {
  const op = patch.operation.toLowerCase();
  if (op === "delete") {
    return [{ color: "text-rose-400", line: `- removed ${patch.path}` }];
  }

  const prefix = op === "create" ? "+" : "~";
  const color = op === "create" ? "text-teal-300" : "text-amber-300";
  return (patch.content || "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({ color, line: `${prefix}${line}` }));
}
