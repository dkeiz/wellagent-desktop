const fs = require('fs');
const net = require('net');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const fetchImpl = global.fetch
  ? (...args) => global.fetch(...args)
  : require('node-fetch');

function createMemoryDb(initialSettings = {}) {
  const settings = new Map(Object.entries(initialSettings));
  const credentials = new Map();
  return {
    async getSetting(key) { return settings.has(key) ? settings.get(key) : null; },
    getSettingSync(key) { return settings.has(key) ? settings.get(key) : null; },
    async saveSetting(key, value) { settings.set(key, String(value ?? '')); },
    async getCredential(key) { return credentials.has(key) ? credentials.get(key) : null; },
    async setCredential(key, value) { credentials.set(key, String(value ?? '')); },
    async deleteCredential(key) { credentials.delete(key); }
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeServerFrame(buffer) {
  if (buffer.length < 2) return null;
  let len = buffer[1] & 0x7F;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < 4) return null;
    len = buffer.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buffer.length < 10) return null;
    len = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + len) return null;
  return {
    payload: buffer.slice(offset, offset + len).toString('utf8'),
    totalLength: offset + len
  };
}

function connectWs({ host, port, ticket }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const key = crypto.randomBytes(16).toString('base64');
    let handshaken = false;
    let buffer = Buffer.alloc(0);
    const messages = [];

    socket.setTimeout(5000);
    socket.on('timeout', () => reject(new Error('WebSocket test client timed out')));
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write([
        `GET /companion/ws?ticket=${encodeURIComponent(ticket)} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaken) {
        const marker = buffer.indexOf('\r\n\r\n');
        if (marker < 0) return;
        const header = buffer.slice(0, marker).toString('utf8');
        if (!header.includes('101 Switching Protocols')) {
          reject(new Error(`WebSocket handshake failed: ${header}`));
          return;
        }
        handshaken = true;
        buffer = buffer.slice(marker + 4);
        resolve({
          close: () => socket.destroy(),
          messages,
          nextMessage: async (predicate, timeoutMs = 5000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              const found = messages.find(predicate);
              if (found) return found;
              await wait(25);
            }
            throw new Error('Timed out waiting for WebSocket message');
          }
        });
      }
      while (handshaken && buffer.length) {
        const frame = decodeServerFrame(buffer);
        if (!frame) break;
        buffer = buffer.slice(frame.totalLength);
        try {
          messages.push(JSON.parse(frame.payload));
        } catch (_) {}
      }
    });
  });
}

module.exports = {
  name: 'companion-web-updates-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const htmlSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'index.html'), 'utf8');
    const relaySource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-relay-channels.js'), 'utf8');
    const updatesSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'updates.js'), 'utf8');
    const activitySource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'activity.js'), 'utf8');
    const browserUiStateSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'ui-state.js'), 'utf8');
    const uiStateSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-ui-state.js'), 'utf8');
    const skinCaster = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-skin-caster.js'));
    const CompanionApiServer = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'));
    const CompanionAuth = require(path.join(rootDir, 'src', 'main', 'companion-auth.js'));
    const {
      attachCompanionRelays,
      configureCompanionServer
    } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'));

    assert.includes(htmlSource, '/companion/web/assets/activity.js', 'Expected web companion to load the activity surface');
    assert.includes(htmlSource, 'id="activity-list"', 'Expected web companion to expose an activity event list');
    assert.includes(htmlSource, 'id="permission-request-list"', 'Expected web companion to expose pending tool permissions');
    assert.includes(htmlSource, 'id="task-queue-list"', 'Expected web companion to expose task queue updates');
    for (const channel of ['task-queue-update', 'workflow-update', 'tool-permission-request', 'plugins:state-changed']) {
      assert.includes(relaySource, channel, `Expected companion relay list to include ${channel}`);
      assert.includes(updatesSource, channel, `Expected browser update router to handle ${channel}`);
    }
    assert.includes(updatesSource, 'payload.currentSessionId', 'Expected browser update router to react to backend currentSessionId changes');
    assert.includes(activitySource, 'app.client.listTaskQueue()', 'Expected browser activity panel to load actionable tasks through the typed companion API');
    assert.includes(activitySource, 'task-queue:approve', 'Expected browser activity panel to approve tasks');
    assert.includes(activitySource, 'app.client.updateTask(', 'Expected browser activity panel to update tasks through the typed companion API');
    assert.includes(uiStateSource, 'ui.skin.enabled', 'Expected companion UI state to read persisted skin enablement');
    assert.includes(uiStateSource, '/companion/skin-cast/', 'Expected companion UI state to expose cast skin CSS URLs');
    assert.includes(uiStateSource, 'ui.typeSize', 'Expected companion UI state to read persisted desktop type size');
    assert.includes(browserUiStateSource, "--type-base", 'Expected companion browser UI state to apply desktop type size');
    assert.includes(browserUiStateSource, "--type-scale", 'Expected companion browser UI state to apply desktop type scale');
    const castCss = skinCaster.castCompanionSkinCss('html[data-active-skin="x"] .messages-container, html[data-active-skin="x"] .message.assistant { color: red; }');
    assert.includes(castCss, '.message-list', 'Expected cast skin CSS to target companion message list');
    assert.includes(castCss, '.message-card.message-assistant', 'Expected cast skin CSS to target companion assistant messages');

    const calls = [];
    const app = {
      ui: { appShell: { hidden: false } },
      activeSessionId: 'session-active',
      changedSessionIds: new Set(),
      activity: {
        recordEvent: (type, payload) => calls.push(['record', type, payload]),
        addPermissionRequest: (payload) => calls.push(['permission', payload]),
        loadTaskQueue: async () => calls.push(['tasks'])
      },
      loadSessions: async () => calls.push(['sessions']),
      renderSessions: () => calls.push(['render-sessions']),
      loadMessages: async () => calls.push(['messages']),
      loadArtifacts: async () => calls.push(['artifacts']),
      loadAgents: async () => calls.push(['agents']),
      refreshSnapshot: async () => calls.push(['snapshot']),
      showToast: (message, type) => calls.push(['toast', message, type]),
      logout: () => calls.push(['logout'])
    };
    const context = { window: {}, Promise, String, Set };
    context.window.window = context.window;
    vm.runInNewContext(updatesSource, context, { filename: 'updates.js' });
    const handlers = context.window.LocalAgentCompanionUpdates.createUpdateHandlers(app);

    await handlers['conversation-update']({ sessionId: 'session-active' }, { type: 'conversation-update' });
    assert.equal(calls.some(entry => entry[0] === 'messages'), true, 'Expected active conversation updates to reload messages');
    calls.length = 0;
    await handlers['conversation-update']({ sessionId: 'session-other', currentSessionId: 'session-other' }, { type: 'conversation-update' });
    assert.equal(app.activeSessionId, 'session-other', 'Expected backend current session changes to retarget the browser companion session');
    assert.equal(calls.some(entry => entry[0] === 'messages'), true, 'Expected backend current session changes to reload current messages');
    calls.length = 0;
    await handlers['conversation-update']({ sessionId: 'session-third' }, { type: 'conversation-update' });
    assert.equal(app.changedSessionIds.has('session-third'), true, 'Expected inactive conversation updates to mark the changed session');
    assert.equal(calls.some(entry => entry[0] === 'messages'), false, 'Expected inactive conversation updates not to reload active messages');
    calls.length = 0;
    await handlers['tool-permission-request']({ toolName: 'search_web' }, { type: 'tool-permission-request' });
    assert.equal(calls.some(entry => entry[0] === 'permission'), true, 'Expected tool permission pushes to be shown in activity');
    await handlers['task-queue-update']({ reason: 'queued' }, { type: 'task-queue-update' });
    assert.equal(calls.some(entry => entry[0] === 'tasks'), true, 'Expected task queue pushes to reload actionable tasks');

    const db = createMemoryDb({
      'ui.theme': 'dark',
      'ui.skin.enabled': 'true',
      'ui.skin.id': 'design-a',
      'ui.skin.theme': 'dark',
      'ui.typeSize': '16'
    });
    const container = createContainer({ db });
    const auth = new CompanionAuth(db);
    const server = new CompanionApiServer({ host: '127.0.0.1', port: 8790 });
    server.port = 0;
    const windowManager = { send() { return true; } };
    configureCompanionServer({ companionServer: server, container, db, companionAuth: auth });
    attachCompanionRelays({ companionServer: server, eventBus: null, windowManager, getCompanionServer: () => server });

    let ws = null;
    try {
      await server.start();
      const address = server.server.address();
      const port = typeof address === 'object' && address ? address.port : 8790;
      const baseUrl = `http://127.0.0.1:${port}`;
      const pairing = auth.generatePairing('127.0.0.1', port);
      const pairResponse = await fetchImpl(`${baseUrl}/companion/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: pairing.code, deviceName: 'Update Browser', deviceId: 'updates-device', platform: 'web' })
      });
      const pairPayload = await pairResponse.json();
      const authResponse = await fetchImpl(`${baseUrl}/companion/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: pairPayload.sessionToken, deviceId: 'updates-device' })
      });
      const authPayload = await authResponse.json();
      const uiResponse = await fetchImpl(`${baseUrl}/companion/ui-state`);
      const uiPayload = await uiResponse.json();
      assert.equal(uiResponse.status, 200, 'Expected companion UI state to be public for pre-pairing auth screen styling');
      assert.equal(uiPayload.success, true, 'Expected companion UI state endpoint to succeed');
      assert.includes(uiPayload.ui.skin.skinHref, '/companion/skin-cast/design-a/skin.css', 'Expected UI state to point at cast skin CSS');
      assert.equal(uiPayload.ui.typeSize, 16, 'Expected UI state to expose desktop type size');
      const castResponse = await fetchImpl(`${baseUrl}${uiPayload.ui.skin.skinHref}`);
      const castPayload = await castResponse.text();
      assert.equal(castResponse.status, 200, 'Expected cast companion skin CSS to be served');
      assert.includes(castPayload, '.message-list', 'Expected served cast skin CSS to include companion selectors');
      ws = await connectWs({ host: '127.0.0.1', port, ticket: authPayload.wsTicket });
      await ws.nextMessage(message => message.type === 'heartbeat');

      windowManager.send('task-queue-update', { reason: 'contract' });
      const taskMessage = await ws.nextMessage(message => message.type === 'task-queue-update');
      assert.equal(taskMessage.payload.reason, 'contract', 'Expected task queue updates to reach paired browsers over WebSocket');

      windowManager.send('tool-permission-request', { toolName: 'search_web' });
      const permissionMessage = await ws.nextMessage(message => message.type === 'tool-permission-request');
      assert.equal(permissionMessage.payload.toolName, 'search_web', 'Expected tool permission requests to reach paired browsers');

      server._wsBroadcast({ type: 'permissions-update', payload: { deviceId: 'updates-device', permissions: { preset: 'chat-only' } } });
      const permissionsMessage = await ws.nextMessage(message => message.type === 'permissions-update');
      assert.equal(permissionsMessage.payload.deviceId, 'updates-device', 'Expected permission changes to target the paired browser');
    } finally {
      if (ws) ws.close();
      await server.stop();
    }
  }
};
