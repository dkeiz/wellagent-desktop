# Content Viewer UI Rework Walkthrough

We have successfully overhauled the LocalAgent Desktop UI, transitioning it from a 3-column classic grid to a 2-column desktop split layout as the default, while maintaining full backwards compatibility with the classic layout as a settings option.

## Changes Made

### 1. Avatar Redirection to Bottom Status Bar
- Modified [plugin-sidebar-widget.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/plugin-sidebar-widget.js) to dynamically mount the pixel-avatar widget (registered as `pixel-avatar-widget`) to the status bar container `#status-bar-avatar` when the layout mode is set to `desktop`.
- Included layout change detection inside `_render()` to auto-unmount and remount the widget into the correct container when the user switches between Classic and Desktop Split modes in Settings.

### 2. Dual-Control settings Flyout Support
- Updated `setupSettingsDock()`, `openSettingsFlyout()`, `closeSettingsFlyout()`, `handleSettingsPointerDown()`, and `handleSettingsKeyDown()` in [sidebar.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/sidebar.js).
- Enabled both the sidebar footer gear button (`#settings-dock`) and the status bar footer gear button (`#statusbar-settings-dock`) to trigger their respective settings flyouts. Clicking outside or hitting Escape closes the active flyout cleanly.

### 3. Keyboard Shortcuts & Statistics Integration
- Extended [shortcuts.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/shortcuts.js) to register click listeners for status bar buttons:
  - `#statusbar-show-shortcuts-btn` for showing the keyboard shortcuts modal.
  - `#statusbar-show-stats-btn` for displaying active statistics.

### 4. Link Interception in Chat
- Enhanced link rendering in [message-formatter.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/message-formatter.js) to append a compact inline "open in viewer" button (`.msg-open-in-viewer`) next to every valid link, and enabled local file link formatting by permitting the `file://` scheme in markdown sanitization.
- Updated event handling inside [main-panel.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/main-panel.js) to intercept clicks on `.msg-open-in-viewer` buttons or standard markdown anchor tags in desktop split mode, call `event.preventDefault()`, and request `window.contentViewer` to load the file or URL.

### 5. Agent Content Tool (`display_content`)
- Added the core `display_content` tool to the MCP registration registry in [register-core-tools.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/main/mcp/register-core-tools.js) allowing agents to send content (`markdown`, `code`, `image`, `html`, `text`, `url`, `file`, `document`) directly to the Content Viewer panel.
- Wired up a listener for `onToolUpdate` in [content-viewer.js](file:///c:/Users/dkeiz/Documents/qwen/antigravity/localagent/src/renderer/components/content-viewer.js) to intercept successful executions of the `display_content` tool and immediately load the structured payload inside the active tab.

## Review Fixes Applied

- Normalized Content Viewer payloads so `display_content` results using `content`, `text`, `html`, `url`, or `filePath` render correctly.
- Routed `file://` and local file targets through `openFile()` instead of iframe URL rendering, and exposed the existing `read-file` IPC as `readFileContent`.
- Sandboxed raw HTML content in an iframe `srcdoc` instead of injecting agent-provided HTML directly into the app DOM.
- Stopped mailto links from being intercepted by the Content Viewer.
- Fixed provider context usage display to use provider prompt tokens for context occupancy, not completion-inclusive total tokens.
- Split new helper logic into small files so `app.js` and `main-panel.js` stay below the 1000-line hard budget.
- Untracked `agentin/memory/comfyui_launch_scripts.txt` while keeping it locally, and broadened `.gitignore` for runtime memory artifacts.
- Added focused contract coverage for Content Viewer rendering, `display_content`, viewer link buttons, renderer script order, layout stylesheet imports, and MCP inventory.

## Verification

### Automated Tests
- `node tests/run-suite.js contracts` PASS: 143 contract items.
- `node tests/run-suite.js core` PASS: 149 items, including contracts plus quick mocked command tests.
- `node tests/run-suite.js skin` PASS: 8 skins validated, 21 skin/theme apply simulations passed.
- Line-budget contract passes; several large existing files remain above the soft warning threshold but under the 1000-line hard cap.

### Manual Verification
1. **Layout Switching**: Toggle between `Classic` and `Desktop Split` layouts in the application settings. Verify that widgets (Plugins, Sub-agents, Workflows) relocate to the left sidebar or right panel as expected, and the status bar appears/disappears accordingly.
2. **Bottom Status Bar Toggles**: Click the status bar's shortcuts (⌨️), stats (📊), settings (⚙️), and calendar (📅) buttons to verify modals and popups open cleanly.
3. **Chat Link Clicking**: Click any HTTP or local file path in the chat to open it inside the resizable split pane Content Viewer instead of spawning an external window.
4. **display_content Execution**: Instruct an agent to show a table or document to witness it load directly into a dedicated viewer tab next to your conversation.
