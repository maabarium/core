import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ModalDialog } from "./ModalDialog";

it("renders a labelled dialog and maps Escape to onCancel", () => {
  const onCancel = vi.fn();
  render(<ModalDialog label="Confirm cleanup" role="alertdialog" onCancel={onCancel}><p>Body</p></ModalDialog>);
  const dialog = screen.getByRole("alertdialog", { name: "Confirm cleanup" });
  expect(dialog.tagName).toBe("DIALOG");
  expect(dialog.hasAttribute("open")).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
