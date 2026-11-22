import { Disclosure } from "./ui/Disclosure";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { ResearchReport, TokenDetails, type TokenUsage } from "./ResearchReport";
import { EvaluationRuleFields, EvidenceCheck, type EvaluationSetup } from "./ResearchEvaluation";

const labels = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse", deepseek: "DeepSeek (paid API)" };
type Lane = keyof typeof labels;
type Step = { lane: Lane; model: string | null; effort: string | null };
const commonEffort = ["low", "medium", "high", "xhigh"];
const effortOptions: Record<Lane, string[]> = {
  codex: commonEffort,
  claude: [...commonEffort, "max"],
  antigravity: [...commonEffort, "max"],
  muse: ["none", "minimal", ...commonEffort, "max", "ultra"],
  deepseek: ["low", "high", "max"],
};
const setup: Record<Lane, { status: string; steps: string[]; check: string }> = {
  codex: {
    status: "Local worker · ChatGPT login required",
    steps: [
      "In Terminal, run codex login and choose ChatGPT, not an API key.",
      "Run the status check below. It should say “Logged in using ChatGPT”.",
      "Install the Maabarium launch agent using the local queue guide, then queue a test task.",
    ],
    check: "codex login status",
  },
  claude: {
    status: "Before enabling background runs, turn off Usage credits",
    steps: [
      "In Terminal, run claude auth login and choose your Claude account. Desktop and CLI sessions can differ.",
      "Check the CLI login separately. Maabarium does not read or store Claude tokens.",
    ],
    check: "claude auth status",
  },
  antigravity: {
    status: "Before enabling background runs, turn off AI Credit Overages",
    steps: [
      "Install the official Antigravity CLI and sign in with the Google account on your plan.",
      "Turn off Use AI Credits in the CLI settings and set account credit overages to Never.",
    ],
    check: "agy models",
  },
  muse: {
    status: "To run in the background, sign in to an active Muse subscription",
    steps: [
      "In Terminal, run muse login and approve the device code in your browser. Do not configure an API key for this lane.",
      "Use Check setup to ask Muse directly whether its browser account is signed in. The allowance check below is separate.",
    ],
    check: "muse usage",
  },
  deepseek: {
    status: "Optional usage-based billing. Subscription jobs never switch to this route.",
    steps: [
      "Create an API key in the DeepSeek platform and check its billing settings.",
      "In macOS Keychain Access, add a password item named maabarium.deepseek, with account api and your API key as the password.",
      "Enable DeepSeek in the local worker using the queue guide. Check setup does not make an API call.",
    ],
    check: "Worker option: --enable-deepseek",
  },
};
export type ResearchJob = {
  id: string;
  lane: string;
  state: string;
  attempts: number;
  detail: string | null;
  result: string | null;
  usage?: TokenUsage | null;
  due?: number;
  model?: string | null;
  effort?: string | null;
  experiment_title?: string | null;
  experiment_active?: boolean | null;
  review_pending?: boolean;
};

const ResearchOutput = lazy(() => import("./ResearchOutput"));

function QueueEntry({ job }: { job: ResearchJob }) {
  const experiment = job.id.startsWith("loop:");
  const local = job.lane === "Local evidence";
  const provider = labels[job.lane as Lane] ?? job.lane;
  const retry = job.state === "queued" && job.due && job.due > Date.now() / 1000 ? job.due : null;
  const status = job.review_pending ? "Awaiting human review"
    : retry ? "Retry scheduled"
    : ({ queued: "Waiting to run", done: "Completed", running: "Running", failed: "Failed" } as Record<string, string>)[job.state] ?? "Unknown status";
  const title = job.experiment_title ?? (local ? job.detail?.split(": waiting for the local runner")[0] ?? "Local benchmark"
    : experiment ? "Research experiment" : `${provider} check`);
  const subtitle = local ? "Runs locally. No model provider or paid API is used."
    : experiment ? (job.id.endsWith(":review") ? `AI review · ${provider}` : provider) : null;
  const finding = job.result?.match(/^(?:#{1,6}\s+)?(?:\*\*)?(?:Answer|Finding|Verdict)(?:\*\*)?\s*:(?:\*\*)?\s*(.{1,240})(?:\r?\n|$)/im)?.[1];
  const next = local && job.state === "queued" ? "The benchmark hasn’t started."
    : job.review_pending ? "Read the report before deciding whether to continue."
    : retry ? `${job.detail?.includes("quota") ? "Waiting for the provider’s quota to reset. " : ""}Next attempt: ${new Date(retry * 1000).toLocaleString()}`
    : job.state === "failed" ? job.detail ?? "See technical details for more information."
    : job.state === "queued" ? "Waiting for the selected provider."
    : null;
  return <li className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="min-w-0 break-words font-semibold">{title}</h4>
      <span className="rounded-full border border-[var(--line)] bg-[var(--subtle)] px-2.5 py-1 text-xs font-semibold">{status}</span>
    </div>
    {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
    {next && <p className="mt-2 text-sm">{next}</p>}
    {finding && <div className="mt-2"><Suspense fallback={<p className="text-sm">Formatting finding…</p>}>
      <ResearchOutput text={finding} />
    </Suspense></div>}
    {job.result && <Disclosure title="Report" className="mt-3" mountWhenExpanded>
      <Suspense fallback={<p className="text-sm">Formatting report…</p>}><ResearchOutput text={job.result} /></Suspense>
    </Disclosure>}
    <Disclosure title="Technical details" className="mt-3" mountWhenExpanded>
      <dl className="space-y-1 text-sm">
        <div><dt className="inline font-semibold">Job ID: </dt><dd className="inline break-all font-mono">{job.id}</dd></div>
        <div><dt className="inline font-semibold">Attempts: </dt><dd className="inline">{job.attempts}</dd></div>
        {job.detail && <div><dt className="inline font-semibold">Worker note: </dt><dd className="inline">{job.detail}</dd></div>}
        {(job.model || job.effort) && <div><dt className="inline font-semibold">Model and effort: </dt><dd className="inline">{job.model ?? "Default"} · {job.effort ?? "Default"}</dd></div>}
      </dl>
      {job.usage && <Disclosure title="Reported tokens" className="mt-2"><TokenDetails usage={job.usage} /></Disclosure>}
      {job.result && <Disclosure title="Raw output" className="mt-2" mountWhenExpanded>
        <pre className="whitespace-pre-wrap break-words text-xs">{job.result}</pre>
      </Disclosure>}
    </Disclosure>
  </li>;
}

export function ResearchRunHistory({ jobs }: { jobs: ResearchJob[] }) {
  if (!jobs.length) return <p className="text-sm text-[var(--muted)]">No research queue experiments yet.</p>;
  return <ul className="space-y-2" aria-label="Research queue experiments">
    {jobs.map(job => <QueueEntry key={job.id} job={job} />)}
  </ul>;
}

function ResearchSelect({ className = "", children, ...props }: ComponentProps<"select">) {
  return <span className={`relative inline-flex max-w-full align-middle ${className}`}>
    <select {...props} className="h-10 w-full appearance-none rounded-md border bg-transparent pl-3 pr-9 disabled:opacity-60">
      {children}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
  </span>;
}

export function ResearchQueue({ onJobsChange }: { onJobsChange?: (jobs: ResearchJob[]) => void } = {}) {
  const [lane, setLane] = useState<Lane>("codex");
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Partial<Record<Lane, string>>>({});
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<Step[]>([]);
  const [reviewEvery, setReviewEvery] = useState(1);
  const [loopId, setLoopId] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationSetup | null>(null);
  const [evaluationMode, setEvaluationMode] = useState("human");
  const [reviewer, setReviewer] = useState<Step | null>(null);
  const [allowPaid, setAllowPaid] = useState(false);
  const useReviewer = evaluationMode === "ai" || evaluationMode === "both";
  const hasPaid = plan.some((step) => step.lane === "deepseek") || (useReviewer && reviewer?.lane === "deepseek");
  const finalLane = plan[plan.length - 1]?.lane;
  const reviewerValid = !useReviewer || (reviewer && reviewer.lane !== finalLane);
  useEffect(() => {
    if (!onJobsChange) return;
    let mounted = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const latest = await invoke<ResearchJob[]>("research_queue_list");
        if (mounted) { setJobs(latest); onJobsChange(latest); }
      } catch { /* The explicit Refresh action reports errors. */ }
      finally { loading = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [onJobsChange]);

  async function readJobs() {
    const latest = await invoke<ResearchJob[]>("research_queue_list");
    setJobs(latest);
    onJobsChange?.(latest);
  }
  async function startLoop() {
    setBusy(true);
    setMessage("");
    try {
      const id = await invoke<string>("research_loop_start", {
        target, plan, reviewEvery, ...(evaluation ? { evaluation } : {}),
        ...(useReviewer && reviewer ? { reviewer } : {}),
        ...(hasPaid ? { allowPaid } : {}),
      });
      setLoopId(id);
      setMessage("Experiment saved and its first step queued.");
      await readJobs();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function checkSubscription() {
    setChecking(true);
    try {
      const result = await invoke<string>("research_subscription_check", { lane });
      setChecks((previous) => ({ ...previous, [lane]: result }));
    } catch (error) {
      setChecks((previous) => ({ ...previous, [lane]: String(error) }));
    } finally {
      setChecking(false);
    }
  }
  async function update(enqueue: boolean) {
    setBusy(true);
    setMessage("");
    let id: string | undefined;
    try {
      if (enqueue) id = await invoke<string>("research_queue_enqueue", { lane });
      await readJobs();
      setMessage(id ? `Queued ${id}.` : "Queue refreshed.");
    } catch (error) {
      setMessage(id ? `Queued ${id}, but refresh failed: ${String(error)}` : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="research-queue" className="workspace-card rounded-xl border p-5" aria-labelledby="research-queue-title">
      <h2 id="research-queue-title" className="text-lg font-semibold">Research queue</h2>
      <p className="mt-1 text-sm">Queue a test task using public information. Providers you’ve set up can run in the background. For the others, run the task yourself and import the result.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="research-lane">Provider</label>
        <ResearchSelect id="research-lane" value={lane}
            disabled={busy} onChange={(event) => setLane(event.target.value as Lane)}>
            {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ResearchSelect>
        <button type="button" className="h-10 rounded-md border px-3" disabled={busy || lane === "deepseek"} onClick={() => void update(true)}>Queue task</button>
        <button type="button" className="h-10 rounded-md border px-3" disabled={busy} onClick={() => void update(false)}>Refresh queue</button>
      </div>
      <Disclosure className="mt-4" title={`Set up ${labels[lane]}`}>
        <p className="mt-2 text-sm">{setup[lane].status}</p>
        <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">
          {setup[lane].steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <code className="break-all text-sm">{setup[lane].check}</code>
        <div className="mt-3">
          <button type="button" disabled={checking} className="rounded border px-3 py-2"
            onClick={() => void checkSubscription()}>{checking ? "Checking…" : "Check setup"}</button>
        </div>
        <p role="status" className="mt-2 text-sm">{checks[lane]}</p>
      </Disclosure>
      <Disclosure className="mt-4" title="Set up an experiment">
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void startLoop(); }}>
          <label className="block" htmlFor="research-target">Public research target</label>
          <textarea id="research-target" className="w-full rounded border bg-transparent p-2"
            maxLength={4096} value={target} disabled={busy}
            onChange={(event) => setTarget(event.target.value)} />
          <p className="text-sm">Only enter material you can send to every selected provider. The worker pauses at each checkpoint and after the final step. Failed jobs do not advance.</p>
          <label className="block" htmlFor="research-checkpoint">Pause for review after</label>
          <ResearchSelect id="research-checkpoint"
            value={reviewEvery} disabled={busy}
            onChange={(event) => setReviewEvery(Number(event.target.value))}>
            {Array.from({ length: Math.max(1, plan.length) }, (_, index) =>
              <option key={index} value={index + 1}>{index === 0 ? "Every step" : `Every ${index + 1} steps`}</option>)}
          </ResearchSelect>
          <ol className="list-decimal space-y-1 pl-5" aria-label="Experiment steps">
            {plan.map((step, index) => <li key={index} className="rounded border p-2">
              <span className="font-medium">{labels[step.lane]}</span>
              <button type="button" className="ml-2 rounded border px-2"
                aria-label={`Remove step ${index + 1}`} disabled={busy}
                onClick={() => {
                  setPlan((previous) => previous.filter((_, i) => i !== index));
                  setReviewEvery((previous) => Math.min(previous, Math.max(1, plan.length - 1)));
                }}>Remove</button>
              <div className="mt-2 flex flex-wrap gap-3">
                <label className="text-sm">Model
                  <input className="ml-2 rounded border bg-transparent p-1"
                    aria-label={`Model for step ${index + 1}`} placeholder="Use default"
                    maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9._:/\\-]*"
                    disabled={busy} value={step.model ?? ""}
                    onChange={(event) => {
                      const model = event.target.value || null;
                      setPlan((previous) => previous.map((value, i) => i === index
                        ? { ...value, model, effort: value.lane === "antigravity" && /orchestrator/i.test(model ?? "") ? null : value.effort }
                        : value));
                    }} />
                </label>
                <label className="text-sm">Thinking effort
                  <ResearchSelect className="ml-2" aria-label={`Thinking effort for step ${index + 1}`}
                    disabled={busy || (step.lane === "antigravity" && /orchestrator/i.test(step.model ?? ""))}
                    value={step.effort ?? ""} onChange={(event) => {
                      const effort = event.target.value || null;
                      setPlan((previous) => previous.map((value, i) => i === index ? { ...value, effort } : value));
                    }}>
                    <option value="">Use default</option>
                    {effortOptions[step.lane].map((effort) => <option key={effort} value={effort}>
                      {effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1)}
                    </option>)}
                  </ResearchSelect>
                </label>
              </div>
            </li>)}
          </ol>
          <fieldset disabled={busy} className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 font-medium">Evaluation</legend>
            <label className="block text-sm">How should we review this experiment?
              <ResearchSelect className="ml-2" value={evaluationMode}
                onChange={(event) => {
                  const mode = event.target.value;
                  setEvaluationMode(mode);
                  setEvaluation((previous) => mode === "local" || mode === "both"
                    ? previous ?? { baseline: "", minimumSavingsPercent: 20 } : null);
                }}>
                <option value="human">Human review only</option>
                <option value="local">Local checks</option>
                <option value="ai">AI reviewer</option>
                <option value="both">Both: local checks and AI review</option>
              </ResearchSelect>
            </label>
            {evaluation && <EvaluationRuleFields setup={evaluation} onChange={setEvaluation} disabled={busy} />}
            {useReviewer && <>
              <p className="text-sm">The selected provider receives the public target, an excerpt of the final step, and local verdict totals if available. Keep private information out of the target and steps. The reviewer cannot change a verdict or start another experiment.</p>
              <label className="block text-sm">Reviewer provider
                <ResearchSelect className="ml-2" required value={reviewer?.lane ?? ""}
                  onChange={(event) => {
                    const selected = event.target.value as Lane | "";
                    setReviewer(selected ? { lane: selected, model: null, effort: null } : null);
                  }}>
                  <option value="">Choose a provider</option>
                  {(Object.keys(labels) as Lane[]).map((provider) => <option key={provider} value={provider}
                    disabled={provider === finalLane}>{labels[provider]}</option>)}
                </ResearchSelect>
              </label>
              {reviewer && <>
                <label className="block text-sm">Reviewer model
                  <input className="ml-2 rounded border bg-transparent p-2" value={reviewer.model ?? ""}
                    maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,127}" placeholder="Subscription default"
                    onChange={(event) => {
                      const model = event.target.value || null;
                      setReviewer({ ...reviewer, model, effort: reviewer.lane === "antigravity" && /orchestrator/i.test(model ?? "") ? null : reviewer.effort });
                    }} />
                </label>
                <label className="block text-sm">Reviewer thinking effort
                  <ResearchSelect className="ml-2" value={reviewer.effort ?? ""}
                    disabled={reviewer.lane === "antigravity" && /orchestrator/i.test(reviewer.model ?? "")}
                    onChange={(event) => setReviewer({ ...reviewer, effort: event.target.value || null })}>
                    <option value="">{reviewer.lane === "deepseek" ? "Off" : "Provider default"}</option>
                    {effortOptions[reviewer.lane].map((effort) => <option key={effort} value={effort}>{effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1)}</option>)}
                  </ResearchSelect>
                </label>
              </>}
              {!reviewerValid && reviewer && <p role="alert" className="text-sm">Choose a different reviewer provider from the last research step.</p>}
            </>}
          </fieldset>
          {hasPaid && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" role="switch" className="toggle-switch" checked={allowPaid}
              onChange={(event) => setAllowPaid(event.target.checked)} />
            Allow DeepSeek API charges for this experiment
          </label>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-2" disabled={busy || plan.length >= 20}
              onClick={() => setPlan((previous) => [...previous, { lane, model: null, effort: null }])}>Add {labels[lane]} step</button>
            <button type="submit" className="rounded border px-3 py-2"
              disabled={busy || !reviewerValid || (hasPaid && !allowPaid) || !target.trim() || new TextEncoder().encode(target.trim()).length > 4096 || !plan.length}>Start experiment</button>
          </div>
        </form>
        {loopId && <p className="mt-3 break-all text-sm">Experiment ID: {loopId}. Use the command-line tool to review the result and continue.</p>}
      </Disclosure>
      <EvidenceCheck experimentId={loopId} />
      <p className="mt-2 break-words text-sm" role="status">{message}</p>
      <ResearchReport />
      {[
        { title: "Active experiments", entries: jobs.filter(job => job.id.startsWith("loop:") && job.experiment_active !== false) },
        { title: "Earlier experiments", entries: jobs.filter(job => job.id.startsWith("loop:") && job.experiment_active === false) },
        { title: "Provider checks", entries: jobs.filter(job => !job.id.startsWith("loop:")) },
      ].filter(group => group.entries.length > 0).map(group => <div key={group.title} className="mt-5">
        <h3 className="mb-2 font-semibold">{group.title}</h3>
        <ul className="space-y-2" aria-label={group.title}>
          {group.entries.map(job => <QueueEntry key={job.id} job={job} />)}
        </ul>
      </div>)}
    </section>
  );
}
