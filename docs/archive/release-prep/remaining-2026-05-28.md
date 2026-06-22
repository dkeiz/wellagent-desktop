# Release Prep - Remaining Work

Target release: `0.1.0-beta.1`.

## Code Work

No planned release-prep code task remains open from the approved plan.

Completed items include:

- Mobile metadata bump.
- README beta/security/npm wording.
- Wellbot package metadata and README updates.
- Runtime artifact ignore rules and contract guard.
- Timestamped sub-agent verifier artifact cleanup.
- Curated desktop `agentin` packaging filter.
- Companion Browser pairing contract update.
- Remote Gateway secret credential migration.
- Direct small fixes from the release plan.
- Pixel Avatar renderer split and allowlist removal.
- Architectural debt documentation.

## Verification

- [x] `node tests/run-suite.js contracts`
- [x] `node tests/run-suite.js quick`
- [x] `node tests/run-suite.js core`
- [x] `npm run pack:wellbot`
- [x] Confirmed the dry-run tarball contains only `LICENSE`, `README.md`, `bin/wellbot.js`, and `package.json`.

The sandbox returned `spawn EPERM` for `quick`; the same bounded suite was
rerun outside the sandbox and passed. `core` was also run outside the sandbox
because it includes the same child-process command tests.

## Deferred Follow-Up

Larger non-release work is tracked in `docs/architectural-debt.md`.
