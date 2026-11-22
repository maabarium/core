import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { ResearchReport } from "./ResearchReport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
