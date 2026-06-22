const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const setupIpcHandlers = require('../src/main/ipc-handlers');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    if (this.handlers.has(channel)) {
      throw new Error(`Duplicate ipcMain.handle registration: ${channel}`);
    }
    this.handlers.set(channel, fn);
  }
}

class MockContainer {
  constructor(map) {
    this.map = map;
  }

  get(name) {
    if (!(name in this.map)) {
      throw new Error(`Missing service in container: ${name}`);
    }
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }
}

function extractExpectedChannels() {
  const dir = path.join(__dirname, '../src/main/ipc');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f.startsWith('register-'));
  const channels = new Set();
  const regex = /ipcMain\.handle\('([^']+)'/g;

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    let match;
    while ((match = regex.exec(content)) !== null) {
      channels.add(match[1]);
    }
  }

  return Array.from(channels).sort();
}

function assertEqualSets(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(x => !actualSet.has(x));
  const extra = actual.filter(x => !expectedSet.has(x));

  if (missing.length || extra.length) {
    throw new Error([
      `IPC channel mismatch.`,
      `Missing (${missing.length}): ${missing.join(', ')}`,
      `Extra (${extra.length}): ${extra.join(', ')}`
    ].join('\n'));
  }
}

function buildMockRuntime() {
  const mcpServer = new EventEmitter();
  mcpServer.executeTool = async () => ({ success: true });
  mcpServer.getTools = () => [];
  mcpServer.getToolsDocumentation = () => ({});
  mcpServer.getToolGroups = () => [];
  mcpServer.activateGroup = async () => ({});
  mcpServer.deactivateGroup = async () => ({});
  mcpServer.getActiveTools = () => [];
  mcpServer.setToolActiveState = async () => {};
  mcpServer.tools = new Map();

  const aiService = {
    initialize: async () => {},
    stopGeneration: () => true,
    isGenerating: false,
    getProviders: () => ['openai'],
    getModels: async () => [],
    setProvider: async () => {},
    setSystemPrompt: async () => {},
    getSystemPrompt: () => 'You are a helpful AI assistant.',
    adapters: {}
  };

  const db = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'getSetting') return async () => null;
      if (prop === 'getCurrentSession') return async () => null;
      if (prop === 'getConversations') return async () => [];
      if (prop === 'getToolStates') return async () => ({});
      if (prop === 'getAllSettings') return async () => ({});
      if (prop === 'getAPIKey') return async () => null;
      if (prop === 'getCustomTools') return async () => [];
      if (prop === 'getPromptRules') return async () => [];
      if (prop === 'getActivePromptRules') return async () => [];
      if (prop === 'getChatSessions') return async () => [];
      if (prop === 'getCalendarEvents') return async () => [];
      if (prop === 'getTodos') return async () => [];
      if (prop === 'getWorkflows') return async () => [];
      if (prop === 'get') return () => null;
      return async () => ({ success: true });
    }
  });

  return new MockContainer({
    db,
    aiService,
    mcpServer,
    mainWindow: { webContents: { send: () => {} } },
    ollamaService: {},
    chainController: { stopChain: () => {}, executeWithChaining: async () => ({ content: 'ok' }) },
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
    portListenerManager: {
      register: async () => ({ success: true }),
      unregister: async () => ({ success: true }),
      getListeners: () => []
    },
    agentMemory: {
      append: async () => ({}),
      read: async () => ({}),
      list: async () => [],
      getStats: () => ({}),
      saveImage: async () => ({})
    },
    promptFileManager: {
      syncToFiles: async () => {},
      getPaths: () => ({}),
      syncFromFiles: async () => {},
      loadSystemPrompt: async () => 'x',
      saveSystemPrompt: async () => {},
      loadRulesFromFiles: async () => []
    },
    agentLoop: {
      onSessionClose: async () => {},
      recordActivity: () => {},
      loadMemoryContext: async () => null,
      getSession: () => ({ autoMemory: false, idleSeconds: 0 })
    },
    connectorRuntime: {
      listConnectors: async () => [],
      startConnector: async () => ({}),
      stopConnector: async () => ({}),
      getLogs: () => []
    },
    sessionWorkspace: {
      getWorkspacePath: () => null,
      listFiles: () => [],
      readFile: () => ({ success: false, error: 'No workspace in IPC registration test' })
    },
    dispatcher: { dispatch: async () => ({ content: 'ok' }) },
    agentManager: {
      getAgents: async () => [],
      getAgent: async () => null,
      createAgent: async () => ({}),
      updateAgent: async () => ({}),
      deleteAgent: async () => ({}),
      activateAgent: async () => ({}),
      deactivateAgent: async () => {},
      compactAgent: async () => {}
    },
    eventBus: { publish: () => {}, getLog: () => [] },
    memoryDaemon: { running: false, start: async () => {}, stop: () => {}, getStatus: () => ({ running: false }) },
    workflowScheduler: {
      running: false,
      start: async () => {},
      stop: () => {},
      getStatus: () => ({ running: false }),
      addSchedule: async () => ({}),
      removeSchedule: async () => ({}),
      toggleSchedule: async () => ({}),
      _getAllSchedules: () => []
    },
    sessionInitManager: {
      recordActivity: async () => {},
      detectStartType: async () => ({ isColdStart: false }),
      buildColdStartPrompt: async () => null,
      buildBaseInitReport: async () => ({})
    }
  });
}

function main() {
  const ipcMain = new FakeIpcMain();
  const container = buildMockRuntime();
  setupIpcHandlers(ipcMain, container);

  const expected = extractExpectedChannels();
  const actual = Array.from(ipcMain.handlers.keys()).sort();
  assertEqualSets(expected, actual);

  console.log(`[test-ipc-registration] PASS: ${actual.length} channels registered with no duplicates.`);
}

main();
