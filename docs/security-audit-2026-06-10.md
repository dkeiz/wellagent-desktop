# Security Audit 2026-06-10

## Scope

Reviewed in this pass:

- `packages/www-gate`
- `src/main/companion/*`
- `src/main/companion/remote-gateway/*`
- CLI/web execution-adjacent boundaries: `src/main/mcp/register-terminal-tools.js`, `src/main/a2a-target-executor.js`, `src/main/custom-tool-sandbox*.js`
- Additional execution and code-loading boundaries: `src/main/a2a-manager.js`, `src/main/execution-directory.js`, `src/main/plugin-module-loader.js`, `src/main/plugin-discovery-service.js`, `src/main/connector-runtime.js`

No direct unauthenticated shell or file-execution path was found in the reviewed HTTP surfaces. The main issues were token lifecycle, secret transport, browser hardening, and brute-force resistance.

## Fixed In This Pass

- Remote Gateway host authentication no longer accepts the shared secret in the query string. It now relies on `Authorization: Bearer ...` only.
- Companion WebSocket tickets are now single-use. Replaying a previously accepted ticket no longer opens another socket.
- Companion direct `/companion/pair` and `/companion/auth` routes now have lightweight in-process throttling.
- Remote Gateway now throttles `/gateway/host`, `/companion/pair`, and `/companion/auth` attempts per source address.
- `www-gate` user and admin sessions now expire server-side using signed `issuedAt` timestamps instead of trusting browser cookie lifetime alone.
- `www-gate` cookies now support `Secure` automatically when `WWW_PUBLIC_BASE_URL` is HTTPS, or explicitly through `WWW_SECURE_COOKIES`.
- `www-gate` now sends baseline browser hardening headers: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: same-origin`.
- `www-gate` theme bootstrapping moved from inline scripts into `/assets/theme.js`, so the portal CSP no longer needs `'unsafe-inline'` for scripts or styles.
- `www-gate` now handles malformed cookie and asset-path encoding more safely instead of trusting `decodeURIComponent` blindly.
- `www-gate` dynamic external links are now restricted to safe `http(s)` URLs or local paths before rendering/redirecting.
- `www-gate` login, signup, and admin-auth endpoints now have lightweight in-process throttling.
- A2A task IDs, context IDs, and target IDs are now validated as opaque identifiers before any task, event, or target-manifest path is built.
- Execution-root path checks now resolve through real filesystem boundaries, blocking symlink/junction escapes for both existing paths and new child writes.
- Plugin module loading now verifies the real entrypoint path stays inside the plugin directory, blocking linked-subtree escapes.
- Plugin discovery now verifies the real plugin directory stays inside the configured plugin root before reading its manifest.
- Connector worker startup now verifies the real connector script path stays inside the configured connector root.

## Architectural Items / Owner Decision

- `src/main/custom-tool-sandbox.js` and `src/main/custom-tool-sandbox-runner.js` use Node `vm` in a helper process. That is a useful containment layer, but it is not a hardened security boundary for hostile third-party JavaScript. If untrusted custom tools are a real product goal, this needs an OS/container sandbox decision.
- `src/main/mcp/register-terminal-tools.js`, `src/main/a2a-target-executor.js`, plugin loading, and connector startup intentionally execute local commands or JavaScript once the permission model or install path allows it. That is acceptable only if prompts, manifests, plugin packages, and approvals are treated as trusted execution inputs. Tightening this further would require an allowlist, code signing, or a reduced capability model.
- Third-party plugins and connectors are still treated as trusted local code after installation. If a public marketplace or one-click installs from unknown authors are part of the product direction, you need an owner decision on publisher trust, signing, and install-time consent UX.
- The new throttling is process-local memory only. For any public deployment, keep proxy/WAF rate limits in front of:
  - `/admin/auth`
  - `/login`
  - `/signup`
  - `/companion/pair`
  - `/companion/auth`
  - `/gateway/host`

## Verification

Validated in this pass with targeted checks:

- `companion-token-lifecycle-contract`
- `remote-gateway-contract`
- `file-tool-execution-policy-contract`
- `execution-folder-contract`
- `plugin-module-loader-contract`
- `plugin-discovery-service-contract`
- `connector-secret-config-contract`
- `connector-tool-execution-policy-contract`
- direct runtime check for companion unauthenticated throttling
- direct runtime check for `www-gate` secure-cookie, session-expiry, and response-header behavior
- direct runtime check for `www-gate` CSP/theme asset behavior
- direct runtime check for invalid A2A task/target IDs and no traversal writes outside the task/event roots

## Broader Validation Notes

- Local broad validation was run with `tests/run-suite.js core` plus the headless `skin` suite and the mocked command checks.
- `skin` passed.
- Mocked command checks passed:
  - `tools/test-ipc-registration.js`
  - `tools/test-plugin-knowledge-managers.js`
  - `tools/test-dispatcher-mocked.js`
  - `tools/test-tool-routing-lifecycle.js`
  - `tools/test-testclient-mode.js`
  - `tools/test-ipc-flow-mocked.js`
- `core` advanced through the security-relevant modules reviewed here, but the aggregate suite still stops later on a pre-existing line-budget contract unrelated to the security work. Current blocker files include:
  - `src/renderer/styles/theme.css`
  - `src/renderer/styles/layout/layout-sidebar.css`
  - `src/renderer/components/main-panel.js`
  - `src/renderer/components/content-viewer.js`
  - `src/renderer/app.js`
- The Electron-backed `www-gate` contract could not be rerun in this environment after the sandbox denied additional elevated `spawn` usage. Earlier direct runtime and source-level `www-gate` checks still passed.
