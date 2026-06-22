const MCPServer = require('../../src/main/mcp-server');
const {
  CUSTOM_TOOL_MAX_OLD_SPACE_MB,
  buildCustomToolSandboxEnv
} = require('../../src/main/custom-tool-sandbox');

function createCapabilityManager() {
  return {
    registerCustomTool() {},
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  };
}

function createServer(timeoutMs = 800) {
  return new MCPServer({
    async getSetting(key) {
      if (key === 'tool_timeout_ms') return String(timeoutMs);
      return null;
    },
    async getCustomTools() {
      return [];
    }
  }, createCapabilityManager());
}

module.exports = {
  name: 'custom-tool-sandbox-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const server = createServer();
    assert.equal(CUSTOM_TOOL_MAX_OLD_SPACE_MB, 64, 'Expected custom tool workers to have a bounded V8 heap');
    const sandboxEnv = buildCustomToolSandboxEnv();
    assert.equal(sandboxEnv.LOCALAGENT_CUSTOM_TOOL_SANDBOX, '1', 'Expected custom tool workers to get an explicit sandbox marker');
    assert.equal(Object.prototype.hasOwnProperty.call(sandboxEnv, 'PATH'), false, 'Expected custom tool worker env not to inherit PATH');

    server.registerCustomTool({
      name: 'custom_sum',
      description: 'Sandbox sum test',
      code: `
        return {
          sum: params.a + params.b,
          processType: typeof process,
          requireType: typeof require,
          globalProcessType: typeof globalThis.process
        };
      `,
      input_schema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' }
        },
        required: ['a', 'b']
      }
    });

    const sum = await server.executeTool('custom_sum', { a: 2, b: 3 });
    assert.equal(sum.result.sum, 5, 'Expected custom tool body to execute');
    assert.equal(sum.result.processType, 'undefined', 'Expected process to be hidden from custom tools');
    assert.equal(sum.result.requireType, 'undefined', 'Expected require to be hidden from custom tools');
    assert.equal(sum.result.globalProcessType, 'undefined', 'Expected global process to be hidden from custom tools');

    server.registerCustomTool({
      name: 'custom_escape_probe',
      description: 'Sandbox escape probe',
      code: `
        let requireProbe = 'not-run';
        let functionProbe = 'not-run';
        try {
          requireProbe = String(require('fs'));
        } catch (error) {
          requireProbe = error.name;
        }
        try {
          functionProbe = Function('return typeof process')();
        } catch (error) {
          functionProbe = error.name;
        }
        return { requireProbe, functionProbe };
      `,
      input_schema: { type: 'object' }
    });

    const escapeProbe = await server.executeTool('custom_escape_probe', {});
    assert.notEqual(escapeProbe.result.requireProbe, 'object', 'Expected require("fs") to be unavailable');
    assert.notEqual(escapeProbe.result.functionProbe, 'object', 'Expected Function constructor escape to be unavailable');
    assert.notEqual(escapeProbe.result.functionProbe, 'function', 'Expected dynamic function generation to be blocked');

    server.registerCustomTool({
      name: 'custom_resource_probe',
      description: 'Sandbox resource probe',
      code: `
        return {
          fetchType: typeof fetch,
          bufferType: typeof Buffer,
          subprocessType: typeof process
        };
      `,
      input_schema: { type: 'object' }
    });

    const resourceProbe = await server.executeTool('custom_resource_probe', {});
    assert.equal(resourceProbe.result.fetchType, 'undefined', 'Expected network fetch to be unavailable by default');
    assert.equal(resourceProbe.result.bufferType, 'undefined', 'Expected Buffer/filesystem helpers to be unavailable by default');
    assert.equal(resourceProbe.result.subprocessType, 'undefined', 'Expected subprocess/process capabilities to be unavailable by default');

    let capabilityRejected = false;
    try {
      server.registerCustomTool({
        name: 'custom_network_requested',
        description: 'Capability request rejection',
        code: 'return true;',
        capabilities: ['network'],
        input_schema: { type: 'object' }
      });
    } catch (error) {
      capabilityRejected = /capabilities are not available/i.test(error.message);
    }
    assert.equal(capabilityRejected, true, 'Expected declared network capability requests to be rejected until the capability model is implemented');

    server.registerCustomTool({
      name: 'custom_big_result',
      description: 'Sandbox output size test',
      code: "return 'x'.repeat(1024 * 1024 + 1);",
      input_schema: { type: 'object' }
    });
    let outputRejected = false;
    try {
      await server.executeTool('custom_big_result', {});
    } catch (error) {
      outputRejected = /result exceeds/i.test(error.message);
    }
    assert.equal(outputRejected, true, 'Expected oversized custom tool output to be rejected');

    const timeoutServer = createServer(250);
    timeoutServer.registerCustomTool({
      name: 'custom_spin',
      description: 'Sandbox timeout test',
      code: 'while (true) {}',
      input_schema: { type: 'object' }
    });

    let timedOut = false;
    try {
      await timeoutServer.executeTool('custom_spin', {});
    } catch (error) {
      timedOut = /timed out|Script execution timed out|exited before returning/i.test(error.message);
    }
    assert.equal(timedOut, true, 'Expected infinite custom tool code to time out');
  }
};
