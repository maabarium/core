# Maabarium Roadmap

This roadmap is a directional product document, not a hard delivery promise. It exists to help contributors and users understand where Maabarium can become materially more useful over time.

The product bar behind every roadmap item is the same:

- make autonomous improvement loops more trustworthy
- reduce setup and operational friction
- improve result quality and reproducibility
- make the desktop experience feel faster, clearer, and more decision-oriented

## Product Direction

Maabarium is at its best when it helps a user move from intent to validated improvement with less manual coordination.

That means the roadmap prioritizes:

1. better run quality and evidence quality
2. better operator control and visibility
3. better setup, onboarding, and runtime ergonomics
4. better reuse of successful workflows, prompts, and evaluation strategies
5. better trust, reproducibility, and collaboration around results

## Near-Term Opportunities

### 1. Guided Setup That Reaches Ready State Faster

Potential improvements:

- one-click readiness fixes for missing local runtime dependencies
- provider setup flows with clearer validation, test requests, and error diagnosis
- richer workspace onboarding that detects repo health, test commands, and likely target files automatically
- saved environment profiles for different use cases such as local-only, mixed runtime, and research-heavy workflows

Why it matters:

Users should spend less time configuring Maabarium and more time running improvement loops that actually produce value.

### 2. Stronger Run Control And Operator Confidence

Potential improvements:

- pause, resume, and step-through controls for active runs
- per-iteration approval gates for high-risk workflows
- clearer stop reasons, retry paths, and resumable failure recovery
- run policies that cap cost, duration, workspace churn, or model usage before a loop begins

Why it matters:

Autonomous systems feel dramatically safer and more usable when operators can intervene deliberately instead of only start or stop.

### 3. Better Research Quality And Source Trust

Potential improvements:

- stronger source-ranking heuristics with freshness, diversity, and credibility signals
- citation health checks that flag broken links, duplicated sourcing, or weak evidence clusters
- side-by-side comparison views for multiple research passes on the same topic
- export packages that preserve sources, traces, provider context, and confidence notes in a cleaner artefact

Why it matters:

For research workflows, quality is not just about volume of sources. It is about grounded synthesis, transparent uncertainty, and evidence users can trust.

### 4. Desktop UX That Helps Users Decide Faster

Potential improvements:

- richer run timeline views that make proposal, evaluation, and keep-or-reject decisions more legible
- comparison dashboards across workflows, runs, and blueprint versions
- better diff ergonomics for large proposals, including grouped file changes and semantic summaries
- saved workspace layouts and role-based views such as operator, researcher, or builder modes

Why it matters:

The desktop app should become a decision cockpit, not just a passive status surface.

## Mid-Term Opportunities

### Guided Workflow Authoring

Potential improvements:

- redesign the blueprint wizard around user intent first, starting from questions such as "What are you trying to produce?" and "Should this modify code, write one document, or generate a sourced brief?"
- derive safer defaults for `language`, `target_files`, evaluator choice, and test requirements from those answers instead of forcing users to understand the raw blueprint contract up front
- add a review step that summarizes the inferred workflow type, output type, and target paths before Maabarium writes the TOML file
- make exact file targets versus multi-file globs explicit in the UI so document workflows do not get configured like application workflows by accident

Why it matters:

Blueprint authoring should feel like selecting an operating mode, not hand-assembling an internal config contract. Better guided authoring should reduce invalid workflows and shorten time-to-first-useful-run.

### 5. Reusable Workflow Intelligence

Potential improvements:

- blueprint recommendations based on repo shape, language, and prior successful runs
- reusable evaluator presets for common domains such as code quality, product work, and grounded research
- prompt and model strategy libraries that capture what worked well in previous experiments
- reusable workspace policies for testing, sandboxing, and branching behaviour

Why it matters:

Users should not need to rediscover the same winning setup every time they start a new project.

### 6. Deeper Evaluation And Quality Signals

Potential improvements:

- richer multi-dimensional evaluation summaries that expose trade-offs, not just totals
- benchmark suites for comparing model/provider strategies over time
- domain-specific scorecards for research quality, code risk, UX quality, and shipping readiness
- experiment-level quality regression alerts when a loop starts drifting or over-optimizing a narrow metric

Why it matters:

The more autonomous the loop becomes, the more important it is that Maabarium can explain why one result is actually better.

### 7. Collaboration, Review, And Sharing

Potential improvements:

- shareable experiment bundles with diffs, metrics, traces, and final verdicts
- review-oriented exports that compress a long run into a human-readable decision brief
- team-ready annotations on runs, proposals, and blueprint revisions
- better pull request handoff from desktop experiments into repository workflows

Why it matters:

The system becomes more valuable when the output is easy to review, discuss, and promote beyond a single operator.

## Longer-Term Opportunities

### LLM-Assisted Workflow Intent Capture

Potential improvements:

- let users describe the workflow they want in natural language, then have an LLM draft structured wizard answers instead of raw TOML
- keep the LLM in an assistant role, with deterministic product rules still deciding final field mappings and validation
- require a mandatory review screen that shows inferred workflow type, target paths, evaluator path, and model choices before creation
- preserve traceability by showing which parts of the blueprint were inferred automatically and which were edited by the user

Why it matters:

Natural-language setup can remove a lot of friction, but only if Maabarium keeps the result reviewable and safe. The right product shape is assisted authoring with strong confirmation, not opaque config generation.

### 8. Adaptive Automation And Smarter Runtime Routing

Potential improvements:

- runtime strategy selection that adapts automatically to task type, hardware state, and prior performance
- model routing that learns when to use cheaper local models vs. stronger remote models
- experiment pacing that changes based on confidence, evaluator signal quality, and current score trend
- policy-driven autonomy levels ranging from human-in-the-loop to lights-out batch optimisation

Why it matters:

Users should get better results and lower cost without constantly hand-tuning every run.

### 9. Trust, Safety, And Governance Features

Potential improvements:

- stronger audit trails for workspace mutations, secrets usage, and outbound provider activity
- policy packs for repo safety, network rules, and sandbox restrictions by workflow type
- compliance-oriented logging and export modes for teams that need reviewable evidence of system behaviour
- more explicit provenance tracking for which model, provider, and evaluator logic influenced each result

Why it matters:

Trust is a product feature. Better governance and provenance make autonomous workflows easier to adopt in real environments.

### 10. Ecosystem And Extension Surface

Potential improvements:

- stable extension points for evaluators, providers, and workflow templates
- community blueprint library publishing and discovery
- first-class import/export for template packs and organizational workflow standards
- desktop surfaces for installing, validating, and upgrading trusted extensions safely

Why it matters:

Maabarium gets stronger if users can extend it without forking the core product or compromising safety.

## What Success Looks Like

The roadmap is working if Maabarium increasingly helps users:

- get to a ready state with less manual setup
- run higher-confidence loops with less supervision overhead
- understand why a result was promoted or rejected
- reuse successful patterns instead of starting from zero
- move from raw experimentation to production-quality outputs faster

## Contributing To The Roadmap

If you want to build toward any of these areas:

- align proposals with the current architecture in [ARCHITECTURE.md](ARCHITECTURE.md)
- keep blueprint-related changes aligned with [BLUEPRINT_SPEC.md](BLUEPRINT_SPEC.md)
- use [CONTRIBUTING.md](../CONTRIBUTING.md) for repository contribution expectations
