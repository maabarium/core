import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen } from "@testing-library/react";
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
    for (const key of ["showModal", "close"] as const) {
      if (original[key]) Object.defineProperty(prototype, key, original[key]);
      else Reflect.deleteProperty(prototype, key);
    }
  }
});
