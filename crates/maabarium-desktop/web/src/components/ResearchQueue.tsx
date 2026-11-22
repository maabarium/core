import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

const labels = { codex: "Codex", claude: "Claude", antigravity: "Antigravity", muse: "Muse" };
type Lane = keyof typeof labels;
const setup: Record<Lane, { status: string; steps: string[]; check: string }> = {
  codex: {
    status: "Local worker · ChatGPT login required",
    steps: [
      "Install the official Codex CLI and sign in with ChatGPT, not an API key.",
      "Run the status check below. It should say “Logged in using ChatGPT”.",
      "Install the Maabarium launch agent using the local queue guide, then queue a test task.",
    ],
    check: "codex login status",
  },
  claude: {
    status: "Manual handoff · unattended billing not verified",
    steps: [
      "Use the sign-in flow in Claude Desktop or Claude Code. Desktop and CLI sessions can differ.",
      "Check the CLI login separately. Maabarium does not read or store Claude tokens.",
    ],
    check: "claude auth status",
  },
  antigravity: {
    status: "Manual handoff · unattended billing not verified",
    steps: [
      "Install the official Antigravity CLI and sign in with the Google account on your plan.",
      "Turn off Use AI Credits in the CLI settings and set account credit overages to Never.",
    ],
    check: "agy models",
  },
  muse: {
    status: "Manual handoff · unattended billing not verified",
    steps: [
      "Sign in through Muse’s official browser flow. Do not configure an API key for this lane.",
      "Check the subscription allowance below. A missing allowance does not verify subscription billing.",
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
};

export function ResearchQueue() {
  const [lane, setLane] = useState<Lane>("codex");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Partial<Record<Lane, string>>>({});
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
      <p className="mt-1 text-sm">Queue a public synthetic task. Codex runs only when the local subscription worker is installed. The other lanes currently require manual handoff.</p>
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
      <p className="mt-2 break-words text-sm" role="status">{message}</p>
      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Latest research jobs">
          {jobs.map((job) => (
            <li key={job.id} className="rounded border p-3">
              <p className="font-semibold">{labels[job.lane] ?? job.lane}: {job.state}</p>
              <p className="break-all text-sm">{job.id}</p>
              <p className="text-sm">{job.attempts} attempts{job.detail ? ` · ${job.detail}` : ""}</p>
              {job.result && <details className="mt-2"><summary>Result</summary><p className="whitespace-pre-wrap break-words">{job.result}</p></details>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
