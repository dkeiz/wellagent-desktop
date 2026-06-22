const MCPServer = require('../../src/main/mcp-server');
const { TimerManager, buildTimerContext, delayToMs } = require('../../src/main/timer-manager');

class FakeTimerDb {
  constructor() {
    this.rows = [];
    this.messages = new Map();
  }

  async getSetting() { return null; }

  async upsertScheduledTimer(timer) {
    const existing = this.rows.find(row => row.timer_id === timer.timer_id && row.context_key === timer.context_key);
    const row = {
      id: existing?.id || this.rows.length + 1,
      timer_id: timer.timer_id,
      context_key: timer.context_key,
      context_json: JSON.stringify(timer.context || {}),
      status: timer.status || 'active',
      due_at: timer.due_at || null,
      interval_ms: Number(timer.interval_ms) || 0,
      remaining_ms: timer.remaining_ms ?? null,
      repeat: timer.repeat ? 1 : 0,
      message: timer.message || '',
      paused_at: timer.paused_at || null,
      fired_at: timer.fired_at || null,
      last_error: timer.last_error || null
    };
    if (existing) Object.assign(existing, row);
    else this.rows.push(row);
    return { ...(existing || row) };
  }

  async getScheduledTimer(timerId, contextKey) {
    const row = this.rows.find(entry => entry.timer_id === timerId && entry.context_key === contextKey);
    return row ? { ...row } : null;
  }

  async listScheduledTimers(contextKey) {
    return this.rows
      .filter(row => row.context_key === contextKey && ['active', 'paused'].includes(row.status))
      .map(row => ({ ...row }));
  }

  async getDueScheduledTimers(nowIso) {
    return this.rows
      .filter(row => row.status === 'active' && row.due_at && row.due_at <= nowIso)
      .map(row => ({ ...row }));
  }

  async updateScheduledTimerState(timerId, contextKey, updates) {
    const row = this.rows.find(entry => entry.timer_id === timerId && entry.context_key === contextKey);
    if (!row) return null;
    Object.assign(row, updates);
    return { ...row };
  }

  async addConversation(message, sessionId) {
    if (!this.messages.has(sessionId)) this.messages.set(sessionId, []);
    this.messages.get(sessionId).push({ ...message });
    return message;
  }

  async getConversations(limit, sessionId) {
    return (this.messages.get(sessionId) || []).slice(-limit);
  }
}

module.exports = {
  name: 'timer-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    assert.equal(delayToMs(2, 'seconds'), 2000, 'Expected seconds to normalize to ms');
    assert.equal(buildTimerContext({ sessionId: 's1', agentId: 7 }).contextKey, 'session:s1|agent:7|source:unknown');

    const db = new FakeTimerDb();
    const dispatched = [];
    const dispatcher = {
      async dispatch(prompt, history, options) {
        dispatched.push({ prompt, history, options });
        return { content: 'timer handled' };
      }
    };
    const windowEvents = [];
    const manager = new TimerManager({
      db,
      dispatcher,
      windowManager: { send: (channel, payload) => windowEvents.push({ channel, payload }) }
    });

    const capabilityManager = {
      isToolActive() { return true; },
      getGroupsConfig() { return []; },
      getActiveTools() { return ['timer']; }
    };
    const server = new MCPServer(db, capabilityManager);
    server.setTimerManager(manager);

    const context = { sessionId: 's1', agentId: 7, source: 'chat-llm' };
    const setResult = await server.executeTool('timer', {
      action: 'set',
      id: 'tea',
      delay: 1,
      unit: 'seconds',
      message: 'Tea is ready.'
    }, null, { context });
    assert.equal(setResult.result.ok, true, 'Expected timer set to succeed');
    assert.equal(setResult.result.id, 'tea', 'Expected timer id to round-trip');

    const listResult = await server.executeTool('timer', { action: 'list' }, null, { context });
    assert.equal(listResult.result.timers.length, 1, 'Expected list to show the context timer');

    const paused = await server.executeTool('timer', { action: 'pause', id: 'tea' }, null, { context });
    assert.equal(paused.result.status, 'paused', 'Expected timer pause to persist');

    const resumed = await server.executeTool('timer', { action: 'resume', id: 'tea' }, null, { context });
    assert.equal(resumed.result.status, 'active', 'Expected timer resume to persist');

    const contextKey = buildTimerContext(context).contextKey;
    await db.updateScheduledTimerState('tea', contextKey, {
      due_at: new Date(Date.now() - 1000).toISOString()
    });
    const fireResult = await manager.fireDueTimers(new Date());
    assert.equal(fireResult.fired, 1, 'Expected overdue timer to fire');
    assert.equal(dispatched.length, 1, 'Expected timer fire to invoke inference');
    assert.equal(dispatched[0].options.sessionId, 's1', 'Expected timer fire to target captured session');
    assert.equal(db.messages.get('s1').some(message => message.role === 'system'), true, 'Expected timer event to be persisted');
    assert.equal(windowEvents[0].channel, 'conversation-update', 'Expected timer fire to notify renderer');

    await server.executeTool('timer', { action: 'set', id: 'cancel-me', delay: 1, unit: 'seconds' }, null, { context });
    const offResult = await server.executeTool('timer', { action: 'off', id: 'cancel-me' }, null, { context });
    assert.equal(offResult.result.status, 'cancelled', 'Expected off to cancel the timer');
  }
};
