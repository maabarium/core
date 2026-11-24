import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { ResearchTrends, type TrendDay } from "./ResearchTrends";

const tokenLabels = { input: "Input", output: "Output", cached: "Cache reads", cache_write: "Cache writes", reasoning: "Reasoning" };
export type TokenUsage = Partial<Record<keyof typeof tokenLabels, number | null>>;
type Lane = TokenUsage & {
  lane: string; jobs: number; completed: number; failed: number; stopped: number;
  pending: number; attempts: number; observed_jobs: number;
};
type ProposalUsage = TokenUsage & { lane: string; jobs: number; observed_jobs: number };
type Campaign = { id: string; status: string; limit: number; audited_trials: number; rejected_trials: number; operational_failures: number; ready_proposal_rounds?: string[]; can_start?: boolean; proposal_usage?: ProposalUsage[]; trial_outcomes?: string[]; confirmation_outcome?: string | null; autonomy_phase?: string | null; autonomy_reason?: string | null };
type PracticeResult = { questions: number; matches: number; scan_checks: number; lookup_checks: number };
type Starter = { stage: string; first: PracticeResult | null; final_result: PracticeResult | null };
type Report = { experiments: number; lanes: Lane[]; trend?: TrendDay[]; campaigns?: Campaign[] };
type Allowance = { observed: number; windows: { label: string; used: number; reset: number }[] };
const providers: Record<string, string> = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse", deepseek: "DeepSeek (paid API)" };
const campaignEfforts = {
  codex: ["low", "medium", "high", "xhigh"],
  claude: ["low", "medium", "high", "xhigh", "max"],
  antigravity: ["low", "medium", "high", "xhigh", "max"],
  muse: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
  deepseek: ["none", "low", "high", "max"],
};
type CampaignLane = keyof typeof campaignEfforts;
type ProviderChoice = { lane: CampaignLane; model: string; effort: string };
const defaultChoices = (): ProviderChoice[] => [
  { lane: "codex", model: "", effort: "" }, { lane: "antigravity", model: "", effort: "" },
];

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
  const [reviewEvery, setReviewEvery] = useState("");
  const [localBudget, setLocalBudget] = useState("");
  const [choices, setChoices] = useState(defaultChoices);
  const [allowPaid, setAllowPaid] = useState(false);
  const [publicBrief, setPublicBrief] = useState("");
  const [plan, setPlan] = useState<{ name: string; raw: string; brief: string; trials: number; rounds: number }>();
  const [readingPlan, setReadingPlan] = useState(false);
  const planRead = useRef(0);
  const usesPaid = Boolean(plan || publicBrief.trim()) && choices.some(choice => choice.lane === "deepseek");
  async function loadPlan(file: File | undefined) {
    setError("");
    if (!file) return;
    const read = ++planRead.current;
    setReadingPlan(true);
    try {
      if (file.size > 65536) throw new Error("Choose a research plan smaller than 64 KiB.");
      const raw = await file.text();
      if (read !== planRead.current) return;
      const value = JSON.parse(raw);
      if (![1, 2].includes(value?.schema) || typeof value?.brief !== "string"
        || !value.brief.trim() || !Number.isInteger(value.trials) || value.trials < 1 || value.trials > 200
        || !Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 200) {
        throw new Error("This file does not have the required Maabarium plan settings.");
      }
      setPlan({ name: file.name, raw, brief: value.brief, trials: value.trials, rounds: value.rounds });
    } catch (failure) {
      if (read !== planRead.current) return;
      setError(failure instanceof SyntaxError ? "That file is not a valid JSON research plan." : String(failure));
    } finally {
      if (read === planRead.current) setReadingPlan(false);
    }
  }
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [practice, setPractice] = useState<PracticeResult>();
  const [practicing, setPracticing] = useState(false);
  const [starter, setStarter] = useState<Starter>();
  const [starterBusy, setStarterBusy] = useState(false);
  async function starterAction(action: string) {
    setStarterBusy(true);
    setError("");
    try { setStarter(await invoke<Starter>("research_starter_campaign", { action })); }
    catch (failure) { setError(String(failure)); }
    finally { setStarterBusy(false); }
  }
  const [practiceStep, setPracticeStep] = useState<"intro" | "result" | "final" | "closed" | "stopped">("intro");
  async function runPractice(finalCheck = false) {
    setPracticing(true);
    setError("");
    try {
      setPractice(await invoke<PracticeResult>("research_campaign_practice", { finalCheck }));
      setPracticeStep(finalCheck ? "final" : "result");
    }
    catch (failure) { setError(String(failure)); }
    finally { setPracticing(false); }
  }
  const [stopRequested, setStopRequested] = useState<string>();
  const [stopping, setStopping] = useState(false);
  async function stopCampaign(id: string) {
    setStopping(true);
    setError("");
    try {
      await invoke("research_campaign_stop", { id });
      setStopRequested(undefined);
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setStopping(false); }
  }
  async function startCampaign(id: string, reviewedTrials?: number) {
    setStarting(true);
    setError("");
    try {
      await invoke("research_campaign_start", { id, reviewedTrials });
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setStarting(false); }
  }
  async function createCampaign() {
    setCreating(true);
    setError("");
    try {
      const providerSettings = choices.map(choice => ({
        lane: choice.lane, model: choice.model.trim() || null, effort: choice.effort || null,
      }));
      if (plan) {
        await invoke("research_campaign_approve_plan", {
          id: campaignId.trim(), approvedPlan: plan.raw, providers: providerSettings, allowPaid,
          ...(reviewEvery ? { reviewEvery: Number(reviewEvery) } : {}),
        });
      } else await invoke("research_campaign_create", {
        id: campaignId.trim(), limit: campaignLimit, publicBrief: publicBrief.trim() || null,
        ...(reviewEvery ? { reviewEvery: Number(reviewEvery) } : {}),
        ...(localBudget ? { localBudgetSeconds: Number(localBudget) } : {}),
        ...(publicBrief.trim() ? {
          providers: providerSettings,
          ...(usesPaid ? { allowPaid } : {}),
        } : {}),
      });
      setCampaignId("");
      setReviewEvery("");
      setLocalBudget("");
      setPublicBrief("");
      setChoices(defaultChoices());
      setAllowPaid(false);
      setPlan(undefined);
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
      <section className="mt-3 rounded border p-3" aria-label="Starter campaign">
        <h4 className="font-semibold">Open a ready-made campaign</h4>
        <p className="mt-2 text-sm">Compare two ways to find a number on a list. Run the first test, review it, then decide whether to check it on different questions. Your progress is saved on this computer. No files, sign-in, or internet are needed.</p>
        {starter && <div className="mt-2 space-y-2 text-sm" role="status">
          {starter.first && <p>First test: both methods agreed with the answer key on {starter.first.matches} of {starter.first.questions} questions. They used {starter.first.scan_checks} and {starter.first.lookup_checks} comparisons.</p>}
          {starter.final_result && <p>Final check: both methods agreed with the answer key on {starter.final_result.matches} of {starter.final_result.questions} different questions. They used {starter.final_result.scan_checks} and {starter.final_result.lookup_checks} comparisons.</p>}
          {starter.stage === "finished" && <p>Starter campaign finished. These results are separate from your research trials.</p>}
          {starter.stage === "stopped" && <p>Starter campaign stopped. Completed results are still here.</p>}
        </div>}
        <div className="mt-2 flex flex-wrap gap-2">
          {(starter?.stage === "first_review" || starter?.stage === "final_review") &&
            <button className="min-h-10 rounded border px-3 text-sm" type="button" disabled={starterBusy}
              onClick={() => void starterAction("stop")}>Stop starter campaign</button>}
          <button className="min-h-10 rounded border px-3 text-sm" type="button" disabled={starterBusy}
            onClick={() => void starterAction(!starter ? "status" : starter.stage === "ready" ? "start"
              : starter.stage === "first_review" ? "final_check" : starter.stage === "final_review" ? "finish" : "reset")}>
            {starterBusy ? "Working…" : !starter ? "Open starter campaign" : starter.stage === "ready" ? "Run first test"
              : starter.stage === "first_review" ? "Run final check on different questions"
              : starter.stage === "final_review" ? "Finish starter campaign" : "Reset starter campaign"}
          </button>
        </div>
      </section>
      <details className="mt-3 rounded border p-3">
        <summary className="cursor-pointer font-semibold">Try a practice experiment</summary>
        <p className="mt-2 text-sm">Compare two ways to find a number on a sorted list. First try five questions. Then check the result on five different questions before you finish. No sign-in, files, or internet needed.</p>
        {practiceStep === "intro" && <button type="button" className="mt-2 min-h-10 rounded border px-3 text-sm" disabled={practicing}
          onClick={() => void runPractice()}>{practicing ? "Running…" : "Run practice experiment"}</button>}
        {practice && (practiceStep === "result" || practiceStep === "final") && <div className="mt-2 space-y-1 text-sm">
          <h4 className="font-semibold">{practiceStep === "result" ? "First test" : "Final check on different questions"}</h4>
          <p role="status">Both methods gave the expected answer on {practice.matches} of {practice.questions} questions.</p>
          <ul className="list-disc pl-5">
            <li>Check one number at a time: {practice.scan_checks} comparisons</li>
            <li>Keep splitting the list in half: {practice.lookup_checks} comparisons</li>
          </ul>
          <p>This comparison starts with an already sorted list. It does not count the work of sorting, and it does not use a campaign trial.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {practiceStep === "result" ? <button type="button" className="min-h-10 rounded border px-3"
              disabled={practicing} onClick={() => void runPractice(true)}>Run final check</button>
              : <button type="button" className="min-h-10 rounded border px-3"
                onClick={() => setPracticeStep("closed")}>Finish practice</button>}
            <button type="button" className="min-h-10 rounded border px-3" disabled={practicing}
              onClick={() => setPracticeStep("stopped")}>Stop practice</button>
          </div>
        </div>}
        {(practiceStep === "closed" || practiceStep === "stopped") && <div className="mt-2 text-sm">
          <p role="status">{practiceStep === "closed" ? "Practice complete. No campaign work was started." : "Practice stopped. Nothing else will run."}</p>
          <button type="button" className="mt-2 min-h-10 rounded border px-3"
            onClick={() => { setPractice(undefined); setPracticeStep("intro"); }}>Start over</button>
        </div>}
      </details>
      {report && <>
        <details className="mt-3 rounded border p-3">
          <summary className="cursor-pointer font-semibold">Create a research campaign</summary>
          <p className="mt-2 text-sm">Start from a research plan to run automatically, or create an empty campaign and add benchmarks yourself.</p>
          <form className="mt-3 grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            void createCampaign();
          }}>
            <fieldset className="grid min-w-0 gap-3">
              <legend className="sr-only">Campaign settings</legend>
              <div className={plan ? "grid grid-cols-1 items-end gap-3 md:grid-cols-2" : "grid grid-cols-1 items-end gap-3 md:grid-cols-3"}>
                <label className="grid min-w-0 gap-1 text-sm">Campaign ID
                  <input className="h-10 w-full min-w-0 rounded border px-2" required maxLength={64} pattern="[A-Za-z0-9_\\-]+"
                    value={campaignId} onChange={(event) => setCampaignId(event.target.value)} />
                </label>
                {!plan && <label className="grid min-w-0 gap-1 text-sm">Trial limit
                  <input className="h-10 w-full min-w-0 rounded border px-2" required type="number" min={1} max={200}
                    value={campaignLimit || ""} onChange={(event) => setCampaignLimit(Number(event.target.value))} />
                </label>}
                <label className="grid min-w-0 gap-1 text-sm">Pause for review every
                  <input className="h-10 w-full min-w-0 rounded border px-2 placeholder:text-[var(--muted)] placeholder:opacity-100" type="number" min={1} max={plan?.trials ?? campaignLimit}
                    placeholder="Final review only" value={reviewEvery} aria-describedby="campaign-review-interval-help"
                  onChange={event => setReviewEvery(event.target.value)} />
                </label>
              </div>
              <p className="text-sm" id="campaign-review-interval-help">
                Enter the number of audited trials between reviews, or leave blank for no scheduled pauses during the run.
              </p>
            </fieldset>
            <div className="grid gap-2 rounded-lg border p-3 text-sm">
              <p className="font-semibold">Run automatically from a research plan</p>
              {!plan && <label className="relative grid min-h-12 cursor-pointer place-items-center rounded-md border border-dashed px-3 font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
                {readingPlan ? "Reading plan…" : "Choose a research plan…"}
                <input className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file"
                  accept=".json,application/json" onChange={event => {
                    void loadPlan(event.target.files?.[0]);
                    event.target.value = "";
                  }} disabled={creating} />
              </label>}
              {plan && <>
                <p className="break-all font-semibold">{plan.name}</p>
                <p>Up to {plan.trials} audited trials and {plan.rounds} rounds of suggestions. The campaign stops if the separate final check passes or a limit is reached.</p>
                <p className="whitespace-pre-wrap break-words"><strong>Public brief:</strong> {plan.brief}</p>
                <p>Only approve a plan you trust: it can run the listed local programs. The selected providers receive the public brief and public experiment settings, not local paths, private evidence, or the final test data.</p>
                <details>
                  <summary className="cursor-pointer font-semibold">View the exact plan and program identities</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2" tabIndex={0}>{plan.raw}</pre>
                </details>
                <button type="button" className="min-h-10 justify-self-start rounded border px-3" disabled={creating} onClick={() => setPlan(undefined)}>Remove plan</button>
              </>}
            </div>
            {!plan && <><label className="grid w-full gap-1 text-sm">Public brief for adaptive proposals (optional)
              <textarea className="rounded border px-2 py-1" rows={3} maxLength={4096}
                value={publicBrief} onChange={(event) => setPublicBrief(event.target.value)}
                aria-describedby="campaign-public-brief-help" />
            </label>
            <label className="grid gap-1 text-sm">Local benchmark time budget (seconds, optional)
              <input className="h-10 w-40 rounded border px-2" type="number" min={2} max={120600}
                value={localBudget} onChange={event => setLocalBudget(event.target.value)} />
              <span>Reserves the time limit for both the benchmark and its checker, including the final check.</span>
            </label>
            <p id="campaign-public-brief-help" className="w-full text-sm">
              Your chosen providers receive this brief and the failure status when a new suggestion is needed. Do not include private information.
            </p></>}
            {(plan || publicBrief.trim()) && <details className="w-full rounded border p-3">
              <summary className="cursor-pointer font-semibold">Suggestion providers and model settings</summary>
              <p className="mt-2">A benchmark only starts after both providers agree. Current selection: {providers[choices[0].lane]} proposes; {providers[choices[1].lane]} checks.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {choices.map((choice, index) => {
                  const role = index === 0 ? "Proposer" : "Independent checker";
                  const fixedEffort = choice.lane === "antigravity" && /orchestrator/i.test(choice.model);
                  const update = (next: ProviderChoice) => setChoices(current => current.map((item, i) => i === index ? next : item));
                  return <fieldset key={role} className="grid gap-2 rounded border p-3">
                    <legend>{role}</legend>
                    <label className="grid gap-1">{role} provider
                      <select className="h-10 rounded border px-2" value={choice.lane} onChange={e => {
                        setAllowPaid(false);
                        update({ lane: e.target.value as CampaignLane, model: "", effort: "" });
                      }}>
                        {(Object.keys(campaignEfforts) as CampaignLane[]).filter(lane => lane !== choices[1 - index].lane)
                          .map(lane => <option key={lane} value={lane}>{providers[lane]}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1">{role} model
                      {choice.lane === "deepseek" ? <select className="h-10 rounded border px-2" value={choice.model}
                        onChange={e => update({ ...choice, model: e.target.value })}>
                        <option value="">Provider default</option>
                        <option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                      </select> : <input className="h-10 min-w-0 rounded border px-2" maxLength={128}
                        placeholder="Provider default" pattern="[A-Za-z0-9][A-Za-z0-9._:/\\-]*"
                        value={choice.model} onChange={e => {
                          const model = e.target.value;
                          update({ ...choice, model, effort: choice.lane === "antigravity" && /orchestrator/i.test(model) ? "" : choice.effort });
                        }} />}
                    </label>
                    {fixedEffort ? <p>Orchestrator sets its own reasoning effort.</p> : <label className="grid gap-1">{role} reasoning effort
                      <select className="h-10 rounded border px-2" value={choice.effort}
                        onChange={e => update({ ...choice, effort: e.target.value })}>
                        <option value="">{choice.lane === "deepseek" ? "Maabarium default (off)" : "Provider default"}</option>
                        {campaignEfforts[choice.lane].map(effort => <option key={effort} value={effort}>{effort === "xhigh" ? "Extra high" : choice.lane === "deepseek" && effort === "none" ? "Off" : effort[0].toUpperCase() + effort.slice(1)}</option>)}
                      </select>
                    </label>}
                  </fieldset>;
                })}
              </div>
              {usesPaid && <button className="mt-3 rounded border px-3 py-2" type="button" role="switch"
                aria-checked={allowPaid} onClick={() => setAllowPaid(!allowPaid)}>
                Allow paid DeepSeek requests: {allowPaid ? "On" : "Off"}
              </button>}
            </details>}
            <button className="min-h-10 justify-self-start rounded border px-3 text-sm" type="submit" disabled={creating || readingPlan || busy || (usesPaid && !allowPaid)}>
              {plan ? "Approve plan and start campaign" : "Create campaign"}
            </button>
          </form>
        </details>
        {!!report.campaigns?.length && <section className="mt-3" aria-label="Research campaigns">
          <h4 className="font-semibold">Research campaigns</h4>
          <ul className="mt-2 space-y-2">
            {report.campaigns.map((campaign) => <li key={campaign.id} className="rounded border p-3 text-sm">
              <p className="break-all font-semibold">{campaign.id}</p>
              <p>{campaign.audited_trials} of {campaign.limit} audited trials · {
                campaign.status === "target_achieved" ? "Target achieved" :
                campaign.status === "confirmation_required" ? "Development pass; sealed confirmation required" :
                campaign.status === "confirming" ? "Sealed confirmation pending" :
                campaign.status === "human_review" ? "Needs review" :
                campaign.status === "checkpoint" ? "Paused for your review" :
                campaign.status === "stopped" ? "Stopped" :
                campaign.status === "blocked" ? "Blocked" :
                campaign.status === "policy_pending" ? "Waiting for the worker to check the approved plan" :
                campaign.autonomy_phase === "trial" ? "Approved trial queued or running" :
                campaign.autonomy_phase === "waiting_for_worker" ? "Waiting for the campaign worker" :
                campaign.autonomy_phase === "discovery" ? "Selecting the next experiment" : "Active"
              }</p>
              {campaign.autonomy_reason && <p className="mt-1">{campaign.autonomy_reason}</p>}
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                <div><dt>Passed</dt><dd className="font-semibold">{campaign.audited_trials - campaign.rejected_trials}</dd></div>
                <div><dt>Did not meet the target</dt><dd className="font-semibold">{campaign.rejected_trials}</dd></div>
                <div><dt>Could not be checked</dt><dd className="font-semibold">{campaign.operational_failures}</dd></div>
              </dl>
              {campaign.confirmation_outcome === "pass" && <p className="mt-2">Final check passed on the separate test panel.</p>}
              {campaign.confirmation_outcome === "fail" && <p className="mt-2">Final check did not meet the target. No further trials will start.</p>}
              {campaign.confirmation_outcome === "operational_failure" && <p className="mt-2">The final check did not record a verdict. This campaign has paused for review.</p>}
              {!!campaign.trial_outcomes?.length && <details className="mt-3">
                <summary className="cursor-pointer font-semibold">Trial results</summary>
                <ol className="mt-1 list-decimal pl-5">
                  {campaign.trial_outcomes.map((outcome, index) => <li key={index}>
                    {outcome === "pass" ? "Passed" : outcome === "fail" ? "Did not meet the target" : "Could not be checked"}
                  </li>)}
                </ol>
              </details>}
              {!!campaign.proposal_usage?.length && <details className="mt-3">
                <summary className="cursor-pointer font-semibold">Token usage for suggestions</summary>
                <p className="mt-1">Local benchmark checks don’t use model tokens. Cache reads may already be included in input.</p>
                <ul className="mt-2 space-y-2">
                  {campaign.proposal_usage.map(usage => <li key={usage.lane} className="rounded border p-2">
                    <p className="font-semibold">{providers[usage.lane] ?? usage.lane}</p>
                    <p>Usage reported for {usage.observed_jobs} of {usage.jobs} jobs.</p>
                    <TokenDetails usage={usage} />
                  </li>)}
                </ul>
              </details>}
              {!!campaign.ready_proposal_rounds?.length && <div className="mt-2">
                <p>Ready to review for a local benchmark:</p>
                <ul className="list-disc pl-5">
                  {campaign.ready_proposal_rounds.map((round) => <li key={round} className="break-all">{round}</li>)}
                </ul>
              </div>}
              {campaign.can_start && <button type="button" className="mt-2 rounded border px-3 py-1"
                disabled={starting || busy} onClick={() => void startCampaign(campaign.id)}>
                Send public brief to selected providers
              </button>}
              {campaign.status === "checkpoint" && <button type="button" className="mt-2 rounded border px-3 py-1"
                disabled={starting || busy || stopping || !!stopRequested}
                onClick={() => void startCampaign(campaign.id, campaign.audited_trials)}>
                Approve and resume campaign
              </button>}
              {["policy_pending", "active", "checkpoint", "confirmation_required", "confirming"].includes(campaign.status) &&
                (stopRequested === campaign.id ? <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="w-full">Cancel queued work and close this campaign? Completed evidence will be kept.</p>
                  <button type="button" className="rounded border px-3 py-1" disabled={stopping}
                    onClick={() => void stopCampaign(campaign.id)}>Stop and cancel queued work</button>
                  <button type="button" className="rounded border px-3 py-1" disabled={stopping}
                    onClick={() => setStopRequested(undefined)}>Keep campaign</button>
                </div> : <button type="button" className="mt-2 rounded border px-3 py-1"
                  disabled={stopping || busy || starting} onClick={() => setStopRequested(campaign.id)}>Stop campaign</button>)}
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
