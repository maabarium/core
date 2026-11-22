import { Disclosure } from "../ui/Disclosure";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import appLogo from "../../../../icons/specimen-tile.svg";

type AboutModalProps = {
  isOpen: boolean;
  version: string;
  dbPath: string | null;
  logPath: string | null;
  onClose: () => void;
  onOpenLicense: () => void;
};

export function AboutModal({ isOpen, version, dbPath, logPath, onClose, onOpenLicense }: AboutModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--ink)] shadow-2xl backdrop:bg-black/50"
    >
      <header className="flex items-start gap-4">
        <img src={appLogo} alt="" className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-2xl font-semibold tracking-tight">About Maabarium</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">The research workspace · v{version}</p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close About Maabarium"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-[var(--ink)] hover:bg-[var(--subtle)]">
          <X aria-hidden="true" size={20} />
        </button>
      </header>

      <p className="mt-5 text-sm leading-relaxed text-[var(--muted)]">
        Run and review research experiments from one workspace. Compare results and keep a record
        of how each result was reached.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <div>
          <h3 className="font-semibold">License</h3>
          <p className="text-sm text-[var(--muted)]">Apache License 2.0</p>
        </div>
        <button type="button" onClick={onOpenLicense}
          className="min-h-11 rounded-md border border-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--subtle)]">
          Open license
        </button>
      </div>

      <Disclosure className="mt-5" title="Runtime paths">
        <dl className="space-y-3 text-sm">
          <div><dt>Database</dt><dd className="break-all font-mono text-[var(--muted)]">{dbPath ?? "Unavailable"}</dd></div>
          <div><dt>Logs</dt><dd className="break-all font-mono text-[var(--muted)]">{logPath ?? "Unavailable"}</dd></div>
        </dl>
      </Disclosure>
    </dialog>
  );
}
