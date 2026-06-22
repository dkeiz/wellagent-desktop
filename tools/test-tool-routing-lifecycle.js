const assert = require('assert');
const setupIpcHandlers = require('../src/main/ipc-handlers');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) {
      throw new Error(`Duplicate handler: ${channel}`);
    }
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
    if (!(name in this.map)) throw new Error(`Missing service ${name}`);
    return this.map[name];
  }
  optional(name) {
    return this.map[name] || null;
  }
}

function buildContainer() {
  const sentEvents = [];
  let lastExecuteCall = null;

  const mcpServer = {
    tools: new Map(),
    toolStates: new Map(),
    on() {},
    async executeTool(toolName, params, toolCallId = null, options = {}) {
      lastExecuteCall = { toolName, params, toolCallId, options };
      if (toolName === 'create_tool') {
        const name = params.name;
        this.tools.set(name, { definition: params, handler: () => ({ ok: true }) });
        return { success: true, created: name };
      }
      return { success: true, toolName, params, options };
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

  const db = {
    async getSetting() { return null; },
    get() { return null; },
    async getConversations() { return []; },
    async addConversation() { return {}; },
    async saveSetting() { return true; },
    async setSetting() { return true; },
    async setToolActive() { return true; },
    async getToolStates() { return {}; },
    async getAllSettings() { return {}; },
    async getAPIKey() { return null; },
    async getCustomTools() { return []; },
    async deleteCustomTool(name) { return { deleted: name }; },
    async getPromptRules() { return []; },
    async getActivePromptRules() { return []; },
    async getChatSessions() { return []; },
    async getCalendarEvents() { return []; },
    async getTodos() { return []; },
    async getWorkflows() { return []; },
    async createChatSession() { return { id: 's1' }; },
    async setCurrentSession() { return true; },
    async loadChatSession() { return []; },
    async deleteChatSession() { return true; },
    async deleteAllConversations() { return true; },
    async addCalendarEvent(v) { return v; },
    async updateCalendarEvent() { return {}; },
    async deleteCalendarEvent() { return {}; },
    async addTodo(v) { return v; },
    async updateTodo() { return {}; },
    async deleteTodo() { return {}; },
    async addPromptRule(v) { return v; },
    async updatePromptRule() { return {}; },
    async togglePromptRule() { return {}; },
    async deletePromptRule() { return {}; }
  };

  const container = new MockContainer({
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
    mcpServer,
    mainWindow: { webContents: { send: (ch, data) => sentEvents.push({ ch, data }) } },
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
    dispatcher: { dispatch: async () => ({ content: 'ok' }) },
    agentManager: { getAgents: async () => [], getAgent: async () => null, createAgent: async () => ({}), updateAgent: async () => ({}), deleteAgent: async () => ({}), activateAgent: async () => ({}), deactivateAgent: async () => {}, compactAgent: async () => {} },
    eventBus: { publish() {}, getLog: () => [] },
    memoryDaemon: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }) },
    workflowScheduler: { running: false, start: async () => {}, stop() {}, getStatus: () => ({ running: false }), addSchedule: async () => ({}), removeSchedule: async () => ({}), toggleSchedule: async () => ({}), _getAllSchedules: () => [] },
    sessionInitManager: { recordActivity: async () => {}, detectStartType: async () => ({ isColdStart: false }), buildColdStartPrompt: async () => null, buildBaseInitReport: async () => ({}) }
  });

  return { container, mcpServer, sentEvents, getLastExecuteCall: () => lastExecuteCall };
}

async function main() {
  const ipcMain = new FakeIpcMain();
  const { container, mcpServer, sentEvents, getLastExecuteCall } = buildContainer();
  setupIpcHandlers(ipcMain, container);

  const execResult = await ipcMain.invoke('execute-tool', 'current_time', {});
  assert.strictEqual(execResult.success, true, 'execute-tool should succeed');
  assert.strictEqual(getLastExecuteCall().toolName, 'current_time');

  const onceResult = await ipcMain.invoke('execute-mcp-tool-once', 'read_file', { path: 'x' });
  assert.strictEqual(onceResult.success, true, 'execute-mcp-tool-once should succeed');
  assert.notStrictEqual(getLastExecuteCall().options.bypassPermissions, true, 'execute-mcp-tool-once should not bypass permissions');

  const toolData = {
    name: 'custom_demo_tool',
    description: 'demo',
    inputSchema: { type: 'object', properties: {} }
  };
  const created = await ipcMain.invoke('create-custom-tool', toolData);
  assert.strictEqual(created.success, true, 'create-custom-tool should succeed');
  assert(mcpServer.tools.has('custom_demo_tool'), 'custom tool should be present after creation');

  const deleted = await ipcMain.invoke('delete-custom-tool', 'custom_demo_tool');
  assert.strictEqual(deleted.success, true, 'delete-custom-tool should succeed');
  assert(!mcpServer.tools.has('custom_demo_tool'), 'custom tool should be removed after delete');

  assert(sentEvents.some(e => e.ch === 'capability-update'), 'capability-update event should be emitted');

  console.log('[test-tool-routing-lifecycle] PASS');
}

main().catch((err) => {
  console.error('[test-tool-routing-lifecycle] FAIL:', err);
  process.exit(1);
});
