import { expect, test } from "vitest";
import { researchStepLabel, shortTitle } from "./titles";

test("short titles are unchanged and whitespace is tidied", () => {
  expect(shortTitle("CODA SF27-F2 · Bursty query demand")).toBe("CODA SF27-F2 · Bursty query demand");
  expect(shortTitle("a\n  b")).toBe("a b");
});

test("long titles end at a word with an ellipsis", () => {
  const long = "Public synthetic research: exact subset-existence under edits. Given four sets of bit masks, a query is true iff each set contains a row that is a subset of the query mask.";
  const short = shortTitle(long);
  expect(short.length).toBeLessThanOrEqual(110);
  expect(short.endsWith("…")).toBe(true);
  expect(long.startsWith(short.slice(0, -1))).toBe(true);
  expect(short.slice(-2, -1)).not.toBe(" ");
});

test("step labels come from the job id so reviews do not shift numbering", () => {
  expect(researchStepLabel("loop:run:3")).toBe("Step 3");
  expect(researchStepLabel("loop:run:review")).toBe("AI review");
  expect(researchStepLabel("loop:run:x")).toBe("Research step");
});
