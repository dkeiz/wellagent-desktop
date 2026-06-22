const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('../helpers/assert');
const {
  invokeIpc,
  shutdownExternalApp,
  startExternalApp,
  waitForHealth
} = require('../helpers/external-app-control');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTROL_PORT = Number(process.env.LOCALAGENT_STT_IPC_CONTROL_PORT || 8799);
const COMPANION_PORT = Number(process.env.LOCALAGENT_STT_IPC_COMPANION_PORT || 8794);
const FIXTURE_PATH = process.env.LOCALAGENT_STT_IPC_FIXTURE
  ? path.resolve(process.env.LOCALAGENT_STT_IPC_FIXTURE)
  : path.join(ROOT, 'tests', 'fixtures', 'audio', 'stt-speech-probe.wav');
const EXPECTED_TRANSCRIPT = process.env.LOCALAGENT_STT_IPC_EXPECT_TRANSCRIPT
  ? String(process.env.LOCALAGENT_STT_IPC_EXPECT_TRANSCRIPT).trim()
  : 'speech recognition proof';


function requestJson(baseUrl, method, route, payload = null, token = '', timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const body = payload && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (Buffer.isBuffer(body)) {
      headers['Content-Type'] = 'audio/wav';
      headers['Content-Length'] = body.length;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(`${baseUrl}${route}`, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : {} });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timeout: ${method} ${route}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function stopApp(app) {
  await shutdownExternalApp(app.baseUrl);
  if (app.child && !app.child.killed) {
    try { app.child.kill('SIGTERM'); } catch (_) {}
  }
}

async function ensureCompanion(app) {
  const status = await invokeIpc(app.baseUrl, 'companion:status');
  if (status?.running && Number(status.port) === COMPANION_PORT) return status;
  const enabled = await invokeIpc(app.baseUrl, 'companion:enable', [{
    host: '127.0.0.1',
    port: COMPANION_PORT
  }]);
  assert.equal(enabled.success, true, 'Expected companion enable to succeed');
  return invokeIpc(app.baseUrl, 'companion:status');
}

async function pairCompanion(app) {
  const companionBaseUrl = `http://127.0.0.1:${COMPANION_PORT}`;
  const pairing = await invokeIpc(app.baseUrl, 'companion:generate-pairing');
  assert.ok(pairing?.code, 'Expected pairing code');
  const deviceId = `stt-ipc-device-${Date.now()}`;
  const pair = await requestJson(companionBaseUrl, 'POST', '/companion/pair', {
    pairingCode: pairing.code,
    deviceName: 'STT IPC Probe',
    deviceId,
    platform: 'android',
    appVersion: 'stt-ipc-routing'
  });
  assert.equal(pair.status, 200, 'Expected companion pair HTTP 200');
  assert.equal(pair.data.success, true, 'Expected companion pair success');
  const auth = await requestJson(companionBaseUrl, 'POST', '/companion/auth', {
    sessionToken: pair.data.sessionToken,
    deviceId
  });
  assert.equal(auth.status, 200, 'Expected companion auth HTTP 200');
  assert.equal(auth.data.success, true, 'Expected companion auth success');
  assert.ok(String(auth.data.accessToken || '').includes('.'), 'Expected companion access token');
  return { companionBaseUrl, accessToken: auth.data.accessToken };
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-stt-ipc-'));
  assert.ok(
    fs.existsSync(FIXTURE_PATH),
    `Real spoken STT fixture is required: ${FIXTURE_PATH}. Set LOCALAGENT_STT_IPC_FIXTURE to a WAV/MP4 with known spoken words.`
  );
  assert.ok(EXPECTED_TRANSCRIPT, 'Expected transcript text is required so the test proves recognition, not only transport.');
  const fixture = fs.readFileSync(FIXTURE_PATH);
  assert.ok(fixture.length > 1000, 'Expected STT fixture WAV bytes');
  const audioBase64 = fixture.toString('base64');

  const app = startExternalApp({
    rootDir: ROOT,
    port: CONTROL_PORT,
    envOverrides: {
      LOCALAGENT_USER_DATA_PATH: userDataDir
    }
  });

  try {
    await waitForHealth(app.baseUrl, 45000);
    const settings = await invokeIpc(app.baseUrl, 'stt:save-settings', [{ defaultPluginId: '' }]);
    assert.equal(settings.defaultPluginId, '', 'Expected built-in desktop STT with no plugin override');

    const providers = await invokeIpc(app.baseUrl, 'stt:list-providers', [{ enabledOnly: true }]);
    assert.ok(providers.some(provider => provider.id === 'embedded-whisper' && provider.status === 'enabled'), 'Expected built-in desktop STT provider to be enabled');

    const desktop = await invokeIpc(app.baseUrl, 'stt:transcribe-audio', [{
      audioBase64,
      mimeType: 'audio/wav',
      prompt: 'fixture'
    }], 30000);
    if (!desktop.success) {
      console.error('STT transcribing failed. Result:', desktop);
    }
    assert.equal(desktop.success, true, 'Expected desktop STT IPC to succeed');
    assert.notEqual(desktop.backend, 'plugin-stt', 'Expected desktop STT IPC to use built-in desktop STT, not a plugin override');
    assert.includes(String(desktop.text || '').toLowerCase(), EXPECTED_TRANSCRIPT.toLowerCase(), 'Expected desktop STT IPC transcript');

    await ensureCompanion(app);
    const { companionBaseUrl, accessToken } = await pairCompanion(app);
    const companion = await requestJson(
      companionBaseUrl,
      'POST',
      '/companion/stt/transcribe',
      fixture,
      accessToken,
      30000
    );
    assert.equal(companion.status, 200, 'Expected companion STT HTTP 200');
    assert.equal(companion.data.success, true, 'Expected companion STT success');
    assert.notEqual(companion.data.backend, 'plugin-stt', 'Expected companion STT to use built-in desktop STT, not a plugin override');
    assert.includes(String(companion.data.text || '').toLowerCase(), EXPECTED_TRANSCRIPT.toLowerCase(), 'Expected companion STT transcript');

    console.log('[external-test:stt-ipc-routing] PASS');
    console.log(`[external-test:stt-ipc-routing] fixture=${FIXTURE_PATH}`);
    console.log(`[external-test:stt-ipc-routing] desktop_text=${JSON.stringify(desktop.text || '')}`);
    console.log(`[external-test:stt-ipc-routing] companion_text=${JSON.stringify(companion.data.text || '')}`);
    console.log(`[external-test:stt-ipc-routing] companion_port=${COMPANION_PORT}`);
  } finally {
    if (app) {
      const { stdout, stderr } = app.logs();
      console.log('--- APP STDOUT ---');
      console.log(stdout);
      console.log('--- APP STDERR ---');
      console.log(stderr);
    }
    await stopApp(app);
  }
}

run().catch((error) => {
  console.error('[external-test:stt-ipc-routing] FAIL:', error.message || String(error));
  process.exit(1);
});
