# Combined Issues Review

Generated: 2026-05-07

This file replaces the earlier collapsed assessment with a code-grounded review.

Method:
- Read `code.issues`, `integrity.issues`, and `ui.issues`.
- Verified claims against `src/main/`, `src/renderer/`, `.gitignore`, `git ls-files`, selected tracked runtime files, and the current test suite.
- Did not assume runtime behavior unless the code or the repo state supported it.
- Did not run the full app or the full test suite in this pass.

## Executive Summary

Highest-confidence issues worth planning first:
1. `BUG-01` — tool-call stripping is duplicated and one implementation is clearly wrong.
2. `BUG-07` — custom tool edits do not persist `code` or `input_schema`.
3. `BUG-03` — `getConversations(limit, sessionId)` ignores `limit`.
4. `UI-018` and `UI-037` — renderer HTML interpolation is unescaped in privileged renderer code.
5. `UI-005` and `UI-021` — tab switching serializes and rehydrates message DOM through `innerHTML`.
6. `UI-009` — stored context usage is tracked globally instead of per tab.
7. `INT-001`, `INT-002`, `INT-003`, `INT-005`, `INT-011`, `INT-012`, `INT-013`, `INT-014` — generated/runtime files are tracked or not ignored.

Claims that were overstated or not currently supported by code:
- `BUG-06` is dormant shared state, but nothing reads those fields today.
- `BUG-08` is a false positive because the DB default is already `FALSE`.
- `UI-007` is a bad wrapper, but current renderer callers only ask for `context_window`, which is exactly what the underlying IPC handler returns.
- `UI-010`, `UI-015`, `UI-025`, `UI-027`, `UI-030`, and `UI-038` are mostly low-priority cleanup or overstated.
- `INT-009` and `INT-010` are not proven by current code.
- `INT-023` is not a good recommendation for SVG because SVG is text and benefits from diffs.

Existing tests are better than the issue files implied, but there are still real gaps:
- DB/runtime coverage exists, but it does not hit the current failure modes in `BUG-03` and `BUG-07`.
- Tool-chain and inference tests exist, but they do not cover parity across strip implementations or queued-lane failure cleanup.
- Plugin lifecycle coverage exists, but not managed-process shutdown behavior.

## Backend / Code Review

### Bugs

- `BUG-01` — Confirmed. `src/main/ipc/shared-utils.js:1-55` has a brace-aware strip implementation; `src/main/tool-chain-controller.js:77-112` uses `String.replace()` on only the `TOOL:name{` prefix and cannot actually consume the full JSON body; `src/main/agent-loop.js:319-321` uses `/TOOL:\w+\{[^}]*\}/g`, which stops at the first `}`. This should be unified on the shared implementation.

- `BUG-02` — Confirmed, with stronger evidence than the original note. `src/main/agent-manager.js:185-188` loads the agent and does nothing with it before calling `db.deleteAgent()`. `src/main/database.js:512-514` only deletes the agent row. `src/main/database-migrations.js:49-55` and `92-110` define `chat_sessions.agent_id` and `subagent_runs.subagent_id` relations without `ON DELETE CASCADE`, and the codebase does not enable SQLite foreign keys. IPC only deletes the tool-permission profile in `src/main/ipc/register-agent-system-handlers.js:249-256`. Folder cleanup, session cleanup, and run cleanup are all currently missing.

- `BUG-03` — Confirmed. `src/main/database.js:136-145` ignores `limit` in both branches and always loads the full session history.

- `BUG-04` — True but trivial. `src/main/ipc/register-agent-system-handlers.js:191-199` re-requires `fs` and `path` inside the handler even though the file already imports them.

- `BUG-05` — True but trivial. `src/main/ipc/register-llm-handlers.js:540-545` re-requires `os`, `fs`, and `path` inside the handler.

- `BUG-06` — Downgraded. `src/main/inference-dispatcher.js:25-26`, `123-124`, and `149-154` do overwrite `_lockMode` and `_lockPreemptible` across concurrent dispatches, but nothing in the current codebase reads those fields. This is stale shared state, not an active correctness bug today.

- `BUG-07` — Confirmed. `src/main/database.js:414-440` updates only `name` and `description`. `src/main/ipc/register-tools-capability-handlers.js:144-169` re-registers the in-memory tool with `updated.code` and `updated.input_schema`, so the app looks updated until restart, then loses the edit.

- `BUG-08` — False positive. `src/main/database.js:181-188` does hardcode `active: false`, but `src/main/database-migrations.js:40-48` defines `prompt_rules.active BOOLEAN DEFAULT FALSE`, so the returned value matches the current schema default.

### Overprotection / Redundancy

- `OVER-01` — Confirmed. `src/main/database.js:304-317` has identical `setSetting()` and `saveSetting()` bodies.

- `OVER-02` — Not an issue. `database.js` is synchronous under `better-sqlite3`, but the async interface is coherent and forward-compatible.

- `OVER-03` — Confirmed. `src/main/ipc/register-chat-data-handlers.js` repeats the private/test/normal session split across many handlers. This is real duplication and a valid refactor target.

- `OVER-04` — Downgraded. The unused `options = {}` parameters in `src/main/ipc/register-agent-system-handlers.js` are consistent enough to read as extensibility padding rather than dead code.

- `OVER-05` — Downgraded. `src/main/ipc/register-tools-capability-handlers.js:10-57` splits `execute-tool` and `execute-mcp-tool` along permission/UI behavior. The naming is confusing, but the trust-level split is real.

- `OVER-06` — Confirmed. `src/main/agent-manager.js:334-336` is a dead stub.

- `OVER-07` — Confirmed. `src/main/tool-chain-controller.js:553-571` defines `isEchoingResult()` and there are no callers.

- `OVER-08` — Low-value style observation. The defensive string normalization pattern exists, including `src/main/inference-dispatcher.js:53`, but this is not a focused issue list item worth planning by itself.

- `OVER-09` — Partly confirmed but overstated. The `existsSync()` then `readFileSync()` pattern exists in several places, for example `src/main/agent-manager.js:299-318` and `src/main/background-memory-daemon.js:628-781`. It is more of a cleanup style issue than a meaningful correctness problem here.

- `OVER-10` — Confirmed, but style-only. `src/main/tool-chain-controller.js:236-262` manually copies options field-by-field.

### Duplication

- `DUP-01` — Confirmed. `src/main/ipc/register-llm-handlers.js:232-312` duplicates LM Studio URL normalization logic across multiple helpers. There is also similar localhost normalization in `src/main/providers/lmstudio-adapter.js`.

- `DUP-02` — Confirmed, low priority. `src/main/main.js:35-53` and `src/main/docker-entry.js:23-37` define two similar IPC bridge classes, but they serve different runtime environments.

- `DUP-03` — Confirmed. `src/main/subtask-runtime.js` duplicates private and persisted run flows heavily in `createRun`, `completeRun`, `failRun`, `cancelRun`, and `deliverToParent`.

- `DUP-04` — Confirmed. The Minimax/invoke cleanup regexes appear in both `src/main/ipc/shared-utils.js:51-54` and `src/main/tool-chain-controller.js:107-111`.

- `DUP-05` — Confirmed. `src/main/ipc/register-chat-data-handlers.js:693-696`, `779-780`, `792-794`, `824-825`, `843-845`, and `893-894` repeat the same activity tracking pattern.

### Tests

- `TEST-01` — Partly confirmed. `tests/contracts/database-runtime-contract.test.js` is thin, but it delegates to `tools/test-database-runtime.js`, which does cover seeding, workflow persistence, conversation metadata persistence, and current-session recovery. It still does not cover `getConversations()` limit handling, `updateCustomTool()`, prompt-rule active semantics, API key round-trips, or memory-job edge cases.

- `TEST-02` — Partly confirmed. `tests/contracts/tool-chain-controller-contract.test.js` already covers malformed tool calls and invoke-style XML calls, but it does not compare all strip implementations against each other and does not hit the `agent-loop.js` regex path.

- `TEST-03` — Confirmed. There is no direct `ConnectorRuntime` contract test; current tests mostly stub it.

- `TEST-04` — Partly confirmed. Three daemon tests exist, but they are narrow. They cover context gathering, queue draining limits, and `runNow()`, not the broader scheduling/resource-gating behavior.

- `TEST-05` — Confirmed. I did not find a direct test for `BackendEventBus` inference dispatch behavior.

- `TEST-06` — Partly confirmed. `tests/contracts/inference-concurrency-contract.test.js` covers queued mode, cross-provider parallelism, same-provider serialization, and enablement signaling. It does not cover queued-lane failure cleanup or error propagation across the same lane.

- `TEST-07` — Partly confirmed. There is no full end-to-end chat-chain persistence test, but there are focused handler tests such as `tests/contracts/chat-user-activity-contract.test.js` and `tests/contracts/private-session-contract.test.js`.

- `TEST-08` — Confirmed. I did not find a test that verifies agent deletion cascades through agent folders, sessions, runs, and permission state.

- `TEST-09` — Partly confirmed. `tests/contracts/plugin-lifecycle-contract.test.js` covers enable/disable, restart re-enable, rollback on failure, and hot reload. It does not cover managed-process termination sequences.

- `TEST-10` — Opinion, not a code defect. The custom runner in `tests/run-suite.js` is real, but whether to migrate to a framework is a tooling decision, not an issue by itself.

### Style / Process

- `STYLE-01` — Confirmed. `src/main/database.js`, `src/main/tool-chain-controller.js`, and `src/main/connector-runtime.js` all contain mixed CRLF and LF line endings.

- `STYLE-02` — Confirmed. `src/main/mcp-server.js:99-101` is visibly over-indented relative to surrounding methods.

- `STYLE-03` — Confirmed. IPC handlers mix `return { error }`, `return { success: false, error }`, and `throw`. `src/main/ipc/register-agent-system-handlers.js` alone contains all three patterns.

- `STYLE-04` — Confirmed. `src/main/ipc/register-tools-capability-handlers.js:23-31` and `src/main/ipc/register-llm-handlers.js:418`, `472`, and `532` still log user-facing interactions and config objects directly.

## Integrity / Git Hygiene Review

- `INT-001` — Confirmed. `git ls-files` shows tracked `__pycache__/` and `*.pyc` files under `agentin/plugins/http-tts-bridge/python_backend/backend/`.

- `INT-002` — Partly confirmed. `agentin/a2a/events/*.jsonl` and `agentin/a2a/tasks/*.json` are clearly tracked runtime data. `agentin/a2a/targets/*.json` are tracked too, but they look like config templates rather than generated state.

- `INT-003` — Confirmed. `git ls-files` shows tracked timestamped sub-agent directories under `agentin/agents/sub/`, alongside stable template agents.

- `INT-004` — Partly confirmed. `agentin/workflows/system_health_check_copy.json` looks like a duplicate artifact, and `agentin/workflows/live_workflow_test.json` looks like a demo/test workflow. Whether they should be deleted or ignored is still a product curation decision.

- `INT-005` — Confirmed. `agentin/tasks/tasks.md` is tracked, and `src/main/runtime-paths.js:114-115` defines it as the runtime task queue file path.

- `INT-006` — Correct as written. `.gitignore` ignores runtime `state.json` while tracking `state.default.json`; that matches the pattern in the repo.

- `INT-007` — Correct as written. Tracked `system.md` files appear intentional while `compact.md` is ignored as runtime output.

- `INT-008` — Partly confirmed. `.gitignore` only ignores specific plugin runtime locations. A general plugin runtime policy is missing, but `agentin/plugins/agent-rag-studio/data/tech-support-menu-20.json` looks like curated dataset content, not obviously runtime junk.

- `INT-009` — Not proven. `src/main/knowledge-manager.js` treats `agentin/knowledge/library/` and `agentin/knowledge/staging/` as managed knowledge roots, with staging explicitly daemon-generated. I did not find code that proves the tracked root markdown files in `agentin/knowledge/` or `agentin/knowledge/multiagent/` are runtime-generated and should be ignored.

- `INT-010` — Not supported by current code. I did not find code writing into `agentin/skills/`. The issue text assumes these files are daemon-generated, but the repository evidence does not currently prove that.

- `INT-011` — Confirmed. `.gitignore` has no global `__pycache__/`, `*.pyc`, or `*.pyo` rules.

- `INT-012` — Confirmed. `.gitignore` has no rule for `agentin/a2a/`.

- `INT-013` — Confirmed. `.gitignore` has no rule for `agentin/tasks/`.

- `INT-014` — Confirmed. `.gitignore` has no rule for timestamped runtime sub-agents.

- `INT-015` — Decision item. `code.issues`, `integrity.issues`, `ui.issues`, and `combined-issues-assessment.md` are currently untracked, not ignored. Keep or ignore is your call.

- `INT-016` — Decision item. There is no broad scratch-file ignore policy. That is a workflow choice, not a defect.

- `INT-017` — Confirmed safe. `.env` is ignored, `.env.example` is tracked, both files are currently identical, and `git log --all --diff-filter=A -- .env` returns no committed `.env` add.

- `INT-018` — Checked and downgraded. `agentin/connectors/telegram-bot.js` and `agentin/connectors/telegram-relay.js` do not contain hardcoded tokens; they expect runtime config.

- `INT-019` — Checked and narrowed. `agentin/a2a/targets/comfyui.json` contains a local endpoint (`http://127.0.0.1:8188`), but these target files do not currently expose secrets.

- `INT-020` — Checked and downgraded. `agentin/plugins/http-tts-bridge/config.txt` looks like a generic request/response mapping template, not personal machine state.

- `INT-021` — Correct process note. Adding ignore rules alone will not untrack the already-indexed files.

- `INT-022` — Optional hardening only.

- `INT-023` — Not recommended as written. Marking `*.svg` as binary would remove useful text diffs. Binary attributes may make sense for `*.png` or `*.ico`, but not for SVG by default.

## Renderer / UI Review

### Initialization / Race Claims

- `UI-001` — Downgrade confirmed. `src/renderer/components/main-panel.js:985-997` and `src/renderer/app.js:280-282` rely on load order, but the current `index.html` order makes this work.

- `UI-002` — Downgrade confirmed. `src/renderer/components/chat-continuity.js:74-87` polls for `window.mainPanel`, but it behaves like a fallback, not a live bug.

- `UI-003` — Downgrade confirmed. `src/renderer/components/tool-call-preview.js:38-58` monkey-patches by load order; ugly, but currently stable.

- `UI-004` — Downgrade confirmed. `src/renderer/components/skin-manager.js:1-24` constructor does not touch the DOM; initialization is deferred.

### Real State / Correctness Problems

- `UI-005` — Confirmed. `src/renderer/components/main-panel-tabs.js:768-839` stores `messagesHTML` snapshots and restores them via `container.innerHTML`, which loses live DOM state and handlers.

- `UI-006` — Confirmed. `src/renderer/electron-api.js:13` and `61` both define `saveSetting`.

- `UI-007` — Partly confirmed. `src/renderer/electron-api.js:11` ignores the `key` parameter and always calls `get-context-setting`. That wrapper is misleading, but `rg` shows the current renderer only calls `getSetting('context_window')`, which coincides with the handler’s actual purpose.

- `UI-008` — Confirmed, low priority. `src/renderer/components/main-panel.js:635-641` hardcodes context usage colors inline.

- `UI-009` — Confirmed. `src/renderer/components/main-panel.js:625-629` writes `lastContextUsage` globally; `showStoredContextUsage()` at `673-676` then reads the global copy instead of the active tab’s `contextUsage`.

- `UI-010` — Downgraded. `src/renderer/components/sidebar.js:121-375` does rebind listeners on rebuilt cards, but those listeners are attached to nodes that are discarded. This is more repeated work than a true leak.

- `UI-011` — Downgrade confirmed. App-lifetime listener in a single-page renderer.

- `UI-012` — Downgrade confirmed. Single observer, single-page lifecycle.

- `UI-013` — Downgrade confirmed. Same reasoning as `UI-011`.

### Theme / Skin System

- `UI-014` — Confirmed. Theme state is written in `src/renderer/index.html:8-29`, `src/renderer/app.js:156-167`, and `src/renderer/components/skin-manager.js:278-289`. This creates duplicated authority and potential visual churn.

- `UI-015` — Downgraded. `src/renderer/components/skin-manager.js:759` does have a 4.5s timeout, but skins are loaded from local files. This is a resilience edge case, not an active bug.

- `UI-016` — Confirmed. `src/renderer/components/skin-manager.js:743` hardcodes `?v=1`, so stylesheet cache busting never changes.

- `UI-017` — Confirmed. `src/renderer/components/sidebar.js:209-216` uses hardcoded inline group-header styles outside the theme system.

### Security / Trust Boundaries

- `UI-018` — Confirmed and important. `src/renderer/components/sidebar.js:241-260` injects tool data directly into `innerHTML`, and `src/renderer/components/sidebar.js:468-485` does the same for workflow names and descriptions. This renderer has Node access, so unescaped HTML is a real risk.

- `UI-019` — Narrowed but valid. `src/renderer/components/skin-manager.js:511` and `634` do renderer-side filesystem copy/delete. `slugifySkinId()` at `449-455` constrains imported IDs, so the current target-path risk is narrower than the issue text suggested, but moving these operations behind validated IPC would still be better.

- `UI-020` — Downgraded. `src/renderer/components/main-panel-tabs.js:315` does `root.innerHTML = ui.html`, but that HTML comes from locally installed plugins, and `src/main/window-manager.js:7-8` confirms the renderer is already privileged. The trust boundary is plugin installation, not this render call.

### Performance / Structural Debt

- `UI-021` — Confirmed, same root cause as `UI-005`. Full DOM teardown/rebuild happens on tab switch in `src/renderer/components/main-panel-tabs.js:781-839`.

- `UI-022` — Confirmed. `src/renderer/components/sidebar.js:123-148` awaits multiple IPC calls serially every time `loadMCPTools()` runs.

- `UI-023` — Confirmed. `src/renderer/components/workflow-editor.js:526-564` rebuilds the entire SVG via `innerHTML` on each render.

- `UI-024` — Confirmed but low priority. `src/renderer/components/message-formatter.js:299-303` allocates a DOM node per `escapeHtml()` call.

- `UI-025` — Downgraded. `src/renderer/components/main-panel.js:359` uses `Date.now()` plus `Math.random()`. Collisions are theoretically possible but extremely unlikely in practice.

- `UI-026` — Partly confirmed. `src/renderer/components/main-panel.js:43-55` and `src/renderer/components/chat-continuity.js:65-71` both listen to the stop button. This is real coupling, but the “wrong tab” race is not proven from current code.

- `UI-027` — Downgraded. `src/renderer/components/main-panel.js:61-70` and `84-108` both handle Enter around autocomplete, but current browser event order makes it work. This is redundant, not a live bug.

- `UI-028` — Confirmed. `src/renderer/components/main-panel.js:235-260` immediately sends dropped files for AI analysis with the hardcoded prompt `Analyze this file`.

- `UI-029` — Partly confirmed. `src/renderer/components/main-panel.js:646` requests only 100 conversations for context estimation. Because `BUG-03` exists, it currently receives the whole session anyway; once `BUG-03` is fixed, this renderer path will start undercounting long sessions.

- `UI-030` — Downgraded. `src/renderer/components/main-panel-tabs.js:393-395` uses a prefix check, but `src/main/private-session-store.js:3-10` defines that prefix as the actual session-id contract.

- `UI-031` — Architectural debt only. `src/renderer/index.html` currently has 33 script tags, not 32, and they are all plain global scripts. This is maintainability debt, not a bug.

- `UI-032` — Confirmed maintainability debt. `src/renderer/components/main-panel.js` is 997 lines.

- `UI-033` — Confirmed maintainability debt. `src/renderer/components/sidebar.js` is 994 lines.

- `UI-034` — Confirmed. The renderer still uses two-way global coupling between `window.mainPanel` and `window.sidebar`.

- `UI-035` — Confirmed, low priority. `src/renderer/components/command-handler.js:627-656` duplicates `/daemonrun` and `/daemonpush`.

- `UI-036` — Confirmed. `sidebar.js` and `workflow-editor.js` both manage workflows and do not share one state model.

- `UI-037` — Confirmed. The renderer has no shared escaping contract across components, which is the broader root cause behind `UI-018`.

### Error Handling / UX

- `UI-038` — False positive as written. `src/renderer/components/main-panel.js:324-352` uses `.then().catch().finally()`, and a thrown exception inside `.then()` would still reach the chained `.catch()`. This is more of a readability/style concern than a silent error swallow.

- `UI-039` — Correctly downgraded. No meaningful fallback exists if the Electron bridge fails to load.

- `UI-040` — Confirmed. `src/renderer/components/skin-manager.js:53-64` logs config load failures but keeps rendering with empty defaults and no user-facing explanation.

- `UI-041` — Confirmed visible bug. `src/renderer/index.html:292` contains literal `${tools.length}` inside static HTML.

- `UI-042` — Partly confirmed, but much weaker than stated. `src/renderer/components/main-panel.js:373` strips only `<think>` before calling `speakText()`. However, `src/renderer/components/tts-controller.js:132-136` uses `tts-text-utils`, and `src/renderer/components/tts-text-utils.js:33-85` already removes fenced code, links, symbol-heavy lines, and other noisy text when that controller is active. The browser fallback path is rougher.

- `UI-043` — Confirmed. `src/renderer/components/main-panel-tabs.js:483-485` can generate duplicate “Chat N” titles after tab deletion.

- `UI-044` — Confirmed. `src/renderer/components/main-panel.js:385-399` lightbox close is click-only; there is no Escape handler.

- `UI-045` — Confirmed but low priority. `src/renderer/components/main-panel.js:145-148` wires the button; the actual action remains a placeholder.

## Repo Policy Notes

- The repo-level “no files longer than 1000 lines” rule is not internally consistent today. `src/main/llm-model-specs.json` is 1064 lines, and `tests/fixtures/line-budgets.json` explicitly allowlists it up to 1100.

- Several near-limit files are still under 1000 but already too large for comfortable maintenance:
  - `src/renderer/components/main-panel.js` — 997
  - `src/renderer/components/sidebar.js` — 994
  - `src/renderer/components/main-panel-tabs.js` — 992
  - `src/renderer/components/skin-manager.js` — 989
  - `src/main/plugin-manager.js` — 989

## Recommended Work Plan

### Phase 1: Correctness and Security
1. Unify tool-call stripping on `src/main/ipc/shared-utils.js` and remove the local variants.
2. Fix `database.updateCustomTool()` persistence for `code` and `input_schema`.
3. Fix `database.getConversations()` to honor `limit`.
4. Escape or DOM-build sidebar tool/workflow cards instead of interpolating raw HTML.
5. Fix tab context usage to read/write per-tab state only.

### Phase 2: Runtime Data Hygiene
1. Add ignore rules for `__pycache__/`, `*.pyc`, `agentin/a2a/events/`, `agentin/a2a/tasks/`, `agentin/tasks/`, and timestamped `agentin/agents/sub/` folders.
2. Untrack already-committed generated files with `git rm --cached`.
3. Decide whether `.issues` files remain private scratch files or become tracked project docs.
4. Decide separately whether `agentin/workflows/live_workflow_test.json` and `system_health_check_copy.json` are kept as curated examples.

### Phase 3: Renderer State / Reliability
1. Replace tab `innerHTML` snapshots with live hidden containers or structured message state.
2. Collapse theme writes behind one owner, preferably `SkinManager`.
3. Remove the misleading `electronAPI.getSetting()` wrapper or rename it to what it actually does.
4. Stop auto-sending dropped files; stage them and let the user choose the prompt.

### Phase 4: Cleanup
1. Remove dead stubs like `getAgentFolderPathById()` and `isEchoingResult()`.
2. Normalize line endings and trim noisy production logging.
3. Revisit test gaps after the correctness fixes land; do not start with a test-runner migration.
