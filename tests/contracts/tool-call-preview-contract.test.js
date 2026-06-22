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
    this.checked = false;
    this.value = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) {
      child.remove();
    }
    if (child.parentNode === this) {
      const currentIndex = this.children.indexOf(child);
      if (currentIndex >= 0) {
        this.children.splice(currentIndex, 1);
      }
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (child.parentNode && child.parentNode !== this) {
      child.remove();
    }
    if (child.parentNode === this) {
      const currentIndex = this.children.indexOf(child);
      if (currentIndex >= 0) {
        this.children.splice(currentIndex, 1);
      }
    }
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  querySelector(selector) {
    if (selector === '.message-wrapper.assistant .message.loading') {
      return null;
    }
    return null;
  }

  closest() {
    return this.parentNode;
  }
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

function createContext(rootDir) {
  const domContentLoadedHandlers = [];
  const messagesContainer = new FakeElement('messages-container');
  messagesContainer.scrollTop = 0;
  messagesContainer.scrollHeight = 120;
  const checkbox = new FakeElement('show-tool-calls', 'input');
  checkbox.checked = true;

  const document = {
    body: new FakeElement('body', 'body'),
    getElementById(id) {
      if (id === 'messages-container') return messagesContainer;
      if (id === 'show-tool-calls') return checkbox;
      return findById(messagesContainer, id) || null;
    },
    createElement(tagName) {
      return new FakeElement('', tagName);
    },
    addEventListener(type, handler) {
      if (type === 'DOMContentLoaded') {
        domContentLoadedHandlers.push(handler);
      }
    },
    removeEventListener() {}
  };

  const localStorage = new Map();
  const toolPreviewListeners = [];

  const context = {
    console,
    document,
    localStorage: {
      getItem(key) {
        return localStorage.has(key) ? localStorage.get(key) : null;
      },
      setItem(key, value) {
        localStorage.set(key, String(value));
      }
    },
    window: null
  };

  context.window = context;
  context.window.document = document;
  context.window.localStorage = context.localStorage;
  context.window.electronAPI = {
    onToolPreviewUpdate(callback) {
      toolPreviewListeners.push(callback);
    },
    getSettings() {
      return Promise.resolve({ 'ui.showToolCalls': 'true' });
    },
    saveSetting() {
      return Promise.resolve();
    }
  };

  const shellSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'renderer-shell.js'), 'utf8');
  const previewSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'tool-call-preview.js'), 'utf8');
  vm.runInNewContext(shellSource, context, { filename: 'renderer-shell.js' });

  const panel = {
    activeTabId: 'chat-1',
    addMessage(role, content) {
      const wrapper = new FakeElement('', 'div');
      wrapper.className = `message-wrapper ${role}`;
      const message = new FakeElement('', 'div');
      message.className = `message ${role}${content === '...' ? ' loading' : ''}`;
      wrapper.appendChild(message);
      messagesContainer.appendChild(wrapper);
      return `${role}:${content}`;
    }
  };

  context.window.localAgentRendererShell.initializeMainPanel(panel);
  vm.runInNewContext(previewSource, context, { filename: 'tool-call-preview.js' });
  for (const handler of domContentLoadedHandlers) {
    handler();
  }

  return { context, messagesContainer, panel, toolPreviewListeners };
}

module.exports = {
  name: 'tool-call-preview-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const { messagesContainer, panel, toolPreviewListeners } = createContext(rootDir);
    assert.equal(toolPreviewListeners.length, 1, 'Expected tool preview listener to be installed');

    toolPreviewListeners[0](null, {
      sessionId: 'chat-1',
      toolCallId: 'call-1',
      toolName: 'run_command',
      params: { command: 'echo ok' },
      status: 'queued'
    });

    let previewRoot = findById(messagesContainer, 'tool-call-preview');
    assert.ok(previewRoot, 'Expected queued tool preview to render');

    toolPreviewListeners[0](null, {
      sessionId: 'chat-1',
      toolCallId: 'call-1',
      toolName: 'run_command',
      params: { command: 'echo ok' },
      result: 'ok',
      status: 'success'
    });

    previewRoot = findById(messagesContainer, 'tool-call-preview');
    assert.ok(previewRoot, 'Expected completed tool preview to remain visible before assistant message');

    panel.addMessage('assistant', 'Tool finished');
    previewRoot = findById(messagesContainer, 'tool-call-preview');
    assert.equal(previewRoot, null, 'Expected assistant message to hide tool preview after execution');
  }
};
