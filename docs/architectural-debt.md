# Architectural Debt

This file tracks work that is too large or cross-cutting for the
`0.1.0-beta.1` release-prep gate. Items here should be planned separately and
not hidden inside release metadata cleanup.

## Security Hardening

### Electron Sandbox

Current state:

- Main windows use `nodeIntegration: false`.
- Main windows use `contextIsolation: true`.
- `sandbox: false` remains.

Follow-up:

- Audit renderer assumptions that still require a non-sandboxed renderer.
- Move remaining filesystem, process, and integration access behind preload IPC.
- Add a contract that fails if future windows weaken `nodeIntegration` or
  `contextIsolation`.
- Enable `sandbox: true` once preload coverage is complete.

### Remote Gateway

Completed for release:

- Shared secret persistence moved from plaintext settings to credential storage.
- Migration covers `remoteGateway.secret` and generic
  `setting.remoteGateway.secret` credentials.

Follow-up:

- Redact secrets from every renderer-facing status path.
- Add a clear revoke/regenerate flow for active companion sessions.
- Add expiry and rotation tests for externally reachable sessions.
- Review logs for accidental secret exposure.

### Mobile Companion Transport

Current state:

- Android allows cleartext traffic for local companion use.
- App-level URL validation limits non-TLS hosts to private/local networks.

Follow-up:

- Prefer HTTPS setup for release builds.
- Replace broad cleartext allowance with a targeted Android network security
  config if feasible.
- Document the threat model in release notes and companion docs.

## Core Runtime Risks

### Tool Pattern Duplication

There are multiple `stripToolPatterns` implementations with different edge-case
behavior. Consolidate into one tested helper and remove local copies.

### Inference Dispatcher Race

`_lockMode` and `_lockPreemptible` are process-level mutable state. Concurrent
requests can observe stale or crossed lock state. Replace with per-request lock
tokens or an explicit lock object that carries mode, owner, and cancellation
state.

### Tool And Session Dispatch Duplication

Triple session-type dispatch appears repeatedly across chat, agent, and subtask
paths. Extract a shared dispatcher only after tests pin current behavior.

### LM Studio URL Parsing

LM Studio URL parsing is duplicated in multiple places. Centralize parsing and
normalization so settings, smoke tests, and provider adapters do not drift.

### Subtask Runtime Duplication

Subtask runtime logic has large duplicated blocks. Split only along tested
contract boundaries: state persistence, run execution, event emission, and
tool-result normalization.

## Frontend And Plugin Hotspots

### Emotion Protocol Duplication

Emotion parsing and marker handling appear across renderer/plugin code. Keep
the protocol definitions in one module and make UI/plugin consumers import the
same source of truth.

### Large Files Near Budget

Track and split files approaching the 1000-line limit before they require
allowlisting. Current hotspots include main panel components, skin manager,
workflow editor, companion web styles, IPC registration modules, sidebar, and
database/runtime modules.

### Pixel Avatar

The release split removed the immediate line-budget violation. Future avatar
work should keep character renderers isolated and move shared animation or
particle behavior into small modules instead of expanding `avatar.js` again.

## Test Gaps

Add focused coverage for:

- destructive cleanup paths such as agent deletion and workspace pruning;
- release packaging filters and packaged default seeding;
- Remote Gateway migration, rotation, and redaction;
- companion token lifetime and revocation;
- mobile companion URL validation and cleartext restrictions;
- inference dispatcher concurrency and cancellation;
- tool pattern stripping edge cases;
- large-file budget enforcement for newly added files;
- plugin lifecycle rollback and generated output cleanup;
- database migration idempotency.
