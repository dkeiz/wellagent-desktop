const AgentManager = require('../../src/main/agent-manager');

module.exports = {
  name: 'subagent-manager-recovery-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const stoppedChains = [];
    const statusUpdates = [];
    const db = {
      async getAgents(type) {
        return type === 'sub'
          ? [{ id: 7, type: 'sub', name: 'Search Agent', status: 'active', description: 'search' }]
          : [];
      },
      async getAgent(id) {
        return Number(id) === 7
          ? { id: 7, type: 'sub', name: 'Search Agent', status: 'active', description: 'search' }
          : null;
      },
      async updateAgent(id, patch) {
        statusUpdates.push({ id, patch });
        return { success: true };
      },
      async listSubagentRuns() {
        return [];
      }
    };
    const subtaskRuntime = {
      listRuns() {
        return [];
      }
    };

    const manager = new AgentManager(
      db,
      null,
      null,
      null,
      null,
      { stopChain: (runId) => stoppedChains.push(runId) },
      null,
      subtaskRuntime
    );

    const runs = await manager.listSubagentRuns({ limit: 10 });
    assert.equal(runs.length, 1, 'Expected manager list to recover subagent entity');
    assert.equal(runs[0].run_id, '7', 'Expected recovered run id to match subagent id');

    const stopped = await manager.cancelSubagentRun('7', 'Stopped from manager');
    assert.equal(stopped.success, true, 'Expected recovered subagent stop to succeed');
    assert.deepEqual(statusUpdates[0], { id: 7, patch: { status: 'idle' } }, 'Expected stop to update backend agent state');
    assert.deepEqual(stoppedChains, ['7'], 'Expected stop to signal scoped backend close');
  }
};
