import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AboutModal } from "./AboutModal";

it("labels the modal, focuses Close, and restores focus after Escape", () => {
  const prototype = HTMLDialogElement.prototype;
  const original = Object.getOwnPropertyDescriptors(prototype);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  try {
    const props = { version: "0.5.0", dbPath: null, logPath: null, onClose: vi.fn(), onOpenLicense: vi.fn() };
    const view = render(<><button>Open About</button><AboutModal {...props} isOpen={false} /></>);
    const opener = screen.getByRole("button", { name: "Open About" });
    opener.focus();
    view.rerender(<><button>Open About</button><AboutModal {...props} isOpen /></>);
    const dialog = screen.getByRole("dialog", { name: "About Maabarium" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close About Maabarium" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(props.onClose).toHaveBeenCalledOnce();
    view.rerender(<><button>Open About</button><AboutModal {...props} isOpen={false} /></>);
    expect(document.activeElement).toBe(opener);
  } finally {
    for (const key of ["showModal", "close"] as const) {
      if (original[key]) Object.defineProperty(prototype, key, original[key]);
      else Reflect.deleteProperty(prototype, key);
    }
  }
});
