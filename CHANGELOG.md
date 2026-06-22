# Changelog

All notable changes to LocalAgent Desktop will be documented in this file.

## [0.1.0-beta.1] — 2026-05-28

### 🔄 First Public Beta

Promoted from alpha to beta after addressing release readiness review findings.

### Security & Hardening
- Electron renderer now runs with `nodeIntegration: false` and `contextIsolation: true`
- Renderer communicates through isolated preload bridge (`contextBridge`)
- Remote Gateway shared secret now uses credential storage with legacy setting migration
- `sandbox: false` remains — full sandboxing is tracked for future hardening
- Removed tracked A2A runtime artifacts and Python bytecode from repository

### Plugin System
- Pixel Avatar: preset-based character system (generated-cat, generated-robot, generated-girl, pixel-cat, pixel-default)
- Pixel Avatar: emotion presets (balanced, expressive, markers, neutral)
- Plugin setup UI rendering via `renderSetupUI` hook
- Plugin agent UI service for agent-scoped plugin panels
- Enriched plugin handler params with agent context

### Agent & Subagent
- Agent subagent contract methods extracted to dedicated module
- Agent subagent run methods extracted to dedicated module
- Agent batch invoker for provider-aware parallel execution

### Infrastructure
- Release readiness review process and documentation
- `.env.example` template for environment setup
- Cleaner `.gitignore` and `.dockerignore` with runtime artifact exclusions
- Line-budget contract with soft warning threshold
- Desktop packaging now bundles curated `agentin` defaults instead of raw runtime state
- `wellbot` npm package metadata now declares repository and homepage

### Bug Fixes
- Fixed `getConversations()` ignoring `limit` parameter
- Fixed `updateCustomTool()` not persisting `code` or `input_schema` changes
- Fixed stale Companion Browser pairing contract expectations
- Fixed `addPromptRule()` returning hardcoded `active: false`
- Fixed `deleteAgent()` not cleaning up agent folders and sessions
- Fixed invalid CORS literal and request timeout leak in `PortListenerManager`
- Removed redundant `require()` calls inside IPC handlers
- Removed dead code: `getAgentFolderPathById()`, `isEchoingResult()`
- Split Pixel Avatar renderer by shared helpers and character renderers

### Known Issues
- Electron runs with `sandbox: false` (full sandboxing tracked for hardening)
- Tool chain has no context window truncation

---

## [0.1.0-alpha] — 2026-04-26

### 🎉 Initial Alpha Release

First public alpha release for community testing.

### Core Features
- Multi-chat sessions with persistent history and tab restore
- Async (non-blocking) chat — send messages while AI is thinking
- 37 built-in MCP tools across 8 domains (system, agent, web, files, terminal, calendar, media, connectors)
- Tool chain controller with auto-continuation and deduplication
- Tool permission system with capability groups and user approval flow

### LLM Provider Support
- 8 provider adapters: Ollama, LM Studio, OpenRouter, OpenAI-compatible, Qwen, Codex CLI, OpenAI Hybrid
- Model spec system with runtime config (reasoning, streaming, context window)
- Custom model testing and last-working-model fallback
- Provider-aware inference locking for local GPU protection

### Agent System
- 7 pro agents with specialized system prompts and memory
- 11+ sub-agents for delegated tasks
- Dual-mode subagent architecture (hidden worker runs + direct user chats)
- Provider-aware parallel batch execution
- File-backed subtask runs with durable state

### Plugin System
- Hot-loadable plugin lifecycle (enable/disable/reload/rollback)
- 7 bundled plugins (SearXNG, TTS bridge, Telegram relay, RAG studio, file browser, research UI, test)
- Plugin Studio UI for management and configuration
- Auto-generated knowledge items for LLM discoverability
- Capability contracts for plugin tool registration

### Workflow Engine
- File-first JSON workflow storage
- Auto-capture of successful tool chains
- Visual workflow editor with canvas
- Scheduled background workflow execution
- Run folder manifests with trace and results

### Knowledge & Memory
- File-first knowledge base with DB index
- Staged/active lifecycle with safety rules
- Background memory daemon with inference-driven summarization
- Daily and global memory files
- User profile observations

### Research Runtime
- Baseline vs variant experiment framework
- Research run store with manifests and artifact registry
- Research Orchestrator pro agent with dedicated UI

### UI/UX
- 8 built-in skins/themes with persistence
- Calendar and todo widgets
- Plugin management panel
- Agent picker widget
- Context window usage display
- TTS voice controls
- Chart renderer for data visualization

### Infrastructure
- Path token system for portable file references
- Secure API key storage via Electron safeStorage
- Event bus for typed system-wide events
- 35+ contract tests across 6 suite levels
- Docker support for headless testing

### Known Issues (Alpha)
- ~~Electron runs with `nodeIntegration: true`~~ (fixed in beta — now `false` with `contextIsolation: true`)
- Rule manager uses innerHTML (XSS surface)
- Tool chain has no context window truncation
- Vector store/embeddings exist but are not wired to knowledge search
