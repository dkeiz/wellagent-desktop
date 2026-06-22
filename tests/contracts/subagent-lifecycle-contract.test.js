const AgentManager = require('../../src/main/agent-manager');

module.exports = {
  name: 'subagent-lifecycle-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const events = [];
    const stoppedChains = [];
    const clearedGrants = [];
    const dbUpdates = [];
    const failedRun = {
      id: 12,
      run_id: '12',
      status: 'failed',
      subagent_id: 5,
      agent_name: 'Search Agent',
      parent_session_id: 216,
      child_session_id: 'legacy-child-12'
    };
    const db = {
      async getSubagentRun(id) {
        return Number(id) === 12 ? failedRun : null;
      },
      run(sql, params) {
        dbUpdates.push({ sql, params });
      }
    };
    const manager = new AgentManager(
      db,
      null,
      null,
      null,
      null,
      {
        stopChain(runId) {
          stoppedChains.push(runId);
        }
      },
      {
        publish(type, payload) {
          events.push({ type, payload });
        }
      },
      null,
      {
        toolPermissionService: {
          clearRunScopedGrant(runId) {
            clearedGrants.push(runId);
          }
        }
      }
    );

    const result = await manager.cancelSubagentRun('12', 'Stopped from test');

    assert.equal(result.success, true, 'Expected Stop to be accepted for a failed run handle');
    assert.equal(result.run.status, 'failed', 'Expected Stop not to erase the failed lifecycle state');
    assert.deepEqual(stoppedChains, ['12'], 'Expected Stop to still send a scoped abort signal');
    assert.deepEqual(clearedGrants, ['12'], 'Expected Stop to clear run-scoped execution grants');
    assert.equal(dbUpdates.length, 0, 'Expected Stop on failed run not to rewrite it as stopped');
    assert.equal(events[0].payload.status, 'failed', 'Expected emitted state to preserve failed status');
  }
};
