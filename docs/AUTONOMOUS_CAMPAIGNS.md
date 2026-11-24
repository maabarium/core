# Autonomous research campaigns (0.5.2)

Approve one policy, then let the Maabarium worker select, prepare, run, and
independently check experiments. An experiment that misses the goal frees
the worker to choose an untried variant. A development pass starts its
separately pinned final check. Only a final pass reaches **Target achieved**.
The desktop Research activity page shows progress and the reason for a block.

## Set up once

1. Install the companion worker from the same source revision as the app.
   Configure the [Maabarium polling service](SUBSCRIPTION_LANE.md) with
   Codex and Antigravity. The service advances the loop without the console
   open or a separate Codex automation. On other hosts, invoke the worker's
   `tick` command periodically through the host's service manager.
2. Review and pin the experiment programs and a public-safe policy file.
   Save the policy's SHA-256 independently of the file. The policy may
   contain private local paths; only the public brief, public variant IDs
   and public summaries go to providers.
3. Start the campaign and use the same worker state directory as the desktop.

```sh
python3 scripts/subscription_lane.py campaign-autostart \
  --id study-01 --policy ./approved-policy.json --policy-sha256 "$APPROVED_SHA256"
python3 scripts/subscription_lane.py campaign-status --id study-01
```

Without a service, a single `tick` processes at most one job. Repeated
invocations use the on-disk ledger. `campaign-stop` prevents further
dispatch and keeps evidence already written.

## Policy schema 1

The top-level JSON object has exactly these fields:

| Field | Meaning |
| --- | --- |
| `schema` | Integer `1`. |
| `brief` | Public research question, up to 2,048 UTF-8 bytes. |
| `rounds`, `trials` | Independent discovery-round and audited-trial limits, each 1–200. |
| `lifetime_seconds` | Admission window, 1 second–7 days. The worker stops dispatch at expiry. Individual attempts also have timeouts. |
| `work_seconds` | Cumulative reserved runner and auditor deadlines, 4–120,600 seconds. |
| `templates` | Map of 1–16 approved research adapters. |
| `variants` | Map of 1–64 public IDs to a `template` ID, exact integer `parameters`, and a public `summary` of up to 96 bytes. |

Each template has exactly `timeout` (1–300 seconds per program), `bounds`
(parameter name to inclusive integer `[min,max]`, at most eight),
`metrics` (metric name to `["eq"|"le"|"ge", integer]`, 1–16 rules),
`development`, `confirmation`, and `panel_sha256`. The last field identifies
the sealed confirmation panel. All templates in a campaign share exactly
the same metric rules. Each stage contains absolute `runner` and
`auditor` paths and their `runner_sha256` and `auditor_sha256`. All four
executable identities must be distinct. A model can choose a public ID or
`NONE`; it cannot add or change variants, metrics, executables or identities.

## Adapter contract

The trusted runner receives `spec.json` and `parameters.json` in its private
working directory. Its bounded stdout is the evidence. The trusted auditor
reads those files and the evidence on stdin, independently checks the
domain rules, and prints a JSON object with exactly:

- `complete: true`, `contract_sha256` from the frozen spec,
  `evidence_sha256` of its stdin, and `parameters_sha256` of the parameter file;
- `metrics`, a map of bounded integers whose keys match the approved rules;
- on confirmation only, `panel_sha256` and `development_evidence_sha256`.

The confirmation runner also gets the hash-verified `development.json`.
Verify real panel separation and task-specific invariants in the adapter;
distinct executable hashes alone do not prove independent evidence.
For example, a learner auditor can independently compute wrong answers and
operation counts; a citation auditor can independently count unsupported
claims. The same orchestrator applies the metrics without knowing either
domain. Use fixed-scale integers if the domain requires decimals.

Local programs are operator-trusted and hash-pinned, not a sandbox for
untrusted code. Provider prose is never executed or accepted as a verdict.
Both subscription providers must agree on the same available public ID.
If no approved option fits the remaining budget, or agreement never
arrives before the round or time cap, the campaign reports **Blocked**.
An interrupted local attempt, corrupt audit, or failed final confirmation
stops for review without an automatic rerun. A new executable, data grant,
or expanded policy needs a new approved campaign. Manual 0.5.1 campaigns
and their audit contracts remain supported.
