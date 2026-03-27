# Build Profiles

## Purpose

Maabarium keeps portable release builds separate from host-specific local tuning.

Use the portable profile for builds that may run on other machines with the same Rust target triple. Use native CPU tuning only for local benchmarking or personal binaries built for the current machine.

## Portable Optimised Build

The workspace defines a `release-lto` profile for optimised local builds with whole-program optimisation:

```bash
cargo build --profile release-lto
```

Current settings:

- `inherits = "release"`
- `codegen-units = 1`
- `lto = "fat"`

This keeps the binary portable while reducing overhead from fragmented code generation.

## Opt-In Native CPU Tuning

For Apple Silicon benchmarking or any other fixed local machine, add native CPU tuning explicitly:

```bash
RUSTFLAGS="-C target-cpu=native" cargo build --profile release-lto
```

This allows LLVM to emit instructions for the exact build host CPU.

Do not use this mode for distributed artefacts, CI outputs, or release bundles intended for other systems. A native-tuned build can silently depend on CPU features that are not available on another machine of the same operating-system target.

## Validation

Suggested commands:

```bash
cargo build --profile release-lto
RUSTFLAGS="-C target-cpu=native" cargo build --profile release-lto
cargo test --manifest-path Cargo.toml -p maabarium-core
```
