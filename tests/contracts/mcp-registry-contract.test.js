const MCPServer = require('../../src/main/mcp-server');

module.exports = {
  name: 'mcp-registry-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const capabilityManager = {
      getGroupsConfig: () => [],
      getActiveTools: () => []
    };

    const server = new MCPServer({}, capabilityManager);

    assert.ok(server.tools.has('run_command'), 'Expected run_command to be registered');
    assert.ok(server.tools.has('current_time'), 'Expected current_time to be registered');
    assert.ok(server.tools.has('search_workspace'), 'Expected search_workspace to be registered');
    assert.ok(server.tools.has('execution_root'), 'Expected execution_root to be registered');

    let duplicateError = null;
    try {
      server.registerTool('run_command', {
        name: 'run_command',
        inputSchema: { type: 'object' }
      }, async () => ({}));
    } catch (error) {
      duplicateError = error;
    }

    assert.ok(duplicateError, 'Expected duplicate tool registration to throw');
    assert.includes(duplicateError.message, 'Tool already registered', 'Expected duplicate registration guard');
  }
};
