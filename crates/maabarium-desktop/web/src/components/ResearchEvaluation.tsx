import { Disclosure } from "./ui/Disclosure";
import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";

export type EvaluationSetup = { baseline: string; minimumSavingsPercent: number };
type Verdict = {
  outcome: "pass" | "fail" | "inconclusive";
  reason: string;
  baseline_work: string | null;
  candidate_work: string | null;
  mismatches: string[];
};

const example = (execute: number) => JSON.stringify({
  fixture: "public-example-v1",
  cases: [{ id: "example-1", answer: "yes" }, { id: "example-2", answer: "no" }],
  work: { setup: 5, execute, propose: 0, verify: 5, fallback: 0 },
}, null, 2);

function EvidenceDropZone({ kind, disabled = false, onLoad }: {
  kind: "baseline" | "candidate";
  disabled?: boolean;
  onLoad: (contents: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load(files: FileList | null) {
    if (disabled || reading || !files?.length) return;
    setMessage("");
    setError("");
    const file = files[0];
    if (files.length !== 1 || !/\.json$/i.test(file.name) || file.size > 65536) {
      setError("Choose one JSON file no larger than 64 KiB.");
      return;
    }
    setReading(true);
    try {
      onLoad(await file.text());
      setMessage(`Loaded ${file.name}`);
    } catch {
      setError("Couldn't read this file. Choose it again or paste the results.");
    } finally {
      setReading(false);
    }
  }
  return <div>
    <input ref={input} hidden type="file" accept=".json,application/json"
      onChange={(event) => { void load(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <button type="button" disabled={disabled || reading} aria-busy={reading}
      onClick={() => input.current?.click()}
      onDragOver={(event) => { event.preventDefault(); if (!disabled && !reading) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); void load(event.dataTransfer.files); }}
      className={`flex min-h-20 w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-sm disabled:opacity-60 ${over ? "border-[var(--accent)] bg-[var(--subtle)]" : "border-[var(--muted)] hover:bg-[var(--subtle)]"}`}>
      <Upload size={20} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
      <span>
        <span className="block font-semibold">{reading ? "Reading file…" : `Drop a ${kind} results file or browse`}</span>
        <span className="block text-[var(--muted)]">JSON · Up to 64 KiB</span>
      </span>
    </button>
    {message && <p className="mt-1 break-all text-sm" role="status">{message}</p>}
    {error && <p className="mt-1 text-sm" role="alert">{error}</p>}
  </div>;
}

function Result({ verdict }: { verdict: Verdict }) {
  return <div role="status" className="mt-3 rounded-lg border p-3">
    <p className="font-semibold">{({ pass: "Passed", fail: "Did not pass", inconclusive: "Not enough evidence" })[verdict.outcome]}</p>
    <p className="text-sm">{verdict.reason}</p>
    {verdict.baseline_work !== null && <Disclosure className="mt-2 text-sm" title="See details">
      <p>Baseline: {verdict.baseline_work} work units. Candidate: {verdict.candidate_work} work units.</p>
      {verdict.mismatches.length > 0 && <p className="break-words">Answers differed in: {verdict.mismatches.join(", ")}.</p>}
    </Disclosure>}
  </div>;
}

export function EvaluationRuleFields({ setup, onChange, disabled }: {
  setup: EvaluationSetup | null;
  onChange: (setup: EvaluationSetup) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<Verdict>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function tryExample() {
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      setPreview(await invoke<Verdict>("research_evaluation_preview", {
        setup: { baseline: example(90), minimumSavingsPercent: setup?.minimumSavingsPercent ?? 20 },
        candidate: example(65),
      }));
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={disabled} className="space-y-2 rounded-xl border p-3">
    <legend className="px-1 font-medium">Local rule: Same answers, less work</legend>
    {setup && <>
      <label className="block text-sm" htmlFor="evaluation-saving">Minimum work saved (%)</label>
      <input className="w-24 rounded border bg-transparent p-2" id="evaluation-saving"
        type="number" min={1} max={100} step={1} required value={setup.minimumSavingsPercent || ""}
        onChange={(event) => { setPreview(undefined); onChange({ ...setup, minimumSavingsPercent: Number(event.target.value) }); }} />
      <p className="text-sm">Pass if every answer matches and total work drops by at least {setup.minimumSavingsPercent || "…"}%. Missing or mismatched test cases pause review.</p>
      <p className="text-sm">Count setup, running the test, proposing changes, checking results, and falling back to the baseline in the same work units.</p>
      <label className="block text-sm" htmlFor="evaluation-baseline">Baseline results (JSON)</label>
      <textarea className="w-full rounded border bg-transparent p-2" id="evaluation-baseline"
        rows={4} required maxLength={65536} value={setup.baseline}
        onChange={(event) => onChange({ ...setup, baseline: event.target.value })} />
      <EvidenceDropZone kind="baseline" disabled={disabled} onLoad={(baseline) => onChange({ ...setup, baseline })} />
      <p className="text-sm">Starting the experiment locks these baseline results and the pass rule. The app keeps them local.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-sm" disabled={busy}
          onClick={() => void tryExample()}>{busy ? "Checking…" : "Try an example"}</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm"
          onClick={() => onChange({ ...setup, baseline: example(90) })}>Fill in an example baseline</button>
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
      {preview && <Result verdict={preview} />}
    </>}
  </fieldset>;
}

export function EvidenceCheck({ experimentId }: { experimentId: string }) {
  const [id, setId] = useState("");
  const [candidate, setCandidate] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = id.trim() || experimentId;
  async function run(save: boolean) {
    setBusy(true);
    setError("");
    setVerdict(undefined);
    try {
      setVerdict(await invoke<Verdict | null>(save ? "research_evaluation_check" : "research_evaluation_read",
        { loopId: selected, ...(save ? { candidate } : {}) }));
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  return <Disclosure className="mt-4" title="Check experiment evidence">
    <div className="mt-3 space-y-2">
      <label className="block text-sm" htmlFor="evaluation-id">Experiment ID</label>
      <input id="evaluation-id" className="w-full rounded border bg-transparent p-2"
        maxLength={128} value={id || experimentId} onChange={(event) => setId(event.target.value)} />
      <label className="block text-sm" htmlFor="evaluation-candidate">Candidate results (JSON)</label>
      <textarea id="evaluation-candidate" className="w-full rounded border bg-transparent p-2" rows={4}
        maxLength={65536} value={candidate} onChange={(event) => setCandidate(event.target.value)} />
      <EvidenceDropZone kind="candidate" disabled={busy} onLoad={setCandidate} />
      <p className="text-sm">Use results from your local test runner. A complete verdict is saved once and can’t be replaced. Incomplete evidence won’t use up that check.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !selected || !candidate.trim()}
          onClick={() => void run(true)} className="rounded border px-3 py-1.5 text-sm">Check and save verdict</button>
        <button type="button" disabled={busy || !selected}
          onClick={() => void run(false)} className="rounded border px-3 py-1.5 text-sm">Read saved verdict</button>
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
      {verdict && <Result verdict={verdict} />}
      {verdict === null && <p role="status" className="text-sm">No verdict has been saved yet.</p>}
    </div>
  </Disclosure>;
}
