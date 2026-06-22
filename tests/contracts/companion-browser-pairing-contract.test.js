const fs = require('fs');
const path = require('path');

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

module.exports = {
  name: 'companion-browser-pairing-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const htmlSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'index.html'), 'utf8');
    const clientSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app.js'), 'utf8');
    const continuitySource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'chat-continuity.js'), 'utf8');
    const rendererAppSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'app.js'), 'utf8');
    const rendererHtmlSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const networkSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion-network-utils.js'), 'utf8');
    const ipcSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-agent-system-handlers.js'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'bootstrap.js'), 'utf8');
    const CompanionApiServer = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'));
    const CompanionAuth = require(path.join(rootDir, 'src', 'main', 'companion-auth.js'));
    const {
      attachCompanionRelays,
      configureCompanionServer
    } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'));
    const sentMessages = [];

    assert.ok(!htmlSource.includes('<span>Device name</span>'), 'Expected browser companion pairing UI to stop exposing a manual device-name field');
    assert.includes(htmlSource, 'named automatically after pairing', 'Expected browser pairing UI to explain automatic device naming');
    assert.includes(clientSource, 'buildDefaultDeviceName()', 'Expected browser companion client to generate a readable default device name');
    assert.includes(appSource, 'resolveDeviceName()', 'Expected browser companion app to resolve device identity without a visible form field');
    assert.includes(appSource, 'ensureActiveSession()', 'Expected browser companion app to ensure an initial session exists after pairing');
    assert.includes(appSource, 'this.client.createChatSession()', 'Expected browser companion app to create the initial session through the companion chat API');
    assert.includes(appSource, 'response.currentSessionId || response.currentSession?.id', 'Expected browser companion restore to prefer backend currentSessionId over list order');
    assert.ok(!clientSource.includes("'/companion/ipc'"), 'Expected browser companion client to use typed companion HTTP routes instead of generic IPC');
    assert.includes(appSource, 'message-origin', 'Expected the browser companion UI to label cross-surface user messages');
    assert.includes(appSource, 'ensurePolling()', 'Expected the browser companion app to keep a lightweight refresh fallback');
    assert.includes(continuitySource, 'loadTabConversations?.(sessionId)', 'Expected desktop chat continuity to actively reload the current tab after remote conversation updates');
    assert.includes(continuitySource, 'message-source-chip', 'Expected desktop chat continuity to decorate companion-originated messages');
    assert.includes(rendererAppSource, 'preferredBrowserUrl', 'Expected desktop settings to keep a single preferred companion URL');
    assert.ok(!rendererHtmlSource.includes('companion-url-list'), 'Expected desktop settings to avoid exposing multiple companion URLs');
    assert.includes(networkSource, 'scoreInterface', 'Expected companion links to prefer real Wi-Fi/LAN interfaces over virtual adapters');
    assert.includes(networkSource, 'resolveEasyConnectHost', 'Expected easy connect to convert localhost binding into LAN-safe binding');
    assert.includes(networkSource, "isLoopbackHost(host) ? '0.0.0.0'", 'Expected easy connect to avoid localhost-only phone links');
    assert.includes(ipcSource, "const host = resolveEasyConnectHost(options.host || '0.0.0.0')", 'Expected enabling companion access to bind localhost inputs to a phone-reachable host');
    assert.includes(ipcSource, "runtime.container.replace('companionServer', companionServer)", 'Expected companion enable to recover when bootstrap registered a null companion server');
    assert.ok(
      ipcSource.indexOf('await companionServer.start()') < ipcSource.indexOf("await db.saveSetting('companion.enabled', 'true')"),
      'Expected companion enablement to persist only after the server starts'
    );
    assert.includes(ipcSource, "await db.saveSetting('companion.enabled', 'false')", 'Expected failed companion startup to avoid leaving access marked enabled');
    assert.includes(bootstrapSource, 'resolveEasyConnectHost(await db.getSetting', 'Expected app startup to normalize old localhost companion bindings');
    assert.includes(rendererAppSource, 'companion.generatePairing()', 'Expected desktop pairing button to rely on backend easy-connect pairing');
    assert.includes(fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion-auth.js'), 'utf8'), '30 * 60 * 1000', 'Expected pairing codes to last long enough for mobile certificate setup');

    const sessions = [{
      id: 'session-1',
      title: 'Companion Chat',
      created_at: '2026-05-12T00:00:00.000Z',
      first_message: 'Companion Chat'
    }];
    const conversations = [];
    let currentSessionId = 'session-1';
    const db = Object.assign(createMemoryDb(), {
      async getChatSessions(_agentId, limit = 20) {
        return sessions.slice(0, Number(limit) || 20);
      },
      async createChatSession() {
        const session = {
          id: `session-${sessions.length + 1}`,
          title: 'New Companion Chat',
          created_at: new Date().toISOString(),
          first_message: ''
        };
        sessions.unshift(session);
        currentSessionId = session.id;
        return session;
      },
      async getCurrentSession() {
        return sessions.find(session => session.id === currentSessionId) || null;
      },
      async setCurrentSession(sessionId) {
        currentSessionId = sessionId;
      },
      async getConversations(limit = 20, sessionId = null) {
        return conversations
          .filter(entry => !sessionId || entry.sessionId === sessionId)
          .slice(-Number(limit || 20));
      },
      async addConversation(entry, sessionId) {
        conversations.push({ ...entry, sessionId });
      },
      async clearChatSession(sessionId) {
        for (let i = conversations.length - 1; i >= 0; i -= 1) {
          if (conversations[i].sessionId === sessionId) conversations.splice(i, 1);
        }
      }
    });
    const container = createContainer({
      db,
      dispatcher: {
        async dispatch(message, history, context) {
          sentMessages.push({ message, history, context });
          return { content: 'sent' };
        }
      },
      capabilityManager: { getState: () => ({ mainEnabled: true, groups: { web: true }, activeToolCount: 1 }) },
      agentManager: { getAgents: async () => [{ id: 1, name: 'Companion Agent', type: 'assistant', active: true }] },
      memoryDaemon: { getStatus: () => ({ running: false }) },
      workflowScheduler: { getStatus: () => ({ running: false }) }
    });
    const auth = new CompanionAuth(db);
    const desktopRelayMessages = [];
    const windowManager = {
      send(channel, payload) {
        desktopRelayMessages.push({ channel, payload });
        return true;
      }
    };

    const server = new CompanionApiServer({ host: '127.0.0.1', port: 8790 });
    server.port = 0;
    configureCompanionServer({ companionServer: server, container, db, companionAuth: auth });
    attachCompanionRelays({ companionServer: server, eventBus: null, windowManager, getCompanionServer: () => server });
    const relayedWsMessages = [];
    server._wsBroadcast = (message) => {
      relayedWsMessages.push(message);
    };

    windowManager.send('conversation-update', { sessionId: 'session-1' });
    assert.equal(relayedWsMessages.some((entry) => entry?.type === 'conversation-update' && entry?.payload?.sessionId === 'session-1'), true, 'Expected renderer conversation updates to be mirrored into companion WebSocket broadcasts');

    try {
      await server.start();
      const address = server.server.address();
      const port = typeof address === 'object' && address ? address.port : 8790;
      const baseUrl = `http://127.0.0.1:${port}`;

      const failingServer = new CompanionApiServer({ host: '127.0.0.1', port });
      configureCompanionServer({ companionServer: failingServer, container, db, companionAuth: new CompanionAuth(db) });
      try {
        await failingServer.start();
        assert.fail('Expected a second companion server on the same port to fail');
      } catch (error) {
        assert.ok(/EADDRINUSE|listen/i.test(String(error.message || error)), 'Expected a bind conflict when starting a second companion server on the same port');
        assert.equal(failingServer.server, null, 'Expected failed companion server starts to clean up stale in-memory server state');
      }

      const pairing = auth.generatePairing('127.0.0.1', port);
      const deviceId = 'web-contract-device';
      const pairResponse = await fetchImpl(`${baseUrl}/companion/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: pairing.code,
          deviceName: 'Chrome on Windows',
          deviceId,
          platform: 'web',
          appVersion: '0.2.0'
        })
      });
      const pairPayload = await pairResponse.json();
      assert.equal(pairResponse.status, 200, 'Expected pairing endpoint to accept a valid browser device');
      assert.equal(pairPayload.success, true, 'Expected pairing endpoint to succeed');
      assert.equal(pairPayload.deviceId, deviceId, 'Expected pairing endpoint to echo the paired browser device id');
      assert.ok(typeof pairPayload.sessionToken === 'string' && pairPayload.sessionToken.length > 20, 'Expected pairing endpoint to return a durable session token');

      const authResponse = await fetchImpl(`${baseUrl}/companion/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: pairPayload.sessionToken,
          deviceId
        })
      });
      const authPayload = await authResponse.json();
      assert.equal(authResponse.status, 200, 'Expected auth endpoint to accept the session token returned by pairing');
      assert.equal(authPayload.success, true, 'Expected auth endpoint to succeed');
      assert.ok(typeof authPayload.accessToken === 'string' && authPayload.accessToken.includes('.'), 'Expected auth endpoint to return a JWT access token');
      assert.ok(typeof authPayload.wsTicket === 'string' && authPayload.wsTicket.length > 10, 'Expected auth endpoint to return a WebSocket ticket');

      const snapshotResponse = await fetchImpl(`${baseUrl}/companion/settings/full`, {
        headers: { Authorization: `Bearer ${authPayload.accessToken}` }
      });
      const snapshotPayload = await snapshotResponse.json();
      assert.equal(snapshotResponse.status, 200, 'Expected browser companion snapshot endpoint to be reachable immediately after auth');
      assert.equal(snapshotPayload.success, true, 'Expected browser companion snapshot payload to succeed');
      assert.equal(snapshotPayload.snapshot?.companion?.permissions?.preset, 'standard', 'Expected newly paired browser devices to receive the standard permission scope');

      const sessionsResponse = await fetchImpl(`${baseUrl}/companion/chat/sessions?limit=20`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authPayload.accessToken}`
        }
      });
      const sessionsPayload = await sessionsResponse.json();
      assert.equal(sessionsResponse.status, 200, 'Expected paired browser devices to load chat sessions through the companion chat API');
      assert.equal(sessionsPayload.success, true, 'Expected companion chat API to return chat sessions');
      assert.equal(Array.isArray(sessionsPayload.result), true, 'Expected chat session list result to be an array');
      assert.equal(sessionsPayload.result[0]?.id, 'session-1', 'Expected companion chat API to preserve chat session payloads');

      const createResponse = await fetchImpl(`${baseUrl}/companion/chat/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authPayload.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const createPayload = await createResponse.json();
      assert.equal(createResponse.status, 200, 'Expected paired browser devices to create an initial chat session through the companion chat API');
      assert.equal(createPayload.success, true, 'Expected companion chat session creation to succeed');
      assert.ok(createPayload.result?.id, 'Expected companion chat session creation to return a session id');

      const sendResponse = await fetchImpl(`${baseUrl}/companion/chat/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authPayload.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'hello from web',
          sessionId: 'session-1'
        })
      });
      const sendPayload = await sendResponse.json();
      assert.equal(sendResponse.status, 200, 'Expected paired browser devices to send messages through the companion chat API');
      assert.equal(sendPayload.success, true, 'Expected companion send-message payload to succeed');
      assert.equal(sentMessages.length > 0, true, 'Expected the companion backend to dispatch the sent web message');
      const userMessage = conversations.find(entry => entry.role === 'user' && entry.content === 'hello from web');
      assert.equal(userMessage?.metadata?.clientSource, 'web', 'Expected companion messages to be tagged as web-originated');
      assert.equal(userMessage?.metadata?.sourceLabel, 'Web Client', 'Expected companion messages to carry a stable UI label');
      assert.equal(userMessage?.metadata?.deviceId, deviceId, 'Expected companion messages to include the paired device id');
    } finally {
      await server.stop();
    }
  }
};

