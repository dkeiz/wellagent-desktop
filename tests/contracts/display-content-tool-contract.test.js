const MCPServer = require('../../src/main/mcp-server');

function createServer() {
  const capabilityManager = {
    isToolActive() {
      return true;
    },
    getGroupsConfig() {
      return [];
    },
    getActiveTools() {
      return [];
    }
  };

  const db = {
    async getSetting(key) {
      if (key === 'tool_timeout_ms') return '5000';
      return null;
    }
  };

  return new MCPServer(db, capabilityManager);
}

module.exports = {
  name: 'display-content-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const server = createServer();
    const tool = server.getTools().find(entry => entry.name === 'display_content');
    assert.ok(tool, 'Expected display_content to be registered as a built-in tool');
    assert.ok(tool.inputSchema.properties.type.enum.includes('file'), 'Expected display_content to accept local files');
    assert.ok(tool.inputSchema.properties.type.enum.includes('document'), 'Expected display_content to accept documents');

    let emitted = null;
    let artifact = null;
    server.on('tool-executed', payload => {
      emitted = payload;
    });
    server.setArtifactRegistry({
      registerVirtual(sessionId, payload) {
        artifact = { sessionId, payload };
      }
    });

    const result = await server.executeTool(
      'display_content',
      { type: 'html', title: 'Panel', html: '<h1>Hi</h1>' },
      null,
      { context: { sessionId: 'session-42', agentId: 'agent-7' } }
    );

    assert.equal(result.success, true, 'Expected display_content execution to succeed');
    assert.equal(result.result.type, 'html', 'Expected type to be preserved');
    assert.equal(result.result.html, '<h1>Hi</h1>', 'Expected html payload to be preserved');
    assert.equal(result.result.sourceAgentId, 'agent-7', 'Expected agent context to be attached');
    assert.equal(result.result.sourceSessionId, 'session-42', 'Expected session context to be attached');
    assert.equal(emitted.toolName, 'display_content', 'Expected tool execution event for renderer bridge');
    assert.equal(artifact.sessionId, 'session-42', 'Expected virtual artifact to be scoped to the active session');
    assert.equal(artifact.payload.data.html, '<h1>Hi</h1>', 'Expected virtual artifact to store display payload data');

    const textResult = await server.executeTool(
      'display_content',
      { type: 'document', title: 'Doc', text: 'doc body' },
      null,
      { context: { sessionId: 'session-43' } }
    );
    assert.equal(textResult.result.content, 'doc body', 'Expected text alias to normalize to content');
    assert.equal(textResult.result.text, 'doc body', 'Expected text alias to normalize to text');
  }
};
