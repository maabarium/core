import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateCheckModal } from "./UpdateCheckModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const prototype = HTMLDialogElement.prototype;
const original = Object.getOwnPropertyDescriptors(prototype);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
});

afterEach(() => {
  cleanup();
  for (const key of ["showModal", "close"] as const) {
    if (original[key]) Object.defineProperty(prototype, key, original[key]);
    else Reflect.deleteProperty(prototype, key);
  }
});

it("checks on open and installs only the version the user selects", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    currentVersion: "0.5.0", channel: "stable", configured: true, available: true,
    version: "0.5.1", body: "A test release.",
  }).mockResolvedValueOnce({ installed: true, version: "0.5.1" });
  render(<UpdateCheckModal onClose={vi.fn()} />);
  const install = await screen.findByRole("button", { name: "Install 0.5.1 and reopen" });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("check_for_updates");
  fireEvent.click(install);
  expect(await screen.findByText("Update installed")).toBeTruthy();
  expect(screen.getByText("Reopening Maabarium…")).toBeTruthy();
  expect(invoke).toHaveBeenNthCalledWith(2, "install_available_update", { expectedVersion: "0.5.1" });
});

it("opens a background-discovered version without checking or installing again", () => {
  render(<UpdateCheckModal onClose={vi.fn()} initialUpdate={{
    currentVersion: "0.5.3", channel: "stable", configured: true, available: true,
    endpoint: "https://example.com", version: "0.5.4", date: null, body: "Staged update",
  }} />);
  expect(screen.getByText("Staged update")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Install 0.5.4 and reopen" })).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps the app open without announcing a relaunch when installation is blocked", async () => {
  const onInstalled = vi.fn();
  vi.mocked(invoke).mockRejectedValueOnce("Finish or stop running workflows before installing the update.");
  render(<UpdateCheckModal onClose={vi.fn()} onInstalled={onInstalled} initialUpdate={{
    currentVersion: "0.5.3", channel: "stable", configured: true, available: true,
    endpoint: null, version: "0.5.4", date: null, body: null,
  }} />);
  fireEvent.click(screen.getByRole("button", { name: "Install 0.5.4 and reopen" }));
  expect(await screen.findByText("Finish or stop running workflows before installing the update.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.queryByText("Reopening Maabarium…")).toBeNull();
  expect(onInstalled).not.toHaveBeenCalled();
});
