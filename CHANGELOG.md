# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Generated `install.sh` publication for macOS desktop releases. The installer downloads the signed app archive referenced by the published `latest.json` updater manifest and installs it into `/Applications`.

### Changed

- `release-prep` now validates `CHANGELOG.md` before creating a release and uses the `Unreleased` section as the GitHub Release notes.

### Breaking Changes

- None.

## [0.1.0] - 2026-03-24

### Initial Release

- Initial Maabarium desktop, CLI, core engine, blueprint runtime, and release automation foundation.
