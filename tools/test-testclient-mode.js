const assert = require('assert');
const setupIpcHandlers = require('../src/main/ipc-handlers');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) throw new Error(`Duplicate handler: ${channel}`);
    this.handlers.set(channel, fn);
  }

  async invoke(channel, ...args) {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`Missing handler: ${channel}`);
    return fn({}, ...args);
  }
}

class MockContainer {
  constructor(map) {
    this.map = map;
  }
  get(name) {
    if (!(name in this.map)) throw new Error(`Missing service: ${name}`);
    return this.map[name];
  }
  optional(name) {
    return this.map[name] || null;
  }
}

function buildContainer() {
  const calls = {
    dbAddConversation: 0,
    dbCreateSession: 0,
    agentLoopRecord: 0,
    sessionInitRecord: 0
  };

  const db = {
    async getSetting() { return null; },
    get() { return null; },
    async getConversations() { return []; },
    async addConversation() { calls.dbAddConversation++; return {}; },
    async createChatSession() { calls.dbCreateSession++; return { id: 1 }; },
    async setCurrentSession() { return true; },
    async saveSetting() { return true; },
    async setSetting() { return true; },
    async getPromptRules() { return []; },
    async getActivePromptRules() { return []; },
    async getChatSessions() { return []; },
    async loadChatSession() { return []; },
    async deleteChatSession() { return true; },
    async deleteAllConversations() { return true; },
    async getCalendarEvents() { return []; },
    async addCalendarEvent(v) { return v; },
    async updateCalendarEvent() { return {}; },
    async deleteCalendarEvent() { return {}; },
    async getTodos() { return []; },
    async addTodo(v) { return v; },
    async updateTodo() { return {}; },
    async deleteTodo() { return {}; },
    async addPromptRule(v) { return v; },
    async updatePromptRule() { return {}; },
    async togglePromptRule() { return {}; },
    async deletePromptRule() { return {}; },
    async getAllSettings() { return {}; },
    async getAPIKey() { return null; },
    async getToolStates() { return {}; },
    async setToolActive() { return true; },
    async getCustomTools() { return []; },
    async deleteCustomTool() { return true; },
    async getWorkflows() { return []; }
  };

  return {
    calls,
    container: new MockContainer({
      db,
      aiService: {
        initialize: async () => {},
        stopGeneration: () => true,
        isGenerating: false,
        getProviders: () => ['ollama'],
        getModels: async () => ['x'],
        setProvider: async () => {},
        setSystemPrompt: async () => {},
        getSystemPrompt: () => 'sys',
        adapters: {}
      },
      mcpServer: {
        tools: new Map(),
        toolStates: new Map(),
        on() {},
        executeTool: async () => ({ ok: true }),
        getTools: () => [],
        getToolsDocumentation: () => ({}),
        getToolGroups: () => [],
        activateGroup: async () => ({}),
        deactivateGroup: async () => ({}),
        getActiveTools: () => [],
        setToolActiveState: async () => {},
        setCurrentSessionId() {}
      },
      mainWindow: { webContents: { send() {} } },
      ollamaService: {},
      chainController: null,
      workflowManager: {
        getWorkflows: async () => [],
        captureWorkflow: async () => ({}),
        deleteWorkflow: async () => {},
        executeWorkflow: async () => ({}),
        findMatchingWorkflows: async () => [],
        copyWorkflow: async () => ({}),
        updateWorkflow: async () => ({})
      },
      vectorStore: {},
      capabilityManager: {
        getState: () => ({}),
        getGroupsConfig: () => [],
        setMainEnabled: () => true,
        setGroupEnabled: () => true,
        setFilesMode: () => 'read',
        getActiveTools: () => [],
        addPortListener: (l) => l,
        removePortListener() {},
        getPortListeners: () => [],
        setCustomToolSafe() {},
        getGroupForTool: () => null,
        isGroupEnabled: () => true,
        customToolSafety: new Map()
      },
      portListenerManager: { register: async () => ({}), unregister: async () => ({}), getListeners: () => [] },
      agentMemory: { append: async () => ({}), read: async () => ({}), list: async () => [], getStats: () => ({}), saveImage: async () => ({}) },
      promptFileManager: { syncToFiles: async () => {}, getPaths: () => ({}), syncFromFiles: async () => {}, loadSystemPrompt: async () => 'x', saveSystemPrompt: async () => {}, loadRulesFromFiles: async () => [] },
      agentLoop: {
        onSessionClose: async () => {},
        recordActivity() { calls.agentLoopRecord++; },
        loadMemoryContext: async () => null,
        getSession: () => ({ autoMemory: false, idleSeconds: 0 })
      },
      connectorRuntime: { listConnectors: async () => [], startConnector: async () => ({}), stopConnector: async () => ({}), getLogs: () => [] },
      sessionWorkspace: { getWorkspacePath: () => null, listFiles: () => [] },
      dispatcher: { dispatch: async () => ({ content: 'tc-ok', model: 'mock' }) },
      agentManager: { getAgents: async () => [], getAgent: async () => null, createAgent: async () => ({}), updateAgent: async () => ({}), deleteAgent: async () => ({}), activateAgent: async () => ({}), deactivateAgent: async () => {}, compactAgent: async () => {} },
      eventBus: { publish() {}, getLog: () => [] },
      memoryDaemon: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }) },
      workflowScheduler: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }), addSchedule: async () => ({}), removeSchedule: async () => ({}), toggleSchedule: async () => ({}), _getAllSchedules: () => [] },
      sessionInitManager: {
        recordActivity: async () => { calls.sessionInitRecord++; },
        detectStartType: async () => ({ isColdStart: false }),
        buildColdStartPrompt: async () => null,
        buildBaseInitReport: async () => ({})
      },
      testClientMode: true,
      testClientStore: { sessions: new Map(), currentSessionId: null }
    })
  };
}

async function main() {
  const ipcMain = new FakeIpcMain();
  const { container, calls } = buildContainer();
  setupIpcHandlers(ipcMain, container);

  const created = await ipcMain.invoke('create-chat-session');
  assert(String(created.id).startsWith('testclient-'), 'Expected transient testclient session id');

  const r1 = await ipcMain.invoke('send-message', 'hello testclient', false, created.id);
  assert.strictEqual(r1.content, 'tc-ok');
  assert.strictEqual(r1.sessionId, created.id);

  const history = await ipcMain.invoke('get-conversations', 20, created.id);
  assert(history.length >= 2, 'Expected in-memory user+assistant messages');

  assert.strictEqual(calls.dbAddConversation, 0, 'DB addConversation must not be called in testclient mode');
  assert.strictEqual(calls.dbCreateSession, 0, 'DB createChatSession must not be called in testclient mode');
  assert.strictEqual(calls.agentLoopRecord, 0, 'agentLoop.recordActivity must be skipped in testclient mode');
  assert.strictEqual(calls.sessionInitRecord, 0, 'sessionInitManager.recordActivity must be skipped in testclient mode');

  const daemonStart = await ipcMain.invoke('daemon:memory-start');
  assert(daemonStart.error, 'daemon start should be blocked in testclient mode');

  const status = await ipcMain.invoke('testclient:status');
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.sessionCount, 1);

  await ipcMain.invoke('testclient:reset');
  const statusAfter = await ipcMain.invoke('testclient:status');
  assert.strictEqual(statusAfter.sessionCount, 0);

  console.log('[test-testclient-mode] PASS');
}

main().catch((err) => {
  console.error('[test-testclient-mode] FAIL:', err);
  process.exit(1);
});
