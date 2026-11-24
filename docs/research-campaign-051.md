# Research campaign delivery contract for 0.5.1

Status: vetted-benchmark release candidate in verification; not yet released.

## Acceptance checklist

Checked items apply to the implemented vetted-catalog workflow and its test
fixtures. They are not claims about live subscriptions or scientific CODA
results.

- [x] Configure a target, trial limit up to 200, and distinct provider roles
  with provider-specific model and effort settings through the desktop app.
- [x] Configure a recurring human checkpoint in the desktop app. Approval
  resumes the current campaign; stopping preserves completed evidence.
- [x] Configure a cumulative local benchmark time budget. Before launch the
  worker reserves both program deadlines, including for sealed confirmation.
- [x] Preserve proposals, executable candidates, operational failures, and audited
  scientific trials as distinct records. Provider messages cannot declare success.
- [x] Carry prior failure and bounded rejected public catalog IDs into the next
  proposal. Raw evidence and private trial identifiers stay local.
- [x] Keep provider jobs constrained to advisory output. Only explicitly approved,
  pinned runners and auditors may execute locally. The app does not auto-author
  executable code from provider replies.
- [x] Prepare, review against a saved pin, and independently audit a new
  template-derived synthetic benchmark through the campaign worker.
- [x] Package custom programs after independent approval pins their exact
  bytes, and verify their identities without executing them.
- [x] Freeze candidate and independent auditor identities before opening evidence.
- [x] Do not reuse a repeatedly inspected panel as an unbiased success certificate.
  Separate development feedback from a sealed confirmation panel and preregister
  the campaign-level success rule before trials begin.
- [x] Persist each audited verdict once across crashes and retries. Interrupted
  scientific execution requires review, never a blind automatic rerun.
- [x] Stop trial dispatch at independently audited success, the configured trial bound, explicit
  user stop, or a safety failure. No work may start after the terminal state.
- [x] Display campaign progress, trial decisions, reported proposal token usage,
  failures, and the final check outcome in Research activity.
- [x] Verify worker restart, cancellation, malformed selections, tampering,
  duplicate results, concurrency, and paid-fallback exclusion in local tests.
- [x] Verify quota recovery with a simulated provider deferral during adaptive selection. The
  restarted worker waits for the same job to become due, completes the pair
  without a paid fallback, and reaches independent sealed confirmation. This
  satisfies release acceptance; no live provider reset was observed.
- [x] Verify the native campaign checkpoint and accessible setup labels in a
  separately identified debug bundle using an isolated profile.
- [x] Verify the ready-made beginner campaign in the native app. It records
  both checked results and final review in a dedicated local table; it does
  not create provider jobs or consume real research trials.
- [x] Walk through the offline practice exercise in the native app using an
  isolated profile: first test, separate final check, and finish. Zero jobs
  were created.
- [ ] Finish native visual, security, and performance release checks on the
  final build before publishing.
- [x] Verify the published 0.5.0 app upgrades in place to the exact notarized
  0.5.1 verification archive, without changing production or the installed app.
- [x] Build an optimized app-only QA bundle and verify the campaign controls
  in a fresh macOS profile, without installing or publishing it.
- [x] Create and stop a campaign through the optimized native UI, including
  its explicit stop confirmation, without queuing provider work.
- [x] Complete one isolated live adaptive catalog pilot with Codex and
  Antigravity: first candidate rejected, second selected with agreed bounded
  settings, development audit passed, and separate sealed confirmation passed.
  Two synthetic trials counted; no authentic CODA evidence was opened.
- [x] Verify isolated live subscription handoffs: Codex and Antigravity each
  returned a public synthetic proposal on their first attempt with no paid
  fallback. A separate locally audited benchmark completed live Codex review.
  This does not verify live adaptive catalog selection through confirmation.

## Outside 0.5.1 release acceptance

- Maabarium runs vetted benchmarks. Turning provider-generated code into a
  runnable benchmark is not required for 0.5.1 and is not enabled.
- The frozen CODA comparison is a research outcome, not an app release gate.
  Testing equal teaching evidence, zero wrong answers, full coverage, and
  lower total work than the strongest matched exact learner belongs to the
  CODA campaign. Release verification does not establish that outcome.
- An actual provider quota reset may be observed during routine use. There is
  no requirement to induce one for release.

The local regression run passed 40 worker tests, seven ledger tests, 52
desktop Rust tests, and 106 frontend tests. The worker and Rust suites each
skipped one live-provider test. The production frontend build and Rust
advisory check passed. These are development checks, not release sign-off.

Native checkpoint smoke on source `a2acd3c`: built the app-only Tauri debug
bundle with identifier `com.maabarium.console.campaignqa` and updater artifacts
disabled. Loaded a seeded synthetic checkpoint through Research activity,
approved it, and verified the displayed and persisted campaign status changed
to Active with the audited count unchanged and zero jobs created. The native
accessibility tree exposed the trial limit, review interval, public brief,
and local benchmark budget. Closed the QA copy; the installed app remained
running. This does not replace full native visual or release verification.

The optimized QA bundle also passed native create/stop in a fresh isolated
profile: the campaign appeared as Active, required explicit confirmation to
stop, and appeared as Stopped. The saved queue contained zero jobs. The
production `npm run test:release-local` check did not build a signed artifact:
it exited before compilation because neither updater private-key setting
was configured. The optimized QA bundle is not a substitute for that gate.

The documented release command was subsequently rerun with the existing
updater key paths on source `31e298d`. It built the 0.5.1 app, updater archive,
signature, update manifest, and installer locally. Minisign independently
verified the archive signature. Archive SHA-256:
`b25261dadda1cb797365b122d5f7c44750924802a7ee15791b1f815337f85aae`.
The app itself was only linker-signed: strict Apple code-sign verification
failed because the bundle had no resource signature. Developer ID signing,
notarization, and in-app upgrade remain separate release checks.

A subsequent local build on source `4ae1f40` supplied the existing Developer
ID Application identity. The app, bundled CLI, and updater archive passed
independent strict code-sign and Minisign verification. The signed archive's
SHA-256 is `4390bd47d9fc6d58809a7cb278509996de0b7d731d3c2522cf65bd0fdb5429e1`.
The production check correctly exited nonzero: Tauri had no notarization
credentials configured, Gatekeeper rejected the unnotarized bundle, and
there was no stapled ticket. No artifact was installed or published.

## Current implementation

Upgrade QA used GitHub verification run `45331718204` on commit `aa1db38`.
The independently verified 0.5.1 updater archive SHA-256 was
`477a5b2b67d65a99a3fb7ff0cb83bae6e2f328d82ed8c2d889e8d0d84cd6ea9f`.
The published 0.5.0 app detected and installed that archive in a disposable
profile using a loopback HTTPS manifest. After relaunch the app reported
0.5.1 and that it was up to date. The installed executable matched the
verified artifact byte-for-byte; strict code signing and stapling validation
passed again after installation. No artifact was promoted.

Set **Pause for review every** when creating a campaign to hold after that
many audited trials. **Approve and resume campaign** releases the hold;
**Stop campaign** cancels queued work. A hold does not override a terminal
review, scientific success, or separate confirmation requirements.

Set **Local benchmark time budget** to limit cumulative runner and auditor
deadlines. For example, a 60-second per-program limit reserves 120 seconds
from the campaign. A reservation is not refunded after an interrupted
attempt. This does not cap provider tokens, charges, or elapsed queue time.
Use the matching updated worker with the desktop build.

For new public synthetic workloads, run
`python3 scripts/adaptive_app_smoke.py OUTPUT --fixture FIXTURE.json`.
Supply a JSON object with integer arrays `rows` and `queries`. Set
`"family": "membership"` to compare exact membership with a direct scan,
or leave it out to use subset existence. The tool
prepares separately pinned executables from fixed trusted templates; it does
not queue or run the benchmark, accept generated source, or produce CODA evidence.
Run the same tool with `OUTPUT --review` to reconstruct the exact expected
program bytes from the package fixture and check both pins without executing
either program. This is a template integrity review, not approval to run.
Save the printed `review_sha256` outside the package. Repeat review with
`--expected-review-sha256 DIGEST` to reject a replacement package, even if its
internal fixture and hashes agree. The `membership-campaign` family also
prints a synthetic contract pin. It can be staged through the campaign
worker and independently checks parity and the cheaper of two frozen exact
scans. This narrow synthetic comparator set is not the CODA comparator set
and cannot establish the CODA target.

For custom programs that have passed a separate trusted review, create an
approval JSON with `schema: 2`, `contract_sha256`, and `programs`. The
`programs` object must contain `runner` and `auditor`, each with an absolute
`path` and separately verified `sha256`. Save the approval file's SHA-256
outside the package. Run `OUTPUT --approved-programs APPROVAL.json
--approval-sha256 DIGEST` to copy only the exact reviewed bytes. Verify with
`OUTPUT --review --expected-review-sha256 DIGEST` using the distinct review
digest printed by preparation. This procedure verifies identities, not program
safety. It never accepts provider output as approval or runs code during review.

**Try a practice experiment** in Research activity runs a small built-in
comparison locally, without files, an account, or any campaign jobs. It guides
the user through the first result, a final check on different questions, and
explicit finish or stop. It teaches correctness and work accounting; it is not
CODA evidence.

**Open a ready-made campaign** saves a separate starter's progress and both
checked results on this computer. A student can close and reopen the app,
run the final check when ready, and finish or stop without setting up a worker.

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
verdicts. The desktop Research activity report separates passed trials,
audited rejections, and trials that could not be checked. Its suggestion
usage disclosure shows reported input, output, and cache reads per provider
for that campaign, excluding unrelated jobs. Trial results appear in recording
order, and a separate final check shows its saved verdict or that no verdict
was recorded before review.

The benchmark and auditor must be trusted local executables. Code suggestions
are not automatically executed. `campaign-propose --campaign <campaign> --id
<round> --public-target <brief>` queues advisory jobs for the campaign's selected providers
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
**Send public brief to selected providers** in Research activity. Repeating
the request does not create a duplicate round or consume a trial.
When creating an adaptive campaign in the app, **Suggestion providers and
model settings** assigns two distinct providers to the proposer and independent
checker roles. Both must agree before a vetted catalog candidate runs. Codex,
Claude, Antigravity, Muse, and DeepSeek are supported. Model and effort choices
apply to every round; blanks use provider defaults. An Antigravity Orchestrator
model controls its own effort. DeepSeek requires explicit campaign consent and
a paid-enabled worker. It is never a fallback.
The DeepSeek lane uses the text Chat Completions API with `deepseek-flash`
or `deepseek-v4-pro`. Reasoning can be off, low, high, or maximum; Maabarium
leaves it off when no effort is selected. This lane does not use the Responses
API or send images.
For an unattended search over a vetted catalog, add
`--stage --select-by-proposal` when submitting each approved benchmark
before starting discovery. Use public-safe trial IDs: providers receive
the IDs and approved brief, never executable paths or benchmark output.
For configurable local templates, add `--parameter-bounds '{"width":[1,8]}'`
to a catalog entry. Providers must agree on both ID and bounded integer
values. The trusted runner and auditor receive `parameters.json` in their
working directory; the selected values also carry forward to confirmation.
This generates a configuration, not executable source.
In the desktop catalog form, use **Settings providers may choose** to add
each setting's name, minimum, and maximum. No JSON is needed in the app.
For a parameterized trial, the trusted auditor must return
`parameters_sha256` for the exact `parameters.json` it verified. Missing
or changed parameters fail closed rather than counting as a trial.
The worker dispatches a catalog trial only when both configured providers
return the same available ID. Disagreement, invalid IDs, or failed proposals
stop at review. After an audited failure it requests another selection from
the remaining catalog. If no approved benchmarks remain, it stops for
human review without asking providers for another selection. The trial
limit is a maximum, not a requirement to run that many benchmarks.
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
To stage a catalog entry from the desktop, choose **Let the campaign providers
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
