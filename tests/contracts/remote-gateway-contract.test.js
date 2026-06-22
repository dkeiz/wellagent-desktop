const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.destroyed = false;
  }

  write(chunk) {
    this.writes.push(chunk);
  }

  destroy() {
    this.destroyed = true;
  }
}

function websocketRequest(pathname = '/gateway/host') {
  return {
    url: pathname,
    headers: {
      host: 'gateway.test',
      'sec-websocket-key': Buffer.from('test-key-1234567').toString('base64')
    }
  };
}

function textFrame(text) {
  const body = Buffer.from(text, 'utf-8');
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
}

module.exports = {
  name: 'remote-gateway-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const files = [
      'src/main/companion/remote-gateway-manager.js',
      'src/main/companion/remote-gateway/server.js',
      'src/main/companion/remote-gateway/relay.js',
      'src/main/companion/remote-gateway/auth.js',
      'src/main/companion/remote-gateway/config.js',
      'src/main/companion/remote-gateway/package.json',
      'src/main/companion/remote-gateway/Dockerfile',
      'src/main/companion/remote-gateway/setup.sh',
      'src/main/companion/remote-gateway/README.md',
      'src/renderer/components/remote-gateway-settings.js'
    ];

    for (const relativePath of files) {
      const absolutePath = path.join(rootDir, relativePath);
      assert.ok(fs.existsSync(absolutePath), `Expected ${relativePath} to exist`);
      const lineCount = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${relativePath} to stay under 1000 lines`);
    }

    const managerSource = fs.readFileSync(path.join(rootDir, 'src/main/companion/remote-gateway-manager.js'), 'utf8');
    assert.includes(managerSource, 'dispatchRemoteGatewayRequest', 'Expected host tunnel requests to dispatch through the companion server');
    assert.includes(managerSource, 'acceptRemoteGatewayWebSocket', 'Expected remote companion WebSocket tickets to be validated by the desktop');
    assert.includes(managerSource, 'generateSecret', 'Expected the desktop manager to generate gateway shared secrets');
    assert.includes(managerSource, 'async setupGateway', 'Expected desktop manager to support one-button SSH setup');
    assert.includes(managerSource, 'buildInstallScript', 'Expected one-button setup to stream a self-contained install script');

    const serverSource = fs.readFileSync(path.join(rootDir, 'src/main/companion/remote-gateway/server.js'), 'utf8');
    assert.includes(serverSource, '/gateway/host', 'Expected deployable gateway to expose the desktop host tunnel');
    assert.includes(serverSource, "url.pathname === '/'", 'Expected deployable gateway root to relay the companion web app');
    assert.includes(serverSource, "url.pathname.startsWith('/companion/')", 'Expected deployable gateway to relay companion HTTP routes');
    assert.includes(serverSource, '/companion/ws', 'Expected deployable gateway to relay companion WebSocket upgrades');
    const gatewayAuth = require(path.join(rootDir, 'src/main/companion/remote-gateway/auth.js'));
    assert.equal(
      gatewayAuth.readSecret(
        { headers: { authorization: 'Bearer contract-secret' } },
        new URL('https://gateway.test/gateway/host?secret=query-secret')
      ),
      'contract-secret',
      'Expected remote gateway auth to prefer bearer headers'
    );
    assert.equal(
      gatewayAuth.readSecret(
        { headers: {} },
        new URL('https://gateway.test/gateway/host?secret=query-secret')
      ),
      '',
      'Expected remote gateway auth not to accept secrets in the query string'
    );

    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'src/main/companion/remote-gateway/package.json'), 'utf8'));
    assert.deepEqual(packageJson.dependencies, {}, 'Remote Gateway package should not require dependency installation');

    const companionServerSource = fs.readFileSync(path.join(rootDir, 'src/main/companion/companion-api-server.js'), 'utf8');
    assert.includes(companionServerSource, 'setRemoteGatewayManager', 'Expected companion server to accept a remote gateway manager');
    assert.includes(companionServerSource, 'dispatchRemoteGatewayRequest', 'Expected companion server to dispatch remote gateway HTTP requests');
    assert.includes(companionServerSource, '_isGatewayPublicRoute', 'Expected Remote Gateway to preserve public companion web/bootstrap routes');
    assert.includes(companionServerSource, '_remoteWsClients', 'Expected companion server to account for remote gateway WebSocket clients');

    const ipcSource = fs.readFileSync(path.join(rootDir, 'src/main/ipc/register-agent-system-handlers.js'), 'utf8');
    assert.includes(ipcSource, 'remote-gateway:connect', 'Expected IPC connect handler for Remote Gateway');
    assert.includes(ipcSource, 'remote-gateway:disconnect', 'Expected IPC disconnect handler for Remote Gateway');
    assert.includes(ipcSource, 'remote-gateway:generate-secret', 'Expected IPC secret generation handler for Remote Gateway');
    assert.includes(ipcSource, 'remote-gateway:setup', 'Expected IPC setup handler for one-button Remote Gateway setup');
    assert.includes(ipcSource, "db.getCredential?.('remoteGateway.secret')", 'Expected Remote Gateway IPC to read secrets from credential storage');
    assert.includes(ipcSource, "db.setCredential('remoteGateway.secret'", 'Expected Remote Gateway IPC to store generated secrets in credential storage');
    assert.ok(!ipcSource.includes("saveSetting('remoteGateway.secret'"), 'Expected Remote Gateway IPC not to persist secrets as plain settings');
    assert.ok(!managerSource.includes("saveSetting('remoteGateway.secret'"), 'Expected Remote Gateway manager not to persist secrets as plain settings');

    const apiSource = fs.readFileSync(path.join(rootDir, 'src/renderer/electron-api.js'), 'utf8');
    assert.includes(apiSource, 'remoteGateway', 'Expected renderer bridge to expose Remote Gateway methods');
    assert.includes(apiSource, "setup: (options = {}) => ipcRenderer.invoke('remote-gateway:setup', options)", 'Expected renderer bridge to expose one-button setup');

    const htmlSource = fs.readFileSync(path.join(rootDir, 'src/renderer/index.html'), 'utf8');
    assert.includes(htmlSource, 'remote-gateway-url', 'Expected settings UI to include Remote Gateway URL input');
    assert.includes(htmlSource, 'remote-gateway-setup-btn', 'Expected settings UI to include a primary setup button');
    assert.includes(htmlSource, 'remote-gateway-manual-toggle-btn', 'Expected manual gateway controls to be behind a disclosure');
    assert.includes(htmlSource, 'remote-gateway-manual-panel" class="remote-gateway-manual-panel" hidden', 'Expected manual gateway controls to stay hidden by default');
    assert.includes(htmlSource, 'Set Up Remote Gateway', 'Expected setup action to be user-facing');
    assert.includes(htmlSource, 'Show Package Path', 'Expected manual package action not to claim automatic deploy');
    assert.includes(htmlSource, 'components/remote-gateway-settings.js', 'Expected settings UI script to load');
    const rendererSettingsSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'remote-gateway-settings.js'), 'utf8');
    assert.includes(rendererSettingsSource, 'runSetup()', 'Expected renderer settings to run setup from the modal');
    assert.includes(rendererSettingsSource, 'toggleManualPanel()', 'Expected renderer settings to keep manual controls compact');
    assert.includes(rendererSettingsSource, 'window.electronAPI.remoteGateway.setup(config)', 'Expected renderer setup to call setup IPC');

    const { RelayHub } = require(path.join(rootDir, 'src/main/companion/remote-gateway/relay'));
    const relay = new RelayHub();
    const oldHost = new FakeSocket();
    const newHost = new FakeSocket();
    relay.attachHost(websocketRequest(), oldHost);
    relay.attachHost(websocketRequest(), newHost);
    oldHost.emit('close');
    assert.equal(relay.hostSocket, newHost, 'Old host close event should not clear a replacement host tunnel');

    const clientSocket = new FakeSocket();
    relay.attachClient(websocketRequest('/companion/ws?ticket=test'), clientSocket);
    const remoteConnectionId = Array.from(relay.clients.keys())[0];
    assert.ok(remoteConnectionId, 'Expected remote companion WebSocket to get a relay connection id');
    clientSocket.emit('data', textFrame(JSON.stringify({ type: 'ping' })));
    const hostWriteText = Buffer.concat(newHost.writes.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))).toString('utf-8');
    assert.includes(hostWriteText, '"type":"ws-message"', 'Expected remote companion WebSocket messages to be forwarded to the desktop host');

    const gatewayManager = require(path.join(rootDir, 'src/main/companion/remote-gateway-manager'));
    const handshake = gatewayManager._test.buildHandshake(new URL('ws://gateway.test/gateway/host'), 'secret');
    const goodHeader = [
      'HTTP/1.1 101 Switching Protocols',
      `Sec-WebSocket-Accept: ${gatewayManager._test.expectedWebSocketAccept(handshake.key)}`,
      '\r\n'
    ].join('\r\n');
    gatewayManager._test.assertValidHandshakeResponse(goodHeader, handshake.key);
    const installScript = gatewayManager._test.buildInstallScript({
      targetDir: '~/localagent-remote-gateway',
      gatewayPort: 8791,
      secret: 'contract-secret'
    });
    assert.includes(installScript, 'REMOTE_GATEWAY_SECRET=$SECRET', 'Expected install script to write generated secret into remote env');
    assert.ok(!installScript.includes('change-me-before-start'), 'Expected one-button setup not to use the manual placeholder secret');
    let rejectedBadAccept = false;
    try {
      gatewayManager._test.assertValidHandshakeResponse('HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: bad\r\n\r\n', handshake.key);
    } catch (_) {
      rejectedBadAccept = true;
    }
    assert.equal(rejectedBadAccept, true, 'Expected desktop manager to reject invalid gateway WebSocket handshakes');

    const CompanionApiServer = require(path.join(rootDir, 'src/main/companion/companion-api-server'));
    const companionServer = new CompanionApiServer();
    const messages = [];
    const closed = [];
    companionServer.setRemoteGatewayManager({
      sendRemoteWsMessage(connectionId, message) { messages.push({ connectionId, message }); },
      closeRemoteWsConnection(connectionId, reason) { closed.push({ connectionId, reason }); }
    });
    companionServer._remoteWsClients.set('remote-1', { deviceId: 'device-a' });
    companionServer._remoteWsClients.set('remote-2', { deviceId: 'device-b' });
    assert.equal(companionServer.disconnectDevice('device-a', 'test-kick'), true, 'Expected remote device to be disconnected');
    assert.equal(companionServer._remoteWsClients.has('remote-1'), false, 'Expected kicked remote client to be removed');
    assert.equal(companionServer._remoteWsClients.has('remote-2'), true, 'Expected unrelated remote client to remain connected');
    assert.equal(messages[0]?.message?.type, 'device-kicked', 'Expected remote client to receive a device-kicked event before close');
    assert.equal(closed[0]?.connectionId, 'remote-1', 'Expected gateway close request for kicked remote client');
  }
};
