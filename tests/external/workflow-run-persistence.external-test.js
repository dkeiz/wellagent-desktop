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

async function waitForWorkflowRun(baseUrl, runId, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await invokeIpc(baseUrl, 'get-workflow-run', [runId]);
    if (run && ['completed', 'failed'].includes(String(run.status || ''))) {
      return run;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting workflow run ${runId}`);
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-workflow-persist-'));
  let app = null;

  try {
    app = await startApp(userDataDir);

    const session = await invokeIpc(app.baseUrl, 'create-chat-session', [{ title: 'Workflow Persistence Probe' }]);
    assert.ok(session?.id, 'Expected workflow test session');
    await invokeIpc(app.baseUrl, 'switch-chat-session', [session.id]);

    const saved = await invokeIpc(app.baseUrl, 'save-workflow', [{
      name: `Runtime Workflow Persist ${Date.now()}`,
      description: 'Runtime persistence probe',
      tool_chain: [
        { tool: 'current_time', params: {} },
        { tool: 'get_stats', params: {} },
        { tool: 'current_time', params: {} }
      ]
    }]);
    assert.equal(saved.success, true, 'Expected save-workflow to succeed');
    const workflowId = Number(saved.workflow?.id || 0);
    assert.ok(workflowId > 0, 'Expected saved workflow id');

    const runAck = await invokeIpc(app.baseUrl, 'run-workflow-advanced', [workflowId, {
      mode: 'auto',
      sessionId: session.id
    }]);
    assert.equal(runAck.success, true, 'Expected workflow run request');
    assert.equal(runAck.accepted, true, 'Expected workflow run accepted');
    assert.equal(runAck.immediate, false, 'Expected 3-step workflow to take async path');
    assert.ok(runAck.run_id, 'Expected workflow run id');

    const completed = await waitForWorkflowRun(app.baseUrl, runAck.run_id, 15000);
    assert.equal(completed.status, 'completed', 'Expected workflow completion');
    assert.ok(completed.result, 'Expected workflow result payload');
    assert.equal(Array.isArray(completed.result.results), true, 'Expected workflow step results');

    const listedBeforeRestart = await invokeIpc(app.baseUrl, 'list-workflow-runs', [{ workflowId, limit: 20 }]);
    assert.ok(
      Array.isArray(listedBeforeRestart) && listedBeforeRestart.some((run) => String(run?.run_id || '') === String(runAck.run_id)),
      'Expected workflow run in listing before restart'
    );

    await stopApp(app);
    app = await startApp(userDataDir);

    const restoredRun = await invokeIpc(app.baseUrl, 'get-workflow-run', [runAck.run_id]);
    assert.ok(restoredRun, 'Expected workflow run after restart');
    assert.equal(restoredRun.status, 'completed', 'Expected workflow completion after restart');
    assert.ok(restoredRun.result?.summary, 'Expected workflow result summary after restart');

    const listedAfterRestart = await invokeIpc(app.baseUrl, 'list-workflow-runs', [{ workflowId, limit: 20 }]);
    assert.ok(
      Array.isArray(listedAfterRestart) && listedAfterRestart.some((run) => String(run?.run_id || '') === String(runAck.run_id)),
      'Expected workflow run in listing after restart'
    );

    assert.equal(
      String(restoredRun?.requested_by_session_id || ''),
      String(session.id),
      'Expected workflow run to preserve requested session id after restart'
    );
    assert.ok(
      String(restoredRun?.result_path || '').includes(String(runAck.run_id)),
      'Expected workflow result path to remain stable after restart'
    );

    console.log('[external-test:workflow-run-persistence] PASS');
    console.log(`[external-test:workflow-run-persistence] workflow_id=${workflowId}`);
    console.log(`[external-test:workflow-run-persistence] run_id=${runAck.run_id}`);
  } finally {
    if (app) {
      await stopApp(app);
    }
    await removeDirWithRetries(userDataDir);
  }
}

run().catch((error) => {
  console.error('[external-test:workflow-run-persistence] FAIL:', error.message || String(error));
  process.exit(1);
});
