import { expect, it } from "vitest";
import { researchEvaluatorMetrics } from "./researchEvaluatorMetrics";

it("uses parity and the smallest savings across all distinct reported workloads", () => {
  const rows = [3, 4, 5].flatMap(width => ["narrow", "middle", "full"].map(layout =>
    `- Width ${width}, ${layout}: signed delta ${width === 4 ? "0.7" : "0.4"}× (5/6 wins); direct transform ${width === 3 ? "0.6" : "0.3"}× (5/6 wins).`));
  const report = ["All answers matched the independent enumeration oracle.", ...rows].join("\n");
  const chart = researchEvaluatorMetrics("CODA", report);
  expect(chart.subtitle).toBe("CODA");
  expect(chart.points).toHaveLength(3);
  expect(chart.points[0]).toBe(1);
  expect(chart.points[1]).toBeCloseTo(0.3);
  expect(chart.points[2]).toBeCloseTo(0.4);
  expect(researchEvaluatorMetrics("CODA", report.replace(rows[0], rows[1])).points).toEqual([]);
  expect(researchEvaluatorMetrics("CODA", null).points).toEqual([]);
});
