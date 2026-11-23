import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { ManagedBenchmark } from "./ManagedBenchmark";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

it("offers available campaigns and completed suggestions without needing to copy IDs", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ campaigns: [
    { id: "class-project", status: "active", ready_proposal_rounds: ["initial"] },
    { id: "finished-project", status: "target_achieved" },
  ] });
  render(<ManagedBenchmark onQueued={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Expand Set up a local benchmark" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Add this test to a campaign (optional)" }));
  fireEvent.click(screen.getByRole("button", { name: "Find my campaigns" }));
  const chooser = await screen.findByLabelText("Campaign");
  expect(screen.queryByText("finished-project")).toBeNull();
  fireEvent.change(chooser, { target: { value: "class-project" } });
  expect(screen.getByLabelText("Link the suggestions that inspired this test (optional)")).toBeTruthy();
  expect(screen.getByRole("option", { name: "initial" })).toBeTruthy();
});
