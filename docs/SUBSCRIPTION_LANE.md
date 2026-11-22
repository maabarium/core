# Unattended subscription research lane

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

If the worker is killed while Codex runs, the child keeps the worker lock
so no second run starts. The queue records the child's process id and
start time; a later tick that finds the child running past its 120 second
deadline plus 30 seconds of grace stops it, after checking that the
process id still belongs to that Codex command, and retries the job.
Scratch files live under the state directory and are removed by the next
tick. Launch agent output goes to `launchd.log` in the state directory.

The queue is at-least-once across a crash before durable completion.
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
