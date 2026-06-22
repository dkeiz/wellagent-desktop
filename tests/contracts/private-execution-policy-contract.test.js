const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const SessionWorkspace = require('../../src/main/session-workspace');
const { makeTempDir } = require('../helpers/fakes');

function createServer() {
  return new MCPServer({
    async getSetting(key) {
      if (key === 'tool_timeout_ms') return '5000';
      return null;
    }
  }, {
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  });
}

module.exports = {
  name: 'private-execution-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-private-exec-');
    const sessionWorkspace = new SessionWorkspace(path.join(tempBase, 'workspaces'));
    const privateSessionId = 'private-policy-test';
    const server = createServer();
    const toolEvents = [];
    let customCalls = 0;
    let pluginCalls = 0;
    let subagentCalls = 0;

    server.setSessionWorkspace(sessionWorkspace);
    server.setCurrentSessionId(privateSessionId);
    server.on('tool-executed', event => toolEvents.push(event));
    server.setAgentManager({
      async invokeSubAgent(parentSessionId) {
        subagentCalls += 1;
        return { accepted: true, parentSessionId };
      },
      async getAgent() {
        return { id: 1, name: 'Worker', type: 'sub' };
      },
      async getAgents() {
        return [{ id: 1, name: 'Worker', type: 'sub' }];
      }
    });

    server.registerTool('unsafe_private_custom', {
      name: 'unsafe_private_custom',
      description: 'Unsafe test helper',
      inputSchema: { type: 'object' },
      isCustom: true
    }, async () => {
      customCalls += 1;
      return { ok: true };
    });

    server.registerTool('plugin_demo_action', {
      name: 'plugin_demo_action',
      description: 'Plugin test helper',
      inputSchema: { type: 'object' },
      isPlugin: true,
      pluginId: 'demo'
    }, async () => {
      pluginCalls += 1;
      return { ok: true };
    });

    try {
      const customResult = await server.executeTool('unsafe_private_custom', {});
      assert.equal(customResult.success, true, 'Expected custom tool to execute in private mode');
      assert.equal(customCalls, 1, 'Expected private custom handler to run');

      const pluginResult = await server.executeTool('plugin_demo_action', {});
      assert.equal(pluginResult.success, true, 'Expected plugin tool to execute in private mode');
      assert.equal(pluginCalls, 1, 'Expected private plugin handler to run');

      const subagentResult = await server.executeTool('subagent', {
        action: 'run',
        id: 1,
        task: 'Do private work'
      });
      assert.equal(subagentResult.success, true, 'Expected subagent tool to execute in private mode');
      assert.equal(subagentCalls, 1, 'Expected private subagent handler to run');

      const writeResult = await server.executeTool('write_file', {
        path: '{workspace}/note.txt',
        content: 'private artifact'
      });
      assert.equal(writeResult.success, true, 'Expected private workspace write to execute');
      assert.equal(
        fs.existsSync(path.join(sessionWorkspace.getWorkspacePath(privateSessionId), 'note.txt')),
        true,
        'Expected private workspace artifact to be written'
      );

      const outsidePath = path.join(tempBase, 'outside.txt');
      fs.writeFileSync(outsidePath, 'outside', 'utf-8');
      const outsideRead = await server.executeTool('read_file', { path: outsidePath });
      assert.equal(outsideRead.success, true, 'Expected file tool to execute in private mode');
      assert.equal(outsideRead.result.content, 'outside', 'Expected private file read to return content to caller');

      assert.equal(toolEvents.length, 0, 'Expected private tool calls not to emit tool trace events');

      server.setCurrentSessionId('normal-session');
      await server.executeTool('unsafe_private_custom', {});
      assert.equal(toolEvents.length, 1, 'Expected non-private tool call to emit trace event');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
