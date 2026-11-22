import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import type { UpdateCheckResult } from "../../types/console";

type Phase = "checking" | "result" | "installing" | "installed" | "error";

export function UpdateCheckModal({ onClose }: { onClose: () => void }) {
  const title = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [update, setUpdate] = useState<UpdateCheckResult>();
  const [message, setMessage] = useState("");
  const check = async () => {
    setPhase("checking");
    setMessage("");
    try {
      setUpdate(await invoke<UpdateCheckResult>("check_for_updates"));
      setPhase("result");
    } catch (error) {
      setMessage(String(error));
      setPhase("error");
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    void check();
    return () => { dialog.close(); };
  }, []);

  const install = async (expectedVersion: string) => {
    setPhase("installing");
    try {
      const result = await invoke<{ installed: boolean; shouldRestart: boolean }>("install_available_update", { expectedVersion });
      setMessage(!result.installed ? "The update is no longer available. Check again to refresh."
        : result.shouldRestart ? "Quit and reopen Maabarium to use the new version." : "The update was installed.");
      setPhase(result.installed ? "installed" : "error");
    } catch (error) {
      setMessage(String(error));
      setPhase("error");
    }
  };

  const status = phase === "checking" ? "Checking for updates…"
    : phase === "installing" ? "Downloading and installing the update…"
    : phase === "installed" ? "Update installed"
    : phase === "error" ? "Couldn’t complete the update"
    : !update?.configured ? "Updates aren’t available in this build"
    : update.available ? `Version ${update.version} is available`
    : "You’re up to date";

  return <dialog ref={dialogRef} aria-labelledby={title}
    onCancel={(event) => { event.preventDefault(); if (phase !== "installing") onClose(); }}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-2xl backdrop:bg-black/50">
    <h2 id={title} className="text-lg font-semibold">Software Update</h2>
    <p role={phase === "error" ? "alert" : "status"} className="mt-3 font-semibold">{status}</p>
    {update && <p className="mt-1 text-sm text-[var(--muted)]">Installed version: {update.currentVersion} · {update.channel}</p>}
    {message && <p className="mt-2 break-words text-sm text-[var(--muted)]">{message}</p>}
    {phase === "result" && !update?.configured &&
      <p className="mt-2 text-sm text-[var(--muted)]">Use a signed release build to receive updates here.</p>}
    {phase === "result" && update?.available && update.body &&
      <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm">{update.body}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" disabled={phase === "installing"} onClick={onClose}
        className="min-h-10 rounded-md border border-[var(--line)] px-3 text-sm disabled:opacity-60">Close</button>
      {phase === "error" && <button type="button" onClick={() => void check()}
        className="min-h-10 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--on-accent)]">Check again</button>}
      {phase === "result" && update?.configured && update.available && update.version && <button type="button"
        onClick={() => void install(update.version!)}
        className="min-h-10 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--on-accent)]">Install {update.version}</button>}
    </div>
  </dialog>;
}
