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

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-plugin-runtime-'));
  const app = startExternalApp({
    rootDir: ROOT,
    port: PORT,
    envOverrides: {
      LOCALAGENT_USER_DATA_PATH: userDataDir
    }
  });

  try {
    const health = await waitForHealth(app.baseUrl, 45000);
    assert.equal(health.windowCount, 0, 'Expected windowless external mode');

    const plugins = await invokeIpc(app.baseUrl, 'plugins:list');
    assert.ok(Array.isArray(plugins) && plugins.length > 0, 'Expected plugin list to be populated');
    const setupPlugin = plugins.find((plugin) => plugin.id === 'agent-setup-superagent');
    assert.ok(setupPlugin, 'Expected agent-setup-superagent plugin to be discoverable');

    const enableResult = await invokeIpc(app.baseUrl, 'plugins:enable', ['agent-setup-superagent']);
    assert.equal(enableResult.success, true, 'Expected setup superagent plugin enable to succeed');

    const widgets = await invokeIpc(app.baseUrl, 'plugins:get-sidebar-widgets');
    assert.ok(Array.isArray(widgets) && widgets.length > 0, 'Expected sidebar widgets after plugin enable');
    const setupWidget = widgets.find((widget) => widget.id === 'setup-health');
    assert.ok(setupWidget, 'Expected setup-health sidebar widget');
    assert.includes(setupWidget.actionNames || [], 'open-setup-chat', 'Expected setup widget action to be exposed');

    const widgetAction = await invokeIpc(app.baseUrl, 'plugins:run-sidebar-widget-action', ['setup-health', 'open-setup-chat', {}]);
    assert.equal(widgetAction.success, true, 'Expected sidebar widget action to succeed');
    assert.equal(widgetAction.result?.openAgentSlug, 'setup-superagent', 'Expected widget action to target setup-superagent');

    const agents = await invokeIpc(app.baseUrl, 'get-agents', ['pro']);
    assert.ok(Array.isArray(agents) && agents.length > 0, 'Expected pro agents to be available');
    const setupAgent = agents.find((agent) => agent.name === 'Setup Superagent');
    assert.ok(setupAgent, 'Expected Setup Superagent agent to exist');

    const subagents = await invokeIpc(app.baseUrl, 'get-agents', ['sub']);
    assert.ok(
      Array.isArray(subagents) && subagents.some((agent) => agent.name === 'Search Agent'),
      `Expected Search Agent subagent in fresh runtime, received: ${JSON.stringify(subagents)}`
    );

    const activation = await invokeIpc(app.baseUrl, 'activate-agent', [setupAgent.id]);
    assert.ok(activation?.sessionId, 'Expected agent activation to create or reuse a session');
    assert.equal(activation.agent?.id || activation.agent_id || setupAgent.id, setupAgent.id, 'Expected activation payload to match setup agent');

    const chatUi = await invokeIpc(app.baseUrl, 'get-agent-chat-ui', [setupAgent.id, { sessionId: activation.sessionId }]);
    assert.ok(chatUi, 'Expected setup superagent chat UI payload');
    assert.ok(typeof chatUi.html === 'string' && chatUi.html.includes('setup-superagent'), 'Expected setup UI HTML payload');

    const chatAction = await invokeIpc(app.baseUrl, 'run-agent-chat-ui-action', [
      setupAgent.id,
      'focus-step',
      { stepId: 'baseinit' },
      { sessionId: activation.sessionId }
    ]);
    assert.equal(chatAction.success, true, 'Expected setup superagent UI action to succeed');
    assert.ok(typeof chatAction.html === 'string' && chatAction.html.includes('baseinit'), 'Expected focused setup UI HTML');

    const createdSession = await invokeIpc(app.baseUrl, 'create-chat-session', [{ title: 'Runtime Restore Probe' }]);
    assert.ok(createdSession?.id, 'Expected create-chat-session to return an id');

    await invokeIpc(app.baseUrl, 'add-conversation', [{ role: 'user', content: 'restore me once' }]);
    await invokeIpc(app.baseUrl, 'add-conversation', [{ role: 'assistant', content: 'restored response once' }]);
    const loadedMessages = await invokeIpc(app.baseUrl, 'load-chat-session', [createdSession.id, { includeHidden: true }]);
    assert.equal(loadedMessages.length, 2, 'Expected created chat session to persist messages');

    const sessionMeta = await invokeIpc(app.baseUrl, 'get-chat-session-meta', [createdSession.id]);
    assert.equal(sessionMeta.id, createdSession.id, 'Expected chat session meta lookup to work');

    const switchResult = await invokeIpc(app.baseUrl, 'switch-chat-session', [createdSession.id]);
    assert.equal(switchResult.success, true, 'Expected switch-chat-session to succeed');

    const recentSessions = await invokeIpc(app.baseUrl, 'get-chat-sessions', [null, 20]);
    const restoredSession = recentSessions.find((session) => Number(session.id) === Number(createdSession.id));
    assert.ok(restoredSession, 'Expected recent session listing to include created runtime session');
    assert.equal(Number(restoredSession.message_count || 0), 2, 'Expected recent session listing to preserve message count');

    const contextEstimate = await invokeIpc(app.baseUrl, 'get-context-usage-estimate', [createdSession.id, 'follow-up prompt']);
    assert.ok(Number(contextEstimate?.tokens || contextEstimate?.prompt_tokens || 0) > 0, 'Expected non-zero context estimate for restored chat');

    const workflows = await invokeIpc(app.baseUrl, 'get-workflows');
    assert.ok(Array.isArray(workflows) && workflows.length > 0, 'Expected workflow list to be populated');
    const healthWorkflow = workflows.find((workflow) => workflow.name === 'System Health Check');
    assert.ok(healthWorkflow, 'Expected System Health Check workflow to be available');

    const workflowRun = await invokeIpc(app.baseUrl, 'run-workflow-advanced', [
      healthWorkflow.id,
      { mode: 'sync', sessionId: createdSession.id }
    ]);
    assert.equal(workflowRun.success, true, 'Expected workflow run request to succeed');
    assert.equal(workflowRun.accepted, true, 'Expected workflow run to be accepted');
    assert.equal(workflowRun.immediate, true, 'Expected sync workflow run to complete immediately');
    assert.equal(workflowRun.result?.success, true, 'Expected System Health Check workflow to complete');
    assert.equal(Array.isArray(workflowRun.result?.results), true, 'Expected workflow results array');

    console.log('[external-test:plugin-superagent] PASS runtime wiring flow');
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
  console.error('[external-test:plugin-superagent] FAIL:', error.message || String(error));
  process.exit(1);
});
