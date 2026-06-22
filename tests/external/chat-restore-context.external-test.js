const fs = require('fs');
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

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-chat-restore-'));
  let app = null;

  try {
    app = await startApp(userDataDir);

    const session = await invokeIpc(app.baseUrl, 'create-chat-session', [{ title: 'Restore Runtime Probe' }]);
    assert.ok(session?.id, 'Expected initial runtime session');
    await invokeIpc(app.baseUrl, 'switch-chat-session', [session.id]);
    await invokeIpc(app.baseUrl, 'add-conversation', [{ role: 'user', content: 'first persisted question about runtime restore' }]);
    await invokeIpc(app.baseUrl, 'add-conversation', [{ role: 'assistant', content: 'first persisted answer from runtime restore' }]);
    await invokeIpc(app.baseUrl, 'add-conversation', [{ role: 'user', content: 'second persisted question that should increase context size' }]);
    await invokeIpc(app.baseUrl, 'save-setting', ['open_chat_tabs', JSON.stringify([session.id])]);
    await invokeIpc(app.baseUrl, 'save-setting', ['active_chat_tab', String(session.id)]);

    const beforeRestartEstimate = await invokeIpc(app.baseUrl, 'get-context-usage-estimate', [session.id, 'third prompt']);
    assert.ok(
      Number(beforeRestartEstimate?.tokens || beforeRestartEstimate?.prompt_tokens || 0) > 0,
      'Expected non-zero context estimate before restart'
    );

    await stopApp(app);
    app = await startApp(userDataDir);

    const sessions = await invokeIpc(app.baseUrl, 'get-chat-sessions', [null, 20]);
    const restored = (Array.isArray(sessions) ? sessions : []).find((entry) => Number(entry.id) === Number(session.id));
    assert.ok(restored, `Expected persisted session after restart, got ${JSON.stringify(sessions)}`);
    assert.equal(Number(restored.message_count || 0), 3, 'Expected persisted message count after restart');

    const meta = await invokeIpc(app.baseUrl, 'get-chat-session-meta', [session.id]);
    assert.equal(Number(meta?.id || 0), Number(session.id), 'Expected session meta after restart');

    const messages = await invokeIpc(app.baseUrl, 'load-chat-session', [session.id, { includeHidden: true }]);
    assert.equal(messages.length, 3, 'Expected persisted messages to load after restart');
    assert.includes(messages[0].content, 'first persisted question', 'Expected first user message after restart');
    assert.includes(messages[2].content, 'second persisted question', 'Expected final user message after restart');

    const afterRestartEstimate = await invokeIpc(app.baseUrl, 'get-context-usage-estimate', [session.id, 'third prompt']);
    const totalTokens = Number(afterRestartEstimate?.tokens || afterRestartEstimate?.prompt_tokens || 0);
    assert.ok(totalTokens > 0, 'Expected non-zero context estimate after restart');

    const switchResult = await invokeIpc(app.baseUrl, 'switch-chat-session', [session.id]);
    assert.equal(switchResult.success, true, 'Expected switch-chat-session after restart');

    console.log('[external-test:chat-restore-context] PASS');
    console.log(`[external-test:chat-restore-context] session_id=${session.id}`);
    console.log(`[external-test:chat-restore-context] tokens=${totalTokens}`);
  } finally {
    if (app) {
      await stopApp(app);
    }
    await removeDirWithRetries(userDataDir);
  }
}

run().catch((error) => {
  console.error('[external-test:chat-restore-context] FAIL:', error.message || String(error));
  process.exit(1);
});
