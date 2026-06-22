const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.scrollTop = 0;
    this.scrollHeight = 120;
  }

  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) child.remove();
    if (child.parentNode === this) {
      const currentIndex = this.children.indexOf(child);
      if (currentIndex >= 0) this.children.splice(currentIndex, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    if (child.parentNode && child.parentNode !== this) child.remove();
    if (child.parentNode === this) {
      const currentIndex = this.children.indexOf(child);
      if (currentIndex >= 0) this.children.splice(currentIndex, 1);
    }
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  querySelector(selector) {
    if (selector === '.message-source-chip') {
      return this.children.find(child => child.className === 'message-source-chip') || null;
    }
    return null;
  }
}

function loadScript(filePath, context) {
  const source = fs.readFileSync(filePath, 'utf8');
  vm.runInNewContext(source, context, { filename: filePath });
}

function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

module.exports = {
  name: 'chat-continuity-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const domHandlers = [];
    const intervalHandlers = [];
    const messages = new FakeElement('messages-container');
    const stopBtn = new FakeElement('stop-btn', 'button');
    const document = {
      getElementById(id) {
        if (id === 'messages-container') return messages;
        if (id === 'stop-btn') return stopBtn;
        return findById(messages, id);
      },
      createElement(tagName) {
        return new FakeElement('', tagName);
      },
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domHandlers.push(handler);
      }
    };

    const conversationListeners = [];
    let sentPayload = null;
    const savedSettings = [];
    const context = {
      console,
      document,
      setTimeout(fn) { fn(); return 1; },
      clearTimeout() {},
      setInterval(fn) { intervalHandlers.push(fn); return intervalHandlers.length; },
      clearInterval() {},
      window: null
    };
    context.window = context;
    context.window.document = document;
    context.window.requestAnimationFrame = (fn) => fn();
    context.window.electronAPI = {
      async sendMessage(message, sessionId) {
        sentPayload = { message, sessionId };
        return { content: 'ok' };
      },
      onConversationUpdate(callback) {
        conversationListeners.push(callback);
      },
      async loadChatSession() {
        return [];
      },
      async saveSetting(key, value) {
        savedSettings.push([key, value]);
      }
    };

    const shellPath = path.join(rootDir, 'src', 'renderer', 'components', 'renderer-shell.js');
    const continuityPath = path.join(rootDir, 'src', 'renderer', 'components', 'chat-continuity.js');
    loadScript(shellPath, context);

    let counter = 0;
    const panel = {
      activeTabId: 's1',
      isSending: false,
      chatTabs: new Map([['s1', { hasChanges: false, needsReload: false, hasUnread: false, isSending: false }]]),
      addMessage(role, content) {
        const wrapper = new FakeElement('', 'div');
        wrapper.className = `message-wrapper ${role}`;
        const message = new FakeElement(`msg-${++counter}`, 'div');
        message.className = `message ${role}`;
        message.textContent = content;
        wrapper.appendChild(message);
        messages.appendChild(wrapper);
        return message.id;
      },
      autoTitleTab() { return Promise.resolve(); },
      renderTabs() {},
      saveCurrentTabMessages() {},
      calculateContextUsage() { return Promise.resolve(); },
      loadTabConversations() { return Promise.resolve(); },
      _storeActiveTabScrollState() {}
    };
    context.window.mainPanel = panel;
    context.window.localAgentRendererShell.initializeMainPanel(panel);
    context.window.localAgentRendererShell.installTabApi({
      loadTabConversations: async () => {},
      saveCurrentTabMessages() {}
    });

    loadScript(continuityPath, context);
    for (const handler of domHandlers) handler();
    for (const handler of intervalHandlers) handler();

    const messageId = panel.addMessage('user', 'hello', null, { sourceLabel: 'Companion', clientSource: 'mobile' });
    const renderedMessage = document.getElementById(messageId);
    assert.ok(renderedMessage.querySelector('.message-source-chip'), 'Expected continuity wrapper to decorate sourced user messages');
    assert.equal(renderedMessage.dataset.clientSource, 'mobile', 'Expected continuity wrapper to persist normalized source metadata');

    await context.window.electronAPI.sendMessage('hi', 's1');
    assert.deepEqual(sentPayload, { message: 'hi', sessionId: 's1' }, 'Expected send bridge wrapper to preserve original payload');
    assert.equal(panel.chatTabs.get('s1').hasChanges, true, 'Expected continuity layer to mark tab as changed on send');

    assert.equal(conversationListeners.length, 1, 'Expected continuity listener to subscribe to conversation updates');
    assert.equal(savedSettings.length, 0, 'Expected continuity wrapper not to mutate unrelated settings during install');
  }
};
