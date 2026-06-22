const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScript(filePath, context) {
  const source = fs.readFileSync(filePath, 'utf8');
  vm.runInNewContext(source, context, { filename: filePath });
}

module.exports = {
  name: 'artifact-tab-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const domHandlers = [];
    const intervalHandlers = [];
    const button = {
      parentElement: { appendChild() {} },
      addEventListener() {},
      setAttribute() {},
      classList: { add() {}, remove() {}, toggle() {} },
      contains() { return false; },
      title: ''
    };
    const noopElement = {
      addEventListener() {},
      setAttribute() {},
      classList: { add() {}, remove() {}, toggle() {} },
      parentElement: null,
      contains() { return false; }
    };
    const document = {
      getElementById(id) {
        if (id === 'artifacts-btn') return button;
        if (id === 'chat-tabs-list') return { addEventListener() {} };
        return null;
      },
      querySelector() {
        return null;
      },
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domHandlers.push(handler);
      },
      createElement() {
        return {
          className: '',
          id: '',
          innerHTML: '',
          querySelector() { return noopElement; },
          appendChild() {},
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
        };
      }
    };

    const saveCalls = [];
    const notifications = [];
    const context = {
      console,
      document,
      setInterval(fn) { intervalHandlers.push(fn); return intervalHandlers.length; },
      clearInterval() {},
      window: null
    };
    context.window = context;
    context.window.document = document;
    context.window.electronAPI = {
      async saveSetting(key, value) {
        saveCalls.push([key, value]);
      },
      getSessionArtifacts: async () => ({ files: [] }),
      onConversationUpdate() {},
      onArtifactUpdate() {}
    };

    const shellPath = path.join(rootDir, 'src', 'renderer', 'components', 'renderer-shell.js');
    const artifactPath = path.join(rootDir, 'src', 'renderer', 'components', 'artifacts-button.js');
    loadScript(shellPath, context);

    const panel = {
      activeTabId: 'artifact:s1:file.txt',
      chatTabs: new Map([
        ['s1', {}],
        ['artifact:s1:file.txt', { isArtifactTab: true }]
      ]),
      showNotification(message, type) {
        notifications.push({ message, type });
      }
    };
    const tabApi = {
      saveCurrentTabMessages() {},
      async saveOpenTabIds() {},
      async switchTab() {},
      async closeTab() {}
    };

    context.window.mainPanel = panel;
    context.window.localAgentRendererShell.initializeMainPanel(panel);
    context.window.localAgentRendererShell.installTabApi(tabApi);
    loadScript(artifactPath, context);
    for (const handler of domHandlers) handler();
    for (const handler of intervalHandlers) handler();

    const saveWrapper = context.window.localAgentRendererShell.getTabApi().saveOpenTabIds;
    await saveWrapper(panel);
    assert.equal(saveCalls.length >= 1, true, 'Expected artifact wrapper to persist filtered open-tab state');
    assert.deepEqual(
      saveCalls[0],
      ['open_chat_tabs', JSON.stringify(['s1'])],
      'Expected artifact tabs to be excluded from persisted open-tab ids'
    );

    const sendWrapper = context.window.localAgentRendererShell.getMainPanel().sendMessage;
    const originalSend = async () => {
      throw new Error('send should have been blocked for artifact tabs');
    };
    panel.sendMessage = originalSend;
    context.window.localAgentRendererShell.initializeMainPanel(panel);
    await panel.sendMessage();
    assert.deepEqual(
      notifications[0],
      { message: 'Artifact tab is file-view mode. Switch to a chat tab to send messages.', type: 'info' },
      'Expected artifact tabs to block send and notify the user'
    );
  }
};
