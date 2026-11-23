import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ResearchTrends, type TrendDay } from "./ResearchTrends";

const tokenLabels = { input: "Input", output: "Output", cached: "Cache reads", cache_write: "Cache writes", reasoning: "Reasoning" };
export type TokenUsage = Partial<Record<keyof typeof tokenLabels, number | null>>;
type Lane = TokenUsage & {
  lane: string; jobs: number; completed: number; failed: number; stopped: number;
  pending: number; attempts: number; observed_jobs: number;
};
type Campaign = { id: string; status: string; limit: number; audited_trials: number; ready_proposal_rounds?: string[]; can_start?: boolean };
type Report = { experiments: number; lanes: Lane[]; trend?: TrendDay[]; campaigns?: Campaign[] };
type Allowance = { observed: number; windows: { label: string; used: number; reset: number }[] };
const providers: Record<string, string> = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse", deepseek: "DeepSeek (paid API)" };

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
  const [campaignId, setCampaignId] = useState("");
  const [campaignLimit, setCampaignLimit] = useState(200);
  const [publicBrief, setPublicBrief] = useState("");
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  async function startCampaign(id: string) {
    setStarting(true);
    setError("");
    try {
      await invoke("research_campaign_start", { id });
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setStarting(false); }
  }
  async function createCampaign() {
    setCreating(true);
    setError("");
    try {
      await invoke("research_campaign_create", {
        id: campaignId.trim(), limit: campaignLimit, publicBrief: publicBrief.trim() || null,
      });
      setCampaignId("");
      setPublicBrief("");
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setCreating(false); }
  }
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
        <details className="mt-3 rounded border p-3">
          <summary className="cursor-pointer font-semibold">Create a research campaign</summary>
          <p className="mt-2 text-sm">Set a trial limit. This does not queue or run any benchmark.</p>
          <form className="mt-2 flex flex-wrap items-end gap-3" onSubmit={(event) => {
            event.preventDefault();
            void createCampaign();
          }}>
            <label className="grid gap-1 text-sm">Campaign ID
              <input className="rounded border px-2 py-1" required maxLength={64} pattern="[A-Za-z0-9_\\-]+"
                value={campaignId} onChange={(event) => setCampaignId(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">Trial limit
              <input className="w-24 rounded border px-2 py-1" required type="number" min={1} max={200}
                value={campaignLimit || ""} onChange={(event) => setCampaignLimit(Number(event.target.value))} />
            </label>
            <label className="grid w-full gap-1 text-sm">Public brief for adaptive proposals (optional)
              <textarea className="rounded border px-2 py-1" rows={3} maxLength={4096}
                value={publicBrief} onChange={(event) => setPublicBrief(event.target.value)}
                aria-describedby="campaign-public-brief-help" />
            </label>
            <p id="campaign-public-brief-help" className="w-full text-sm">
              When no approved trial is waiting after an audited failure, Codex and Antigravity receive this brief and the failure status. Do not include private information.
            </p>
            <button className="rounded border px-3 py-1 text-sm" type="submit" disabled={creating || busy}>Create campaign</button>
          </form>
        </details>
        {!!report.campaigns?.length && <section className="mt-3" aria-label="Research campaigns">
          <h4 className="font-semibold">Research campaigns</h4>
          <ul className="mt-2 space-y-2">
            {report.campaigns.map((campaign) => <li key={campaign.id} className="rounded border p-3 text-sm">
              <p className="break-all font-semibold">{campaign.id}</p>
              <p>{campaign.audited_trials} of {campaign.limit} audited trials · {
                campaign.status === "target_achieved" ? "Target achieved" :
                campaign.status === "human_review" ? "Needs review" :
                campaign.status === "stopped" ? "Stopped" : "Active"
              }</p>
              {!!campaign.ready_proposal_rounds?.length && <div className="mt-2">
                <p>Ready to review for a local benchmark:</p>
                <ul className="list-disc pl-5">
                  {campaign.ready_proposal_rounds.map((round) => <li key={round} className="break-all">{round}</li>)}
                </ul>
              </div>}
              {campaign.can_start && <button type="button" className="mt-2 rounded border px-3 py-1"
                disabled={starting || busy} onClick={() => void startCampaign(campaign.id)}>
                Send public brief to Codex and Antigravity
              </button>}
            </li>)}
          </ul>
        </section>}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt>Experiments</dt><dd className="text-lg font-semibold">{report.experiments}</dd></div>
          <div><dt>Jobs</dt><dd className="text-lg font-semibold">{sum("jobs")}</dd></div>
          <div><dt>Completed</dt><dd className="text-lg font-semibold">{sum("completed")}{terminal ? ` · ${rate(sum("completed"), terminal)}` : ""}</dd></div>
          <div><dt>Failed</dt><dd className="text-lg font-semibold">{sum("failed")}{terminal ? ` · ${rate(sum("failed"), terminal)}` : ""}</dd></div>
        </dl>
        <p className="mt-2 text-sm">{sum("pending")} queued or running · {sum("stopped")} stopped. Percentages are based on completed and failed jobs only.</p>
        {report.trend && <ResearchTrends days={report.trend} />}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" className="workspace-switch" checked={details}
            onChange={(event) => setDetails(event.target.checked)} />
          Show provider details
        </label>
        {details && <div className="mt-3 space-y-3">
          <p className="text-sm">Completion means a result was returned, not that it passed scientific review. Token counts include only completed jobs with usage data. Cache and reasoning counts may already be included in input or output.</p>
          {report.lanes.map((lane) => <section className="rounded border p-3" key={lane.lane}>
            <h4 className="font-semibold">{providers[lane.lane] ?? lane.lane}</h4>
            <p className="mb-2 text-sm">{lane.completed} completed · {lane.failed} failed · {lane.attempts} attempts · token data on {lane.observed_jobs} of {lane.jobs} jobs</p>
            <TokenDetails usage={lane} />
          </section>)}
          <section className="rounded border p-3">
            <h4 className="font-semibold">Subscription allowance</h4>
            <p className="text-sm">This shows usage across your account, not just in Maabarium. Only Muse usage can be checked here.</p>
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
