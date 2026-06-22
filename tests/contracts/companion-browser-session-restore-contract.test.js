const path = require('path');
const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');

const fetchImpl = global.fetch
  ? (...args) => global.fetch(...args)
  : require('node-fetch');

function createMemoryDb(initialSettings = {}) {
  const settings = new Map(Object.entries(initialSettings));
  const credentials = new Map();
  return {
    async getSetting(key) {
      return settings.has(key) ? settings.get(key) : null;
    },
    getSettingSync(key) {
      return settings.has(key) ? settings.get(key) : null;
    },
    async saveSetting(key, value) {
      settings.set(key, String(value ?? ''));
    },
    async getCredential(key) {
      return credentials.has(key) ? credentials.get(key) : null;
    },
    async setCredential(key, value) {
      credentials.set(key, String(value ?? ''));
    },
    async deleteCredential(key) {
      credentials.delete(key);
    }
  };
}

function createContainer(services = {}) {
  const store = new Map(Object.entries(services));
  return {
    get(key) {
      if (!store.has(key)) throw new Error(`Missing test service: ${key}`);
      return store.get(key);
    },
    optional(key) {
      return store.has(key) ? store.get(key) : null;
    },
    replace(key, value) {
      store.set(key, value);
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(String(token)));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(String(token)));
    },
    toggle(token, force) {
      const key = String(token);
      if (force === true) {
        values.add(key);
        return true;
      }
      if (force === false) {
        values.delete(key);
        return false;
      }
      if (values.has(key)) {
        values.delete(key);
        return false;
      }
      values.add(key);
      return true;
    },
    contains(token) {
      return values.has(String(token));
    }
  };
}

function createDatasetNodes(documentRef, html, selector) {
  const matchers = {
    '[data-group-id]': ['groupId', /data-group-id="([^"]+)"/g],
    '[data-session-id]': ['sessionId', /data-session-id="([^"]+)"/g],
    '[data-speak-index]': ['speakIndex', /data-speak-index="([^"]+)"/g],
    '[data-agent-id]': ['agentId', /data-agent-id="([^"]+)"/g],
    '[data-artifact-name]': ['artifactName', /data-artifact-name="([^"]+)"/g]
  };
  const entry = matchers[selector];
  if (!entry) return [];
  const [datasetKey, regex] = entry;
  const nodes = [];
  let match = regex.exec(String(html || ''));
  while (match) {
    const node = createFakeElement(documentRef, 'button');
    node.dataset[datasetKey] = match[1];
    nodes.push(node);
    match = regex.exec(String(html || ''));
  }
  return nodes;
}

function createFakeElement(documentRef, tagName = 'div', id = '') {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    id,
    tagName: String(tagName || 'div').toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    files: [],
    dataset: {},
    className: '',
    scrollTop: 0,
    scrollHeight: 120,
    parentElement: null,
    children: [],
    style: {
      setProperty(name, value) {
        this[name] = String(value);
      }
    },
    classList: createClassList(),
    addEventListener(type, handler) {
      const key = String(type);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type);
      if (!listeners.has(key)) return;
      listeners.set(key, listeners.get(key).filter((entry) => entry !== handler));
    },
    dispatchEvent(event) {
      const handlers = listeners.get(String(event && event.type)) || [];
      handlers.forEach((handler) => handler(event));
    },
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      if (child.id) documentRef._register(child);
      return child;
    },
    insertBefore(child) {
      return this.appendChild(child);
    },
    remove() {
      this.removed = true;
      if (this.id) documentRef._unregister(this.id);
    },
    setAttribute(name, value) {
      const key = String(name);
      const text = String(value);
      attributes.set(key, text);
      if (key === 'id') {
        this.id = text;
        documentRef._register(this);
      }
      if (key.startsWith('data-')) {
        const datasetKey = key
          .slice(5)
          .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[datasetKey] = text;
      }
    },
    getAttribute(name) {
      return attributes.has(String(name)) ? attributes.get(String(name)) : null;
    },
    removeAttribute(name) {
      attributes.delete(String(name));
    },
    querySelectorAll(selector) {
      return createDatasetNodes(documentRef, this.innerHTML, selector);
    },
    focus() {
      this.focused = true;
    },
    click() {},
    contains(node) {
      return this === node || this.children.includes(node);
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    }
  };
  if (id) {
    attributes.set('id', id);
  }
  return element;
}

function createFakeDocument() {
  const nodes = new Map();
  const documentRef = {
    hidden: false,
    documentElement: {
      attributes: new Map(),
      style: {
        setProperty(name, value) {
          this[name] = String(value);
        }
      },
      setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
      },
      getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
      }
    },
    _register(element) {
      if (element && element.id) nodes.set(String(element.id), element);
    },
    _unregister(id) {
      nodes.delete(String(id));
    },
    getElementById(id) {
      const key = String(id);
      if (!nodes.has(key)) {
        nodes.set(key, createFakeElement(documentRef, key === 'artifact-dialog' ? 'dialog' : 'div', key));
      }
      return nodes.get(key);
    },
    createElement(tagName) {
      return createFakeElement(documentRef, tagName);
    },
    head: null
  };
  documentRef.head = createFakeElement(documentRef, 'head', 'document-head');
  return documentRef;
}

function createBrowserContext({ baseUrl, storage }) {
  const document = createFakeDocument();
  const windowListeners = new Map();
  const location = new URL(baseUrl);
  const windowObject = {
    console,
    document,
    location: {
      origin: location.origin,
      protocol: location.protocol,
      host: location.host,
      search: ''
    },
    navigator: {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
    },
    localStorage: storage,
    URL,
    URLSearchParams,
    fetch: fetchImpl,
    Promise,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Set,
    Map,
    Object,
    RegExp,
    JSON,
    crypto: {
      getRandomValues(array) {
        return nodeCrypto.randomFillSync(array);
      }
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        removeEventListener() {}
      };
    },
    addEventListener(type, handler) {
      const key = String(type);
      if (!windowListeners.has(key)) windowListeners.set(key, []);
      windowListeners.get(key).push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type);
      if (!windowListeners.has(key)) return;
      windowListeners.set(key, windowListeners.get(key).filter((entry) => entry !== handler));
    },
    dispatchWindowEvent(type, payload = {}) {
      const handlers = windowListeners.get(String(type)) || [];
      handlers.forEach((handler) => handler({ type, ...payload }));
    },
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    WebSocket: class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1;
          if (typeof this.onopen === 'function') this.onopen();
        }, 0);
      }

      close() {
        this.readyState = 3;
        if (typeof this.onclose === 'function') this.onclose();
      }
    },
    LocalAgentCompanionUtils: {
      escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
      formatBytes(size) {
        return `${Number(size || 0)} B`;
      },
      formatDateTime(value) {
        return value ? String(value) : '-';
      },
      formatGroupLabel(value) {
        return String(value || '');
      }
    },
    LocalAgentCompanionMessageRenderer: {
      renderMessage(_role, content) {
        return String(content || '');
      }
    },
    LocalAgentCompanionUiState: {
      apply() {}
    },
    LocalAgentCompanionUpdates: {
      createUpdateHandlers() {
        return {};
      },
      async resyncAfterReconnect() {}
    },
    LocalAgentCompanionActivity: {
      createActivityController() {
        return {
          async loadTaskQueue() {},
          recordEvent() {},
          addPermissionRequest() {}
        };
      }
    }
  };
  windowObject.window = windowObject;
  windowObject.globalThis = windowObject;
  windowObject.global = windowObject;
  return windowObject;
}

async function bootBrowserCompanion({ rootDir, baseUrl, storage }) {
  const clientSource = fs.readFileSync(
    path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app.js'),
    'utf8'
  );
  const context = createBrowserContext({ baseUrl, storage });
  vm.runInNewContext(clientSource, context, { filename: 'client.js' });
  vm.runInNewContext(appSource, context, { filename: 'app.js' });
  context.dispatchWindowEvent('DOMContentLoaded');
  await waitFor(
    () => {
      const app = context.localAgentCompanionApp;
      return Boolean(app && app.ui && app.ui.appShell.hidden === false && app.messages.length >= 1);
    },
    5000,
    'browser companion auto-restore'
  );
  return { context, app: context.localAgentCompanionApp };
}

module.exports = {
  name: 'companion-browser-session-restore-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const CompanionApiServer = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'));
    const CompanionAuth = require(path.join(rootDir, 'src', 'main', 'companion-auth.js'));
    const {
      attachCompanionRelays,
      configureCompanionServer
    } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'));

    const sessions = [
      {
        id: 'session-first',
        title: 'First Listed Session',
        created_at: '2026-06-10T09:00:00.000Z',
        first_message: 'First listed preview'
      },
      {
        id: 'session-current',
        title: 'Backend Current Session',
        created_at: '2026-06-11T10:00:00.000Z',
        first_message: 'Current preview'
      }
    ];
    let currentSessionId = 'session-current';
    const conversationMap = new Map([
      ['session-first', [
        { role: 'user', content: 'first listed user message', timestamp: '2026-06-10T09:01:00.000Z' },
        { role: 'assistant', content: 'first listed assistant reply', timestamp: '2026-06-10T09:01:05.000Z' }
      ]],
      ['session-current', [
        { role: 'user', content: 'current session user message', timestamp: '2026-06-11T10:01:00.000Z' },
        { role: 'assistant', content: 'current session assistant reply', timestamp: '2026-06-11T10:01:05.000Z' }
      ]]
    ]);
    const db = Object.assign(createMemoryDb({
      'ui.theme': 'light'
    }), {
      async getChatSessions(_agentId, limit = 20) {
        return sessions.slice(0, Number(limit) || 20);
      },
      async getCurrentSession() {
        return sessions.find((session) => session.id === currentSessionId) || null;
      },
      async setCurrentSession(sessionId) {
        currentSessionId = String(sessionId || '').trim() || currentSessionId;
      },
      async getConversations(limit = 80, sessionId = null) {
        const sid = String(sessionId || '').trim();
        return (conversationMap.get(sid) || []).slice(0, Number(limit) || 80);
      },
      async createChatSession() {
        throw new Error('createChatSession should not be used during restore');
      },
      async clearChatSession() {
        return { success: true };
      }
    });
    const container = createContainer({
      db,
      capabilityManager: {
        getState: () => ({ mainEnabled: true, groups: { web: true }, activeToolCount: 1 })
      },
      agentManager: {
        getAgents: async () => [{ id: 1, name: 'Companion Agent', type: 'assistant', active: true }]
      },
      memoryDaemon: {
        getStatus: () => ({ running: false })
      },
      workflowScheduler: {
        getStatus: () => ({ running: false })
      }
    });
    const auth = new CompanionAuth(db);
    const windowManager = { send() { return true; } };
    const server = new CompanionApiServer({ host: '127.0.0.1', port: 8790 });
    server.port = 0;
    configureCompanionServer({ companionServer: server, container, db, companionAuth: auth });
    attachCompanionRelays({ companionServer: server, eventBus: null, windowManager, getCompanionServer: () => server });

    try {
      await server.start();
      const address = server.server.address();
      const port = typeof address === 'object' && address ? address.port : 8790;
      const baseUrl = `http://127.0.0.1:${port}`;
      const pairing = auth.generatePairing('127.0.0.1', port);
      const deviceId = 'browser-session-restore-device';

      const pairResponse = await fetchImpl(`${baseUrl}/companion/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: pairing.code,
          deviceName: 'Chrome on Windows',
          deviceId,
          platform: 'desktop-web',
          appVersion: '0.1.0-beta.1'
        })
      });
      const pairPayload = await pairResponse.json();
      assert.equal(pairResponse.status, 200, 'Expected pairing to succeed before restore');
      assert.equal(pairPayload.success, true, 'Expected pairing payload to succeed before restore');
      assert.ok(pairPayload.sessionToken, 'Expected pairing to return a durable session token');

      const storage = createStorage({
        companion_session_token: String(pairPayload.sessionToken),
        companion_device: deviceId,
        companion_device_name: 'Chrome on Windows'
      });
      const { app } = await bootBrowserCompanion({ rootDir, baseUrl, storage });

      assert.equal(app.ui.appShell.hidden, false, 'Expected auto-login restore to show the browser companion shell');
      assert.equal(app.sessions[0]?.id, 'session-first', 'Expected the first listed session to differ from the backend current session');
      assert.equal(app.activeSessionId, 'session-current', 'Expected restore to honor backend currentSessionId instead of first session order');
      assert.equal(app.ui.activeSessionTitle.textContent, 'Backend Current Session', 'Expected restored UI title to match the backend current session');
      assert.deepEqual(
        app.messages.map((message) => message.content),
        ['current session user message', 'current session assistant reply'],
        'Expected restored browser messages to come from the backend current session'
      );
      assert.equal(
        app.messages.some((message) => String(message.content || '').includes('first listed')),
        false,
        'Expected restore not to hydrate messages from the first listed session'
      );
    } finally {
      await server.stop();
    }
  }
};
