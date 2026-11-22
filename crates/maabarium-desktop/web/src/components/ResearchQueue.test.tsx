import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ResearchQueue } from "./ResearchQueue";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("queues the selected provider and displays manual handoff without claiming authentication", async () => {
  vi.mocked(invoke).mockResolvedValueOnce("muse-example").mockResolvedValueOnce([
    { id: "muse-example", lane: "muse", state: "queued", attempts: 0, detail: "awaiting manual handoff", result: null },
  ]);
  render(<ResearchQueue />);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "muse" } });
  fireEvent.click(screen.getByRole("button", { name: "Expand Set up Muse" }));
  expect(screen.getByText("muse usage")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Queue task" }));
  expect(await screen.findByRole("heading", { name: "Muse check" })).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_queue_enqueue", { lane: "muse" });
  expect(invoke).toHaveBeenNthCalledWith(2, "research_queue_list");
});

it("locks the local rule and a separate subscription reviewer in Both mode", async () => {
  cleanup();
  vi.mocked(invoke).mockReset().mockResolvedValueOnce("both-loop").mockResolvedValueOnce([]);
  render(<ResearchQueue />);
  fireEvent.change(screen.getByLabelText("Public research target"), { target: { value: "Public fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Expand Set up an experiment" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Codex step" }));
  fireEvent.change(screen.getByLabelText("How should we review this experiment?"), { target: { value: "both" } });
  const start = screen.getByRole("button", { name: "Start experiment" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reviewer provider"), { target: { value: "claude" } });
  fireEvent.change(screen.getByLabelText("Reviewer model"), { target: { value: "opus" } });
  fireEvent.change(screen.getByLabelText("Reviewer thinking effort"), { target: { value: "high" } });
  fireEvent.click(screen.getByRole("button", { name: "Fill in an example baseline" }));
  fireEvent.click(start);
  expect(await screen.findByText(/Experiment ID: both-loop/)).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_loop_start", {
    target: "Public fixture", plan: [{ lane: "codex", model: null, effort: null }], reviewEvery: 1,
    evaluation: { baseline: expect.stringContaining("public-example-v1"), minimumSavingsPercent: 20 },
    reviewer: { lane: "claude", model: "opus", effort: "high" },
  });
});

it("starts a public experiment with an ordered provider plan", async () => {
  cleanup();
  vi.mocked(invoke).mockReset().mockResolvedValueOnce("example-loop").mockResolvedValueOnce([]);
  render(<ResearchQueue />);
  fireEvent.click(screen.getByRole("button", { name: "Expand Set up an experiment" }));
  fireEvent.change(screen.getByLabelText("Public research target"), { target: { value: "Compare public rules" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Codex step" }));
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "muse" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Muse step" }));
  fireEvent.change(screen.getByLabelText("Model for step 1"), { target: { value: "gpt-5.6-sol" } });
  fireEvent.change(screen.getByLabelText("Thinking effort for step 1"), { target: { value: "high" } });
  fireEvent.change(screen.getByLabelText("Pause for review after"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Start experiment" }));
  expect(await screen.findByText(/Experiment ID: example-loop/)).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_loop_start", {
    target: "Compare public rules", plan: [
      { lane: "codex", model: "gpt-5.6-sol", effort: "high" },
      { lane: "muse", model: null, effort: null },
    ], reviewEvery: 2,
  });
});

it("requires a separate paid opt-in before starting a DeepSeek research step", async () => {
  cleanup();
  vi.mocked(invoke).mockReset().mockResolvedValueOnce("paid-loop").mockResolvedValueOnce([]);
  render(<ResearchQueue />);
  fireEvent.change(screen.getByLabelText("Public research target"), { target: { value: "Public fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Expand Set up an experiment" }));
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
  fireEvent.click(screen.getByRole("button", { name: "Add DeepSeek (paid API) step" }));
  const start = screen.getByRole("button", { name: "Start experiment" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Allow DeepSeek API charges for this experiment" }));
  fireEvent.click(start);
  expect(await screen.findByText(/Experiment ID: paid-loop/)).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_loop_start", {
    target: "Public fixture", plan: [{ lane: "deepseek", model: null, effort: null }],
    reviewEvery: 1, allowPaid: true,
  });
});

it("accepts a dropped JSON evidence file and rejects oversized files", async () => {
  cleanup();
  render(<ResearchQueue />);
  fireEvent.click(screen.getByRole("button", { name: "Expand Check experiment evidence" }));
  const dropZone = screen.getByRole("button", { name: /Drop a candidate results file/ });
  fireEvent.drop(dropZone, { dataTransfer: { files: [new File(["x".repeat(65537)], "large.json")] } });
  expect(screen.getByRole("alert").textContent).toMatch(/64 KiB/);
  const file = new File(["{}"], "candidate.json");
  Object.defineProperty(file, "text", { value: async () => "{}" });
  fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
  expect(await screen.findByText("Loaded candidate.json")).toBeTruthy();
  expect((screen.getByLabelText("Candidate results (JSON)") as HTMLTextAreaElement).value).toBe("{}");
});

it("tells reviewers how to decide AI steps and points local reviews to their checkpoint", async () => {
  cleanup();
  const longTarget = "Public synthetic research: exact subset-existence under edits. Given four sets of bit masks, a query is true iff each set contains a row that is a subset of the query mask.";
  vi.mocked(invoke).mockReset().mockResolvedValueOnce([
    { id: "loop:ai-run:3", lane: "codex", state: "done", attempts: 1, detail: "ChatGPT", result: "Finding: ok",
      experiment_title: longTarget, experiment_active: true, review_pending: true, review_continues: true },
    { id: "loop:bench:review", lane: "claude", state: "done", attempts: 1, detail: "review", result: "Finding: advice",
      experiment_title: "Bench", experiment_active: true, review_pending: true },
    { id: "loop:bench:1", lane: "Local evidence", state: "done", attempts: 1, detail: "Local check complete",
      result: "Finding: **Local gate pass**", experiment_title: "Bench", experiment_active: true, review_pending: false },
  ]);
  render(<ResearchQueue />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  const heading = await screen.findByRole("heading", { name: /^Public synthetic research/ });
  expect(heading.textContent?.endsWith("…")).toBe(true);
  expect(screen.queryByText("Decide in Terminal")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
  expect(screen.getByText("Approval queues the next configured step.")).toBeTruthy();
  expect(screen.getByText(/approve or stop the experiment on its local benchmark card/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve and close review" })).toBeTruthy();
});

it("shows a held adaptive successor as waiting for approval", async () => {
  cleanup();
  vi.mocked(invoke).mockReset().mockResolvedValueOnce([
    { id: "loop:bench-next:1", lane: "Local evidence", state: "queued", attempts: 0,
      detail: "Held until bench is approved", result: null, experiment_title: "Next benchmark",
      experiment_active: false, review_pending: false },
  ]);
  render(<ResearchQueue />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  expect(await screen.findByText("Held for your approval")).toBeTruthy();
  expect(screen.getByText(/runs only after you approve that result/)).toBeTruthy();
});
