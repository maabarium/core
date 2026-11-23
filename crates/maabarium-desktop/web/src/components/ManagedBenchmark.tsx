import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Disclosure } from "./ui/Disclosure";

type Executable = { path: string; sha256: string };
const reviewers = { codex: "Codex", claude: "Claude", antigravity: "Antigravity" } as const;

export function ManagedBenchmark({ onQueued }: { onQueued: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [reviewer, setReviewer] = useState<keyof typeof reviewers>("codex");
  const [shareAutomatically, setShareAutomatically] = useState(false);
  const [timeout, setTimeoutSeconds] = useState(60);
  const [runner, setRunner] = useState<Executable>();
  const [auditor, setAuditor] = useState<Executable>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [contractHash, setContractHash] = useState("");
  const [proposalRound, setProposalRound] = useState("");
  const [confirmSealed, setConfirmSealed] = useState(false);
  const [panelHash, setPanelHash] = useState("");
  const [preApprove, setPreApprove] = useState(false);
  const [sealedRunner, setSealedRunner] = useState<Executable>();
  const [sealedAuditor, setSealedAuditor] = useState<Executable>();
  const [catalog, setCatalog] = useState(false);
  const [candidateId, setCandidateId] = useState("");
  const [parameterRanges, setParameterRanges] = useState<Array<{ key: number; name: string; minimum: string; maximum: string }>>([]);
  const [nextRangeKey, setNextRangeKey] = useState(0);
  function editRange(key: number, field: "name" | "minimum" | "maximum", value: string) {
    setParameterRanges(rows => rows.map(row => row.key === key ? { ...row, [field]: value } : row));
    setConfirmed(false);
  }

  async function choose(set: (file?: Executable) => void) {
    setBusy(true);
    setError("");
    try {
      const path = await open({ multiple: false, directory: false });
      if (typeof path === "string") {
        setConfirmed(false);
        set(undefined);
        set(await invoke<Executable>("research_inspect_benchmark_executable", { path }));
      }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function enqueue() {
    if (!runner || !auditor || !confirmed || busy) return;
    setBusy(true);
    setError("");
    setQueued("");
    try {
      let parameterBounds: string | null = null;
      if (catalog && !confirmSealed && parameterRanges.length) {
        const names = parameterRanges.map(row => row.name.trim());
        if (new Set(names).size !== names.length) throw new Error("Give each setting a different name.");
        if (parameterRanges.some(row => Number(row.minimum) > Number(row.maximum))) {
          throw new Error("A setting’s minimum cannot be higher than its maximum.");
        }
        parameterBounds = JSON.stringify(Object.fromEntries(parameterRanges.map(row => [
          row.name.trim(), [Number(row.minimum), Number(row.maximum)],
        ])));
      }
      const id = await invoke<string>("research_enqueue_benchmark", {
        title, publicBrief: shareAutomatically ? brief : "",
        reviewer: shareAutomatically ? reviewer : null, timeout, runner, auditor, confirmed,
        campaign: campaignId.trim() ? {
          id: campaignId.trim(), contractSha256: contractHash.trim(),
          proposalRound: confirmSealed || catalog ? null : proposalRound.trim() || null,
          confirmationPanelSha256: confirmSealed ? panelHash.trim() : null,
          publicCandidateId: catalog && !confirmSealed ? candidateId.trim() : null,
          parameterBounds,
          confirmationPlan: preApprove && !confirmSealed ? {
            runner: sealedRunner, auditor: sealedAuditor, panelSha256: panelHash.trim(),
          } : null,
        } : null,
      });
      setQueued(id);
      setConfirmed(false);
      await onQueued();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <Disclosure title="Set up a local benchmark" className="mt-4">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void enqueue(); }}>
      <p className="text-sm text-[var(--muted)]">Choose the program that runs the benchmark and a separate program that checks its results. Only choose files you trust: they run with your account’s permissions.</p>
      <label className="block text-sm font-medium">Experiment name
        <input className="mt-1 block h-10 w-full rounded-md border bg-transparent px-3" required maxLength={256}
          value={title} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} />
      </label>
      <Disclosure title="Attach to a research campaign (optional)">
        <p className="mt-2 text-sm">Approval stages this trial for automatic dispatch. Only the independent audit can count it or stop the campaign.</p>
        <div className="mt-2 grid gap-3">
          <label className="grid gap-1 text-sm">Campaign ID
            <input className="h-10 w-full rounded-md border bg-transparent px-3" maxLength={64} value={campaignId}
              onChange={event => { setCampaignId(event.target.value); setConfirmed(false); }} />
          </label>
          {campaignId.trim() && <>
            <label className="grid gap-1 text-sm">Frozen contract SHA-256
              <input className="h-10 w-full rounded-md border bg-transparent px-3" required pattern="[a-f0-9]{64}" maxLength={64} value={contractHash}
                onChange={event => { setContractHash(event.target.value); setConfirmed(false); }} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" role="switch" className="workspace-switch" checked={confirmSealed}
                onChange={event => { setConfirmSealed(event.target.checked); setConfirmed(false); }} />
              Run sealed confirmation instead
            </label>
            {confirmSealed ? <label className="grid gap-1 text-sm">Sealed panel SHA-256
              <input className="h-10 w-full rounded-md border bg-transparent px-3" required pattern="[a-f0-9]{64}" maxLength={64} value={panelHash}
                onChange={event => { setPanelHash(event.target.value); setConfirmed(false); }} />
              <span>Use separate trusted programs and the winning trial’s contract. Turn off sharing with an AI evaluator.</span>
            </label> : <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" role="switch" className="workspace-switch" checked={catalog}
                onChange={event => { setCatalog(event.target.checked); setConfirmed(false); }} />
              Let Codex and Antigravity select this candidate
            </label>
            {catalog ? <><label className="grid gap-1 text-sm">Public candidate ID
              <input className="h-10 w-full rounded-md border bg-transparent px-3" required pattern="[A-Za-z0-9_\\-]{1,64}" maxLength={64} value={candidateId}
                onChange={event => { setCandidateId(event.target.value); setConfirmed(false); }} />
              <span>Both providers can see this ID. Use an ID that describes the approach without revealing private information. Add candidates before starting discovery.</span>
            </label>
            <fieldset className="grid gap-2 rounded-md border p-3 text-sm">
              <legend className="px-1 font-medium">Settings providers may choose (optional)</legend>
              <p>For settings supported by your runner, enter the name and the lowest and highest whole numbers allowed. Both providers can see these names and ranges. Leave this empty for a fixed benchmark.</p>
              {parameterRanges.map((row, index) => <div key={row.key} className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]">
                <label className="grid gap-1">Setting {index + 1} name
                  <input className="h-10 min-w-0 rounded-md border bg-transparent px-2" required maxLength={32}
                    pattern="[a-z][a-z0-9_]{0,31}" placeholder="width" value={row.name}
                    onChange={event => editRange(row.key, "name", event.target.value)} />
                </label>
                {(["minimum", "maximum"] as const).map(field => <label key={field} className="grid gap-1">
                  {field === "minimum" ? "Minimum" : "Maximum"}
                  <input className="h-10 min-w-0 rounded-md border bg-transparent px-2" type="number" required
                    min={-1000000} max={1000000} step={1} value={row[field]}
                    onChange={event => editRange(row.key, field, event.target.value)} />
                </label>)}
                <button type="button" className="min-h-10 rounded-md border px-2" aria-label={`Remove setting ${index + 1}`}
                  onClick={() => { setParameterRanges(rows => rows.filter(item => item.key !== row.key)); setConfirmed(false); }}>Remove</button>
              </div>)}
              <button type="button" className="min-h-10 justify-self-start rounded-md border px-3" disabled={parameterRanges.length >= 8}
                onClick={() => { setParameterRanges(rows => [...rows, { key: nextRangeKey, name: "", minimum: "", maximum: "" }]); setNextRangeKey(key => key + 1); setConfirmed(false); }}>
                Add a setting
              </button>
            </fieldset></> : <label className="grid gap-1 text-sm">Completed proposal round (optional)
              <input className="h-10 w-full rounded-md border bg-transparent px-3" maxLength={64} value={proposalRound}
                onChange={event => { setProposalRound(event.target.value); setConfirmed(false); }} />
            </label>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" role="switch" className="workspace-switch" checked={preApprove}
                onChange={event => { setPreApprove(event.target.checked); setConfirmed(false); }} />
              Pre-approve sealed confirmation after a development pass
            </label>
            {preApprove && <div className="grid gap-3">
              <p className="text-sm">Confirmation stays local. Choose two separate trusted programs. They run automatically only after this trial passes its development audit.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-10 rounded-md border px-3 text-sm" disabled={busy}
                  onClick={() => void choose(setSealedRunner)}>Choose confirmation runner</button>
                <button type="button" className="min-h-10 rounded-md border px-3 text-sm" disabled={busy}
                  onClick={() => void choose(setSealedAuditor)}>Choose confirmation auditor</button>
              </div>
              {sealedRunner && <p className="break-all text-sm">Runner: {sealedRunner.path}</p>}
              {sealedAuditor && <p className="break-all text-sm">Auditor: {sealedAuditor.path}</p>}
              <label className="grid gap-1 text-sm">Pre-approved sealed panel SHA-256
                <input className="h-10 w-full rounded-md border bg-transparent px-3" required pattern="[a-f0-9]{64}"
                  maxLength={64} value={panelHash} onChange={event => { setPanelHash(event.target.value); setConfirmed(false); }} />
              </label>
            </div>}
            </>}
          </>}
        </div>
      </Disclosure>
      <div className="grid gap-3 md:grid-cols-2">
        {([{ label: "Runner", file: runner, set: setRunner }, { label: "Independent auditor", file: auditor, set: setAuditor }]).map(({ label, file, set }) =>
          <div key={label} className="min-w-0 rounded-xl border border-[var(--line)] p-3">
            <button type="button" disabled={busy} onClick={() => void choose(set)}
              className="h-10 rounded-md border px-3 text-sm font-semibold">Choose {label.toLowerCase()}</button>
            {file && <div className="mt-2 break-all text-xs">
              <p className="text-sm font-medium">{file.path.split(/[\\/]/).pop()}</p>
              <p className="mt-1 text-[var(--muted)]">{file.path}</p>
              <p className="mt-1">Selected. Maabarium will check that it hasn’t changed before running.</p>
              <Disclosure title="Technical details">
                <p className="font-mono">SHA-256: {file.sha256}</p>
              </Disclosure>
            </div>}
          </div>)}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" role="switch" className="workspace-switch" checked={shareAutomatically}
            disabled={busy} onChange={event => { setShareAutomatically(event.target.checked); setConfirmed(false); }} />
          Send to an AI evaluator automatically
        </label>
        {shareAutomatically && <label className="text-sm font-medium">Evaluator subscription
          <select className="mt-1 block h-10 rounded-md border bg-transparent px-3" value={reviewer}
            onChange={event => { setReviewer(event.target.value as keyof typeof reviewers); setConfirmed(false); }}>
            {Object.entries(reviewers).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>}
        <label className="text-sm font-medium">Time limit per process (seconds)
          <input type="number" min={1} max={300} required className="mt-1 block h-10 w-24 rounded-md border bg-transparent px-3"
            value={timeout || ""} onChange={event => { setTimeoutSeconds(Number(event.target.value)); setConfirmed(false); }} />
        </label>
      </div>
      {shareAutomatically ? <div className="rounded-xl border border-[var(--line)] p-3">
        <label className="block text-sm font-medium">Public brief sent to {reviewers[reviewer]}
          <textarea className="mt-2 block w-full rounded-md border bg-transparent p-2" rows={3} maxLength={4096} required
            value={brief} onChange={event => { setBrief(event.target.value); setConfirmed(false); }} />
        </label>
        <p className="mt-2 text-sm text-[var(--muted)]">After the local check, Maabarium sends this brief and the pass/fail result without asking again. File paths and the full local report stay on this computer. The run still pauses for human review.</p>
      </div> : <p className="text-sm text-[var(--muted)]">Results stay on this computer. The run pauses for human review after the local check.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" role="switch" className="workspace-switch" checked={confirmed} disabled={busy}
          onChange={event => setConfirmed(event.target.checked)} />
        I trust these two programs to run on this computer.
      </label>
      <button type="submit" className="min-h-10 rounded-md bg-[var(--accent)] px-3 font-semibold text-[var(--on-accent)] disabled:opacity-60"
        disabled={busy || !runner || !auditor || !confirmed || !title.trim()
          || (!!campaignId.trim() && preApprove && !confirmSealed && (!sealedRunner || !sealedAuditor || !panelHash.trim()))
          || (shareAutomatically && (!brief.trim() || (confirmSealed && !!campaignId.trim())))}>
        {campaignId.trim() ? (confirmSealed ? "Approve sealed confirmation" : "Approve and stage trial") : "Queue benchmark"}
      </button>
      {queued && <p role="status" className="text-sm">Benchmark submitted. Check its status in Research activity.</p>}
      {error && <p role="alert" className="break-words text-sm">{error}</p>}
    </form>
  </Disclosure>;
}

export function LocalCheckpointActions({ jobId, continues = false, onChanged }: { jobId: string; continues?: boolean; onChanged: () => Promise<void> }) {
  const [choice, setChoice] = useState<"approve" | "stop">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approveLabel = continues ? "Approve and continue" : "Approve and close review";
  return <div className="mt-3 space-y-2 text-sm">
    {!choice ? <div className="flex flex-wrap gap-2">
      <button type="button" className="h-10 rounded-md border px-3" onClick={() => setChoice("approve")}>{approveLabel}</button>
      <button type="button" className="h-10 rounded-md border px-3" onClick={() => setChoice("stop")}>Stop experiment</button>
    </div> : <>
      <p>{choice === "approve" && continues ? "Approval queues the next configured step." :
        choice === "approve" ? "Approval closes this review. No follow-up will start." : "Stop closes this experiment without starting another step."}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className="h-10 rounded-md border px-3" onClick={() => setChoice(undefined)}>Cancel</button>
        <button type="button" disabled={busy} className="h-10 rounded-md border px-3 font-semibold" onClick={async () => {
          setBusy(true); setError("");
          try {
            await invoke("research_decide_local_checkpoint", { jobId, approved: choice === "approve" });
            await onChanged();
          } catch (cause) { setError(String(cause)); }
          finally { setBusy(false); }
        }}>{choice === "approve" ? approveLabel : "Stop this experiment"}</button>
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
