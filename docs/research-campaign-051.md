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

The standalone transactional ledger has focused tests for success, trial bound,
idempotency, conflicting replay, restart, and operational-failure review. It is
not yet connected to the trusted benchmark auditor, provider loop, or desktop UI.
Its `record` function is an internal boundary, not an authenticated audit API.
The existing subscription worker tests are a separate regression suite, not
evidence that the campaign lifecycle above works.

Do not publish 0.5.1 or start the real 200-trial CODA campaign until these
acceptance requirements are implemented and verified.
