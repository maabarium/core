import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QuitConfirmDialog } from "./QuitConfirmDialog";

it("explains what quitting stops, keeps running by default, and quits only on confirmation", async () => {
  const onKeepRunning = vi.fn();
  const onQuit = vi.fn(async () => undefined);
  render(<QuitConfirmDialog work={{ flow: "Synthetic flow", groups: ["Nightly"] }}
    onKeepRunning={onKeepRunning} onQuit={onQuit} />);
  const dialog = screen.getByRole("alertdialog", { name: "Quit Maabarium?" });
  expect(dialog.textContent).toContain("“Synthetic flow” will stop");
  expect(dialog.textContent).toContain("“Nightly” will stop");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep running" }));
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(onKeepRunning).toHaveBeenCalledTimes(1);
  expect(onQuit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop and quit" }));
  expect(onQuit).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("button", { name: "Stopping…" })).toBeTruthy();
});

it("reports a failed quit instead of hiding it", async () => {
  render(<QuitConfirmDialog work={{ flow: null, groups: ["Nightly"] }}
    onKeepRunning={vi.fn()} onQuit={vi.fn(async () => { throw new Error("busy"); })} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop and quit" }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not quit");
});
