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

it("charts audited F2 results even when the direct scan win threshold fails", () => {
  const rows = [3, 4, 5].flatMap(width => [0, 1, 2].flatMap(layout =>
    [["delta", 0.629], ["transform", 0.593], ["leaf-scan", 0.827]].map(([arm, ratio]) =>
      `width ${width}, layout ${layout}, ${arm}: ${width === 3 && layout === 0 && arm === "leaf-scan" ? 18 : 24}/24 wins, ratio ${ratio}`)));
  const report = ["Finding: **Local gate fail**", "", "Oracle parity: passed.", ...rows].join("\n");
  const chart = researchEvaluatorMetrics("CODA SF27-F2", report);
  expect(chart.points).toHaveLength(4);
  expect(chart.points[0]).toBe(1);
  expect(chart.points[3]).toBeCloseTo(0.173);
  expect(chart.gateNotes).toEqual(["Width 3, narrow layout: 18 of 24 wins against direct leaf scan (20 required)."]);
  expect(researchEvaluatorMetrics("CODA", report.replace(rows[0], rows[1])).points).toEqual([]);
});
