const metricsTitle = "Latest Evaluator Metrics";
const burstBaselines = ["delta", "transform", "leaf-scan"] as const;
const baselineNames = {
  delta: "signed delta",
  transform: "direct transform",
  "leaf-scan": "direct leaf scan",
};
const layouts = ["narrow", "middle", "full"];

function burstMetrics(report: string) {
  const parity = /^Oracle parity: (passed|failed)\.$/m.exec(report)?.[1];
  if (!parity) return null;
  const rows = [...report.matchAll(
    /^width ([345]), layout ([012]), (delta|transform|leaf-scan): (\d+)\/24 wins, ratio (\d+(?:\.\d+)?)$/gm,
  )].map(([, width, layout, arm, wins, ratio]) => ({
    width, layout, arm: arm as keyof typeof baselineNames, wins: Number(wins), ratio: Number(ratio),
  }));
  if (rows.length !== 27 || new Set(rows.map(row => `${row.width}:${row.layout}:${row.arm}`)).size !== 27
    || rows.some(row => row.wins > 24 || !Number.isFinite(row.ratio))) return null;
  const gateNotes = rows.flatMap(row => row.wins < 20 ? [
    `Width ${row.width}, ${layouts[Number(row.layout)]} layout: ${row.wins} of 24 wins against ${baselineNames[row.arm]} (20 required).`,
  ] : []);
  return {
    points: [parity === "passed" ? 1 : 0, ...burstBaselines.map(arm =>
      Math.max(0, 1 - Math.max(...rows.filter(row => row.arm === arm).map(row => row.ratio))),
    )],
    labels: ["Answer parity", ...burstBaselines.map(arm => `Min. savings vs ${baselineNames[arm]}`)],
    gateNotes,
  };
}

// The local runner's audited summary has a fixed per-workload format.
// Never substitute unrelated workflow scores for missing benchmark evidence.
export function researchEvaluatorMetrics(title: string, report: string | null) {
  const unavailable = { title: metricsTitle, subtitle: title, points: [], labels: [], gateNotes: [] as string[] };
  const burst = report && burstMetrics(report);
  if (burst) return { ...unavailable, ...burst };
  if (!report?.includes("All answers matched the independent enumeration oracle.")) return unavailable;
  const rows = Array.from(report.matchAll(
    /^- Width (\d+), (narrow|middle|full): signed delta (\d+(?:\.\d+)?)× \(\d+\/6 wins\); direct transform (\d+(?:\.\d+)?)× \(\d+\/6 wins\)\.$/gm,
  ));
  if (rows.length !== 9 || new Set(rows.map(row => `${row[1]}:${row[2]}`)).size !== 9) return unavailable;
  const delta = Math.max(...rows.map(row => Number(row[3])));
  const transform = Math.max(...rows.map(row => Number(row[4])));
  if (![delta, transform].every(value => Number.isFinite(value) && value > 0 && value <= 1)) return unavailable;
  return {
    title: metricsTitle,
    subtitle: title,
    points: [1, 1 - delta, 1 - transform],
    labels: ["Answer parity", "Min. savings vs signed delta", "Min. savings vs direct transform"],
    gateNotes: [],
  };
}
