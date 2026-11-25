import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UpdateCheckModal } from "./UpdateCheckModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("checks on open and installs only the version the user selects", async () => {
  const prototype = HTMLDialogElement.prototype;
  const original = Object.getOwnPropertyDescriptors(prototype);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  try {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValueOnce({
      currentVersion: "0.5.0", channel: "stable", configured: true, available: true,
      version: "0.5.1", body: "A test release.",
    }).mockResolvedValueOnce({ installed: true, shouldRestart: true });
    const view = render(<UpdateCheckModal onClose={vi.fn()} />);
    const install = await screen.findByRole("button", { name: "Install 0.5.1" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("check_for_updates");
    fireEvent.click(install);
    expect(await screen.findByText("Update installed")).toBeTruthy();
    expect(invoke).toHaveBeenNthCalledWith(2, "install_available_update", { expectedVersion: "0.5.1" });
    view.unmount();
  } finally {
    cleanup();
    for (const key of ["showModal", "close"] as const) {
      if (original[key]) Object.defineProperty(prototype, key, original[key]);
      else Reflect.deleteProperty(prototype, key);
    }
  }
});

it("opens a background-discovered version without checking or installing again", () => {
  const prototype = HTMLDialogElement.prototype;
  const original = Object.getOwnPropertyDescriptors(prototype);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  try {
    vi.mocked(invoke).mockReset();
    const view = render(<UpdateCheckModal onClose={vi.fn()} initialUpdate={{
      currentVersion: "0.5.3", channel: "stable", configured: true, available: true,
      endpoint: "https://example.com", version: "0.5.4", date: null, body: "Staged update",
    }} />);
    expect(screen.getByText("Staged update")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install 0.5.4" })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    cleanup();
    for (const key of ["showModal", "close"] as const) {
      if (original[key]) Object.defineProperty(prototype, key, original[key]);
      else Reflect.deleteProperty(prototype, key);
    }
  }
});
