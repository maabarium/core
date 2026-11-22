# Unattended subscription research lane

The local queue stores explicit Codex, Claude, Antigravity, and Muse
routes. Codex runs unattended by default when the worker is installed.
Claude and Antigravity can opt in on a personal machine after checking
their account's paid overage settings. Unconfigured routes use a manual handoff
and do not invoke a provider or assert how a result was billed:

```sh
python3 scripts/subscription_lane.py enqueue --lane claude --id review-1
python3 scripts/subscription_lane.py export-task --id review-1
python3 scripts/subscription_lane.py import-result --id review-1 --result-file answer.txt
python3 scripts/subscription_lane.py status
```

The same commands work with `--lane antigravity` or `--lane muse`.
Existing queues migrate in place, with old jobs assigned to Codex. A
provider-specific job never falls back to another route. These are local
CLI handoff controls, not native workflow history. The macOS desktop
Research queue lets you choose a lane, enqueue the fixed public task, and
refresh status and results. The provider setup disclosure explains the
official sign-in and verification steps. **Check setup** checks for local
clients at standard paths and queries Codex, Claude, and Muse sign-in status
without returning credential data. It does not start a model or prove
paid overages are off. Custom `--state` paths are CLI-only.

The proposed continuous research loop also needs a configurable experiment
target, per-lane capability and billing checks, review and promotion gates,
and independent result validation. A bounded CLI controller now queues one
step at a time and only advances after explicit operator acceptance.
Start an experiment from the desktop's Research queue or from the CLI.
Desktop start queues exactly the first job and shows the experiment ID.
Review and stop are currently CLI controls:

```sh
python3 scripts/subscription_lane.py loop-start --id public-example \
  --public-target 'Compare exact and greedy inference on public synthetic rules' \
  --plan codex muse claude antigravity
python3 scripts/subscription_lane.py loop-status --id public-example
python3 scripts/subscription_lane.py loop-review --id public-example --step 1 --decision accept
```

Use only material safe to disclose to the chosen providers. Each step uses
the same target, not previous model output. Use `--decision stop` to stop
the current loop. Other providers remain manual; this is not a scientific
evaluator, promotion gate, or unattended four-provider pipeline.

For Muse, Lascoria's account coordinator provides a useful boundary:
it removes `META_API_KEY`, isolates account configuration, and requires the
native host to confirm account login before starting a subscription session.
Maabarium uses the native experimental `account/read` handshake with a
clean environment to distinguish browser-account login from other states.
It doesn't copy Lascoria's credentials or use Lascoria's process as a proxy.
An installed Muse binary and a missing allowance response are not equivalent
to that contract. Do not copy Lascoria's credential store or enable its
separate API-key path in this queue.

The experimental sidecar runs one fixed, public synthetic research task
through the installed Codex CLI. It does not send a checkout, private
research artifacts, or held-out inputs. This lane is separate from
Maabarium's API-backed model pool, group history, and winner promotion.
It never uses an API fallback or promotes a result.

Use macOS and Python 3.9+ with Codex signed in using ChatGPT. The worker
checks the login each time, uses a credential-free environment allowlist,
ignores user CLI config for execution, and disables shell, hooks and web
search in an ephemeral, read-only scratch session. Use a trusted local
Codex binary. Quota and other transient runner failures share a bounded
retry path; the worker does not claim to read a provider's quota reset.

To enable Claude and Antigravity, first verify that Claude **Settings →
Usage → Usage credits** is off and Antigravity **Models & Usage → Enable AI
Credit Overages** is off for the CLI accounts. Then pass
`--claude "$HOME/.local/bin/claude" --antigravity "$HOME/.local/bin/agy"`
when generating the launch agent or running a tick. These explicit paths
are operator opt-ins, not programmable account-billing evidence. If you
enable account overages later, unload the worker or remove that lane before
doing so. The worker rechecks Claude first-party paid-plan login at each
attempt, strips API credential environment variables, and forces
`useG1Credits=false` for Antigravity. It never retries on another provider.
Antigravity uses Gemini 4 Neon Low, not the desktop Orchestrator pair.
Muse remains manual.

From the checkout that will remain on disk:

```sh
python3 scripts/subscription_lane.py enqueue
python3 scripts/subscription_lane.py status
mkdir -p "$HOME/Library/LaunchAgents"
python3 scripts/subscription_lane.py launchd-plist > "$HOME/Library/LaunchAgents/org.maabarium.subscription-lane.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.maabarium.subscription-lane.plist"
```

The agent runs at load and then checks every minute while the user
session is available. Stop it with
`launchctl bootout "gui/$(id -u)/org.maabarium.subscription-lane"`.
A tick claims one item and exits. Enqueue with a different `--id` for
another independent run of the same fixed prompt. The SQLite queue
lives in a private per-user directory; do not commit it or its replies.

The queue is at-least-once across a crash before durable completion. A
separate process holds the worker lock and enforces the model attempt
deadline if the queue worker is killed.
A retry may use subscription quota again, but cannot create a second
completed row. This is appropriate for synthetic research, not a
one-look held-out evidence transaction. The lane stops retrying after
four execution attempts and never switches providers.

Run `python3 tests/subscription_lane_test.py` to exercise interruption
and recovery with a fake provider. A real subscription smoke test is
separate; no API key is needed for either test.

Local acceptance: a task was enqueued before a temporary macOS launch
agent loaded. The launch agent completed it through the installed
ChatGPT-authenticated Codex CLI on its first attempt; the temporary
agent was then unloaded. SIGKILL and restart were tested separately
with the fake CLI. A real quota exhaustion/reset was not induced.
