const assert = require('assert');
const setupIpcHandlers = require('../src/main/ipc-handlers');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) {
      throw new Error(`duplicate handler: ${channel}`);
    }
    this.handlers.set(channel, fn);
  }

  async invoke(channel, ...args) {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`missing handler: ${channel}`);
    return fn({}, ...args);
  }
}

class MockContainer {
  constructor(map) {
    this.map = map;
  }
  get(k) {
    if (!(k in this.map)) throw new Error(`missing service ${k}`);
    return this.map[k];
  }
  optional(k) {
    return this.map[k] || null;
  }
}

function buildContainer() {
  const conversations = [];
  const sentEvents = [];
  const todoSessionRequests = [];
  let msgCounter = 0;

  const db = {
    async getSetting(key) {
      if (key === 'llm.provider' || key === 'llm.model') return null;
      return null;
    },
    get(sql) {
      if (sql.includes('SELECT agent_id FROM chat_sessions')) return { agent_id: null };
      return null;
    },
    async getConversations() {
      return conversations.slice();
    },
    async addConversation(msg) {
      conversations.push({ ...msg, id: ++msgCounter });
      return msg;
    },
    async saveSetting() { return true; },
    async setSetting() { return true; },
    async getToolStates() { return {}; },
    async getAllSettings() { return {}; },
    async getAPIKey() { return null; },
    async getCustomTools() { return []; },
    async getPromptRules() { return []; },
    async getActivePromptRules() { return []; },
    async getChatSessions() { return []; },
    async getCalendarEvents() { return []; },
    async getTodos(sessionId) { todoSessionRequests.push(sessionId); return []; },
    async getWorkflows() { return []; },
    async createChatSession() { return { id: 's-new' }; },
    async setCurrentSession() { return true; },
    async loadChatSession() { return []; },
    async deleteChatSession() { return true; },
    async deleteAllConversations() { conversations.length = 0; return true; },
    async addCalendarEvent(v) { return v; },
    async updateCalendarEvent() { return {}; },
    async deleteCalendarEvent() { return {}; },
    async addTodo(v) { return v; },
    async updateTodo() { return {}; },
    async deleteTodo() { return {}; },
    async addPromptRule(v) { return v; },
    async updatePromptRule() { return {}; },
    async togglePromptRule() { return {}; },
    async deletePromptRule() { return {}; },
    async setToolActive() { return true; },
    async deleteCustomTool() { return true; }
  };

  const dispatcher = {
    async dispatch(prompt) {
      await new Promise(r => setTimeout(r, 110));
      return { content: `Echo:${prompt}`, model: 'mock-dispatcher' };
    }
  };

  const aiService = {
    initialize: async () => {},
    stopGeneration: () => true,
    isGenerating: false,
    getProviders: () => ['ollama'],
    getModels: async () => ['mock-model'],
    setProvider: async () => {},
    setSystemPrompt: async () => {},
    getSystemPrompt: () => 'sys',
    adapters: {}
  };

  const mcpServer = {
    tools: new Map(),
    toolStates: new Map(),
    on() {},
    executeTool: async (toolName) => {
      if (toolName === 'perm-tool') return { needsPermission: true, toolName, params: { a: 1 } };
      return { ok: true };
    },
    getTools: () => [],
    getToolsDocumentation: () => ({}),
    getToolGroups: () => [],
    activateGroup: async () => ({}),
    deactivateGroup: async () => ({}),
    getActiveTools: () => [],
    setToolActiveState: async () => {},
    setCurrentSessionId() {}
  };

  const mainWindow = { webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) } };

  return {
    container: new MockContainer({
      db,
      aiService,
      mcpServer,
      mainWindow,
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
        removePortListener: () => {},
        getPortListeners: () => [],
        setCustomToolSafe: () => {},
        getGroupForTool: () => null,
        isGroupEnabled: () => true,
        customToolSafety: new Map()
      },
      portListenerManager: { register: async () => ({}), unregister: async () => ({}), getListeners: () => [] },
      agentMemory: { append: async () => ({}), read: async () => ({}), list: async () => [], getStats: () => ({}), saveImage: async () => ({}) },
      promptFileManager: { syncToFiles: async () => {}, getPaths: () => ({}), syncFromFiles: async () => {}, loadSystemPrompt: async () => 'x', saveSystemPrompt: async () => {}, loadRulesFromFiles: async () => [] },
      agentLoop: { onSessionClose: async () => {}, recordActivity() {}, loadMemoryContext: async () => null, getSession: () => ({ autoMemory: false, idleSeconds: 0 }) },
      connectorRuntime: { listConnectors: async () => [], startConnector: async () => ({}), stopConnector: async () => ({}), getLogs: () => [] },
      sessionWorkspace: { getWorkspacePath: () => null, listFiles: () => [] },
      dispatcher,
      agentManager: { getAgents: async () => [], getAgent: async () => null, createAgent: async () => ({}), updateAgent: async () => ({}), deleteAgent: async () => ({}), activateAgent: async () => ({}), deactivateAgent: async () => {}, compactAgent: async () => {} },
      eventBus: null,
      memoryDaemon: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }) },
      workflowScheduler: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }), addSchedule: async () => ({}), removeSchedule: async () => ({}), toggleSchedule: async () => ({}), _getAllSchedules: () => [] },
      sessionInitManager: { recordActivity: async () => {}, detectStartType: async () => ({ isColdStart: false }), buildColdStartPrompt: async () => null, buildBaseInitReport: async () => ({}) },
      userIdleDebounceMs: 5
    }),
    conversations,
    sentEvents,
    todoSessionRequests
  };
}

async function main() {
  const ipcMain = new FakeIpcMain();
  const { container, conversations, sentEvents, todoSessionRequests } = buildContainer();
  setupIpcHandlers(ipcMain, container);

  const t0 = Date.now();
  const response = await ipcMain.invoke('send-message', 'hello-flow', false, 's1');
  const elapsed = Date.now() - t0;

  assert(response.content.includes('Echo:hello-flow'));
  assert(elapsed >= 100, `Expected delayed response >=100ms, got ${elapsed}ms`);
  assert(conversations.length >= 2, 'Expected user + assistant messages persisted');
  assert(sentEvents.some(e => e.channel === 'conversation-update'));

  const perm = await ipcMain.invoke('execute-mcp-tool', 'perm-tool', { x: 1 });
  assert.strictEqual(perm.needsPermission, true, 'Expected permission flow signal');
  assert(sentEvents.some(e => e.channel === 'tool-permission-request'));

  await ipcMain.invoke('get-todos', 's-todo');
  assert.deepStrictEqual(todoSessionRequests, ['s-todo'], 'Expected todo IPC to pass through session id');

  console.log('[test-ipc-flow-mocked] PASS');
}

main().catch((err) => {
  console.error('[test-ipc-flow-mocked] FAIL:', err);
  process.exit(1);
});
