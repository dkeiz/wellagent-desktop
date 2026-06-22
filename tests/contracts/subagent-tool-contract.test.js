const MCPServer = require('../../src/main/mcp-server');

module.exports = {
  name: 'subagent-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = {
      async getSetting(key) {
        if (key === 'tool_timeout_ms') return '5';
        return null;
      }
    };

    const server = new MCPServer(db, null);
    const calls = {
      create: [],
      invoke: [],
      deactivate: [],
      wait: [],
      cancel: []
    };

    const searchAgent = {
      id: 5,
      name: 'Search Agent',
      type: 'sub',
      status: 'idle',
      icon: '🌐',
      description: 'Search worker'
    };

    server.setCurrentSessionId(42);
    server.setAgentManager({
      async getAgents(type) {
        return type === 'sub' ? [searchAgent] : [];
      },
      async getAgent(id) {
        return Number(id) === 5 ? searchAgent : null;
      },
      async createAgent(data) {
        calls.create.push(data);
        return { id: 8, status: 'idle', ...data };
      },
      async invokeSubAgent(parentSessionId, subAgentId, task, options) {
        calls.invoke.push({ parentSessionId, subAgentId, task, options });
        return {
          success: true,
          accepted: true,
          run_id: 'subtask-test-1',
          status: 'queued',
          child_session_id: 'subtask-test-1'
        };
      },
      async deactivateAgent(id) {
        calls.deactivate.push(id);
        return { success: true };
      },
      async cancelSubagentRun(runId, reason) {
        calls.cancel.push({ runId, reason });
        return {
          success: true,
          run: {
            run_id: runId,
            status: 'stopped'
          }
        };
      },
      async waitForSubagentRun(runId, timeoutMs) {
        calls.wait.push({ runId, timeoutMs });
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          run_id: runId,
          status: 'task_complete',
          subagent_id: 5,
          agent_name: 'Search Agent',
          parent_session_id: 42,
          child_session_id: 'subtask-test-1',
          result: {
            contract: {
              status: 'task_complete',
              summary: 'Found sources',
              data: {
                sources: ['a', 'b']
              },
              artifacts: [],
              notes: ''
            }
          }
        };
      },
      async listSubagentRuns() {
        return [{
          run_id: 'subtask-test-1',
          status: 'queued',
          subagent_id: 5,
          agent_name: 'Search Agent'
        }];
      },
      async getSubagentRun(runId) {
        return {
          run_id: runId,
          status: 'empty',
          subagent_id: 5,
          agent_name: 'Search Agent',
          parent_session_id: 42,
          child_session_id: 'subtask-test-1',
          result: {
            contract: {
              status: 'empty',
              summary: 'No result found',
              data: {},
              artifacts: [],
              notes: ''
            }
          }
        };
      }
    });

    const listResult = await server.executeTool('subagent', {});
    assert.equal(listResult.success, true, 'Expected subagent list tool call to succeed');
    assert.equal(listResult.result.action, 'list', 'Expected default subagent action to be list');
    assert.equal(listResult.result.count, 1, 'Expected one listed sub-agent');
    assert.equal(listResult.result.agents[0].id, 5, 'Expected Search Agent in list output');

    const runResult = await server.executeTool('subagent', {
      action: 'run',
      id: 5,
      task: 'Find sources'
    });
    assert.equal(runResult.success, true, 'Expected subagent run tool call to succeed');
    assert.equal(runResult.result.action, 'run', 'Expected run action result');
    assert.equal(runResult.result.run_id, 'subtask-test-1', 'Expected returned run id');
    assert.equal(calls.invoke.length, 1, 'Expected invokeSubAgent to be called once');
    assert.equal(calls.invoke[0].parentSessionId, 42, 'Expected current session id to be forwarded');
    assert.equal(calls.invoke[0].subAgentId, 5, 'Expected run action to target the selected sub-agent');
    assert.equal(calls.invoke[0].options.subagentMode, 'no_ui', 'Expected MCP default subagent mode to match backend default');
    assert.equal(runResult.result.waited, false, 'Expected default run path to remain async');
    assert.equal(runResult.result.identifiers.run_id, 'subtask-test-1', 'Expected canonical string run id refs');
    assert.equal(runResult.result.identifiers.child_session_id, 'subtask-test-1', 'Expected canonical string child session refs');

    const waitedRunResult = await server.executeTool('subagent', {
      action: 'run',
      id: 5,
      task: 'Find sources and wait',
      wait: true,
      timeout_ms: 1234
    });
    assert.equal(waitedRunResult.success, true, 'Expected awaited subagent run to succeed');
    assert.equal(waitedRunResult.result.waited, true, 'Expected awaited run flag');
    assert.equal(waitedRunResult.result.done, true, 'Expected awaited run to report completion');
    assert.equal(waitedRunResult.result.contract.summary, 'Found sources', 'Expected awaited run to expose final contract');
    assert.equal(waitedRunResult.result.run.identifiers.parent_session_id, '42', 'Expected canonical parent session ref on waited run');
    assert.deepEqual(calls.wait, [{ runId: 'subtask-test-1', timeoutMs: 1234 }], 'Expected awaited run to wait on the child completion');

    const statusResult = await server.executeTool('subagent', {
      action: 'status',
      run_id: 'subtask-test-1'
    });
    assert.equal(statusResult.success, true, 'Expected status action to succeed');
    assert.equal(statusResult.result.done, true, 'Expected status polling to treat completed result as done even with opaque statuses');

    const createResult = await server.executeTool('subagent', {
      action: 'new',
      name: 'Tracer'
    });
    assert.equal(createResult.success, true, 'Expected subagent new action to succeed');
    assert.equal(createResult.result.agent.name, 'Tracer', 'Expected created sub-agent name');
    assert.equal(calls.create[0].type, 'sub', 'Expected action=new to create a sub-agent');

    const stopResult = await server.executeTool('subagent', {
      action: 'stop',
      id: 5
    });
    assert.equal(stopResult.success, true, 'Expected subagent stop action to succeed');
    assert.equal(stopResult.result.action, 'stop', 'Expected stop action result');
    assert.deepEqual(calls.deactivate, [5], 'Expected stop action to deactivate the target sub-agent');

    const stopRunResult = await server.executeTool('subagent', {
      action: 'stop',
      run_id: 'subtask-test-1'
    });
    assert.equal(stopRunResult.success, true, 'Expected scoped subagent run stop to succeed');
    assert.equal(stopRunResult.result.action, 'stop', 'Expected scoped stop action result');
    assert.deepEqual(calls.cancel, [{
      runId: 'subtask-test-1',
      reason: 'Stopped by subagent tool'
    }], 'Expected scoped stop to cancel the delegated run');

    calls.cancel.length = 0;
    const stopFailedResult = await server.executeTool('subagent', {
      action: 'stop',
      run_id: 'failed-run-1'
    });
    assert.equal(stopFailedResult.success, true, 'Expected stop action to dispatch for failed run handles');
    assert.deepEqual(calls.cancel, [{
      runId: 'failed-run-1',
      reason: 'Stopped by subagent tool'
    }], 'Expected failed run stop to still go through cancellation path');

    const legacyResult = await server.executeTool('run_subagent', {
      agent_id: 5,
      task: 'Legacy path'
    });
    assert.equal(legacyResult.success, true, 'Expected legacy run_subagent alias to still work');
    assert.equal(legacyResult.result.run_id, 'subtask-test-1', 'Expected legacy alias to delegate through the unified handler');
  }
};
