const MCPServer = require('../../src/main/mcp-server');
const ToolChainController = require('../../src/main/tool-chain-controller');

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

  const server = new MCPServer(db, capabilityManager);
  server.registerTool('demo_echo', {
    name: 'demo_echo',
    description: 'Echo input',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' }
      }
    }
  }, async (params) => ({ echoed: params.text }));
  server.registerTool('demo_fail', {
    name: 'demo_fail',
    description: 'Always fails',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' }
      }
    }
  }, async () => {
    throw new Error('upstream server unreachable');
  });
  return server;
}

module.exports = {
  name: 'tool-chain-controller-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = {};

    {
      const mcp = createServer();
      let executeCount = 0;
      const originalExecute = mcp.executeTool.bind(mcp);
      mcp.executeTool = async (...args) => {
        executeCount++;
        return originalExecute(...args);
      };

      const dispatcher = {
        async dispatch() {
          return {
            content: 'TOOL:demo_echo{"text":}',
            reasoning: 'r1',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.equal(executeCount, 0, 'Expected malformed tool call not to execute');
      assert.equal(result.chain.steps, 1, 'Expected malformed response to end turn without continuation');
      assert.equal(result.reasoning, 'r1', 'Expected reasoning to be preserved on terminal return');
    }

    {
      const mcp = createServer();
      const dispatcher = {
        async dispatch() {
          return {
            content: 'TOOL:demo_echo{"text":"unterminated"\nThe rest of this answer should remain visible.',
            reasoning: 'r1b',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.includes(result.content, 'The rest of this answer should remain visible.', 'Expected malformed TOOL payload to preserve trailing text');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const syntheticMessages = [];
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: 'TOOL:demo_echo{"text":"ok"}',
              reasoning: 'r2',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'done',
            reasoning: 'r3',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {
        trace: {
          async onSyntheticUserMessage(payload) {
            syntheticMessages.push(payload);
          }
        }
      });
      assert.equal(result.content, 'done', 'Expected chain to continue after real tool execution');
      assert.equal(result.chain.steps, 2, 'Expected second step after successful tool run');
      assert.ok(result.chain.tools.includes('demo_echo'), 'Expected executed tool to be tracked in chain metadata');
      assert.equal(result.reasoning, 'r3', 'Expected latest reasoning to be returned');
      assert.equal(syntheticMessages.length, 1, 'Expected backend-generated tool-results message to be traceable');
      assert.includes(syntheticMessages[0].content, '<tool_results>', 'Expected synthetic message to preserve tool-results wrapper');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: '<minimax:tool_call><invoke name="demo_echo"><parameter name="text">ok-from-invoke</parameter></invoke></minimax:tool_call>',
              reasoning: 'invoke-r1',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'invoke done',
            reasoning: 'invoke-r2',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('hello', [], {});
      assert.equal(result.content, 'invoke done', 'Expected invoke-style tool call to execute and continue chain');
      assert.equal(result.chain.steps, 2, 'Expected invoke-style call to trigger second step');
      assert.ok(result.chain.tools.includes('demo_echo'), 'Expected invoke-style call to record demo_echo tool');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const syntheticMessages = [];
      const dispatcher = {
        async dispatch() {
          turn++;
          if (turn === 1) {
            return {
              content: 'TOOL:demo_fail{"city":"Moscow"}',
              reasoning: 'r4',
              model: 'demo-model',
              renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
            };
          }
          return {
            content: 'Weather service is unavailable right now.',
            reasoning: 'r5',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model', runtimeConfig: { reasoning: { visibility: 'show' } } }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      const result = await chain.executeWithChaining('weather?', [], {
        trace: {
          async onSyntheticUserMessage(payload) {
            syntheticMessages.push(payload);
          }
        }
      });

      assert.equal(result.content, 'Weather service is unavailable right now.', 'Expected failed tool to still continue with synthetic tool_results context');
      assert.equal(result.chain.steps, 2, 'Expected a second step after tool failure');
      assert.equal(syntheticMessages.length, 1, 'Expected one synthetic tool-results message for failed tool');
      assert.includes(syntheticMessages[0].content, 'Error: upstream server unreachable', 'Expected error details to be forwarded to the model');
    }

    {
      const mcp = createServer();
      let executeCount = 0;
      const originalExecute = mcp.executeTool.bind(mcp);
      mcp.executeTool = async (...args) => {
        executeCount++;
        return originalExecute(...args);
      };
      const dispatcher = {
        async dispatch() {
          return {
            content: 'TOOL:demo_echo{"text":"should-not-run"}',
            reasoning: 'stop-r1',
            model: 'demo-model',
            renderContext: { provider: 'ollama', model: 'demo-model' }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      chain.stopChain('subtask-run-1');
      const result = await chain.executeWithChaining('hello', [], {
        subagentRunId: 'subtask-run-1'
      });
      assert.equal(executeCount, 0, 'Expected scoped stop to prevent tool execution for the stopped run');
      assert.equal(result.chain.steps, 0, 'Expected stopped scoped chain to exit before running a step');

      const next = await chain.executeWithChaining('hello', [], {
        subagentRunId: 'subtask-run-2',
        maxChainSteps: 1
      });
      assert.equal(next.chain.steps, 1, 'Expected scoped stop not to affect another subagent run');
    }

    {
      const mcp = createServer();
      let turn = 0;
      const dispatchOptions = [];
      const runtimeConfig = { concurrency: { allowParallel: true }, reasoning: { enabled: false } };
      const modelSpec = { capabilities: { concurrency: { supported: true } } };
      const principal = { type: 'subagent', id: 'subagent:1:run', profile: 'strict-subagent' };
      const toolContexts = [];
      const originalExecute = mcp.executeTool.bind(mcp);
      mcp.executeTool = async (toolName, params, toolCallId, options) => {
        toolContexts.push(options.context);
        return originalExecute(toolName, params, toolCallId, options);
      };
      const dispatcher = {
        async dispatch(prompt, history, options) {
          dispatchOptions.push(options);
          turn++;
          if (turn === 1) {
            return {
              content: 'TOOL:demo_echo{"text":"ok"}',
              model: 'demo-model',
              renderContext: { provider: 'openrouter', model: 'or-model' }
            };
          }
          return {
            content: 'done',
            model: 'demo-model',
            renderContext: { provider: 'openrouter', model: 'or-model' }
          };
        }
      };

      const chain = new ToolChainController(dispatcher, mcp, db);
      await chain.executeWithChaining('hello', [], {
        sessionId: 's-chain',
        agentId: 42,
        provider: 'openrouter',
        model: 'anthropic/claude',
        modelSpec,
        runtimeConfig,
        thinkingMode: 'off',
        temperature: 0.2,
        max_tokens: 123,
        concurrencyMode: 'parallel',
        runtimePolicyProfile: 'strict-subagent',
        runtimePolicyGrants: { tools: ['demo_echo'] },
        principal,
        subagentRunId: 'run-chain',
        includeTools: true,
        includeRules: false,
        includeEnv: false,
        skipMemoryOnStart: true,
        skipLock: true,
        preemptible: false
      });

      assert.equal(dispatchOptions.length, 2, 'Expected dispatch options to be forwarded on every chain step');
      for (const options of dispatchOptions) {
        assert.equal(options.provider, 'openrouter', 'Expected provider override to pass through chaining');
        assert.equal(options.model, 'anthropic/claude', 'Expected model override to pass through chaining');
        assert.equal(options.modelSpec, modelSpec, 'Expected modelSpec to pass through chaining');
        assert.equal(options.runtimeConfig, runtimeConfig, 'Expected runtimeConfig to pass through chaining');
        assert.equal(options.thinkingMode, 'off', 'Expected thinkingMode to pass through chaining');
        assert.equal(options.temperature, 0.2, 'Expected temperature to pass through chaining');
        assert.equal(options.max_tokens, 123, 'Expected max_tokens to pass through chaining');
        assert.equal(options.concurrencyMode, 'parallel', 'Expected concurrencyMode to pass through chaining');
        assert.equal(options.runtimePolicyProfile, 'strict-subagent', 'Expected runtime policy profile to pass through chaining');
        assert.deepEqual(options.runtimePolicyGrants, { tools: ['demo_echo'] }, 'Expected runtime policy grants to pass through chaining');
        assert.equal(options.principal, principal, 'Expected principal to pass through chaining');
        assert.equal(options.subagentRunId, 'run-chain', 'Expected subagentRunId to pass through chaining');
        assert.equal(options.includeTools, true, 'Expected includeTools flag to pass through chaining');
        assert.equal(options.includeRules, false, 'Expected includeRules flag to pass through chaining');
        assert.equal(options.includeEnv, false, 'Expected includeEnv flag to pass through chaining');
        assert.equal(options.skipMemoryOnStart, true, 'Expected skipMemoryOnStart flag to pass through chaining');
        assert.equal(options.skipLock, true, 'Expected skipLock flag to pass through chaining');
        assert.equal(options.preemptible, false, 'Expected preemptible flag to pass through chaining');
      }
      assert.equal(toolContexts[0].principal, principal, 'Expected chained tool execution to retain principal');
      assert.equal(toolContexts[0].runtimePolicyProfile, 'strict-subagent', 'Expected chained tool execution to retain runtime policy profile');
      assert.deepEqual(toolContexts[0].runtimePolicyGrants, { tools: ['demo_echo'] }, 'Expected chained tool execution to retain runtime policy grants');
    }
  }
};
