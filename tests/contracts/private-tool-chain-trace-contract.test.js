const MCPServer = require('../../src/main/mcp-server');
const ToolChainController = require('../../src/main/tool-chain-controller');

module.exports = {
  name: 'private-tool-chain-trace-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const mcp = new MCPServer({
      async getSetting(key) {
        if (key === 'tool_timeout_ms') return '5000';
        return null;
      }
    }, {
      isToolActive() { return true; },
      getGroupsConfig() { return []; },
      getActiveTools() { return []; }
    });
    let toolCalls = 0;
    let dispatchCalls = 0;
    let traceCalls = 0;
    let capturedWorkflows = 0;

    mcp.registerTool('demo_private_echo', {
      name: 'demo_private_echo',
      description: 'Private trace helper',
      inputSchema: { type: 'object' }
    }, async () => {
      toolCalls += 1;
      return { text: 'secret-result' };
    });

    const dispatcher = {
      async dispatch() {
        dispatchCalls += 1;
        if (dispatchCalls === 1) {
          return {
            content: 'TOOL:demo_private_echo{}',
            model: 'mock'
          };
        }
        return { content: 'done', model: 'mock' };
      }
    };

    const chain = new ToolChainController(dispatcher, mcp, {});
    chain.setWorkflowManager({
      async captureWorkflow() {
        capturedWorkflows += 1;
      }
    });
    chain.setAutoCapture(true);

    const result = await chain.executeWithChaining('secret request', [], {
      sessionId: 'private-chain-test',
      trace: {
        onToolQueued() { traceCalls += 1; },
        onToolResult() { traceCalls += 1; },
        onSyntheticUserMessage() { traceCalls += 1; }
      }
    });

    assert.equal(result.content, 'done', 'Expected private chain to execute tool and continue');
    assert.equal(toolCalls, 1, 'Expected private chain tool to run');
    assert.equal(traceCalls, 0, 'Expected private chain trace hooks not to run');
    assert.equal(result.chain.private, true, 'Expected private chain metadata flag');
    assert.deepEqual(result.chain.tools, [], 'Expected private chain metadata to redact tool names');
    assert.equal(capturedWorkflows, 0, 'Expected private chain not to auto-capture workflow trace');
  }
};
