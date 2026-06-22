const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { RuntimePolicy } = require('../../src/main/runtime-policy');
const { MemoryDB, TestContainer, PluginCapabilityStub, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'plugin-runtime-boundary-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-plugin-boundary-');
    const pluginsDir = path.join(tempDir, 'plugins');
    const deniedPluginDir = path.join(pluginsDir, 'strict-denied-plugin');
    const allowedPluginDir = path.join(pluginsDir, 'strict-allowed-plugin');

    fs.mkdirSync(deniedPluginDir, { recursive: true });
    fs.mkdirSync(allowedPluginDir, { recursive: true });
    fs.writeFileSync(path.join(deniedPluginDir, 'plugin.json'), JSON.stringify({
      id: 'strict-denied-plugin',
      name: 'Strict Denied Plugin',
      version: '1.0.0',
      main: 'main.js',
      runtimePermissions: {
        profile: 'plugin-strict'
      }
    }, null, 2));
    fs.writeFileSync(
      path.join(deniedPluginDir, 'main.js'),
      "module.exports = { async onEnable(ctx) { await ctx.connectors.list(); } };",
      'utf-8'
    );

    fs.writeFileSync(path.join(allowedPluginDir, 'plugin.json'), JSON.stringify({
      id: 'strict-allowed-plugin',
      name: 'Strict Allowed Plugin',
      version: '1.0.0',
      main: 'main.js',
      runtimePermissions: {
        profile: 'plugin-strict'
      }
    }, null, 2));
    fs.writeFileSync(
      path.join(allowedPluginDir, 'main.js'),
      "module.exports = { async onEnable(ctx) { ctx.registerHandler('hello', { description: 'hello', inputSchema: { type: 'object' } }, async () => ({ ok: true })); } };",
      'utf-8'
    );

    const db = new MemoryDB();
    const capabilityManager = new PluginCapabilityStub();
    const mcpServer = new MCPServer(db, capabilityManager);
    const runtimePolicy = new RuntimePolicy();
    const container = new TestContainer({
      db,
      mcpServer,
      capabilityManager,
      runtimePolicy,
      connectorRuntime: {
        listConnectors() {
          return [];
        }
      }
    });
    const pluginManager = new PluginManager(container, { pluginsDir });

    try {
      await pluginManager.initialize();

      let deniedError = null;
      try {
        await pluginManager.enablePlugin('strict-denied-plugin');
      } catch (error) {
        deniedError = error;
      }
      assert.equal(deniedError?.code, 'RUNTIME_POLICY_DENIED', 'Expected strict plugin connector access to be policy-denied');

      await pluginManager.enablePlugin('strict-allowed-plugin');
      const result = await mcpServer.executeTool('plugin_strict_allowed_plugin_hello', {});
      assert.equal(result.result.ok, true, 'Expected strict plugin core handler registration to remain allowed');
      await pluginManager.disablePlugin('strict-allowed-plugin');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
