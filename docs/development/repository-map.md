# Repository Map

This repository is a mixed workspace. The root app is private, while selected subpackages are intended for public distribution.

## Primary Surfaces

- `src/`
  - Electron desktop source.
  - `src/main/` owns backend services, IPC, providers, companion server, and windowless runtime.
  - `src/renderer/` owns the desktop UI.
- `mobile/`
  - Private Expo Android companion app.
  - Generated native folders stay ignored for now.
- `packages/wellbot/`
  - Public npm CLI/bootstrap package.
  - Keep tarball contents minimal and independent from desktop runtime state.
- `packages/www-gate/`
  - Public Node/SQLite site and registry surface.

## Bundled Defaults vs Runtime State

- `agentin/` contains bundled defaults plus file-backed runtime directories.
- Defaults that define shipped behavior stay tracked.
- Personal memory, workspaces, task runs, runtime caches, and generated state stay ignored.

## Tests and Tooling

- `tests/` holds contract, quick, core, live, and external suites.
- `tools/` holds focused development utilities and smoke helpers.

## Documentation Layout

- Root docs are limited to public entry documents.
- `docs/development/` holds maintainer and contributor references.
- `docs/release/` holds packaging and release workflow docs.
- `docs/archive/` holds historical plans, release snapshots, and internal working history that should remain versioned but not sit at the repo root.
