const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(baseUrl, method, route, payload = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      `${baseUrl}${route}`,
      {
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          : undefined,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
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

async function waitForHealth(baseUrl, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(baseUrl, 'GET', '/health', null, 2000);
      if (response.status === 200 && response.data?.ok) {
        return response.data;
      }
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('External test server did not become healthy in time');
}

async function invokeIpc(baseUrl, channel, args = [], timeoutMs = 12000) {
  const response = await requestJson(baseUrl, 'POST', '/invoke', { channel, args }, timeoutMs);
  if (response.status !== 200 || response.data?.success !== true) {
    throw new Error(response.data?.error || `IPC ${channel} failed with HTTP ${response.status}`);
  }
  return response.data.result;
}

async function shutdownExternalApp(baseUrl) {
  try {
    await requestJson(baseUrl, 'POST', '/shutdown', {});
  } catch (_) {}
}

function startExternalApp({ rootDir, port, envOverrides = null }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const electronBinary = typeof require('electron') === 'string'
    ? require('electron')
    : process.execPath;
  const args = ['.', '--external-test', '--windowless', '--external-port', String(port)];
  const env = { ...process.env };
  if (envOverrides && typeof envOverrides === 'object') {
    Object.assign(env, envOverrides);
  }
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary, args, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf-8');
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf-8');
  });

  return {
    child,
    baseUrl,
    logs() {
      return { stdout, stderr };
    }
  };
}

module.exports = {
  invokeIpc,
  requestJson,
  shutdownExternalApp,
  sleep,
  startExternalApp,
  waitForHealth
};
