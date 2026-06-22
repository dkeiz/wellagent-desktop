const AgentManager = require('../../src/main/agent-manager');

module.exports = {
  name: 'subagent-close-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const dbDeletes = [];
    const stoppedChains = [];
    const clearedGrants = [];
    const run = {
      id: 44,
      run_id: '44',
      status: 'failed',
      subagent_id: 5,
      agent_name: 'Search Agent',
      parent_session_id: 216,
      child_session_id: 'legacy-child-44'
    };
    const db = {
      async getSubagentRun(id) {
        return Number(id) === 44 ? run : null;
      },
      async listSubagentRuns() {
        return [run];
      },
      run(sql, params) {
        if (String(sql).includes('DELETE FROM subagent_runs')) {
          dbDeletes.push(params);
        }
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
      null,
      null,
      {
        toolPermissionService: {
          clearRunScopedGrant(runId) {
            clearedGrants.push(runId);
          }
        }
      }
    );

    const result = await manager.closeSubagentRun('44');

    assert.equal(result.success, true, 'Expected close to succeed');
    assert.equal(result.closed, true, 'Expected close result');
    assert.deepEqual(dbDeletes, [[44]], 'Expected close to remove the closed run record');
    assert.deepEqual(stoppedChains, ['44'], 'Expected close to stop scoped chain handling');
    assert.deepEqual(clearedGrants, ['44'], 'Expected close to clear run-scoped grants');
  }
};
