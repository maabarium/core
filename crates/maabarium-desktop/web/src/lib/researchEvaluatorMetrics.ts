const metricsTitle = "Latest Evaluator Metrics";

// The local runner's audited summary has a fixed per-workload format.
// Never substitute unrelated workflow scores for missing benchmark evidence.
export function researchEvaluatorMetrics(title: string, report: string | null) {
  const unavailable = { title: metricsTitle, subtitle: title, points: [], labels: [] };
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
  };
}
