const { buildPluginKnowledgeRuntime } = require('../../src/main/ipc/runtime-dependencies');

module.exports = {
  name: 'plugin-ipc-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const shared = {
      container: { optional() { return null; } },
      pluginManager: { listPlugins() { return []; } },
      agentManager: { getAgent() { return null; } },
      mcpServer: { tools: new Map() },
      db: { get() { return null; } },
      windowManager: { send() {} },
      runtimePaths: { pluginsDir: 'C:\\plugins' },
      knowledgeManager: { listItems() { return []; } }
    };

    const runtime = buildPluginKnowledgeRuntime(shared);
    assert.equal(runtime.container, shared.container, 'Expected plugin IPC runtime to expose the service container');
    assert.equal(runtime.windowManager, shared.windowManager, 'Expected plugin IPC runtime to expose the window manager');
    assert.equal(runtime.pluginManager, shared.pluginManager, 'Expected plugin IPC runtime to keep plugin manager access');
    assert.equal(runtime.runtimePaths, shared.runtimePaths, 'Expected plugin IPC runtime to expose runtime paths');
    assert.equal(runtime.knowledgeManager, shared.knowledgeManager, 'Expected plugin IPC runtime to expose the knowledge manager');
  }
};
