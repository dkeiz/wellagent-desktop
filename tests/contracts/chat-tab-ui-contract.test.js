const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'chat-tab-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const html = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const api = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    const mainPanel = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel.js'), 'utf8');
    const tabRestore = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tab-restore.js'), 'utf8');
    const tabs = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tabs.js'), 'utf8');
    const continuity = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'chat-continuity.js'), 'utf8');
    const styles = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'chat-tabs.css'), 'utf8');

    assert.equal(html.includes('id="new-session-btn"'), false, 'Expected legacy New Chat button to be removed');
    assert.includes(html, '<div class="chat-tabs-strip">', 'Expected wrapper that keeps + next to the last tab');
    assert.includes(html, 'id="new-chat-btn" class="chat-tab-new"', 'Expected add-tab plus button in chat tab bar');
    assert.includes(html, 'components/main-panel-tab-restore.js', 'Expected restore helper to be loaded before tab shell wiring');
    assert.includes(api, 'clearChatSession: (sessionId)', 'Expected renderer API for clearing a specific chat session');
    assert.includes(tabs, 'async function clearTab(panel, sessionId)', 'Expected per-tab clear handler');
    assert.includes(tabs, 'clearBtn.className = \'chat-tab-reset\'', 'Expected dedicated clear icon on tabs');
    assert.includes(tabs, 'clearBtn.textContent = \'🖌\'', 'Expected brush-style clear icon on tabs');
    assert.includes(tabs, 'closeBtn.className = \'chat-tab-close\'', 'Expected existing close button to remain');
    assert.ok(
      tabs.indexOf('tabEl.appendChild(clearBtn);') < tabs.indexOf('tabEl.appendChild(statusDot);'),
      'Expected clear icon to render on the left edge before the tab status/label'
    );
    assert.includes(styles, '.chat-tabs-strip {', 'Expected strip layout styles for tabs plus icon');
    assert.includes(styles, '.chat-tab-reset,', 'Expected clear-button styling in chat tabs stylesheet');
    assert.includes(tabs, 'scheduleBottomRestore(panel, container)', 'Expected restored chat tabs to settle at bottom after startup layout');
    assert.includes(continuity, 'scheduleBottomRestore(panel, container)', 'Expected source-aware reloads to preserve startup bottom restore behavior');
    assert.includes(tabs, 'if (!deferredScrollStore)', 'Expected initial bottom restore not to save a false top scroll state');
    assert.includes(tabRestore, 'const currentSessionId = settings?.current_session_id', 'Expected tab restore to prefer DB current session over stale tab metadata');
    assert.includes(tabs, 'await saveOpenTabIds(panel);', 'Expected tab mutations to persist restore metadata before returning');
    assert.equal(
      /async function newChat\(panel\)[\s\S]*?return clearTab\(panel, panel\.activeTabId\);/.test(tabs),
      false,
      'Expected top-bar + to always create a new regular chat instead of resetting agent/subtask tabs'
    );
    assert.includes(api, 'getChatSessionMeta: (sessionId)', 'Expected renderer API for session metadata lookup');
    assert.includes(tabs, 'async function ensureTabAgentId(panel, sessionId, tab = null)', 'Expected tab actions to rehydrate missing agent context');
    assert.includes(tabs, 'const agentId = await resolveSessionAgentId(sessionId);', 'Expected restored tabs to use persisted session agent_id');
    assert.includes(mainPanel, '} else if (!this._suspendMessageAutoscroll) {', 'Expected bulk history loads not to store false top scroll state while appending messages');
    assert.includes(mainPanel, 'window.electronAPI.getContextUsageEstimate', 'Expected chat-load context badge to fall back to saved/local context calculation');
    assert.includes(mainPanel, '.then(async response =>', 'Expected send completion to recalculate context through the backend');
    assert.includes(mainPanel, 'await this.calculateContextUsage(sessionId);', 'Expected post-send context display to use full session calculation');
    assert.equal(mainPanel.includes('this.updateContextUsage(response);'), false, 'Expected direct provider response usage not to bypass full session context calculation');
    assert.includes(tabs, 'await panel.calculateContextUsage(tabKey);', 'Expected tab switches to recalculate full session context instead of trusting stale tab memory');
    assert.includes(mainPanel, "const source = response.source || usagePayload.source || (response.usage ? 'provider' : 'local');", 'Expected context badge to track provider/saved/local source');
    assert.includes(mainPanel, 'formatK(displayTokens)', 'Expected context badge to render provider prompt usage instead of total completion usage');
  }
};
