import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

const tokenLabels = { input: "Input", output: "Output", cached: "Cache reads", cache_write: "Cache writes", reasoning: "Reasoning" };
export type TokenUsage = Partial<Record<keyof typeof tokenLabels, number | null>>;
type Lane = TokenUsage & {
  lane: string; jobs: number; completed: number; failed: number; stopped: number;
  pending: number; attempts: number; observed_jobs: number;
};
type Report = { experiments: number; lanes: Lane[] };
type Allowance = { observed: number; windows: { label: string; used: number; reset: number }[] };
const providers: Record<string, string> = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse" };

export function TokenDetails({ usage }: { usage: TokenUsage }) {
  const counters = (Object.keys(tokenLabels) as (keyof TokenUsage)[]).filter((key) => usage[key] != null);
  return counters.length ? (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {counters.map((key) => <div key={key}><dt>{tokenLabels[key]}</dt><dd className="font-semibold tabular-nums">{usage[key]?.toLocaleString()}</dd></div>)}
    </dl>
  ) : <p className="text-sm">Token counts not reported.</p>;
}

function rate(n: number, total: number) {
  return total ? `${Math.round(100 * n / total)}%` : "Not yet available";
}

export function ResearchReport() {
  const [report, setReport] = useState<Report>();
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quotaBusy, setQuotaBusy] = useState(false);
  const [quota, setQuota] = useState<Allowance | null>();
  const [quotaError, setQuotaError] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try { setReport(await invoke<Report>("research_queue_report")); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  async function refreshAllowance() {
    setQuotaBusy(true);
    setQuotaError("");
    setQuota(undefined);
    try { setQuota(await invoke<Allowance | null>("research_muse_allowance")); }
    catch (failure) { setQuotaError(String(failure)); }
    finally { setQuotaBusy(false); }
  }
  const sum = (key: "jobs" | "completed" | "failed" | "stopped" | "pending") =>
    report?.lanes.reduce((total, lane) => total + lane[key], 0) ?? 0;
  const terminal = sum("completed") + sum("failed");
  return (
    <section className="mt-4 rounded-xl border p-4" aria-label="Research activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Research activity</h3>
        <button className="rounded border px-3 py-1.5 text-sm" type="button" disabled={busy}
          onClick={() => void refresh()}>{busy ? "Loading…" : report ? "Refresh report" : "Load report"}</button>
      </div>
      {error && <p role="status" className="mt-2 text-sm">{error}</p>}
      {report && <>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt>Experiments</dt><dd className="text-lg font-semibold">{report.experiments}</dd></div>
          <div><dt>Jobs</dt><dd className="text-lg font-semibold">{sum("jobs")}</dd></div>
          <div><dt>Completed</dt><dd className="text-lg font-semibold">{sum("completed")}{terminal ? ` · ${rate(sum("completed"), terminal)}` : ""}</dd></div>
          <div><dt>Failed</dt><dd className="text-lg font-semibold">{sum("failed")}{terminal ? ` · ${rate(sum("failed"), terminal)}` : ""}</dd></div>
        </dl>
        <p className="mt-2 text-sm">{sum("pending")} queued or running · {sum("stopped")} stopped. Completion rates exclude pending and stopped jobs.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" className="workspace-switch" checked={details}
            onChange={(event) => setDetails(event.target.checked)} />
          Show provider details
        </label>
        {details && <div className="mt-3 space-y-3">
          <p className="text-sm">Completion means a result was returned, not that it passed scientific review. Token counts cover recorded completed jobs only; cache and reasoning counters may overlap input or output.</p>
          {report.lanes.map((lane) => <section className="rounded border p-3" key={lane.lane}>
            <h4 className="font-semibold">{providers[lane.lane] ?? lane.lane}</h4>
            <p className="mb-2 text-sm">{lane.completed} completed · {lane.failed} failed · {lane.attempts} worker attempts · token data on {lane.observed_jobs} of {lane.jobs} jobs</p>
            <TokenDetails usage={lane} />
          </section>)}
          <section className="rounded border p-3">
            <h4 className="font-semibold">Subscription allowance</h4>
            <p className="text-sm">Account-wide, not a Maabarium token total. Codex, Claude and Antigravity allowance is not imported here.</p>
            <button type="button" className="mt-2 rounded border px-3 py-1.5 text-sm" disabled={quotaBusy}
              onClick={() => void refreshAllowance()}>{quotaBusy ? "Checking…" : "Check Muse allowance"}</button>
            {quotaError && <p role="status" className="text-sm">{quotaError}</p>}
            {quota === null && <p role="status" className="text-sm">Muse did not report an allowance.</p>}
            {quota && <ul className="mt-2 space-y-1 text-sm">
              {quota.windows.map((window) => <li key={window.label}>
                {window.label}: {window.used}% used · {Math.max(0, 100 - window.used)}% remaining · resets {new Date(window.reset).toLocaleString()}
              </li>)}
              <li>Reported {new Date(quota.observed).toLocaleString()}</li>
            </ul>}
          </section>
        </div>}
      </>}
    </section>
  );
}
