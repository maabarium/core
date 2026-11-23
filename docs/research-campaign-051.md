# Research campaign delivery contract for 0.5.1

Status: incomplete development, not a released capability.

## Acceptance

- Configure a target, trial limit up to 200, provider roles, model/effort,
  resource limits, and human review policy through the desktop app.
- Preserve proposals, executable candidates, operational failures, and audited
  scientific trials as distinct records. Provider messages cannot declare success.
- Carry the prior result and rejected-mechanism history into the next proposal.
- Keep providers read-only by default. Generated code must pass explicit trusted
  validation and the configured review policy before it becomes an executable.
- Freeze candidate and independent auditor identities before opening evidence.
- Verify same teaching evidence, zero wrong answers, no coverage loss, and lower
  total work than the strongest matched exact comparator. Count all preparation,
  proposals, verification, fallback, and inference costs under a frozen contract.
- Do not reuse a repeatedly inspected panel as an unbiased success certificate.
  Separate development feedback from a sealed confirmation panel and preregister
  the campaign-level success rule before trials begin.
- Persist each audited verdict once across crashes and retries. Interrupted
  scientific execution requires review, never a blind automatic rerun.
- Stop at independently audited success, the configured trial bound, explicit
  user stop, or a safety failure. No work may start after the terminal state.
- Display campaign progress, decisions, provider token usage, failures, and final
  review in the existing reporting surfaces.
- Verify restart, quota recovery, cancellation, malformed output, tampering,
  duplicate results, concurrency, paid-fallback exclusion, and native UI behavior.

## Current implementation

The worker supports `campaign-create` and `campaign-status` with an experiment
ID. Submit a frozen trial through `local-benchmark-enqueue` with `--campaign`
and `--contract-sha256`; the first trial binds the contract for that campaign.
Only one trial can be pending, and duplicate runner hashes are rejected.
Use `campaign-stop --id <campaign>` to stop dispatch and cancel its queued work.
If the worker is in an active attempt, stop is rejected until it releases the lock.
The desktop Research activity report also offers **Stop campaign**. It preserves
completed evidence, cancels queued campaign jobs, and refuses to interrupt a
running campaign attempt.
Trial outcomes and job completion are committed together after the independent
audit. Operational failures require review rather than counting as scientific
verdicts. The desktop Research activity report shows campaign progress.

The benchmark and auditor must be trusted local executables. Code suggestions
are not automatically executed. `campaign-propose --campaign <campaign> --id
<round> --public-target <brief>` queues advisory jobs for Codex and Antigravity
without consuming trial slots. Pending proposals and pending trials cannot
overlap in a campaign, and stopping cancels pending proposals too.
When enqueueing a vetted benchmark, `--proposal-round <round>` connects
it to a completed pair of subscription results in the same campaign. The
frozen trial spec records both result hashes; a round cannot be reused.
This is provenance, not evidence or an authorization from the providers.
Add `--stage` to reserve a slot for an approved trial. The worker dispatches
staged trials in submission order after audited failures. A pass, resource
or execution failure, explicit stop, or exhausted budget prevents remaining
staged trials from launching. The worker never executes provider text.
For adaptive discovery, include an approved public brief via `--public-target`
when creating the campaign from the CLI. An audited failure with no staged
trial queues one deterministic Codex/Antigravity proposal pair. Only the
failure bit and the approved brief go to providers; local evidence stays local.
Start discovery explicitly with `campaign-start --id <campaign>` or
**Send public brief to Codex and Antigravity** in Research activity. Repeating
the request does not create a duplicate round or consume a trial.
For an unattended search over a vetted catalog, add
`--stage --select-by-proposal` when submitting each approved benchmark
before starting discovery. Use public-safe trial IDs: providers receive
the IDs and approved brief, never executable paths or benchmark output.
The worker dispatches a catalog trial only when both subscription results
return the same available ID. Disagreement, invalid IDs, or failed proposals
stop at review. After an audited failure it requests another selection from
the remaining catalog, unless the trial limit has been reached.
An adaptive development pass stops dispatch at **Sealed confirmation
required**, not **Target achieved**. This prevents a search over many
development trials from declaring success on the same evidence it used to
choose the candidate. A trusted operator can enqueue the single sealed
confirmation from **Set up a local benchmark → Attach to a research campaign →
Run sealed confirmation instead**, or through the CLI with
`--confirm-panel-sha256`. Both paths require the original
contract hash, and separate pinned runner and auditor executables. The auditor
must bind its result to the approved panel and the winning development
evidence. Confirmation stays local and does not consume another development
trial. The auditor is trusted to verify panel separation and candidate
identity; different file hashes alone do not prove those properties.

For unattended confirmation, turn on **Pre-approve sealed confirmation after
a development pass** in the desktop benchmark form, or pass
`--confirmation-plan <file>` when enqueueing the development trial. The JSON
accepts only `runner`, `runner_sha256`, `auditor`, `auditor_sha256`, and
`panel_sha256`. On a development pass the worker reserves one confirmation
atomically with the audited verdict. It rechecks both executable pins and
copies the hash-verified winning evidence into the isolated confirmation
directory as `development.json`, for the trusted auditor. Nothing from that
directory is sent to providers.
The desktop can create campaigns, display counts, and approve a frozen trial
through **Set up a local benchmark → Attach to a research campaign**. The
optional completed-round ID pins the two proposal results to that trial.
To stage a catalog entry from the desktop, choose **Let Codex and Antigravity
select this candidate** and enter a public-safe candidate ID before starting
discovery. Preparing new benchmark executables from free-form proposals and
native release verification remain open.

The synthetic end-to-end worker test
`test_full_adaptive_catalog_with_subscriptions_and_confirmation` exercises
two provider selections, one audited rejection, a development pass, and
sealed confirmation across independent worker invocations. Its provider
clients are fixtures, not live accounts. The test audits two development
trials and one separate confirmation; it does not run CODA evidence.

Do not publish 0.5.1 or start the real 200-trial CODA campaign until these
acceptance requirements are implemented and verified.
