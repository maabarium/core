## Summary

Describe the user-visible or architecture-visible change in 2-5 bullets.

-

## Why This Change

Explain the problem, regression, gap, or product need this PR addresses.

## Scope

Call out the main areas touched.

- [ ] `maabarium-core`
- [ ] `maabarium-cli`
- [ ] `maabarium-desktop`
- [ ] `blueprints/`
- [ ] `docs/`
- [ ] CI / release / packaging

## Validation

List the exact commands you ran and summarize the result.

```bash
# example
cargo test
cd crates/maabarium-desktop && pnpm build
```

## Documentation

- [ ] No documentation update was needed.
- [ ] Updated `README.md`.
- [ ] Updated `docs/ARCHITECTURE.md`.
- [ ] Updated `docs/BLUEPRINT_SPEC.md`.
- [ ] Updated contributor or customization guidance.

## Risk Review

Note anything reviewers should watch closely.

- Runtime / behavioral risk:
- Security or secret-handling impact:
- Persistence / migration impact:
- Packaging / updater impact:

## UI Evidence

If desktop UI behavior changed, include screenshots or a short recording and note the affected flows.

## Checklist

- [ ] The change is focused and does not mix unrelated refactors.
- [ ] Tests or validation were added or updated when behavior changed.
- [ ] Logging, tracing, and error reporting remain useful on touched paths.
- [ ] New dependencies were avoided or justified.
- [ ] Follow-up work is called out explicitly instead of hidden in behavior-critical TODOs.
