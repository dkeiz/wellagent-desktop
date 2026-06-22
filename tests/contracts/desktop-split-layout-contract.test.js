const fs = require('fs');
const path = require('path');

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) return '';
  return text.slice(startIndex, endIndex);
}

module.exports = {
  name: 'desktop-split-layout-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexHtml = read(rootDir, 'src/renderer/index.html');
    const layoutMode = read(rootDir, 'src/renderer/components/app-layout-mode.js');
    const splitPane = read(rootDir, 'src/renderer/components/split-pane.js');
    const desktopCss = read(rootDir, 'src/renderer/styles/layout/layout-desktop-split.css');
    const chatTabsCss = read(rootDir, 'src/renderer/styles/chat-tabs.css');
    const statusCss = read(rootDir, 'src/renderer/styles/layout/layout-statusbar.css');
    const capabilityJs = read(rootDir, 'src/renderer/components/capability-panel.js');
    const capabilityCss = read(rootDir, 'src/renderer/styles/capability-panel.css');
    const agentPickerJs = read(rootDir, 'src/renderer/components/agent-picker.js');
    const pluginPanelJs = read(rootDir, 'src/renderer/components/plugin-panel.js');
    const workflowWidgetJs = read(rootDir, 'src/renderer/components/workflow-widget.js');
    const pluginSidebarWidgetJs = read(rootDir, 'src/renderer/components/plugin-sidebar-widget.js');
    const widgetCss = read(rootDir, 'src/renderer/styles/layout/layout-widgets.css');

    assert.ok(!indexHtml.includes('IDE (Chat + Viewer)'), 'Layout setting must not expose the old broken label');
    assert.includes(indexHtml, '<option value="desktop">Desktop Split</option>', 'Desktop Split option should be visible');

    assert.includes(layoutMode, "const LEGACY_DESKTOP_ALIAS = 'ide';", 'Old saved setting should remain a legacy alias');
    assert.includes(layoutMode, "if (mode === LEGACY_DESKTOP_ALIAS || mode === DESKTOP_MODE) return DESKTOP_MODE;", 'Legacy saved mode must normalize to desktop');
    assert.includes(layoutMode, "await window.electronAPI?.saveSetting?.('ui.layoutMode', normalizedMode);", 'Layout migration writes should be awaited');
    assert.includes(layoutMode, "console.error('Failed to persist migrated layout mode:', error);", 'Layout migration write failures should be handled');
    assert.includes(layoutMode, "appContainer.setAttribute('data-layout-mode', normalizedMode);", 'DOM layout mode should use normalized value');

    assert.includes(splitPane, 'static DEFAULT_RATIO = 0.72;', 'Desktop split should default to 72 percent chat');
    assert.includes(splitPane, 'static MIN_CHAT = 0.62;', 'Split pane should reject viewer-heavy old ratios');
    assert.includes(splitPane, 'clamp(280px, ${viewerPercent}%, 420px)', 'Viewer width should be clamped to avoid giant gaps');
    assert.includes(desktopCss, '[data-layout-mode="desktop"] .content-viewer-panel', 'Desktop split stylesheet should target desktop mode');
    assert.ok(!desktopCss.includes('[data-layout-mode="ide"]'), 'Desktop split stylesheet should not keep active ide selectors');
    assert.includes(desktopCss, 'Split contract: chat, handle, and viewer must stay flush.', 'Desktop split should document the no-gap boundary contract');
    assert.includes(desktopCss, 'gap: 0;', 'Desktop split content panel must not introduce horizontal gaps');
    assert.includes(desktopCss, 'column-gap: 0;', 'Desktop split content panel must not introduce column gaps');
    assert.includes(desktopCss, 'padding: 0 0 1rem 1rem;', 'Chat pane top and right padding must remain zero against the top bar and split handle');
    assert.includes(desktopCss, '[data-layout-mode="desktop"] .split-handle', 'Split handle should be the only separator between chat and viewer');
    assert.includes(desktopCss, 'margin: 0;', 'Split boundary panes should not introduce margins');

    assert.includes(layoutMode, "agentPicker.parentElement.insertBefore(widgetStack, agentPicker.nextSibling);", 'Widgets should move directly after Agents');
    assert.includes(layoutMode, "agentPicker.parentElement.insertBefore(pluginSidebarWidgets, widgetStack.nextSibling);", 'Plugin sidebar widgets should stay under agent widgets');
    assert.includes(desktopCss, '[data-layout-mode="desktop"] .sidebar .nav-tabs > .widget-stack', 'Moved widgets need desktop sidebar styling');
    assert.includes(layoutMode, "const SIDEBAR_SECTION_STORAGE_PREFIX = 'ui.sidebarSection';", 'Left sidebar compact states should persist under one namespace');
    assert.includes(layoutMode, "{ id: 'agents', selector: '.agent-picker-widget' }", 'Agents should participate in desktop compact defaults');
    assert.includes(layoutMode, "{ id: 'subagents', selector: '.subagents-widget' }", 'Sub-agents should participate in desktop compact defaults');
    assert.includes(layoutMode, 'applySidebarCompaction(normalizedMode);', 'Layout apply should restore compact states');

    assert.includes(indexHtml, 'class="subagent-header-label"', 'Sub-agent header should have the same label/collapse structure as other widgets');
    assert.includes(indexHtml, 'id="toggle-subagents-widget"', 'Sub-agent header should remain wired');
    assert.includes(agentPickerJs, "setSidebarSectionCollapsed?.('subagents', collapsed)", 'Sub-agent collapse arrow should persist its state');
    assert.includes(agentPickerJs, "setSidebarSectionCollapsed?.('agents', collapsed)", 'Agent collapse arrow should persist its state');
    assert.includes(pluginPanelJs, "setSidebarSectionCollapsed?.('plugins', collapsed)", 'Plugins collapse arrow should persist its state');
    assert.includes(workflowWidgetJs, "setSidebarSectionCollapsed?.('workflows', collapsed)", 'Workflows collapse arrow should persist its state');
    assert.includes(pluginSidebarWidgetJs, "setSidebarSectionCollapsed?.(`pluginWidget.${widget.id}`, collapsed)", 'Dynamic plugin widget collapse should persist its state');
    assert.includes(pluginSidebarWidgetJs, 'if (targetContainer === this.container)', 'Status-bar routed plugin widgets should not be forced into sidebar compaction');
    assert.includes(widgetCss, '.subagents-widget .collapse-arrow', 'Sub-agent compact arrow should be styled');
    assert.includes(widgetCss, '.subagents-widget.collapsed .widget-content', 'Sub-agent compact state should hide content');
    assert.includes(desktopCss, '.plugin-sidebar-widget-item.collapsed .widget-content', 'Dynamic plugin widget compact state should hide content');

    assert.includes(indexHtml, 'id="tools-density-toggle"', 'Tools compact toggle should exist');
    assert.includes(capabilityJs, "this.toolsCompactStorageKey = 'ui.toolsCompact';", 'Tools compact preference should persist');
    assert.includes(capabilityJs, "return layoutMode === 'desktop';", 'Tools should default compact in desktop split mode');
    assert.includes(capabilityCss, '[data-layout-mode="desktop"] .capability-panel.tools-compact .capability-groups', 'Compact tools styles should exist');
    assert.includes(capabilityCss, 'grid-template-columns: repeat(6, minmax(0, 1fr));', 'Compact tools should render as a single icon row');
    assert.includes(chatTabsCss, '--top-tabbar-height: 34px;', 'Chat tabs should define the shared top tab bar height');
    assert.includes(chatTabsCss, '--top-tab-height: 26px;', 'Chat tabs should define the shared top tab height');
    assert.includes(chatTabsCss, 'min-height: var(--top-tab-height);', 'Chat tabs should consume the shared tab height');
    assert.includes(chatTabsCss, 'font-size: var(--top-tab-font-size);', 'Chat tabs should consume the shared tab font token');
    assert.includes(desktopCss, 'min-height: var(--top-tabbar-height);', 'Viewer header should consume the shared top tab bar height');
    assert.includes(desktopCss, '.content-viewer-tab', 'Content viewer tab styles should exist');
    assert.includes(desktopCss, 'font-size: var(--top-tab-font-size);', 'Content viewer tab text should share chat tab font source');
    assert.includes(desktopCss, 'min-height: var(--top-tab-height);', 'Content viewer tabs should share chat tab height source');
    const viewerSelectBlock = between(desktopCss, '.content-viewer-controls .compact-select {', '}');
    assert.includes(viewerSelectBlock, 'height: var(--top-tab-height);', 'Viewer mode select should match viewer tab height source');
    assert.includes(viewerSelectBlock, 'font-size: var(--top-tab-font-size);', 'Viewer mode select should match viewer tab text size source');
    assert.includes(viewerSelectBlock, 'line-height: 1;', 'Viewer mode select should align like tab text');

    const centerStatus = between(indexHtml, '<div class="status-bar-center">', '<div class="status-bar-right">');
    const rightStatus = between(indexHtml, '<div class="status-bar-right">', '</footer>');
    assert.ok(!centerStatus.includes('status-bar-calendar'), 'Calendar should not be centered in the status bar');
    assert.ok(!centerStatus.includes('status-bar-avatar'), 'Avatar should not be centered in the status bar');
    assert.includes(rightStatus, 'id="statusbar-theme-picker"', 'Theme controls should live in the right status bar cluster');
    assert.includes(rightStatus, 'id="status-bar-avatar"', 'Avatar should live in the right status bar cluster');
    assert.includes(rightStatus, 'id="status-bar-calendar"', 'Calendar should live in the right status bar cluster');
    assert.ok(
      rightStatus.indexOf('id="statusbar-theme-picker"') < rightStatus.indexOf('id="status-bar-avatar"'),
      'Theme controls should sit before avatar in the right status cluster'
    );
    assert.ok(
      rightStatus.indexOf('id="status-bar-avatar"') < rightStatus.indexOf('id="status-bar-calendar"'),
      'Calendar should be the rightmost status cluster control'
    );
    assert.includes(statusCss, '[data-layout-mode="desktop"] .calendar-flyout.from-statusbar', 'Calendar flyout should anchor from desktop status bar');
    assert.includes(statusCss, 'Calendar is the corner control; keep the flyout aligned to that edge.', 'Calendar flyout should document right-corner anchoring');

    assert.includes(statusCss, '.status-bar-right .theme-btn', 'Status bar theme button styles should exist');
    assert.includes(statusCss, 'flex: 0 0 auto;', 'Theme buttons should not stretch inside the status bar');
    assert.includes(statusCss, 'flex-direction: row;', 'Theme buttons should stay on one status line');
    assert.includes(statusCss, 'height: var(--control-h-sm);', 'Theme buttons should match status bar control height');
    assert.includes(statusCss, 'font-size: var(--text-xs);', 'Theme buttons should use type tokens');
    assert.includes(statusCss, 'text-transform: none;', 'Theme labels should not be forced uppercase');
    assert.includes(statusCss, 'letter-spacing: 0;', 'Theme labels should not use mismatched letter spacing');
  }
};
