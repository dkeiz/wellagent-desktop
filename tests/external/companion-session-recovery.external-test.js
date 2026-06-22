const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('../helpers/assert');
const {
  invokeIpc,
  shutdownExternalApp,
  sleep,
  startExternalApp,
  waitForHealth
} = require('../helpers/external-app-control');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8788;

function requestJson(baseUrl, method, route, payload = null, token = '', timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const url = new URL(route, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(body ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve({
              status: res.statusCode || 0,
              data: raw ? JSON.parse(raw) : {}
            });
          } catch (error) {
            reject(new Error(`Invalid JSON from ${route}: ${error.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timeout: ${method} ${route}`)));
    if (body) req.write(body);
    req.end();
  });
}

function waitForChildExit(child, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', finish);
      child.removeListener('error', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', finish);
    child.once('error', finish);
  });
}

async function removeDirWithRetries(targetPath, attempts = 8, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

async function stopApp(app) {
  await shutdownExternalApp(app.baseUrl);
  await waitForChildExit(app.child);
  if (!app.child.killed) {
    try {
      app.child.kill('SIGTERM');
    } catch (_) {}
  }
  await waitForChildExit(app.child, 2000);
}

async function startApp(userDataDir) {
  const app = startExternalApp({
    rootDir: ROOT,
    port: PORT,
    envOverrides: {
      LOCALAGENT_USER_DATA_PATH: userDataDir
    }
  });
  const health = await waitForHealth(app.baseUrl, 45000);
  assert.equal(health.windowCount, 0, 'Expected windowless external mode');
  return app;
}

async function ensureCompanionRunning(app) {
  const status = await invokeIpc(app.baseUrl, 'companion:status');
  if (status?.running) {
    return status;
  }
  const enabled = await invokeIpc(app.baseUrl, 'companion:enable', [{
    host: status?.host || '0.0.0.0',
    port: status?.port || 8790
  }]);
  assert.equal(enabled.success, true, 'Expected companion enable to succeed');
  return invokeIpc(app.baseUrl, 'companion:status');
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-companion-recovery-'));
  const deviceId = `web-test-${Date.now()}`;
  let app = null;

  try {
    app = await startApp(userDataDir);
    const companion = await ensureCompanionRunning(app);
    const companionBaseUrl = `http://127.0.0.1:${Number(companion?.port || 8790)}`;

    const pairing = await invokeIpc(app.baseUrl, 'companion:generate-pairing');
    assert.ok(pairing?.code, 'Expected pairing code');

    const pairResponse = await requestJson(companionBaseUrl, 'POST', '/companion/pair', {
      pairingCode: pairing.code,
      deviceName: 'Runtime Browser',
      deviceId,
      platform: 'desktop-web',
      appVersion: '0.2.0'
    });
    assert.equal(pairResponse.status, 200, 'Expected companion pair endpoint success');
    assert.equal(pairResponse.data.success, true, 'Expected companion pairing to succeed');
    const sessionToken = String(pairResponse.data.sessionToken || '');
    assert.ok(sessionToken.length > 20, 'Expected durable session token');

    const authResponse = await requestJson(companionBaseUrl, 'POST', '/companion/auth', {
      sessionToken,
      deviceId
    });
    assert.equal(authResponse.status, 200, 'Expected companion auth success');
    assert.equal(authResponse.data.success, true, 'Expected companion auth payload');
    const accessToken = String(authResponse.data.accessToken || '');
    assert.ok(accessToken.includes('.'), 'Expected access token JWT');

    const created = await requestJson(companionBaseUrl, 'POST', '/companion/chat/session', {}, accessToken);
    assert.equal(created.status, 200, 'Expected companion chat session create success');
    assert.equal(created.data.success, true, 'Expected companion session create payload');
    const sessionId = String(created.data.result?.id || '');
    assert.ok(sessionId, 'Expected companion-created session id');

    const imported = await invokeIpc(app.baseUrl, 'chat-session:import-messages', [sessionId, [
      {
        role: 'user',
        content: 'hello from companion recovery runtime',
        metadata: {
          clientSource: 'web',
          sourceLabel: 'Web Client',
          platform: 'desktop-web',
          deviceId,
          deviceName: 'Runtime Browser'
        }
      },
      {
        role: 'assistant',
        content: 'runtime recovery reply'
      }
    ]]);
    assert.equal(imported.success, true, 'Expected seeded companion-visible history');

    const beforeRestartSessions = await requestJson(companionBaseUrl, 'GET', '/companion/chat/sessions?limit=20', null, accessToken);
    assert.equal(beforeRestartSessions.status, 200, 'Expected companion session listing before restart');
    assert.equal(beforeRestartSessions.data.success, true, 'Expected companion session listing payload');
    assert.ok(
      (beforeRestartSessions.data.result || []).some((entry) => String(entry?.id || '') === sessionId),
      'Expected created session before restart'
    );

    await stopApp(app);
    app = await startApp(userDataDir);
    const restartedCompanion = await ensureCompanionRunning(app);
    const restartedBaseUrl = `http://127.0.0.1:8790`;

    const resumedAuth = await requestJson(restartedBaseUrl, 'POST', '/companion/auth', {
      sessionToken,
      deviceId
    });
    assert.equal(resumedAuth.status, 200, 'Expected saved session token to survive restart');
    assert.equal(resumedAuth.data.success, true, 'Expected resumed companion auth payload');
    const resumedAccessToken = String(resumedAuth.data.accessToken || '');

    const afterRestartSessions = await requestJson(restartedBaseUrl, 'GET', '/companion/chat/sessions?limit=20', null, resumedAccessToken);
    assert.equal(afterRestartSessions.status, 200, 'Expected companion session listing after restart');
    assert.equal(afterRestartSessions.data.success, true, 'Expected companion session listing after restart payload');
    assert.ok(
      (afterRestartSessions.data.result || []).some((entry) => String(entry?.id || '') === sessionId),
      'Expected created session after restart'
    );

    const messages = await requestJson(
      restartedBaseUrl,
      'GET',
      `/companion/chat/messages?sessionId=${encodeURIComponent(sessionId)}&limit=20`,
      null,
      resumedAccessToken
    );
    assert.equal(messages.status, 200, 'Expected companion message history after restart');
    assert.equal(messages.data.success, true, 'Expected companion message history payload');
    const list = Array.isArray(messages.data.result) ? messages.data.result : [];
    assert.ok(
      list.some((message) => String(message?.content || '').includes('hello from companion recovery runtime')),
      'Expected sent companion message after restart'
    );
    assert.ok(
      list.some((message) => message?.metadata?.deviceId === deviceId),
      'Expected companion-origin metadata after restart'
    );

    const switched = await requestJson(restartedBaseUrl, 'POST', '/companion/chat/switch', { sessionId }, resumedAccessToken);
    assert.equal(switched.status, 200, 'Expected companion session switch after restart');
    assert.equal(switched.data.success, true, 'Expected companion switch payload');

    console.log('[external-test:companion-session-recovery] PASS');
    console.log(`[external-test:companion-session-recovery] session_id=${sessionId}`);
    console.log(`[external-test:companion-session-recovery] paired_port=${Number(restartedCompanion?.port || 8790)}`);
  } finally {
    if (app) {
      await stopApp(app);
    }
    await removeDirWithRetries(userDataDir);
  }
}

run().catch((error) => {
  console.error('[external-test:companion-session-recovery] FAIL:', error.message || String(error));
  process.exit(1);
});

