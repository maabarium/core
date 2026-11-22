import { useEffect, useRef, type ReactNode } from "react";

/**
 * A full-window modal built on the native <dialog>. While it is mounted it
 * keeps keyboard focus and assistive technology inside, stops the page behind
 * from scrolling, and returns focus to where it was when it closes.
 * Escape calls `onCancel`; omit it to make Escape do nothing.
 */
export function ModalDialog({ label, role, onCancel, className = "", children }: {
  label: string;
  role?: "dialog" | "alertdialog";
  onCancel?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog
    ref={ref}
    role={role}
    aria-label={label}
    onCancel={(event) => { event.preventDefault(); onCancel?.(); }}
    className={`m-0 h-full max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-transparent px-4 py-8 backdrop:bg-black/60 backdrop:backdrop-blur-sm ${className}`}
  >
    {children}
  </dialog>;
}
