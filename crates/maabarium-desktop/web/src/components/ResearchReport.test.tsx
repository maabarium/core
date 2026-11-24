import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { ResearchReport } from "./ResearchReport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("resumes a saved starter campaign and offers the next review step", async () => {
  const result = { questions: 5, matches: 5, scan_checks: 20, lookup_checks: 20 };
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValueOnce({ stage: "first_review", first: result, final_result: null })
    .mockResolvedValueOnce({ stage: "final_review", first: result, final_result: result })
    .mockResolvedValueOnce({ stage: "finished", first: result, final_result: result });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Open starter campaign" }));
  fireEvent.click(await screen.findByRole("button", { name: "Run final check on different questions" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish starter campaign" }));
  expect(await screen.findByText("Starter campaign finished. These results are separate from your research trials.")).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["research_starter_campaign", { action: "status" }],
    ["research_starter_campaign", { action: "final_check" }],
    ["research_starter_campaign", { action: "finish" }],
  ]);
});

it("runs a local practice experiment without opening the queue or starting a campaign", async () => {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValueOnce({ questions: 5, matches: 5, scan_checks: 20, lookup_checks: 15 })
    .mockResolvedValueOnce({ questions: 5, matches: 5, scan_checks: 20, lookup_checks: 16 });
  render(<ResearchReport />);
  fireEvent.click(screen.getByText("Try a practice experiment"));
  fireEvent.click(screen.getByRole("button", { name: "Run practice experiment" }));
  expect(await screen.findByText("Both methods gave the expected answer on 5 of 5 questions.")).toBeTruthy();
  expect(screen.getByText("Keep splitting the list in half: 15 comparisons")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run final check" }));
  expect(await screen.findByText("Final check on different questions")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Finish practice" }));
  expect(screen.getByText("Practice complete. No campaign work was started.")).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["research_campaign_practice", { finalCheck: false }],
    ["research_campaign_practice", { finalCheck: true }],
  ]);
});

it("creates a campaign without queuing a benchmark", async () => {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValueOnce({ experiments: 0, lanes: [] })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ experiments: 0, lanes: [],
      campaigns: [{ id: "demo", status: "active", limit: 12, audited_trials: 0, rejected_trials: 0, operational_failures: 0 }] });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  fireEvent.click(await screen.findByText("Create a research campaign"));
  fireEvent.change(screen.getByLabelText("Campaign ID"), { target: { value: "demo" } });
  fireEvent.change(screen.getByLabelText("Trial limit"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Public brief for adaptive proposals (optional)"), {
    target: { value: "Compare two exact synthetic solvers." },
  });
  fireEvent.click(screen.getByText("Suggestion providers and model settings"));
  fireEvent.change(screen.getByLabelText("Proposer provider"), { target: { value: "muse" } });
  fireEvent.change(screen.getByLabelText("Proposer reasoning effort"), { target: { value: "ultra" } });
  fireEvent.change(screen.getByLabelText("Independent checker provider"), { target: { value: "deepseek" } });
  expect(Array.from((screen.getByLabelText("Independent checker reasoning effort") as HTMLSelectElement).options, option => option.value)).toEqual(["", "none", "low", "high", "max"]);
  fireEvent.change(screen.getByLabelText("Independent checker reasoning effort"), { target: { value: "none" } });
  expect((screen.getByRole("button", { name: "Create campaign" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: /Allow paid DeepSeek/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
  expect(await screen.findByText("0 of 12 audited trials · Active")).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "research_queue_report", "research_campaign_create", "research_queue_report",
  ]);
  expect(invoke).toHaveBeenCalledWith("research_campaign_create", {
    id: "demo", limit: 12, publicBrief: "Compare two exact synthetic solvers.",
    providers: [{ lane: "muse", model: null, effort: "ultra" }, { lane: "deepseek", model: null, effort: "none" }],
    allowPaid: true,
  });
});

it("approves the displayed checkpoint without creating a new campaign", async () => {
  const checkpoint = { id: "demo", status: "checkpoint", limit: 10,
    audited_trials: 2, rejected_trials: 2, operational_failures: 0 };
  vi.mocked(invoke).mockResolvedValueOnce({ experiments: 0, lanes: [], campaigns: [checkpoint] })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ experiments: 0, lanes: [], campaigns: [{ ...checkpoint, status: "active" }] });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve and resume campaign" }));
  expect(await screen.findByText("2 of 10 audited trials · Active")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("research_campaign_start", { id: "demo", reviewedTrials: 2 });
});

it("shows audited campaigns separately from provider jobs", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    experiments: 8,
    lanes: [],
    campaigns: [{ id: "coda-demo", status: "target_achieved", limit: 200, audited_trials: 3, rejected_trials: 2, operational_failures: 1,
      proposal_usage: [{ lane: "codex", jobs: 3, observed_jobs: 2, input: 120, output: 0 }],
      trial_outcomes: ["fail", "fail", "pass"], confirmation_outcome: "pass" }],
  });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByText("3 of 200 audited trials · Target achieved")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Research campaigns" })).toBeTruthy();
  for (const [label, count] of [["Passed", "1"], ["Did not meet the target", "2"], ["Could not be checked", "1"]]) {
    expect(screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent).toBe(count);
  }
  expect(screen.getByText("Final check passed on the separate test panel.")).toBeTruthy();
  expect(screen.getByText("Trial results").closest("details")?.open).toBe(false);
  expect(screen.getByText("Token usage for suggestions").closest("details")?.open).toBe(false);
  expect(screen.getByText("Usage reported for 2 of 3 jobs.")).toBeTruthy();
  expect(screen.getByText("Output").nextElementSibling?.textContent).toBe("0");
});

it("distinguishes blocked autonomy from an idle active campaign", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    experiments: 0,
    lanes: [],
    campaigns: [{ id: "study", status: "blocked", limit: 20, audited_trials: 1,
      rejected_trials: 1, operational_failures: 0, autonomy_reason: "Approved experiments exhausted" }],
  });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByText("1 of 20 audited trials · Blocked")).toBeTruthy();
  expect(screen.getByText("Approved experiments exhausted")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send public brief to selected providers" })).toBeNull();
});

it("shows terminal rates and reveals provider details only with the switch", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    experiments: 2,
    lanes: [{ lane: "claude", jobs: 5, completed: 2, failed: 1, stopped: 1,
      pending: 1, attempts: 4, observed_jobs: 1, input: 30, output: null, cached: 0 }],
  }).mockResolvedValueOnce(null);
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByText("2 · 67%")).toBeTruthy();
  expect(screen.getByText("1 · 33%")).toBeTruthy();
  expect(screen.queryByText("Cache reads")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Show provider details" }));
  expect(screen.getByText("Cache reads")).toBeTruthy();
  expect(screen.queryByText("Output")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check Muse allowance" }));
  expect(await screen.findByText("Muse did not report an allowance.")).toBeTruthy();
});
