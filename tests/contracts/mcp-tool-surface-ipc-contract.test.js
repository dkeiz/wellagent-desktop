const { registerToolsCapabilityHandlers } = require('../../src/main/ipc/register-tools-capability-handlers');

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

module.exports = {
  name: 'mcp-tool-surface-ipc-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const inventory = [
      { name: 'global_tool', description: 'Visible everywhere' },
      { name: 'scoped_tool', description: 'Visible only for a matching agent' }
    ];
    const calls = {
      getTools: 0,
      getToolsForContext: [],
      getActiveToolsForContext: []
    };

    const mcpServer = {
      getTools() {
        calls.getTools += 1;
        return inventory;
      },
      async getToolsForContext(context = {}) {
        calls.getToolsForContext.push(context);
        return Number(context.agentId) === 101 ? inventory : [inventory[0]];
      },
      async getActiveToolsForContext(context = {}) {
        calls.getActiveToolsForContext.push(context);
        return Number(context.agentId) === 101 ? inventory : [inventory[0]];
      },
      getToolsDocumentation() {
        return [];
      },
      getToolGroups() {
        return [];
      },
      getActiveTools() {
        return inventory;
      },
      tools: new Map(inventory.map((tool) => [tool.name, { definition: tool }]))
    };

    const ipc = new FakeIpcMain();
    registerToolsCapabilityHandlers(ipc, {
      db: {},
      mcpServer,
      windowManager: { send() {} },
      capabilityManager: null,
      toolPermissionService: null
    });

    const defaultVisible = await ipc.invoke('get-mcp-tools', {});
    assert.deepEqual(
      defaultVisible.map((tool) => tool.name),
      ['global_tool'],
      'Expected default get-mcp-tools to return only context-visible tools'
    );

    const scopedVisible = await ipc.invoke('get-mcp-tools', { agentId: 101 });
    assert.deepEqual(
      scopedVisible.map((tool) => tool.name),
      ['global_tool', 'scoped_tool'],
      'Expected agent-scoped get-mcp-tools to include scoped tools for the matching agent'
    );

    const inventoryViaMode = await ipc.invoke('get-mcp-tools', { mode: 'inventory' });
    assert.deepEqual(
      inventoryViaMode.map((tool) => tool.name),
      ['global_tool', 'scoped_tool'],
      'Expected inventory mode to return the full registry'
    );

    const inventoryViaDedicated = await ipc.invoke('get-mcp-tool-inventory');
    assert.deepEqual(
      inventoryViaDedicated.map((tool) => tool.name),
      ['global_tool', 'scoped_tool'],
      'Expected dedicated inventory handler to return the full registry'
    );

    const defaultActive = await ipc.invoke('capability:get-active-tools', {});
    assert.deepEqual(
      defaultActive,
      ['global_tool'],
      'Expected active-tool fallback to stay context-filtered without ToolPermissionService'
    );

    const scopedActive = await ipc.invoke('capability:get-active-tools', { agentId: 101 });
    assert.deepEqual(
      scopedActive,
      ['global_tool', 'scoped_tool'],
      'Expected active-tool fallback to include scoped tools for a matching agent'
    );

    assert.equal(calls.getTools, 2, 'Expected full registry reads only through explicit inventory handlers');
    assert.equal(calls.getToolsForContext.length, 2, 'Expected visible-tool queries to use context filtering');
    assert.equal(calls.getActiveToolsForContext.length, 2, 'Expected active-tool fallback to use context filtering');
  }
};
