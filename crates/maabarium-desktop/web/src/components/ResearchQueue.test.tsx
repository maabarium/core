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
  fireEvent.click(screen.getByText("Set up Muse"));
  expect(screen.getByText("muse usage")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Queue task" }));
  expect(await screen.findByText("Muse: queued")).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_queue_enqueue", { lane: "muse" });
  expect(invoke).toHaveBeenNthCalledWith(2, "research_queue_list");
});

it("starts a public experiment with an ordered provider plan", async () => {
  cleanup();
  vi.mocked(invoke).mockReset().mockResolvedValueOnce("example-loop").mockResolvedValueOnce([]);
  render(<ResearchQueue />);
  fireEvent.click(screen.getByText("Configure an experiment"));
  fireEvent.change(screen.getByLabelText("Public research target"), { target: { value: "Compare public rules" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Codex step" }));
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "muse" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Muse step" }));
  fireEvent.click(screen.getByRole("button", { name: "Start experiment" }));
  expect(await screen.findByText(/Experiment ID: example-loop/)).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(1, "research_loop_start", {
    target: "Compare public rules", plan: ["codex", "muse"],
  });
});
