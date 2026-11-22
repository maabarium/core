import { fireEvent, render, screen } from "@testing-library/react";
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
