const AgentManager = require('../../src/main/agent-manager');

module.exports = {
  name: 'subagent-close-agent-entity-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const deletes = [];
    const events = [];
    const db = {
      async getAgent(id) {
        return Number(id) === 8 && deletes.length === 0
          ? { id: 8, type: 'sub', name: 'Diag Search', status: 'idle' }
          : null;
      },
      async getAgents(type) {
        return type === 'sub' && deletes.length === 0
          ? [{ id: 8, type: 'sub', name: 'Diag Search', status: 'idle' }]
          : [];
      },
      async deleteAgent(id) {
        deletes.push(id);
      }
    };
    const subtaskRuntime = {
      listRuns() {
        return [];
      }
    };
    const manager = new AgentManager(db, null, null, null, null, null, {
      publish(type, payload) {
        events.push({ type, payload });
      }
    }, subtaskRuntime);

    const result = await manager.closeSubagentRun('8');
    assert.equal(result.success, true, 'Expected close to succeed');
    assert.equal(result.closed, true, 'Expected backend entity to be closed');
    assert.deepEqual(deletes, [8], 'Expected Close to delete the subagent entity');
    assert.equal(events[0].type, 'subagent:closed', 'Expected close event');

    const rows = await manager.listSubagentRuns({ limit: 10 });
    assert.equal(rows.length, 0, 'Expected closed subagent to leave manager list');
  }
};
