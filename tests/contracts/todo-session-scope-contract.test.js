const MCPServer = require('../../src/main/mcp-server');

function createServer() {
  const calls = [];
  let nextId = 1;
  const rowsBySession = new Map();
  const db = {
    async getSetting(key) {
      return key === 'tool_timeout_ms' ? '5000' : null;
    },
    async setSetting(key, value) {
      calls.push({ op: 'setSetting', key, value });
      return { key, value };
    },
    async addTodo(todo, sessionId) {
      calls.push({ op: 'addTodo', sessionId });
      const row = { id: nextId++, completed: 0, priority: 1, due_date: null, ...todo, session_id: sessionId };
      rowsBySession.set(sessionId, [...(rowsBySession.get(sessionId) || []), row]);
      return row;
    },
    async getTodos(sessionId) {
      calls.push({ op: 'getTodos', sessionId });
      return rowsBySession.get(sessionId) || [];
    },
    async updateTodo(id, todo, sessionId) {
      calls.push({ op: 'updateTodo', id, sessionId });
      const rows = rowsBySession.get(sessionId) || [];
      const index = rows.findIndex(row => Number(row.id) === Number(id));
      if (index >= 0) rows[index] = { ...rows[index], ...todo };
      return { id, ...todo, session_id: sessionId, changes: index >= 0 ? 1 : 0 };
    }
  };
  const capabilityManager = {
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  };
  return { server: new MCPServer(db, capabilityManager), calls };
}

module.exports = {
  name: 'todo-session-scope-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const { server, calls } = createServer();

    const created = await server.executeTool(
      'todo_op',
      { action: 'create', task: 'session todo', visible: true },
      null,
      { context: { sessionId: 's1' } }
    );
    assert.equal(created.result.session_id, 's1', 'Expected todo create to use execution session id');

    const listed = await server.executeTool('todo_op', { action: 'list' }, null, { context: { sessionId: 's1' } });
    assert.deepEqual(listed.result.map(todo => todo.task), ['session todo'], 'Expected list to read only the active session');

    const wrongSession = await server.executeTool('todo_op', { action: 'complete', id: created.result.id }, null, { context: { sessionId: 's2' } });
    assert.equal(wrongSession.result.error, `Todo not found: ${created.result.id}`, 'Expected complete to reject another session');

    await server.executeTool('todo_op', { action: 'complete', id: created.result.id }, null, { context: { sessionId: 's1' } });
    assert.ok(calls.some(call => call.op === 'updateTodo' && call.sessionId === 's1'), 'Expected complete to update with session id');
  }
};
