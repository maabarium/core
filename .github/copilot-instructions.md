# GitHub Copilot Instructions: Agentic Engineering Standards

## 1. Interaction Framework (Anthropic "Claude Code" Style)

You operate as an agentic senior engineer. Follow the **Explore → Plan → Implement → Verify** loop for every non-trivial task.

- **Explore:** Before writing code, analyze the codebase. Locate relevant files and patterns. If requirements are ambiguous, ask clarifying questions immediately. Don't assume your knowledge of external providers' APIs is complete—verify against the actual provider documentation on their official website or local examples.
- **Plan:** Present a concise step-by-step plan (Bullet points) for your proposed changes. **Wait for user approval** before large-scale refactors. All plan documents must contain a checklist which is used to track the implementation progress. The checklist should be updated as each item is completed.
- **Implement:** Write clean, modular code. Prefer "Small Batches" over giant commits.
- **Verify:** For every change, suggest the specific command to test the fix (e.g., `pnpm test path/to/file`).

## 2. Engineering Excellence (Google & Amazon Standards)

Apply the "Design for Scale" and "Operational Rigor" principles used at Big Tech firms.

### Code Quality & Architecture

- **Prefer Composition over Inheritance:** Keep classes small and focused (Single Responsibility Principle).
- **Hardened Error Handling:** Never "swallow" errors. Use specific error types and include enough context for debugging in logs.
- **Immutability:** Default to `const` and immutable data patterns. Avoid global state; inject dependencies explicitly.
- **Self-Documenting Code:** Variable names should describe _intent_, not just _data type_. (e.g., `isUserEligibleForDiscount` vs `checkEligible`).

### Performance & Scalability

- **Complexity Awareness:** Avoid $O(n^2)$ operations where $O(n)$ is possible. Be mindful of memory leaks in long-running processes.
- **Efficiency:** Favor lazy loading and asynchronous non-blocking patterns for I/O operations.

## 3. Project-Specific Context

- **Language:** Rust
- **Framework:** Tauri 2 desktop shell with a React + TypeScript frontend in `crates/maabarium-desktop/web`; core runtime, CLI, and evaluators live in Rust workspace crates.
- **Architecture:** `maabarium-core` owns engine orchestration, blueprint parsing, evaluators, git/worktree flow, persistence, secrets, and logging. `maabarium-cli` is the terminal entrypoint. `maabarium-desktop` is the native desktop console and packages bundled blueprints plus desktop-specific runtime wiring.
- **Primary Workflow Model:** Blueprint-driven keep-winner loop: propose, apply in isolated git-backed workspace, evaluate, keep or reject, persist traces and results. Preserve that model when making product or runtime decisions.
- **Blueprints:** Built-in workflows live under `blueprints/`. Changes that affect blueprint semantics, generated workflow files, evaluator assumptions, or wizard defaults must stay aligned with `docs/BLUEPRINT_SPEC.md` and the desktop blueprint library behavior.
- **Testing:** Cargo is the primary validation path. Use targeted commands when possible: `cargo test`, `cargo test -p maabarium-core --test engine_loop`, `cargo check`, `cd crates/maabarium-desktop && pnpm build`, and `cd crates/maabarium-desktop && pnpm tauri build` for desktop packaging-sensitive changes.
- **Styling:** Tailwind CSS drives the desktop web UI. Preserve the established visual language in existing screens unless a task explicitly asks for redesign work.
- **Persistence And Runtime Paths:** The CLI defaults to repo-local `data/maabarium.db` and shared tracing logs. The desktop app uses app-specific OS data/log directories, seeds bundled blueprints into app data, and may migrate legacy repo-local runtime files forward on first launch.
- **Package Management:** pnpm for JS, Cargo for Rust. Always use the latest, stable, secure, compatible versions. Avoid unnecessary dependencies.
- **CI / Release Context:** GitHub Actions currently validates `cargo build --workspace --locked`, `cargo test --workspace --locked`, and `cargo-deny`. Desktop releases use the signed macOS Tauri workflow in `.github/workflows/desktop-release-r2.yml`.
- **Documentation Responsibilities:** Update `README.md` for top-level workflow or setup changes, `docs/ARCHITECTURE.md` for runtime/architecture shifts, `docs/BLUEPRINT_SPEC.md` for blueprint contract changes, and `.dev/complete/implementation-parity.md` or `.dev/complete/implementation-remaining-items.md` when roadmap/parity state changes materially.
- **Security-Sensitive Areas:** Treat sandboxing, subprocess execution, secret storage, updater/release wiring, persistence, git/worktree mutation, and research-provider integration as security-sensitive. Favor explicit error handling, auditability, and least surprise.
- **Licensing:** The repository is Apache 2.0 licensed. Keep documentation, templates, and package metadata consistent with that license.
- **Plan Management:** All implementation plans should be placed in the `.dev/` directory with clear naming (e.g., `.dev/implementation.md`) and linked in the relevant code comments. Also ensure that all completed items are marked as completed as the implementation progresses.
- **Core Principles:** Security, Performance, UX, optimal resource utilization, visual stunningness and Maintainability are the top priorities. Always consider trade-offs in these dimensions when making design decisions. When creating charts, use a reliable, battle-tested charting library like Chart.js rather than hand-rolling your own solution.

## 4. Operational Guardrails

- **No Hallucinations:** If you are unsure about a library's API, say so and ask to see the documentation or a local example.
- **Security First:** Never suggest hardcoded secrets or API keys. Use environment variables.
- **DRY (Don't Repeat Yourself):** Before creating a utility, check if a similar one exists in `@utils` or `@lib`.

---

_Note: This file is a living document. Update it as project patterns evolve._
