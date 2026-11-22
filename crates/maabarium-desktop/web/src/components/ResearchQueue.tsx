import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ResearchReport, TokenDetails, type TokenUsage } from "./ResearchReport";

const labels = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse" };
type Lane = keyof typeof labels;
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
};
type Job = {
  id: string;
  lane: Lane;
  state: string;
  attempts: number;
  detail: string | null;
  result: string | null;
  usage?: TokenUsage | null;
  due?: number;
};

export function ResearchQueue() {
  const [lane, setLane] = useState<Lane>("codex");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Partial<Record<Lane, string>>>({});
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<Lane[]>([]);
  const [reviewEvery, setReviewEvery] = useState(1);
  const [loopId, setLoopId] = useState("");
  async function startLoop() {
    setBusy(true);
    setMessage("");
    try {
      const id = await invoke<string>("research_loop_start", { target, plan, reviewEvery });
      setLoopId(id);
      setMessage("Experiment saved and its first step queued.");
      setJobs(await invoke<Job[]>("research_queue_list"));
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
      setJobs(await invoke<Job[]>("research_queue_list"));
      setMessage(id ? `Queued ${id}.` : "Queue refreshed.");
    } catch (error) {
      setMessage(id ? `Queued ${id}, but refresh failed: ${String(error)}` : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-card rounded-xl border p-5" aria-labelledby="research-queue-title">
      <h2 id="research-queue-title" className="text-lg font-semibold">Research queue</h2>
      <p className="mt-1 text-sm">Queue a test task using public information. Providers you’ve set up can run in the background. For the others, run the task yourself and import the result.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="research-lane">Provider</label>
        <select className="rounded border bg-transparent p-2" id="research-lane" value={lane}
          disabled={busy} onChange={(event) => setLane(event.target.value as Lane)}>
          {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void update(true)}>Queue task</button>
        <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => void update(false)}>Refresh queue</button>
      </div>
      <details className="mt-4 rounded border p-3">
        <summary className="cursor-pointer font-medium">Set up {labels[lane]}</summary>
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
      </details>
      <details className="mt-4 rounded border p-3">
        <summary className="cursor-pointer font-medium">Set up an experiment</summary>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void startLoop(); }}>
          <label className="block" htmlFor="research-target">Public research target</label>
          <textarea id="research-target" className="w-full rounded border bg-transparent p-2"
            maxLength={4096} value={target} disabled={busy}
            onChange={(event) => setTarget(event.target.value)} />
          <p className="text-sm">Only enter material you can send to every selected provider. The worker pauses at each checkpoint and after the final step. Failed jobs do not advance.</p>
          <label className="block" htmlFor="research-checkpoint">Pause for review after</label>
          <select id="research-checkpoint" className="rounded border bg-transparent p-2"
            value={reviewEvery} disabled={busy}
            onChange={(event) => setReviewEvery(Number(event.target.value))}>
            {Array.from({ length: Math.max(1, plan.length) }, (_, index) =>
              <option key={index} value={index + 1}>{index === 0 ? "Every step" : `Every ${index + 1} steps`}</option>)}
          </select>
          <ol className="list-decimal space-y-1 pl-5" aria-label="Experiment steps">
            {plan.map((provider, index) => <li key={index}>
              {labels[provider]}
              <button type="button" className="ml-2 rounded border px-2"
                aria-label={`Remove step ${index + 1}`} disabled={busy}
                onClick={() => {
                  setPlan((previous) => previous.filter((_, i) => i !== index));
                  setReviewEvery((previous) => Math.min(previous, Math.max(1, plan.length - 1)));
                }}>Remove</button>
            </li>)}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-2" disabled={busy || plan.length >= 20}
              onClick={() => setPlan((previous) => [...previous, lane])}>Add {labels[lane]} step</button>
            <button type="submit" className="rounded border px-3 py-2"
              disabled={busy || !target.trim() || new TextEncoder().encode(target.trim()).length > 4096 || !plan.length}>Start experiment</button>
          </div>
        </form>
        {loopId && <p className="mt-3 break-all text-sm">Experiment ID: {loopId}. Use the command-line tool to review the result and continue.</p>}
      </details>
      <p className="mt-2 break-words text-sm" role="status">{message}</p>
      <ResearchReport />
      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Latest research jobs">
          {jobs.map((job) => (
            <li key={job.id} className="rounded border p-3">
              <p className="font-semibold">{labels[job.lane] ?? job.lane}: {job.state}</p>
              <p className="break-all text-sm">{job.id}</p>
              <p className="text-sm">{job.attempts} attempts{job.detail ? ` · ${job.detail}` : ""}</p>
              {job.state === "queued" && job.due && job.due > Date.now() / 1000 ? (
                <p className="text-sm">Next attempt: {new Date(job.due * 1000).toLocaleString()}</p>
              ) : null}
              {job.usage && <details className="mt-2"><summary>Reported tokens</summary><TokenDetails usage={job.usage} /></details>}
              {job.result && <details className="mt-2"><summary>Result</summary><p className="whitespace-pre-wrap break-words">{job.result}</p></details>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
