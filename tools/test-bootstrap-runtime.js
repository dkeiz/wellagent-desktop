const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { bootstrapApplication } = require('../src/main/bootstrap');
const { makeTempDir } = require('../tests/helpers/fakes');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) {
      throw new Error(`duplicate handler: ${channel}`);
    }
    this.handlers.set(channel, fn);
  }
}

class FakeWindow extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.sent = [];
    this.destroyed = false;
    this.webContents = {
      send: (channel, payload) => {
        this.sent.push({ channel, payload });
      }
    };
  }

  isDestroyed() {
    return this.destroyed;
  }

  closeWindow() {
    this.destroyed = true;
    this.emit('closed');
  }
}

function exitApp(code) {
  if (app && typeof app.exit === 'function') {
    app.exit(code);
    return;
  }
  process.exit(code);
}

async function removeDirWithRetry(targetPath, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      const isRetryable = ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code);
      if (!isRetryable) throw error;
      if (attempt === attempts - 1) {
        console.warn(`[test-bootstrap-runtime] Cleanup skipped for busy temp dir: ${targetPath}`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return false;
}

async function runContract() {
  const tempBase = makeTempDir('localagent-bootstrap-');
  const ipcMain = new FakeIpcMain();
  const windows = [];
  let runtime = null;

  try {
    runtime = await bootstrapApplication({
      app,
      ipcMain,
      dbPath: path.join(tempBase, 'localagent.db'),
      agentinRoot: path.join(tempBase, 'agentin'),
      promptBasePath: path.join(tempBase, 'prompts'),
      knowledgeBaseDir: path.join(tempBase, 'knowledge'),
      sessionWorkspaceBase: path.join(tempBase, 'workspaces'),
      agentBasePath: path.join(tempBase, 'agents'),
      memoryBasePath: path.join(tempBase, 'memory'),
      userProfilePath: path.join(tempBase, 'userabout', 'memoryaboutuser.md'),
      pluginsDir: path.join(tempBase, 'plugins'),
      connectorsDir: path.join(tempBase, 'connectors'),
      autoStartDaemons: false,
      createWindow: ({ kind }) => {
        const win = new FakeWindow(`${kind}-${windows.length + 1}`);
        windows.push(win);
        return win;
      }
    });

    const containerKeys = runtime.container.keys();
    [
      'db',
      'windowManager',
      'mcpServer',
      'aiService',
      'dispatcher',
      'workflowManager',
      'promptFileManager',
      'knowledgeManager',
      'pluginManager',
      'a2aManager',
      'runtimePaths'
    ].forEach(key => {
      assert.ok(containerKeys.includes(key), `Expected startup container to include ${key}`);
    });

    [
      'send-message',
      'a2a:get-status',
      'plugins:list',
      'knowledge:list',
      'daemon:memory-status'
    ].forEach(channel => {
      assert.ok(ipcMain.handlers.has(channel), `Expected IPC handler ${channel} to be registered`);
    });

    const eventBus = runtime.container.get('eventBus');
    const runtimePaths = runtime.container.get('runtimePaths');
    const agentMemory = runtime.container.get('agentMemory');
    const agentLoop = runtime.container.get('agentLoop');
    const workflowManager = runtime.container.get('workflowManager');
    const memoryDaemon = runtime.container.get('memoryDaemon');
    const sessionInitManager = runtime.container.get('sessionInitManager');
    const a2aManager = runtime.container.get('a2aManager');
    const firstWindow = runtime.windowManager.getMainWindow();
    assert.ok(firstWindow, 'Expected startup to create an initial main window');
    assert.equal(agentMemory.basePath, runtimePaths.memoryBasePath, 'Expected bootstrap to isolate agent memory paths');
    assert.equal(workflowManager.workflowsDir, path.join(runtimePaths.agentinRoot, 'workflows'), 'Expected workflow manager to use runtime workflow path');
    assert.equal(agentLoop.userProfilePath, runtimePaths.userProfilePath, 'Expected bootstrap to wire agent-loop to the runtime user profile');
    assert.equal(memoryDaemon.basePath, runtimePaths.backgroundDaemonBasePath, 'Expected bootstrap to isolate memory daemon state');
    assert.equal(sessionInitManager.connectorsDir, runtimePaths.connectorsDir, 'Expected bootstrap to wire session-init to runtime connectors');
    assert.equal(a2aManager.baseDir, runtimePaths.a2aBaseDir, 'Expected bootstrap to wire A2AManager to runtime A2A paths');
    assert.equal(eventBus._notifyPromptPath, runtimePaths.backgroundNotifyPromptPath, 'Expected bootstrap to isolate event-bus prompt paths');

    eventBus.publish('daemon:started', { summary: 'initial' });
    assert.ok(
      firstWindow.sent.some(entry => entry.channel === 'background-event' && entry.payload.type === 'daemon:started'),
      'Expected the initial main window to receive background events'
    );

    const firstWindowEventCount = firstWindow.sent.length;
    firstWindow.closeWindow();
    const recreatedWindow = runtime.handleActivate();
    assert.ok(recreatedWindow, 'Expected activate handler to recreate the main window');
    assert.notStrictEqual(recreatedWindow, firstWindow, 'Expected a distinct recreated main window');

    eventBus.publish('daemon:started', { summary: 'recreated' });
    assert.strictEqual(firstWindow.sent.length, firstWindowEventCount, 'Expected the closed window to stop receiving events');
    assert.ok(
      recreatedWindow.sent.some(entry => entry.channel === 'background-event' && entry.payload.payload.summary === 'recreated'),
      'Expected the recreated main window to receive new background events'
    );

    runtime.windowManager.send('conversation-update', { sessionId: 7 });
    assert.ok(
      recreatedWindow.sent.some(entry => entry.channel === 'conversation-update' && entry.payload.sessionId === 7),
      'Expected window manager sends to target the active main window'
    );

    console.log('[test-bootstrap-runtime] PASS');
  } finally {
    if (runtime) {
      await runtime.shutdown();
    }
    await removeDirWithRetry(tempBase);
  }
}

runContract()
  .then(() => {
    exitApp(0);
  })
  .catch(error => {
    console.error('[test-bootstrap-runtime] FAIL:', error);
    exitApp(1);
  });
