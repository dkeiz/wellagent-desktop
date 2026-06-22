# Fix Inference Sending, Caching, and Message Handling Bugs

After a thorough audit of the inference pipeline — from IPC handlers through the dispatcher, conversation context, and all provider adapters — I found **9 distinct bugs** causing the issues you described: broken caching, incorrect message appending, and hidden context limits fighting your configured one.

## User Review Required

> [!IMPORTANT]
> Several of these bugs interact with each other. For example, the conversation context cache silently drops messages (#3), which then gets compounded by the `max_tokens` vs `max_completion_tokens` confusion (#4) limiting your *output* to 1000 tokens regardless of your context window setting. Fixing these together should dramatically improve inference quality.

> [!WARNING]
> Bug #6 (InferenceDispatcher `_lockMode` race condition) was already flagged in your `code.issues` (BUG-06) but the fix here is scoped to the inference flow — it doesn't restructure concurrency, just prevents stale state reads.

---

## Proposed Changes

### Component 1: Conversation Context Cache — Silent Message Loss

#### Bug #1: `append()` silently drops messages when cache is cold
**File**: [conversation-context.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/conversation-context.js#L134-L146)

The `append()` method does `if (!cached) return;` — if the cache for a session hasn't been populated yet (first message in a session, or after a restart), **every appended message is silently lost**. The next `getOrLoad()` will load from the DB, but any messages appended between `persistMessage()` and the next `getOrLoad()` may be stale or missing from the in-memory view.

**The real problem**: In `send-message` (line 822-826), `persistMessage()` calls `append()` to the cache, then later `buildPromptHistory()` calls `getOrLoad()`. But `persistMessage()` is called *after* `buildPromptHistory()` — so the just-appended user message is in the cache but was already sent to inference. On the **assistant response** (line 869), `persistMessage()` appends the assistant message, but if the cache was invalidated in between (session switch, clear), it silently drops. The next conversation turn will be missing the assistant's last response.

**Fix**: Ensure `append()` initializes the cache entry if needed, so no message is ever silently dropped.

#### Bug #2: `getOrLoad()` returns shallow copies but shares the inner `messages` array reference
**File**: [conversation-context.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/conversation-context.js#L113-L132)

`getOrLoad()` does `cached.messages.map(m => ({ ...m }))` — this creates new message objects but the *cache entry itself* (`cached.messages`) is still the live array. When `append()` pushes to `cached.messages`, it's mutating the same array. If any caller holds a reference to a previous `getOrLoad()` result and iterates it while `append()` is running, undefined behavior occurs. This is a minor issue but contributes to race conditions during rapid message exchanges.

**Fix**: This is acceptable as-is since JS is single-threaded. No code change needed, but documenting this for clarity.

#### Bug #3: `buildPromptHistory()` uses `context_window` setting but `dispatch()` resolves its own context window independently
**File**: [register-chat-data-handlers.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/ipc/register-chat-data-handlers.js#L98-L109) and [inference-dispatcher.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/inference-dispatcher.js#L257-L280)

`buildPromptHistory()` reads `context_window` from settings and uses it to trim history. Independently, `_applyUiRuntimeOverrides()` in the dispatcher *also* reads `context_window` and applies it to the model spec. **These two reads can disagree** if the setting changes between the two calls (e.g., user changes context window while a message is in-flight). More importantly, `buildPromptHistory()` uses a raw string setting while the dispatcher sanitizes it through `sanitizeContextWindow()` which clamps to model-specific min/max. So your history budget may be calculated for 128k tokens but the actual model is clamped to 32k.

**Fix**: Pass the resolved, sanitized context window from the dispatcher back to the history builder, not read it twice independently.

---

### Component 2: Provider Adapter Issues — The "Limited by Something Else"

#### Bug #4: `max_tokens` hardcoded to 1000 in all adapters — this is your hidden limiter
**Files**: 
- [openai-compatible-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/openai-compatible-adapter.js#L36) — `max_tokens: options.max_tokens ?? 1000`
- [openrouter-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/openrouter-adapter.js#L34) — `max_tokens: options.max_tokens || 1000`
- [lmstudio-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/lmstudio-adapter.js#L42) — `max_tokens: options.max_tokens || -1`
- [ollama-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/ollama-adapter.js) — no max_tokens (Ollama uses `num_ctx` instead)

> [!CAUTION]
> **This is almost certainly your "limited by something else" problem.** The dispatcher **never sets `options.max_tokens`** anywhere. The `dispatch()` method passes options through but doesn't populate `max_tokens`. So every OpenAI-compatible provider (OpenRouter, DeepSeek, Mistral, Anthropic, Groq, OpenAI, BYOK, local-openai) gets **max_tokens=1000** — meaning the model's output is capped at ~750 words regardless of your context window setting. Your context limiter controls how much *history* goes in; `max_tokens` controls how much *response* comes out.

> [!WARNING]
> OpenRouter and OpenAI-compatible use `||` (falsy check) while others use `??` (nullish check). With `||`, even `max_tokens: 0` falls through to 1000. With `??`, only `null`/`undefined` falls through. Inconsistent.

**Fix**: 
1. Have the dispatcher compute a sensible `max_tokens` default from the model spec (many models have a `maxOutputTokens` field) or from the context window (e.g., `min(4096, contextWindow * 0.25)`).
2. Use `??` consistently across all adapters.
3. For LM Studio, keep `-1` as the unlimited fallback.

#### Bug #5: OpenRouter `cache_control` is set at top-level instead of per-message
**File**: [openrouter-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/openrouter-adapter.js#L120-L125)

For Anthropic-routed models through OpenRouter, the code sets `requestBody.cache_control = { type: 'ephemeral' }`. But OpenRouter's API expects `cache_control` annotations **on individual messages**, not at the request body level. Setting it at the top level is silently ignored by the API, meaning prompt caching never actually activates for Anthropic models through OpenRouter.

**Fix**: Apply cache control breakpoints on the system message and the last 2 user messages (the Anthropic caching sweet spot).

#### Bug #6: Prompt cache key doesn't include the system prompt hash — cache collisions across agents
**File**: [inference-dispatcher.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/inference-dispatcher.js#L165-L175)

The cache key is `localagent:${provider}:${model}:${agent}:${session}`. But the *system prompt content* is not hashed into the key. If you switch agents within the same session, or if rules change, the cache key stays the same but the system prompt is different. This can cause the API to serve a cached response based on a stale system prompt. (This mainly affects OpenAI and OpenRouter which support server-side prompt caching.)

**Fix**: Include a lightweight hash of the system prompt length + first 100 chars in the cache key.

---

### Component 3: Dispatcher Issues — Stale State and Message Assembly

#### Bug #7: `_lockMode` / `_lockPreemptible` race condition on concurrent dispatches
**File**: [inference-dispatcher.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/inference-dispatcher.js#L131-L162)

Already documented in your `code.issues` as BUG-06. The `execute` closure writes to `this._lockMode` and `this._lockPreemptible`, but these are instance-level fields. If two dispatches run via different lanes (e.g., a chat dispatch and a daemon internal dispatch), the second overwrites the first's lock state. The `finally` block then clears them to null while the first dispatch is still in flight.

**Fix**: Move lock state into the `execute` closure or into a per-lane Map.

#### Bug #8: `_applyUiRuntimeOverrides` reads `context_window` but doesn't validate it's for the current model
**File**: [inference-dispatcher.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/inference-dispatcher.js#L257-L280)

`context_window` is a single global setting. But different models have different max context sizes. If you set `context_window=128000` for a model that only supports 32768, `sanitizeContextWindow()` should clamp it — but only if the model spec has `contextWindow.max` defined. For models without specs (BYOK, local-openai, unknown models), the raw value passes through unclamped, potentially sending a `num_ctx` or context configuration the model can't handle, causing silent truncation or errors.

**Fix**: Add a defensive clamp in `sanitizeContextWindow()` for models without max: default to a sane max (e.g., 131072) so extremely large values don't pass through.

---

### Component 4: Message Construction Bugs

#### Bug #9: Anthropic adapter uses OpenAI message format — no `system` role separation
**File**: [ai-service.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/ai-service.js#L53-L60)

The `anthropic` provider is registered as an `OpenAICompatibleAdapter` with `defaultBaseURL: 'https://api.anthropic.com/v1'`. But the Anthropic Messages API uses a **different request format** from OpenAI:
- Anthropic expects `system` as a **top-level string field**, not as a message with `role: "system"`
- Anthropic uses `max_tokens` as a **required** field (not optional)  
- Anthropic needs `anthropic-version` header (which is set, ✅)

If anyone uses the `anthropic` provider directly (not through OpenRouter), they'll hit API errors because the system message is sent inside the messages array where Anthropic doesn't accept it. OpenRouter proxies handle this translation, so it works through OpenRouter but breaks for direct Anthropic API calls.

**Fix**: Either create a dedicated `AnthropicAdapter` that separates the system prompt, or document that direct Anthropic should be used through OpenRouter. Given the scope, I recommend adding a `_preprocessMessages()` hook in the adapter.

---

## Summary of Changes by File

| File | Bugs Fixed | Change Type |
|------|-----------|-------------|
| [conversation-context.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/conversation-context.js) | #1 (silent drop) | `append()` auto-initializes cache |
| [register-chat-data-handlers.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/ipc/register-chat-data-handlers.js) | #3 (dual context read) | Pass resolved context window to history builder |
| [openai-compatible-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/openai-compatible-adapter.js) | #4 (max_tokens=1000), #9 (Anthropic) | Compute sensible max_tokens default; add Anthropic message preprocessing |
| [openrouter-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/openrouter-adapter.js) | #4 (max_tokens), #5 (cache_control) | Fix max_tokens; move cache_control to per-message |
| [lmstudio-adapter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/providers/lmstudio-adapter.js) | #4 (consistent `??`) | Use `??` for max_tokens |
| [inference-dispatcher.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/inference-dispatcher.js) | #6 (cache key), #7 (lock race), #8 (context clamp) | Hash system prompt in cache key; scope lock state per-call; add defensive max clamp |

---

## Open Questions

> [!IMPORTANT]
> **Q1**: For Bug #4 (max_tokens=1000) — what should the default be? Options:
> - **A)** `4096` (good default for most models, ~3000 words)
> - **B)** Derive from model spec if available, fallback to 4096
> - **C)** Remove the cap entirely (let the API decide) — risky for cost on cloud providers
> 
> I recommend **B** — use the model spec's `maxOutputTokens` if present, fall back to 4096.

> [!IMPORTANT]
> **Q2**: For Bug #9 (Anthropic adapter) — are you actually using the `anthropic` provider directly, or always through OpenRouter? If only through OpenRouter, this is low priority and I'll just add a comment. If direct, I'll build a proper Anthropic adapter.

> [!IMPORTANT]
> **Q3**: For Bug #5 (OpenRouter cache_control) — do you actively use Anthropic models through OpenRouter and want prompt caching? If not, I'll skip the per-message cache_control refactor and just remove the broken top-level field.

---

## Verification Plan

### Automated Tests
- Run existing test suite: `node tests/run-suite.js`
- Verify no regressions in contract tests

### Manual Verification
1. **max_tokens fix**: Send a message asking for a long response, verify it's no longer cut off at ~750 words
2. **Cache fix**: Send multiple messages in a session, verify the conversation context grows correctly (check `[Context]` log lines)
3. **Context window**: Set context_window to a model-specific value, verify the `[Dispatcher]` log shows the correct `historyLen` 
4. **Multi-provider**: Test with at least 2 of your configured providers to verify the fixes work across adapters


your context calculation solutions still wrong and mocking. FUCKING READ USER INPUT. 
I NEED FULL CONTEXTR CONTROPL AND CALCULATION. AND IT DID EXIST IN CODE UNTIL YOU FUCKER DECIDE TO REMOVE IT. NEVER REMOVE MY WORKAGBLE CODE. YOU TASK IS SIMPLE: 
IN CHAT THERE ALWAYS CONTEXT. USER LOAD PREVIOUS CHAT - WE SHOW USER CONTEXT OF THIS CHAT. FULLY. NO TRANCATION. REAL CONTEXT SIZE. USER SEND MORE MESSAGE - CONTEXT GROW - WE SHOW REAL GROWS OF REAL CONTEXT. WHY* THAT SIMPLE MECHANISM OF HONEST SHOWN REAL DATA IS SO HARD FOR YOU?!?!!?!?!?!?
PLAN HOW DO THIS THIS P{ROPERLY. FORE ANYH PROVIDER. IN ANY CASE AND EDGE CASE. IF CONTEXTR EXIST OR FALLEN OR CORRUPTED. ALWAYS REAL DATA TO USER IN SUCH FIELD. 