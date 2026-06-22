const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('../helpers/assert');
const {
  invokeIpc,
  requestJson,
  shutdownExternalApp,
  sleep,
  startExternalApp,
  waitForHealth
} = require('../helpers/external-app-control');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8788;

function collectSse(url, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      timeout: timeoutMs
    });

    const events = [];
    req.on('response', (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(5).trim());
            events.push(parsed.result || parsed.error);
          }
          idx = buffer.indexOf('\n\n');
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`SSE timeout after ${timeoutMs}ms`)));
    req.write(JSON.stringify(payload));
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

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-a2a-ext-'));
  const app = startExternalApp({
    rootDir: ROOT,
    port: PORT,
    envOverrides: {
      LOCALAGENT_USER_DATA_PATH: userDataDir
    }
  });
  try {
    await waitForHealth(app.baseUrl, 45000);

    const status = await invokeIpc(app.baseUrl, 'a2a:get-status');
    assert.equal(status.enabled, false, 'Expected A2A exposure to start disabled');

    const enabled = await invokeIpc(app.baseUrl, 'a2a:set-exposure', [true]);
    assert.equal(enabled.enabled, true, 'Expected A2A exposure enablement to persist');
    assert.equal(enabled.running, true, 'Expected A2A exposure server to start');

    const cardResponse = await requestJson(enabled.baseUrl, 'GET', '/.well-known/agent-card.json', null, 5000);
    assert.equal(cardResponse.status, 200, 'Expected LocalAgent card endpoint to respond');
    assert.equal(cardResponse.data.name, 'LocalAgent', 'Expected LocalAgent card name');

    const blocking = await requestJson(enabled.baseUrl, 'POST', '/rpc', {
      jsonrpc: '2.0',
      id: 'external-blocking',
      method: 'message/send',
      params: {
        configuration: { blocking: true },
        metadata: { localagent: { mockResponse: 'external-ok' } },
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'ping' }]
        }
      }
    }, 5000);
    assert.equal(blocking.status, 200, 'Expected blocking A2A send to succeed');
    assert.equal(blocking.data.result.status.state, 'completed', 'Expected blocking A2A send to complete');

    const streamEvents = await collectSse(`${enabled.baseUrl}/rpc`, {
      jsonrpc: '2.0',
      id: 'external-stream',
      method: 'message/stream',
      params: {
        metadata: { localagent: { mockResponse: 'external-stream-ok', delayMs: 25 } },
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'stream ping' }]
        }
      }
    });
    assert.ok(streamEvents.length >= 2, 'Expected stream to emit multiple events');
    assert.equal(streamEvents[streamEvents.length - 1].status.state, 'completed', 'Expected stream to finish');

    const queued = await requestJson(enabled.baseUrl, 'POST', '/rpc', {
      jsonrpc: '2.0',
      id: 'external-cancel-seed',
      method: 'message/send',
      params: {
        metadata: { localagent: { mockResponse: 'never', delayMs: 300 } },
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'cancel later' }]
        }
      }
    }, 5000);
    const taskId = queued.data.result.id;
    const canceled = await requestJson(enabled.baseUrl, 'POST', '/rpc', {
      jsonrpc: '2.0',
      id: 'external-cancel',
      method: 'tasks/cancel',
      params: { id: taskId }
    }, 5000);
    assert.equal(canceled.data.result.status.state, 'canceled', 'Expected cancel to succeed');

    await sleep(200);
    console.log('[external-test:a2a] PASS A2A windowless flow');
  } finally {
    await shutdownExternalApp(app.baseUrl);
    await waitForChildExit(app.child);
    if (!app.child.killed) {
      try {
        app.child.kill('SIGTERM');
      } catch (_) {}
    }
    await waitForChildExit(app.child, 2000);
    await removeDirWithRetries(userDataDir);
  }
}

run().catch((error) => {
  console.error('[external-test:a2a] FAIL:', error.message || String(error));
  process.exit(1);
});
