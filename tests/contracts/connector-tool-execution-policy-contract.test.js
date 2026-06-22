const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const { ExecutionDirectory } = require('../../src/main/execution-directory');
const { normalizeConnectorName } = require('../../src/main/connector-name-policy');
const { makeTempDir } = require('../helpers/fakes');

function createServer(db, executionRoot, connectorsDir) {
  const server = new MCPServer(db, {
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  });
  server.setExecutionDirectory(new ExecutionDirectory(db, { defaultRoot: executionRoot }));
  server.setConnectorRuntime({
    connectorsDir,
    listConnectors: () => [],
    startConnector: async (name) => ({ success: true, name }),
    stopConnector: async (name) => ({ success: true, name }),
    getConfig: async () => ({}),
    setConfig: async (name, key, value) => ({ success: true, name, key, value })
  });
  return server;
}

module.exports = {
  name: 'connector-tool-execution-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-connector-policy-');
    const executionRoot = path.join(tempBase, 'project');
    const connectorsDir = path.join(tempBase, 'agentin', 'connectors');
    const db = {
      async getSetting() { return null; },
      async getCustomTools() { return []; }
    };

    try {
      fs.mkdirSync(executionRoot, { recursive: true });
      const server = createServer(db, executionRoot, connectorsDir);

      const created = await server.executeTool('connector_op', {
        action: 'create',
        name: 'safe-connector',
        code: 'module.exports = { name: "safe-connector" };'
      });
      assert.equal(created.success, true, 'Connector create should succeed inside the connector root');
      assert.ok(fs.existsSync(path.join(connectorsDir, 'safe-connector.js')), 'Connector file should be created under connectorsDir');

      let invalidMessage = '';
      try {
        await server.executeTool('connector_op', {
          action: 'create',
          name: '../escape',
          code: 'module.exports = {};'
        });
      } catch (error) {
        invalidMessage = error.message || '';
      }
      assert.includes(invalidMessage, 'Connector name', 'Connector create should reject path-like names');
      assert.equal(fs.existsSync(path.join(tempBase, 'escape.js')), false, 'Rejected connector names must not write outside connectorsDir');

      assert.equal(normalizeConnectorName('telegram-relay'), 'telegram-relay', 'Expected ordinary connector names to pass');
      let runtimePolicyMessage = '';
      try {
        normalizeConnectorName('..\\escape');
      } catch (error) {
        runtimePolicyMessage = error.message || '';
      }
      assert.includes(runtimePolicyMessage, 'Connector name', 'Connector runtime should share the same traversal-rejecting name policy');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
