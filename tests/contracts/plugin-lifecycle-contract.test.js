const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, TestContainer, PluginCapabilityStub } = require('../helpers/fakes');

module.exports = {
  name: 'plugin-lifecycle-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const db = new MemoryDB();
    const capabilityManager = new PluginCapabilityStub();
    const mcpServer = new MCPServer(db, capabilityManager);
    const container = new TestContainer({ db, mcpServer, capabilityManager });
    const pluginManager = new PluginManager(container);

    await pluginManager.initialize();
    await pluginManager.enablePlugin('test-plugin');
    assert.equal(
      pluginManager.listPlugins().find(plugin => plugin.id === 'test-plugin')?.visibleInSidebar,
      true,
      'Plugins should show in the sidebar by default'
    );

    const hiddenState = pluginManager.setPluginSidebarVisible('test-plugin', false);
    assert.equal(hiddenState.visibleInSidebar, false, 'Plugin sidebar visibility should toggle off');
    assert.equal(
      pluginManager.listPlugins().find(plugin => plugin.id === 'test-plugin')?.visibleInSidebar,
      false,
      'Plugin list should expose hidden sidebar visibility'
    );
    assert.equal(
      pluginManager.getPluginDetail('test-plugin')?.visibleInSidebar,
      false,
      'Plugin detail should expose hidden sidebar visibility'
    );

    const executeResult = await mcpServer.executeTool('plugin_test_plugin_hello', { name: 'Tester' });
    assert.equal(executeResult.success, true, 'Enabled plugin tool should execute');
    assert.equal(capabilityManager.isToolActive('plugin_test_plugin_hello'), true, 'Plugin tool should be active in capability manager');

    await pluginManager.disablePlugin('test-plugin');
    assert.equal(mcpServer.tools.has('plugin_test_plugin_hello'), false, 'Disabled plugin tool should be removed');

    await pluginManager.enablePlugin('agent-file-browser');
    await pluginManager.enablePlugin('agent-research-orchestrator-ui');
    const researchPlugins = pluginManager.getAgentPlugins('research-orchestrator');
    assert.equal(
      pluginManager.getAgentPlugin('research-orchestrator'),
      'agent-file-browser',
      'Agent-bound plugin lookup should resolve companion plugin'
    );
    assert.ok(
      researchPlugins.includes('agent-research-orchestrator-ui'),
      'Agent should support multiple UI companion plugins'
    );
    const chatUI = await pluginManager.getAgentChatUI({
      slug: 'research-orchestrator',
      name: 'Research Orchestrator',
      folderPath: path.join(rootDir, 'agentin', 'agents', 'pro', 'research-orchestrator')
    });
    assert.includes(chatUI.html, 'Research Orchestrator', 'Agent chat UI should render individual agent panel');
    assert.includes(chatUI.html, 'data-agent-ui-action="add-child"', 'Agent chat UI should render current research controls');
    const refreshResult = await pluginManager.runAgentChatUIAction(
      { slug: 'research-orchestrator', name: 'Research Orchestrator', folderPath: path.join(rootDir, 'agentin', 'agents', 'pro', 'research-orchestrator') },
      'refresh',
      { pluginId: 'agent-research-orchestrator-ui' }
    );
    assert.includes(refreshResult.html, 'Research Orchestrator', 'Agent UI action should return updated plugin HTML');
    await pluginManager.disablePlugin('agent-research-orchestrator-ui');
    await pluginManager.disablePlugin('agent-file-browser');

    db.run('UPDATE plugins SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['enabled', null, 'test-plugin']);
    const restartManager = new PluginManager(container);
    await restartManager.initialize();
    assert.equal(
      mcpServer.tools.has('plugin_test_plugin_hello'),
      true,
      'Plugin marked enabled in DB should auto-enable and wire handlers on startup'
    );
    await restartManager.disablePlugin('test-plugin');

    const tempPluginId = `tmp-rollback-plugin-${Date.now()}`;
    const tempPluginDir = path.join(rootDir, 'agentin', 'plugins', tempPluginId);
    fs.mkdirSync(tempPluginDir, { recursive: true });
    fs.writeFileSync(path.join(tempPluginDir, 'plugin.json'), JSON.stringify({
      id: tempPluginId,
      name: 'Tmp Rollback Plugin',
      version: '1.0.0',
      main: 'main.js'
    }, null, 2));
    fs.writeFileSync(
      path.join(tempPluginDir, 'main.js'),
      "module.exports = { async onEnable(ctx) { ctx.registerHandler('partial', { description: 'partial', inputSchema: { type: 'object' } }, async () => 'ok'); throw new Error('boom'); } };"
    );

    try {
      const rollbackManager = new PluginManager(container);
      await rollbackManager.initialize();

      let rollbackError = null;
      try {
        await rollbackManager.enablePlugin(tempPluginId);
      } catch (error) {
        rollbackError = error;
      }

      const pluginState = rollbackManager.plugins.get(tempPluginId);
      assert.ok(rollbackError, 'Expected rollback plugin enable to fail');
      assert.equal(pluginState.status, 'error', 'Failed plugin should move to error state');
      assert.equal(pluginState.handlers.length, 0, 'Failed plugin should not retain handlers');
      assert.equal(
        mcpServer.tools.has(`plugin_${tempPluginId.replace(/-/g, '_')}_partial`),
        false,
        'Failed plugin should not leave registered tools behind'
      );
    } finally {
      fs.rmSync(tempPluginDir, { recursive: true, force: true });
    }

    const hotReloadPluginId = `tmp-hot-reload-plugin-${Date.now()}`;
    const hotReloadPluginDir = path.join(rootDir, 'agentin', 'plugins', hotReloadPluginId);
    fs.mkdirSync(hotReloadPluginDir, { recursive: true });
    fs.writeFileSync(path.join(hotReloadPluginDir, 'helper.js'), "module.exports = () => 'v1';");
    fs.writeFileSync(path.join(hotReloadPluginDir, 'plugin.json'), JSON.stringify({
      id: hotReloadPluginId,
      name: 'Tmp Hot Reload Plugin',
      version: '1.0.0',
      main: 'main.js'
    }, null, 2));
    fs.writeFileSync(
      path.join(hotReloadPluginDir, 'main.js'),
      "const helper = require('./helper'); module.exports = { async onEnable(ctx) { ctx.registerHandler('version', { description: 'version', inputSchema: { type: 'object' } }, async () => ({ version: helper() })); } };"
    );

    try {
      const hotReloadManager = new PluginManager(container);
      await hotReloadManager.initialize();
      await hotReloadManager.enablePlugin(hotReloadPluginId);
      const toolName = `plugin_${hotReloadPluginId.replace(/-/g, '_')}_version`;

      let first = await mcpServer.executeTool(toolName, {});
      assert.equal(first.result.version, 'v1', 'Expected first plugin load to use helper v1');

      await hotReloadManager.disablePlugin(hotReloadPluginId);
      fs.writeFileSync(path.join(hotReloadPluginDir, 'helper.js'), "module.exports = () => 'v2';");
      await hotReloadManager.enablePlugin(hotReloadPluginId);
      const second = await mcpServer.executeTool(toolName, {});
      assert.equal(second.result.version, 'v2', 'Expected hot reload to pick updated helper module');
      await hotReloadManager.disablePlugin(hotReloadPluginId);
    } finally {
      fs.rmSync(hotReloadPluginDir, { recursive: true, force: true });
    }
  }
};
