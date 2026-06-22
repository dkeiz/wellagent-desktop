const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = {
  name: 'chat-restore-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const helperSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tab-restore.js'), 'utf8');
    const source = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tabs.js'), 'utf8');
    const installed = {};
    const messagesContainer = { innerHTML: '', scrollTop: 0, scrollHeight: 120 };
    const state = {
      createdSessions: 0,
      loadedSessions: [],
      switchedSessions: [],
      contextSessions: [],
      savedSettings: [],
      notifications: []
    };

    const sandbox = {
      console,
      CustomEvent: function CustomEvent(type, init = {}) { this.type = type; this.detail = init.detail; },
      document: {
        getElementById(id) {
          if (id === 'messages-container') return messagesContainer;
          if (id === 'chat-tabs-list') return { innerHTML: '', appendChild() {} };
          return null;
        },
        createElement() {
          return {
            className: '',
            dataset: {},
            textContent: '',
            hidden: false,
            style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {},
            addEventListener() {},
            setAttribute() {}
          };
        },
        head: { appendChild() {} },
        dispatchEvent() {}
      },
      window: {
        requestAnimationFrame(fn) { fn(); },
        localAgentRendererShell: {
          installTabApi(api) { Object.assign(installed, api); },
          emit() {}
        },
        electronAPI: {
          async getSettings() {
            return {
              open_chat_tabs: '',
              active_chat_tab: '',
              current_session_id: '42'
            };
          },
          async getChatSessions() {
            return [{ id: 42, title: 'Recovered' }];
          },
          async getChatSessionMeta(sessionId) {
            return String(sessionId) === '42' ? { id: 42, title: 'Recovered', agent_id: null } : null;
          },
          async loadChatSession(sessionId) {
            state.loadedSessions.push(String(sessionId));
            if (String(sessionId) === '42') {
              return [{ role: 'user', content: 'Recovered hello' }];
            }
            return [];
          },
          async createChatSession() {
            state.createdSessions += 1;
            return { id: 1000 };
          },
          async switchChatSession(sessionId) {
            state.switchedSessions.push(String(sessionId));
            return { success: true, sessionId };
          },
          async saveSetting(key, value) {
            state.savedSettings.push([key, value]);
          },
          agents: {
            async get() { return null; }
          }
        }
      },
      setTimeout(fn) { fn(); return 1; }
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(helperSource, sandbox, { filename: 'main-panel-tab-restore.js' });
    vm.runInContext(source, sandbox, { filename: 'main-panel-tabs.js' });

    const panel = {
      chatTabs: new Map(),
      activeTabId: null,
      addMessage(role, content) {
        messagesContainer.innerHTML += `[${role}]${content}`;
      },
      async calculateContextUsage(sessionId) {
        state.contextSessions.push(String(sessionId));
      },
      updateContextUsage() {},
      showNotification(message) {
        state.notifications.push(message);
      },
      _storeActiveTabScrollState() {},
      _isNearBottom() { return true; }
    };

    await installed.restoreOpenTabs(panel);

    assert.equal(state.createdSessions, 0, 'Expected restore to reuse the current session instead of creating a blank chat');
    assert.deepEqual(state.loadedSessions, ['42', '42', '42'], 'Expected restore to load the recovered session for hydration, visible render, and auto-title');
    assert.deepEqual(state.switchedSessions, ['42', '42'], 'Expected restore to switch the backend to the recovered session');
    assert.deepEqual(state.contextSessions, ['42'], 'Expected restore to recalculate context for the recovered session');
    assert.equal(String(panel.activeTabId), '42', 'Expected recovered session to become the active tab');
    assert.ok(messagesContainer.innerHTML.includes('Recovered hello'), 'Expected recovered chat history to be rendered');
  }
};
