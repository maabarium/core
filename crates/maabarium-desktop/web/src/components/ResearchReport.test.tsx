import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { ResearchReport } from "./ResearchReport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
      campaigns: [{ id: "demo", status: "active", limit: 12, audited_trials: 0 }] });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  fireEvent.click(await screen.findByText("Create a research campaign"));
  fireEvent.change(screen.getByLabelText("Campaign ID"), { target: { value: "demo" } });
  fireEvent.change(screen.getByLabelText("Trial limit"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Public brief for adaptive proposals (optional)"), {
    target: { value: "Compare two exact synthetic solvers." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
  expect(await screen.findByText("0 of 12 audited trials · Active")).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "research_queue_report", "research_campaign_create", "research_queue_report",
  ]);
  expect(invoke).toHaveBeenCalledWith("research_campaign_create", {
    id: "demo", limit: 12, publicBrief: "Compare two exact synthetic solvers.",
  });
});

it("shows audited campaigns separately from provider jobs", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    experiments: 8,
    lanes: [],
    campaigns: [{ id: "coda-demo", status: "target_achieved", limit: 200, audited_trials: 3 }],
  });
  render(<ResearchReport />);
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByText("3 of 200 audited trials · Target achieved")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Research campaigns" })).toBeTruthy();
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
