const path = require('path');
const fs = require('fs');
const CompanionAuth = require('../../src/main/companion-auth');
const { configureCompanionServer } = require('../../src/main/companion/companion-backend-dispatch');
const { createCompanionBackendEntrypoints } = require('../../src/main/companion/companion-backend-entrypoints');

function createMemoryDb() {
  const settings = new Map();
  const sessions = new Map([
    ['s1', { id: 's1', title: 'Main', agent_id: null }],
    ['s2', { id: 's2', title: 'Agent', agent_id: 7 }]
  ]);
  const conversations = [];
  let currentSessionId = 's1';

  return {
    settings,
    sessions,
    conversations,
    get(sql, params = []) {
      if (String(sql).includes('FROM chat_sessions')) {
        return sessions.get(String(params[0])) || null;
      }
      return null;
    },
    async getSetting(key) { return settings.get(key) || null; },
    getSettingSync(key) { return settings.get(key) || null; },
    async saveSetting(key, value) {
      if (String(value || '') === '') settings.delete(key);
      else settings.set(key, String(value));
    },
    async setSetting(key, value) { return this.saveSetting(key, value); },
    async getCurrentSession() { return sessions.get(currentSessionId) || null; },
    async setCurrentSession(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sessions.has(sid)) throw new Error(`Chat session not found: ${sid}`);
      currentSessionId = sid;
      return { sessionId: sid };
    },
    async getChatSessions() { return Array.from(sessions.values()); },
    async getConversations(limit = 20, sessionId = null) {
      return conversations.filter(entry => !sessionId || entry.sessionId === sessionId).slice(-Number(limit || 20));
    },
    async addConversation(entry, sessionId) { conversations.push({ ...entry, sessionId }); },
    async createChatSession() {
      const id = `s${sessions.size + 1}`;
      sessions.set(id, { id, title: 'New', agent_id: null });
      currentSessionId = id;
      return { id, title: 'New' };
    }
  };
}

function createContainer(services = {}) {
  const store = new Map(Object.entries(services));
  return {
    get(name) {
      if (!store.has(name)) throw new Error(`Missing service: ${name}`);
      return store.get(name);
    },
    optional(name) { return store.has(name) ? store.get(name) : null; },
    replace(name, value) { store.set(name, value); return this; }
  };
}

module.exports = {
  name: 'companion-session-boundary-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const db = createMemoryDb();
    const mcpState = { sessionId: null, agentContext: undefined };
    const windowEvents = [];
    const chainCalls = [];
    const dispatchCalls = [];
    const artifactListCalls = [];
    const entrypoints = createCompanionBackendEntrypoints(createContainer({
      db,
      windowManager: {
        send(channel, payload) { windowEvents.push({ channel, payload }); }
      },
      mcpServer: {
        setCurrentSessionId(sessionId) { mcpState.sessionId = sessionId; },
        setCurrentAgentContext(context) { mcpState.agentContext = context; }
      },
      chainController: {
        async executeWithChaining(message, history, options) {
          chainCalls.push({ message, history, options });
          return { content: 'final answer\nTOOL:noop{}', model: 'mock' };
        }
      },
      dispatcher: {
        async dispatch() {
          dispatchCalls.push(true);
          return { content: 'dispatcher' };
        }
      },
      artifactRegistry: {
        listArtifacts(sessionId, options = {}) {
          artifactListCalls.push({ sessionId, options });
          if (options.openableOnly) {
            return { count: 0, artifacts: [] };
          }
          return {
            count: 1,
            artifacts: [{
              key: 'virtual:todo:one',
              name: 'one',
              size: 0,
              timestamp: '2026-05-31T00:00:00.000Z',
              kind: 'todo',
              category: 'data',
              source: 'todo_op',
              action: 'created',
              virtual: true,
              accepted: false
            }]
          };
        }
      }
    }));

    const switched = await entrypoints.switchChatSession('s2');
    assert.equal(switched.success, true, 'Expected companion switch to resolve a known session');
    assert.equal(mcpState.sessionId, 's2', 'Expected companion switch to update MCP current session');
    assert.deepEqual(mcpState.agentContext, { sessionId: 's2', agentId: 7 }, 'Expected companion switch to update MCP agent context');
    assert.ok(windowEvents.some(event => event.channel === 'conversation-update' && event.payload.currentSessionId === 's2'), 'Expected companion switch to relay backend current session');

    const sent = await entrypoints.sendMessage('run tool', 's2', { clientSource: 'web' });
    assert.equal(chainCalls.length, 1, 'Expected companion send to use tool chaining');
    assert.equal(dispatchCalls.length, 0, 'Expected dispatcher fallback not to run when chain controller exists');
    assert.equal(sent.content.trim(), 'final answer', 'Expected companion send to strip tool syntax before storing');
    assert.equal(db.conversations[1].content.trim(), 'final answer', 'Expected stored assistant message to be cleaned');
    assert.equal(mcpState.sessionId, 's2', 'Expected companion send to update MCP current session');
    assert.deepEqual(mcpState.agentContext, { sessionId: 's2', agentId: 7 }, 'Expected companion send to update agent context');
    assert.ok(windowEvents.some(event => event.channel === 'conversation-update' && event.payload.sessionId === 's2' && event.payload.currentSessionId === 's2' && event.payload.phase === 'user-message'), 'Expected companion send to relay the stored user message before assistant completion');
    assert.ok(windowEvents.some(event => event.channel === 'conversation-update' && event.payload.sessionId === 's2' && event.payload.currentSessionId === 's2'), 'Expected companion send to relay synchronized session id');

    const packedDb = createMemoryDb();
    packedDb.settings.set('context_window', '32768');
    for (let index = 0; index < 36; index += 1) {
      packedDb.conversations.push({
        sessionId: 's1',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `packed prior ${index + 1}`
      });
    }
    const packedCalls = [];
    const packedEntry = createCompanionBackendEntrypoints(createContainer({
      db: packedDb,
      chainController: {
        async executeWithChaining(message, history, options) {
          packedCalls.push({ message, history, options });
          return { content: 'packed answer', model: 'mock' };
        }
      },
      dispatcher: { async dispatch() { return { content: 'unused' }; } }
    }));
    await packedEntry.sendMessage('packed next', 's1');
    assert.ok(packedCalls[0].history.length > 20, 'Expected companion send to include packed history beyond 20 prior messages');
    assert.equal(packedCalls[0].history[0].content, 'packed prior 1', 'Expected companion packed history to include older persisted messages');

    const permissionDb = createMemoryDb();
    const permissionEntry = createCompanionBackendEntrypoints(createContainer({
      db: permissionDb,
      chainController: {
        async executeWithChaining() {
          return {
            needsPermission: true,
            permissionRequest: { toolName: 'read_file', reason: 'tool_disabled', params: {} }
          };
        }
      },
      dispatcher: { async dispatch() { return { content: 'unused' }; } }
    }));
    const permission = await permissionEntry.sendMessage('need file', 's1');
    assert.equal(permission.needsPermission, true, 'Expected companion send to propagate tool permission requests');
    assert.equal(permission.toolName, 'read_file', 'Expected permission request details at top level');
    assert.equal(permissionDb.conversations.length, 1, 'Expected permission pauses not to store an assistant turn');

    const artifacts = await entrypoints.getSessionArtifacts('s1');
    assert.equal(artifacts.success, true, 'Expected artifact listing to succeed');
    assert.equal(artifactListCalls[0].options.openableOnly, true, 'Expected companion artifact listing to request openable entries only');
    assert.deepEqual(artifacts.files, [], 'Expected companion artifacts to hide virtual-only registry entries');

    const authDb = createMemoryDb();
    const auth = new CompanionAuth(authDb);
    const pairing = auth.generatePairing('127.0.0.1', 8790);
    const firstPair = await auth.validatePairing({ pairingCode: pairing.code, deviceId: 'd1', deviceName: 'One' });
    const secondPair = await auth.validatePairing({ pairingCode: pairing.code, deviceId: 'd2', deviceName: 'Two' });
    assert.equal(firstPair.success, true, 'Expected first pairing attempt to succeed');
    assert.equal(secondPair.success, false, 'Expected pairing code to be single-use');
    assert.equal(await auth.getActivePairingAsync(), null, 'Expected pairing state to be cleared after success');

    const raceAuth = new CompanionAuth(createMemoryDb());
    const racePairing = raceAuth.generatePairing('127.0.0.1', 8791);
    const raceResults = await Promise.all([
      raceAuth.validatePairing({ pairingCode: racePairing.code, deviceId: 'race-1', deviceName: 'Race One' }),
      raceAuth.validatePairing({ pairingCode: racePairing.code, deviceId: 'race-2', deviceName: 'Race Two' })
    ]);
    assert.equal(
      raceResults.filter(result => result.success).length,
      1,
      'Expected concurrent pairing attempts to consume the code once'
    );

    let dispatch = null;
    configureCompanionServer({
      companionServer: { setDispatch(fn) { dispatch = fn; }, disconnectDevice() {} },
      container: createContainer({ db: createMemoryDb(), dispatcher: { async dispatch() { return { content: 'unused' }; } } }),
      companionAuth: {
        async validateAccessToken() {
          return { valid: true, payload: { deviceId: 'device-1', platform: 'web', permissions: { preset: 'standard' } } };
        }
      }
    });
    const listed = await dispatch(
      'GET',
      '/companion/chat/sessions',
      {},
      {},
      'token',
      {},
      new URL('http://127.0.0.1/companion/chat/sessions')
    );
    assert.equal(listed.status, 200, 'Expected companion session list route to succeed');
    assert.equal(listed.body.currentSessionId, 's1', 'Expected companion session list to expose backend current session id');

    const rejected = await dispatch(
      'POST',
      '/companion/chat/send',
      { text: 'hello', sessionId: 'missing' },
      {},
      'token',
      {},
      new URL('http://127.0.0.1/companion/chat/send')
    );
    assert.equal(rejected.status, 400, 'Expected explicit unknown companion sessions to fail with 400');

    const databaseSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'database.js'), 'utf8');
    assert.includes(databaseSource, "this.db.pragma('foreign_keys = ON')", 'Expected SQLite foreign keys to be enabled');
    assert.includes(databaseSource, 'SELECT id FROM chat_sessions WHERE id = ?', 'Expected current-session writes to validate session existence');
    assert.includes(databaseSource, 'Chat session not found', 'Expected invalid session errors to be explicit');
  }
};
