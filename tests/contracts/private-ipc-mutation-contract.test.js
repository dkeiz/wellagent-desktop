const { registerPluginKnowledgeHandlers } = require('../../src/main/ipc/register-plugin-knowledge-handlers');
const { registerAgentSystemHandlers } = require('../../src/main/ipc/register-agent-system-handlers');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    this.handlers.set(channel, fn);
  }

  invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler({}, ...args);
  }
}

class FakeContainer {
  constructor(map = {}) {
    this.map = map;
  }

  optional(name) {
    return this.map[name] || null;
  }
}

module.exports = {
  name: 'private-ipc-mutation-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const privateSessionId = 'private-ipc-test';
    const mcpServer = {
      getCurrentSessionId() { return privateSessionId; },
      on() {}
    };
    const pluginCalls = { config: 0, action: 0 };
    const daemonCalls = { start: 0 };

    const pluginIpc = new FakeIpcMain();
    registerPluginKnowledgeHandlers(pluginIpc, {
      container: new FakeContainer({
        pluginManager: {
          async setPluginConfig() { pluginCalls.config += 1; },
          async runPluginAction() {
            pluginCalls.action += 1;
            return { ok: true };
          }
        },
        knowledgeManager: {
          async promoteStaged() { throw new Error('should not run'); }
        }
      }),
      windowManager: { send() {} },
      mcpServer
    });

    const configResult = await pluginIpc.invoke('plugins:set-config', 'demo', 'k', 'v');
    assert.equal(configResult.success, true, 'Expected private plugin config mutation to run');
    assert.equal(pluginCalls.config, 1, 'Expected private plugin config handler to run');

    const actionResult = await pluginIpc.invoke(
      'plugins:run-action',
      'demo',
      'refresh',
      {}
    );
    assert.equal(actionResult.success, true, 'Expected private plugin action to run');
    assert.equal(pluginCalls.action, 1, 'Expected private plugin action handler to run');

    const agentIpc = new FakeIpcMain();
    registerAgentSystemHandlers(agentIpc, {
      mcpServer,
      windowManager: { send() {} },
      memoryDaemon: {
        async start() { daemonCalls.start += 1; },
        getStatus() { return { running: false }; }
      },
      workflowScheduler: null,
      testClientMode: false
    }, {
      async syncDaemonEnabledSetting() {}
    });

    const daemonResult = await agentIpc.invoke('daemon:memory-start');
    assert.equal(daemonResult.success, true, 'Expected private daemon start IPC to run');
    assert.equal(daemonCalls.start, 1, 'Expected private daemon start handler to run');
  }
};
