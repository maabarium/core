# Security Policy

## Scope

maabarium is a local-first Rust workspace that executes autonomous proposal/evaluation loops, manages provider credentials through the OS keychain, and runs sandboxed subprocess-based evaluation paths. Security-sensitive areas include:

- evaluator sandboxing and subprocess execution
- git-backed proposal application
- provider credential handling
- persistence and export of experiment data
- any future extension or plugin surface

## Reporting a Vulnerability

Do not disclose security issues publicly before maintainers have had a chance to assess them.

If the repository host provides a private vulnerability reporting mechanism, use that first. If no dedicated private reporting channel is available yet, contact the maintainer privately before opening a public issue.

When reporting an issue, include:

- affected component or file paths
- a clear description of impact
- reproduction steps or a proof of concept when safe to share
- whether secrets, arbitrary code execution, sandbox escape, or data corruption are involved
- any suggested mitigations or constraints you already identified

## What to Report

Please report issues involving:

- sandbox escapes or unsafe evaluator execution
- arbitrary filesystem writes outside intended boundaries
- secret exposure through logs, persistence, or CLI behavior
- command execution or injection vulnerabilities
- unsafe plugin-loading or extension behavior, if introduced
- supply-chain or dependency issues with practical security impact
- denial-of-service conditions that can break long-running engine sessions

## Disclosure Expectations

- Prefer coordinated disclosure.
- Avoid public proof-of-concept releases before a fix or mitigation is available.
- If a report is not reproducible, maintainers may ask for a smaller test case.

## Supported Security Posture

This repository currently follows a best-effort security posture for the latest code on the default branch.

Areas with active security relevance already present in the implementation include:

- keychain-backed secret storage via OS facilities
- path sanitization and copied sandbox roots for evaluator execution
- Wasmtime-backed sandbox policy validation
- subprocess-based code evaluation rather than direct in-process execution of untrusted code
- typed persistence queries using parameterized SQLite statements

Some roadmap items are intentionally deferred and should not be assumed to exist yet, including a stable runtime plugin ABI and a finalized desktop signing/notarization story.

## Hardening Guidance for Contributors

When changing security-sensitive code:

- add tests for failure paths, not only success paths
- preserve or improve tracing without logging secrets
- document any new runtime assumptions
- update `docs/ARCHITECTURE.md` if the security posture changes materially
