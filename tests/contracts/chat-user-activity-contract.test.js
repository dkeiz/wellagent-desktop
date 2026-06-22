const setupIpcHandlers = require('../../src/main/ipc-handlers');

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

  get(key) {
    if (!(key in this.map)) throw new Error(`missing service ${key}`);
    return this.map[key];
  }

  optional(key) {
    return this.map[key] || null;
  }
}

function buildContainer(publishedEvents) {
  const conversations = [];

  const db = {
    async getSetting() {
      return null;
    },
    get(sql) {
      if (sql.includes('SELECT agent_id FROM chat_sessions')) return { agent_id: null };
      return null;
    },
    async getConversations() {
      return conversations.slice();
    },
    async addConversation(message) {
      conversations.push(message);
      return message;
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
    async getTodos() { return []; },
    async getWorkflows() { return []; },
    async createChatSession() { return { id: 's-new' }; },
    async setCurrentSession() { return true; },
    async loadChatSession() { return []; },
    async deleteChatSession() { return true; },
    async deleteAllConversations() { return true; },
    async addCalendarEvent(value) { return value; },
    async updateCalendarEvent() { return {}; },
    async deleteCalendarEvent() { return {}; },
    async addTodo(value) { return value; },
    async updateTodo() { return {}; },
    async deleteTodo() { return {}; },
    async addPromptRule(value) { return value; },
    async updatePromptRule() { return {}; },
    async togglePromptRule() { return {}; },
    async deletePromptRule() { return {}; },
    async setToolActive() { return true; },
    async deleteCustomTool() { return true; }
  };

  return new MockContainer({
    db,
    aiService: {
      initialize: async () => {},
      stopGeneration: () => true,
      isGenerating: false,
      getProviders: () => ['mock'],
      getModels: async () => ['mock-model'],
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
      addPortListener: (listener) => listener,
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
    sessionWorkspace: {
      getWorkspacePath: () => '',
      listFiles: () => [],
      searchFiles: () => []
    },
    connectorRuntime: { listConnectors: async () => [], startConnector: async () => ({}), stopConnector: async () => ({}), getLogs: () => [] },
    dispatcher: {
      async dispatch(prompt) {
        return { content: `Echo:${prompt}`, model: 'mock-dispatcher' };
      }
    },
    agentManager: { getAgents: async () => [], getAgent: async () => null, createAgent: async () => ({}), updateAgent: async () => ({}), deleteAgent: async () => ({}), activateAgent: async () => ({}), deactivateAgent: async () => {}, compactAgent: async () => {} },
    eventBus: {
      publish(eventType, payload) {
        publishedEvents.push({ eventType, payload });
      },
      getLog: () => []
    },
    memoryDaemon: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }) },
    workflowScheduler: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }), addSchedule: async () => ({}), removeSchedule: async () => ({}), toggleSchedule: async () => ({}), _getAllSchedules: () => [] },
    sessionInitManager: { recordActivity: async () => {}, detectStartType: async () => ({ isColdStart: false }), buildColdStartPrompt: async () => null, buildBaseInitReport: async () => ({}) },
    userIdleDebounceMs: 15
  });
}

module.exports = {
  name: 'chat-user-activity-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const publishedEvents = [];
    const ipcMain = new FakeIpcMain();
    setupIpcHandlers(ipcMain, buildContainer(publishedEvents));

    const response = await ipcMain.invoke('send-message', 'hello-user-activity', false, 's1');
    assert.includes(response.content, 'Echo:hello-user-activity', 'Expected mocked send-message response');
    assert.ok(
      publishedEvents.some(event => event.eventType === 'chat:user-active' && event.payload.sessionId === 's1'),
      'Expected chat:user-active event for the live session'
    );

    await new Promise(resolve => setTimeout(resolve, 40));

    assert.ok(
      publishedEvents.some(event => event.eventType === 'chat:user-idle' && event.payload.sessionId === 's1'),
      'Expected debounced chat:user-idle event for the live session'
    );
  }
};
