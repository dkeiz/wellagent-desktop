# Content Viewer UI Rework - Desktop Split Layout

Transform LocalAgent Desktop from a 3-column layout (sidebar | chat | widgets) into a 2-column desktop split layout (sidebar | chat + content viewer) with a resizable split pane.

## Review Status — June 5, 2026

The desktop split layout work has been implemented and reviewed with hard contract/core validation. Follow-up fixes were applied for Content Viewer payload normalization, local file loading, HTML sandboxing, link interception, provider context token accounting, line budgets, and release runtime artifact hygiene.

Current caveat: **secondary chat in the Content Viewer is still a UI scaffold**. The toggle shows a secondary chat area, but it is not yet wired to a session/agent send flow. Treat that as a remaining implementation task, not a completed feature.

Validation now passes:
- `node tests/run-suite.js contracts` — PASS, 143 contract items.
- `node tests/run-suite.js core` — PASS, 149 items.

## Current Architecture

```
┌──────────┬──────────────────────┬────────────┐
│  Left    │     Center           │   Right    │
│ Sidebar  │   Chat / Settings    │  Widgets   │
│ (14%)    │     (68.5%)          │  (17.5%)   │
│          │                      │            │
│ Nav      │  Chat tabs           │ Theme      │
│ Agents   │  Messages            │ Plugins    │
│ Tools    │  Input               │ Sub-agents │
│ History  │                      │ Workflows  │
│          │                      │ Avatar     │
│          │                      │ Calendar   │
└──────────┴──────────────────────┴────────────┘
```

## Proposed New Layout

```
┌──────────┬──────────────────────┬─────────────────────┐
│  Left    │     Chat Area        │   Content Viewer    │
│ Sidebar  │                      │                     │
│          │                      │                     │
│ Nav      │  Chat tabs           │  Viewer tabs        │
│ Agents   │  Messages            │  File/URL/Doc       │
│ Plugins  │  Input               │  rendered content   │
│ Sub-agts │                      │                     │
│ Workflows│                      │                     │
│ Tools    │                      │                     │
│ History  │  ← drag handle →     │                     │
├──────────┼──────────────────────┴─────────────────────┤
│ ⚙️ 📊 ⌨️│   🐱 Avatar   │  📅 Jun 5, 2026  │ ☀️🌅🌙 │
└──────────┴───────────────┴───────────────────┴─────────┘
```

## User Review Required

> [!IMPORTANT]
> **Layout Toggle in Settings**: The "Type Picker" dropdown in Application Settings already exists. I'll add a **"Layout Mode"** dropdown alongside it with options: `Classic (3-column)` and `Desktop Split`. The desktop split layout will be the **default** for new installations. Existing users keep their saved preference.

> [!IMPORTANT]
> **Content Viewer Tab Modes**: Two modes selectable in the viewer's header:
> - **Single Tab** (default) — viewer is bound to the **first active chat session**. All content from that session's agent opens in one shared viewer pane. New content replaces old. When switching from single→multi-tab, the viewer's content history is preserved and fanned out into per-agent tabs. When loading a new session, the viewer re-binds to that session's active chat, maintaining cross-session consistency.
> - **Multi-Tab** — each agent gets its own viewer tab. Tabs are closeable individually. When switching from multi→single-tab, the currently focused tab's content is shown.

> [!WARNING]
> **Breaking Change for Skins**: Skins that override `.widget-panel` or the 3-column grid will need a compatibility update. I'll add a `data-layout-mode` attribute to `.app-container` so skins can target both modes. Existing skins will continue to work in Classic mode.

## Open Questions

> [!IMPORTANT]
> **Content Viewer as Parallel Chat**: You mentioned "content area can become parallel chat area." My proposal:
> - Add a small "Open Chat Here" button in the content viewer header. When clicked, it converts the viewer into a secondary chat pane (split chat mode). The user can pick which agent/session the secondary chat connects to via a dropdown.
> - A "Back to Viewer" button restores it. This keeps it simple — do you agree, or did you have a different interaction in mind?

> [!IMPORTANT]
> **Tab picker for content viewer**: My refined proposal:
> - When in **Multi-Tab** mode, each tab shows the source agent's icon + a content title (e.g. "📄 report.md" or "🌐 https://example.com").
> - Tabs are draggable for reordering and closeable with × buttons.
> - When the user switches chat tabs, the content viewer **auto-focuses** the tab belonging to that chat's agent (if it exists), but doesn't close other tabs.
> - In **Single Tab** mode, the viewer header shows a breadcrumb trail (Agent → content title).

> [!NOTE]
> **Avatar plugin placement**: I'll place it in the status bar, left of the calendar date. It will render inline at a small size (~32px), with click-to-expand behavior showing the full widget.

## Proposed Changes

### Phase 1 — Layout Mode System & Settings

#### [MODIFY] [index.html](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/index.html)
- Add `data-layout-mode` attribute to `.app-container` (values: `classic`, `desktop`)
- Add "Layout Mode" dropdown in the Settings tab (next to "Type Picker")
- Add the **Content Viewer panel** HTML structure inside `.app-container` (hidden by default in classic mode):
  ```html
  <div class="content-viewer-panel" id="content-viewer-panel">
    <div class="content-viewer-header">
      <div class="content-viewer-tabs" id="content-viewer-tabs"></div>
      <div class="content-viewer-controls">
        <select id="content-viewer-mode" class="compact-select">
          <option value="single">Single Tab</option>
          <option value="multi">Multi-Tab</option>
        </select>
        <button id="content-viewer-chat-toggle" class="icon-btn-sm" title="Open Chat Here">💬</button>
      </div>
    </div>
    <div class="content-viewer-body" id="content-viewer-body">
      <div class="content-viewer-empty">
        <span>No content open</span>
        <small>Click links in chat or agents will send content here</small>
      </div>
    </div>
  </div>
  ```
- Add a **resizable drag handle** div between chat and content viewer:
  ```html
  <div class="split-handle" id="split-handle" title="Drag to resize"></div>
  ```
- Add the **status bar** HTML at the bottom of `.app-container`:
  ```html
  <footer class="status-bar" id="status-bar">
    <div class="status-bar-left">
      <!-- sidebar footer buttons move here -->
    </div>
    <div class="status-bar-center">
      <div id="status-bar-avatar" class="status-bar-avatar"></div>
      <button id="status-bar-calendar" class="status-bar-calendar-btn">
        📅 <span id="status-bar-date">Calendar</span>
      </button>
    </div>
    <div class="status-bar-right">
      <!-- theme picker moves here -->
    </div>
  </footer>
  ```
- Move right-column widgets (plugins, sub-agents, workflows) HTML into left sidebar as new collapsible sections

#### [MODIFY] [app.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/app.js)
- Add `initializeLayoutMode()` method to App class
- Read/save `ui.layoutMode` from settings (default: `desktop`)
- Apply `data-layout-mode` attribute based on setting
- Initialize split-pane drag behavior
- Move theme picker initialization to work in both locations (right panel in classic, status bar in desktop split mode)
- Initialize the content viewer component

---

### Phase 2 - CSS Layout System for Desktop Split Mode

#### [NEW] [layout-desktop-split.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/layout/layout-desktop-split.css)
New CSS file for the desktop split layout mode, scoped under `[data-layout-mode="desktop"]`:
- 2-column grid: `sidebar | main-area`
- Main area uses flexbox with resizable chat + content viewer
- Split handle styling (4px drag bar)
- Status bar fixed at bottom (24-28px height)
- Content viewer panel styles
- Content viewer tab bar styles
- Content viewer body (iframe/rendered content area)
- Empty state styling
- Animation for panel open/close

#### [NEW] [layout-statusbar.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/layout/layout-statusbar.css)
- Status bar base styles
- Avatar inline widget in status bar
- Calendar button in status bar
- Theme picker compact mode for status bar
- Responsive breakpoints

#### [MODIFY] [layout-core.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/layout/layout-core.css)
- Wrap existing 3-column grid in `[data-layout-mode="classic"]` scope
- Keep all existing styles working for classic mode

#### [MODIFY] [layout-sidebar.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/layout/layout-sidebar.css)
- Add styles for relocated widgets (plugins, sub-agents, workflows) in sidebar
- These widgets reuse the same `.collapsible-section` / `.sidebar-agent-block` pattern as the existing Agents section
- Scope right-panel collapse styles under `[data-layout-mode="classic"]`

#### [MODIFY] [layout.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/layout.css)
- Add imports for `layout-desktop-split.css` and `layout-statusbar.css`

---

### Phase 3 — Content Viewer Component

#### [NEW] [content-viewer.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/content-viewer.js)
Core content viewer component (~300-400 lines):

**ContentViewer class**:
- `constructor()` — init DOM refs, bind events, load mode preference
- `setMode(mode)` — switch between `single` and `multi` tab modes
- `openContent(content)` — open content in viewer. Content object: `{ type, title, url, html, text, sourceAgentId, sourceSessionId }`
- `openFile(filePath)` — load and display a local file (text, image, code with syntax highlighting)
- `openUrl(url)` — load HTTP content (rendered markdown/HTML or iframe)
- `openDocument(doc)` — display a structured document (from agent tool)
- `closeTab(tabId)` — close a specific tab (multi-tab mode)
- `switchTab(tabId)` — switch to a specific tab
- `autoFocusForAgent(agentId)` — auto-switch to tab belonging to agent
- `toggleChatMode()` — convert viewer to secondary chat pane
- `renderTabs()` — render tab bar UI
- `renderContent(content)` — render content body (with type detection)
- Content type renderers:
  - `renderMarkdown(text)` — markdown → HTML
  - `renderCode(text, language)` — syntax-highlighted code
  - `renderImage(url)` — image viewer with zoom
  - `renderHtml(html)` — sandboxed HTML display
  - `renderPlainText(text)` — plain text with line numbers
  - `renderUrl(url)` — iframe or fetched content

**Integration points**:
- Register as `window.contentViewer`
- Listen for `content-viewer:open` custom events (agents/tools fire these)
- Listen for `chat-tab-switched` to auto-focus viewer tabs
- Listen for click events on file/URL links in chat messages

---

### Phase 4 — Split Pane Resizer

#### [NEW] [split-pane.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/split-pane.js)
Drag handle for resizing chat vs. content viewer (~100 lines):
- `SplitPane` class
- Mouse/touch drag handlers
- Persist split ratio to localStorage
- Min/max constraints (chat min 30%, viewer min 20%)
- Double-click to reset to 50/50
- CSS custom property updates (`--chat-width`, `--viewer-width`)

---

### Phase 5 — Widget Migration (Right → Left Sidebar)

#### [MODIFY] [sidebar.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/sidebar.js)
- Add initialization for relocated widgets in left sidebar (plugins, sub-agents, workflows) when in desktop split mode
- Add collapsible behavior for these new sidebar sections
- Tools panel gets a "compact" toggle button that reduces it to a single-row icon grid (already partially exists with capability groups)

#### [MODIFY] [plugin-panel.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/plugin-panel.js)
- Adapt plugin rendering to work in both right panel (classic) and left sidebar (desktop split) containers
- Use the container's parent to determine styling

#### [MODIFY] [plugin-sidebar-widget.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/plugin-sidebar-widget.js)
- Update container targeting: in desktop split mode, plugin sidebar widgets render below the agent-related sidebar sections (or in the status bar for avatar)
- Avatar widget detection: if widget is the pixel-avatar, route it to `#status-bar-avatar` instead

#### [MODIFY] [workflow-widget.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/workflow-widget.js)
- Adapt to render in left sidebar collapsible section in desktop split mode

---

### Phase 6 — Status Bar & Calendar/Avatar Relocation

#### [MODIFY] [calendar.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/calendar.js)
- In desktop split mode, bind the status bar calendar button to open the calendar flyout
- Calendar flyout position changes: opens upward from the status bar
- Calendar dock element changes from right panel to status bar

#### [MODIFY] [plugins.css](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/styles/plugins.css)
- Add sidebar-variant styles for plugins widget when rendered in left sidebar

---

### Phase 7 — Chat Link Interception & Agent Content Tool

#### [MODIFY] [message-formatter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/message-formatter.js)
- Add click handler for file/URL links in chat messages
- When in desktop split mode, intercept link clicks and open in content viewer instead of external browser
- Add a small "open in viewer" icon next to links
- Fire `content-viewer:open` event with link details

#### [MODIFY] [main-panel.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/main-panel.js)
- Wire up the content viewer to agent tool results
- When an agent uses a hypothetical `display_content` tool, route the result to the content viewer
- Handle the "secondary chat" mode toggle

---

### Phase 8 — Settings & Persistence

#### [MODIFY] [app.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/app.js)
- Layout mode toggle in settings: saves `ui.layoutMode` to DB
- Content viewer mode persistence (single/multi-tab)
- Split pane ratio persistence
- Transition animation when switching layout modes

---

## Summary of New Files

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `styles/layout/layout-desktop-split.css` | Desktop split layout grid, split pane, content viewer styles | ~400 |
| `styles/layout/layout-statusbar.css` | Status bar styling | ~150 |
| `components/content-viewer.js` | Content viewer component | ~400 |
| `components/split-pane.js` | Resizable split pane handler | ~120 |
| `components/app-layout-mode.js` | Layout mode application and widget relocation helper | ~50 |
| `components/main-panel-content-viewer-links.js` | Chat link routing helper for Content Viewer targets | ~50 |

## Summary of Modified Files

| File | Changes |
|------|---------|
| `index.html` | Content viewer HTML, status bar, layout mode dropdown, widget relocation |
| `app.js` | Layout mode init, settings binding, split pane init |
| `sidebar.js` | Relocated widget init, collapsible behavior |
| `layout-core.css` | Scope classic layout under `data-layout-mode` |
| `layout-sidebar.css` | Sidebar widget styles, classic scoping |
| `layout.css` | New CSS imports |
| `plugins.css` | Sidebar variant styles |
| `plugin-panel.js` | Dual-container rendering |
| `plugin-sidebar-widget.js` | Avatar routing, container targeting |
| `workflow-widget.js` | Left sidebar rendering |
| `calendar.js` | Status bar binding |
| `message-formatter.js` | Link interception for content viewer |
| `main-panel.js` | Content viewer integration, agent tool routing |

## Verification Plan

### Manual Verification
1. **Classic Mode**: Toggle to classic layout in settings — everything works exactly as before
2. **Desktop Split Mode**: 
   - Left sidebar shows all sections (nav, agents, plugins, sub-agents, workflows, tools, history)
   - Content viewer appears to the right of chat with drag handle
   - Split pane resizes properly with min/max constraints
   - Status bar shows avatar, calendar, theme picker
3. **Content Viewer**:
   - Click a file link in chat → opens in viewer
   - Click a URL in chat → opens in viewer (with external link fallback)
   - Switch between single/multi-tab modes
   - Multi-tab: tabs appear per agent with proper icons
4. **Visual Skins**: Verify at least Default and 2-3 other skins work in both modes
5. **Responsiveness**: Window resize maintains proper proportions
