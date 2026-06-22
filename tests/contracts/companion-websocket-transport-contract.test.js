const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
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

function expectedAcceptValue(key) {
  return crypto.createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-5AB5DC11E548`)
    .digest('base64');
}

function performWebSocketHandshake({ host, port, ticket, key }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const request = [
      `GET /companion/ws?ticket=${encodeURIComponent(ticket)} HTTP/1.1`,
      `Host: ${host}:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '\r\n'
    ].join('\r\n');
    const chunks = [];
    let settled = false;

    const finish = (error, payload = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(payload);
    };

    socket.setTimeout(2000, () => finish(new Error('Timed out waiting for WebSocket handshake response')));
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const merged = Buffer.concat(chunks);
      const boundary = merged.indexOf('\r\n\r\n');
      if (boundary === -1) return;
      finish(null, {
        headerText: merged.slice(0, boundary + 4).toString('utf8'),
        extraBytes: merged.slice(boundary + 4)
      });
    });

    socket.write(request);
  });
}

module.exports = {
  name: 'companion-websocket-transport-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const clientSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app.js'), 'utf8');
    const mobileAppSource = fs.readFileSync(path.join(rootDir, 'mobile', 'App.tsx'), 'utf8');
    const docsSource = fs.readFileSync(path.join(rootDir, 'docs', 'android-emulator-testing.md'), 'utf8');

    assert.includes(clientSource, 'Live updates unavailable. Using refresh polling.', 'Expected companion client to expose a stable polling fallback status');
    assert.includes(appSource, 'connected (live)', 'Expected companion shell to label live transport status');
    assert.includes(appSource, 'connected (polling)', 'Expected companion shell to label polling fallback status');
    assert.includes(appSource, 'already paired on this device', 'Expected reused pairing codes to explain the saved-session case');
    assert.includes(mobileAppSource, 'LogBox.ignoreLogs', 'Expected mobile app to suppress known expo-av warning noise');
    assert.includes(docsSource, 'Regression Method', 'Expected emulator docs to describe the repeatable regression loop');

    const CompanionApiServer = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'));
    const CompanionAuth = require(path.join(rootDir, 'src', 'main', 'companion-auth.js'));
    const { configureCompanionServer } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'));

    const db = createMemoryDb();
    const container = createContainer({
      db,
      capabilityManager: { getState: () => ({ mainEnabled: true, groups: { web: true }, activeToolCount: 1 }) },
      agentManager: { getAgents: async () => [] },
      memoryDaemon: { getStatus: () => ({ running: false }) },
      workflowScheduler: { getStatus: () => ({ running: false }) }
    });
    const auth = new CompanionAuth(db);
    const server = new CompanionApiServer({ host: '127.0.0.1', port: 0 });
    configureCompanionServer({ companionServer: server, container, db, companionAuth: auth });

    try {
      await server.start();
      const address = server.server.address();
      const port = typeof address === 'object' && address ? address.port : 8790;
      const baseUrl = `http://127.0.0.1:${port}`;
      const pairing = auth.generatePairing('127.0.0.1', port);
      const deviceId = 'ws-contract-device';

      const pairResponse = await fetchImpl(`${baseUrl}/companion/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: pairing.code,
          deviceName: 'Android WebView',
          deviceId,
          platform: 'android-web',
          appVersion: '0.2.0'
        })
      });
      const pairPayload = await pairResponse.json();
      assert.equal(pairResponse.status, 200, 'Expected pairing endpoint to succeed for websocket transport contract');
      assert.equal(pairPayload.success, true, 'Expected websocket transport contract pairing to succeed');

      const authResponse = await fetchImpl(`${baseUrl}/companion/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: pairPayload.sessionToken,
          deviceId
        })
      });
      const authPayload = await authResponse.json();
      assert.equal(authResponse.status, 200, 'Expected auth endpoint to succeed for websocket transport contract');
      assert.equal(authPayload.success, true, 'Expected websocket transport contract auth to succeed');
      assert.ok(authPayload.wsTicket, 'Expected websocket transport contract auth to return a ws ticket');

      const wsKey = 'dGhlIHNhbXBsZSBub25jZQ==';
      const handshake = await performWebSocketHandshake({
        host: '127.0.0.1',
        port,
        ticket: authPayload.wsTicket,
        key: wsKey
      });
      const expectedAccept = expectedAcceptValue(wsKey);

      assert.includes(handshake.headerText, 'HTTP/1.1 101 Switching Protocols', 'Expected companion websocket upgrade to return 101');
      assert.includes(handshake.headerText, `Sec-WebSocket-Accept: ${expectedAccept}`, 'Expected companion websocket upgrade to return the RFC accept header');
      assert.equal(handshake.extraBytes.length, 0, 'Expected websocket handshake to complete without extra frame bytes immediately after headers');
    } finally {
      await server.stop();
    }
  }
};

