import { useState } from "react";
import { ModalDialog } from "../ui/ModalDialog";

export type ActiveWork = { flow: string | null; groups: string[] };

/**
 * Shown when the window is closed (or the app quit) while work is running.
 * Keeping it running is the default; quitting stops the work first.
 */
export function QuitConfirmDialog({ work, onKeepRunning, onQuit }: {
  work: ActiveWork;
  onKeepRunning: () => void;
  onQuit: () => Promise<void>;
}) {
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState("");
  const items = [
    ...(work.flow ? [`The workflow “${work.flow}” will stop. Reopening Maabarium starts a new run; it does not resume this one.`] : []),
    ...work.groups.map((group) => `Workflow group “${group}” will stop and be marked as interrupted.`),
  ];
  return <ModalDialog label="Quit Maabarium?" role="alertdialog" onCancel={quitting ? undefined : onKeepRunning}
    className="items-center justify-center open:flex">
    <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--ink)] shadow-2xl">
      <h2 className="text-xl font-semibold">Quit Maabarium?</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Work is still running. Quitting now stops it.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="mt-3 text-sm text-[var(--muted)]">Research queue jobs run separately and keep going after you quit.</p>
      {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus disabled={quitting} onClick={onKeepRunning}
          className="min-h-10 rounded-md border border-[var(--line)] px-3 font-semibold">Keep running</button>
        <button type="button" disabled={quitting} onClick={async () => {
          setQuitting(true); setError("");
          try { await onQuit(); }
          catch (cause) { setError(`Maabarium could not quit: ${String(cause)}`); setQuitting(false); }
        }} className="min-h-10 rounded-md border border-[var(--line)] px-3 font-semibold text-[var(--danger)]">
          {quitting ? "Stopping…" : "Stop and quit"}
        </button>
      </div>
    </div>
  </ModalDialog>;
}
