const Database = require('./database');
const AIService = require('./ai-service');
const MCPServer = require('./mcp-server');
const ToolChainController = require('./tool-chain-controller');
const WorkflowManager = require('./workflow-manager');
const WorkflowRuntime = require('./workflow-runtime');
const EmbeddingService = require('./embedding-service');
const VectorStore = require('./vector-store');
const CapabilityManager = require('./capability-manager');
const ToolPermissionStore = require('./tool-permission-store');
const ToolPermissionService = require('./tool-permission-service');
const PortListenerManager = require('./port-listener-manager');
const AgentMemory = require('./agent-memory');
const PromptFileManager = require('./prompt-file-manager');
const AgentLoop = require('./agent-loop');
const ConnectorRuntime = require('./connector-runtime');
const ExternalChannelBridge = require('./external-channel-bridge');
const InferenceDispatcher = require('./inference-dispatcher');
const { A2AManager } = require('./a2a-manager');
const SessionWorkspace = require('./session-workspace');
const AgentManager = require('./agent-manager');
const SubtaskRuntime = require('./subtask-runtime');
const ollamaService = require('./ollama-service');
const BackendEventBus = require('./backend-event-bus');
const BackgroundMemoryDaemon = require('./background-memory-daemon');
const BackgroundWorkflowScheduler = require('./background-workflow-scheduler');
const SessionInitManager = require('./session-init-manager');
const { SetupSuperagentService } = require('./setup-superagent-service');
const PluginManager = require('./plugin-manager');
const KnowledgeManager = require('./knowledge-manager');
const ResearchRuntime = require('./research-runtime');
const TaskQueueService = require('./task-queue-service');
const ArtifactRegistry = require('./artifact-registry');
const { TimerManager } = require('./timer-manager');
const { ExecutionDirectory } = require('./execution-directory');
const { CompanionTlsManager } = require('./companion-tls-manager');
const TtsService = require('./tts-service');
const SttService = require('./stt-service');
const { createTtsHttpEntrypoint } = require('./tts-http-entrypoint');
const { createChatContextService } = require('./chat-context-service');
const { stripToolPatterns, stripReasoningBlocks } = require('./ipc/shared-utils');
const { PrivateSessionStore, isPrivateSessionId } = require('./private-session-store');
const { RemoteGatewayManager } = require('./companion/remote-gateway-manager');

function registerOrReplace(container, name, instance) {
  if (container.has?.(name)) {
    container.replace(name, instance);
    return;
  }
  container.register(name, instance);
}

async function setupCoreInfrastructure(ctx) {
  const { container, options, startupProfiler, paths, windowManager, runtimePolicy, isTestClientMode, privateModeDefault } = ctx;

  registerOrReplace(container, 'runtimePaths', paths);
  registerOrReplace(container, 'windowManager', windowManager);
  registerOrReplace(container, 'startupProfiler', startupProfiler);
  registerOrReplace(container, 'runtimePolicy', runtimePolicy);

  const db = new Database({ dbPath: options.dbPath, app: options.app });
  await startupProfiler.time('database.init', () => db.init());
  container.register('db', db);
  ctx.db = db;

  const companionTlsManager = new CompanionTlsManager(db, paths);
  const executionDirectory = new ExecutionDirectory(db, {
    defaultRoot: options.executionRoot || process.cwd()
  });
  container.register('companionTlsManager', companionTlsManager);
  container.register('executionDirectory', executionDirectory);
  container.register('privateModeDefault', privateModeDefault);
  container.register('testClientMode', isTestClientMode);

  const testClientStore = options.testClientStore || { sessions: new Map(), currentSessionId: null };
  container.register('testClientStore', testClientStore);
  ctx.testClientStore = testClientStore;

  const eventBus = new BackendEventBus({
    notifyPromptPath: paths.backgroundNotifyPromptPath
  });
  container.register('eventBus', eventBus);
  ctx.eventBus = eventBus;

  const capabilityManager = new CapabilityManager(db);
  if (
    await db.getSetting('execution.allowOutsideRoot') === 'true'
    && capabilityManager.getTerminalMode?.() !== 'system'
  ) {
    capabilityManager.setTerminalMode('system');
  }
  container.register('capabilityManager', capabilityManager);
  ctx.capabilityManager = capabilityManager;
}

async function setupInferenceAndWorkflow(ctx) {
  const { container, startupProfiler, db, capabilityManager, windowManager, runtimePolicy, paths, eventBus } = ctx;

  const mcpServer = new MCPServer(db, capabilityManager);
  mcpServer._windowManager = windowManager;
  mcpServer._uiMode = { noWindow: ctx.isNoWindowMode === true };
  mcpServer.setExecutionDirectory(container.get('executionDirectory'));
  mcpServer.setRuntimePolicy(runtimePolicy);
  capabilityManager.registerCustomTool('setup_superagent', true);

  const aiService = new AIService(db, mcpServer, { windowManager });
  await startupProfiler.time('ai.initialize', () => aiService.initialize());
  mcpServer.setAIService(aiService);
  await startupProfiler.time('mcp.customTools.load', () => mcpServer.loadCustomTools());
  container.register('mcpServer', mcpServer);
  container.register('aiService', aiService);
  ctx.mcpServer = mcpServer;
  ctx.aiService = aiService;

  const dispatcher = new InferenceDispatcher(aiService, db, mcpServer);
  container.register('dispatcher', dispatcher);
  ctx.dispatcher = dispatcher;

  const timerManager = new TimerManager({ db, dispatcher, windowManager });
  mcpServer.setTimerManager(timerManager);
  timerManager.initialize();
  container.register('timerManager', timerManager);
  ctx.timerManager = timerManager;

  const chainController = new ToolChainController(dispatcher, mcpServer, db);
  timerManager.setChainController(chainController);
  container.register('chainController', chainController);
  ctx.chainController = chainController;

  const workflowManager = new WorkflowManager(db, mcpServer, dispatcher, {
    workflowsDir: paths.workflowBasePath
  });
  const workflowRuntime = new WorkflowRuntime(workflowManager, eventBus, paths.workflowBasePath);
  workflowRuntime.initialize();
  workflowManager.setWorkflowRuntime(workflowRuntime);
  chainController.setWorkflowManager(workflowManager);
  mcpServer.setWorkflowManager(workflowManager);
  container.register('workflowManager', workflowManager);
  container.register('workflowRuntime', workflowRuntime);
  ctx.workflowManager = workflowManager;
  ctx.workflowRuntime = workflowRuntime;

  const embeddingService = new EmbeddingService();
  const vectorStore = new VectorStore(db, embeddingService);
  container.register('embeddingService', embeddingService);
  container.register('vectorStore', vectorStore);

  const portListenerManager = new PortListenerManager(dispatcher);
  const agentMemory = new AgentMemory(paths.memoryBasePath);
  container.register('portListenerManager', portListenerManager);
  container.register('agentMemory', agentMemory);
  ctx.agentMemory = agentMemory;
}

function createBootstrapTestHelpers(ctx) {
  function isTestSessionId(sessionId) {
    return typeof sessionId === 'string' && sessionId.startsWith('testclient-');
  }

  function ensureBootstrapTestSession(sessionId = null) {
    if (!ctx.isTestClientMode) return sessionId;
    if (sessionId && isTestSessionId(sessionId)) {
      if (!ctx.testClientStore.sessions.has(sessionId)) {
        ctx.testClientStore.sessions.set(sessionId, {
          id: sessionId,
          title: 'Test Client',
          created_at: new Date().toISOString(),
          messages: []
        });
      }
      ctx.testClientStore.currentSessionId = sessionId;
      return sessionId;
    }
    if (ctx.testClientStore.currentSessionId && ctx.testClientStore.sessions.has(ctx.testClientStore.currentSessionId)) {
      return ctx.testClientStore.currentSessionId;
    }
    const id = `testclient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ctx.testClientStore.sessions.set(id, {
      id,
      title: `Test Chat ${new Date().toLocaleTimeString()}`,
      created_at: new Date().toISOString(),
      messages: []
    });
    ctx.testClientStore.currentSessionId = id;
    return id;
  }

  function getBootstrapTestMessages(sessionId, limit = 100) {
    const sid = ensureBootstrapTestSession(sessionId);
    const session = ctx.testClientStore.sessions.get(sid);
    if (!session) return [];
    return session.messages
      .slice(-limit)
      .map((message) => ({ ...message, timestamp: message.timestamp || new Date().toISOString() }));
  }

  return { ensureBootstrapTestSession, getBootstrapTestMessages };
}

async function setupSessionRuntime(ctx) {
  const { container, startupProfiler, db, dispatcher, eventBus, paths, windowManager, agentMemory } = ctx;

  const taskQueueService = new TaskQueueService({
    db,
    tasksFilePath: paths.tasksQueueFile,
    onQueueUpdated(payload) {
      windowManager.send('task-queue-update', payload || {});
    }
  });
  await startupProfiler.time('taskQueue.initialize', () => taskQueueService.initialize());
  container.register('taskQueueService', taskQueueService);
  ctx.taskQueueService = taskQueueService;

  const sessionWorkspace = new SessionWorkspace(paths.sessionWorkspaceBase);
  sessionWorkspace.cleanupStale(30);
  const artifactRegistry = new ArtifactRegistry(sessionWorkspace, {
    onUpdate(sessionId) {
      windowManager.send('artifact-update', { sessionId });
    }
  });
  const privateSessionStore = new PrivateSessionStore({ sessionWorkspace });
  container.register('sessionWorkspace', sessionWorkspace);
  container.register('artifactRegistry', artifactRegistry);
  container.register('privateSessionStore', privateSessionStore);
  ctx.sessionWorkspace = sessionWorkspace;
  ctx.artifactRegistry = artifactRegistry;
  ctx.privateSessionStore = privateSessionStore;

  const { getBootstrapTestMessages } = createBootstrapTestHelpers(ctx);
  const chatContextService = createChatContextService({
    db,
    dispatcher,
    privateSessionStore,
    testClientMode: ctx.isTestClientMode,
    testClientStore: ctx.testClientStore,
    getTestMessages: getBootstrapTestMessages,
    cleaners: { stripToolPatterns, stripReasoningBlocks }
  });
  container.register('chatContextService', chatContextService);
  if (ctx.timerManager?.setChatContextService) {
    ctx.timerManager.setChatContextService(chatContextService);
  }
  ctx.chatContextService = chatContextService;

  const persistConversationMessage = async (message, sessionId = null) => {
    let result;
    if (privateSessionStore && isPrivateSessionId(sessionId)) {
      result = privateSessionStore.addMessage(sessionId, message);
      chatContextService.append(sessionId, message);
      return result;
    }

    const isTestSession = typeof sessionId === 'string' && sessionId.startsWith('testclient-');
    if (ctx.isTestClientMode && isTestSession) {
      if (!ctx.testClientStore.sessions.has(sessionId)) {
        ctx.testClientStore.sessions.set(sessionId, {
          id: sessionId,
          title: 'Test Client',
          created_at: new Date().toISOString(),
          messages: []
        });
      }
      const session = ctx.testClientStore.sessions.get(sessionId);
      session.messages.push({
        role: message.role,
        content: message.content,
        metadata: message.metadata || null,
        timestamp: new Date().toISOString()
      });
      ctx.testClientStore.currentSessionId = sessionId;
      chatContextService.append(sessionId, message);
      return message;
    }

    result = await db.addConversation(message, sessionId);
    chatContextService.append(sessionId, message);
    return result;
  };

  const subtaskRuntime = new SubtaskRuntime(db, sessionWorkspace, eventBus, paths.subtaskBasePath, {
    persistConversationMessage,
    notifyConversationUpdate(sessionId) {
      if (sessionId === null || sessionId === undefined) {
        return windowManager.send('conversation-update');
      }
      return windowManager.send('conversation-update', { sessionId });
    }
  });
  container.register('subtaskRuntime', subtaskRuntime);
  ctx.subtaskRuntime = subtaskRuntime;

  const promptFileManager = new PromptFileManager(db, paths.promptBasePath);
  await startupProfiler.time('prompt.initialize', () => promptFileManager.initialize());
  const systemPrompt = await startupProfiler.time('prompt.loadSystem', () => promptFileManager.loadSystemPrompt());
  await startupProfiler.time('ai.setSystemPrompt', () => ctx.aiService.setSystemPrompt(systemPrompt));
  ctx.mcpServer.setPromptFileManager(promptFileManager);
  container.register('promptFileManager', promptFileManager);
  ctx.promptFileManager = promptFileManager;

  const agentLoop = new AgentLoop(dispatcher, agentMemory, db, sessionWorkspace, {
    templateBasePath: paths.promptTemplatesDir,
    userProfilePath: paths.userProfilePath,
    taskQueueService
  });
  ctx.mcpServer.setAgentLoop(agentLoop);
  ctx.mcpServer.setSessionWorkspace(sessionWorkspace);
  ctx.mcpServer.setArtifactRegistry(artifactRegistry);
  container.register('agentLoop', agentLoop);
  ctx.agentLoop = agentLoop;

  const connectorRuntime = new ConnectorRuntime(dispatcher, db, {
    connectorsDir: paths.connectorsDir,
    eventBus,
    externalChannelBridge: new ExternalChannelBridge({
      db,
      dispatcher,
      chainController: ctx.chainController,
      windowManager,
      aiService: ctx.aiService,
      chatContextService
    })
  });
  const externalChannelBridge = connectorRuntime.externalChannelBridge;
  ctx.mcpServer.setConnectorRuntime(connectorRuntime);
  container.register('connectorRuntime', connectorRuntime);
  ctx.connectorRuntime = connectorRuntime;
  ctx.externalChannelBridge = externalChannelBridge;

  const a2aManager = new A2AManager({
    db,
    aiService: ctx.aiService,
    dispatcher,
    externalChannelBridge,
    windowManager,
    baseDir: paths.a2aBaseDir,
    targetsDir: paths.a2aTargetsDir,
    tasksDir: paths.a2aTasksDir,
    eventsDir: paths.a2aEventsDir
  });
  await startupProfiler.time('a2a.initialize', () => a2aManager.initialize());
  ctx.mcpServer.setA2AManager(a2aManager);
  container.register('a2aManager', a2aManager);
  ctx.a2aManager = a2aManager;
}

async function setupAgentAndPluginRuntime(ctx) {
  const { container, startupProfiler, db, dispatcher, agentMemory, sessionWorkspace, eventBus, subtaskRuntime, paths, windowManager, taskQueueService } = ctx;

  const agentManager = new AgentManager(
    db,
    dispatcher,
    ctx.agentLoop,
    agentMemory,
    sessionWorkspace,
    ctx.chainController,
    eventBus,
    subtaskRuntime,
    { basePath: paths.agentBasePath }
  );
  await startupProfiler.time('agentManager.initialize', () => agentManager.initialize());
  dispatcher.setAgentManager(agentManager);
  ctx.mcpServer.setAgentManager(agentManager);
  container.register('agentManager', agentManager);
  ctx.agentManager = agentManager;

  const toolPermissionStore = new ToolPermissionStore(db);
  const toolPermissionService = new ToolPermissionService({
    db,
    capabilityManager: ctx.capabilityManager,
    mcpServer: ctx.mcpServer,
    agentManager,
    store: toolPermissionStore
  });
  await startupProfiler.time('toolPermission.initialize', () => toolPermissionService.initialize());
  ctx.mcpServer.setToolPermissionService(toolPermissionService);
  agentManager.setToolPermissionService(toolPermissionService);
  container.register('toolPermissionStore', toolPermissionStore);
  container.register('toolPermissionService', toolPermissionService);

  const sessionInitManager = new SessionInitManager(db, agentMemory, eventBus, {
    agentinPath: paths.agentinRoot,
    templatePath: paths.coldStartTemplatePath,
    connectorsDir: paths.connectorsDir,
    userProfilePath: paths.userProfilePath,
    memoryBasePath: paths.memoryBasePath
  });
  const setupSuperagentService = new SetupSuperagentService(container, {
    db,
    sessionInitManager,
    capabilityManager: ctx.capabilityManager,
    windowManager,
    eventBus
  });
  container.register('sessionInitManager', sessionInitManager);
  container.register('setupSuperagentService', setupSuperagentService);
  ctx.sessionInitManager = sessionInitManager;
  ctx.setupSuperagentService = setupSuperagentService;

  const pluginManager = new PluginManager(container, { pluginsDir: paths.pluginsDir });
  container.register('pluginManager', pluginManager);
  await startupProfiler.time('plugin.initialize', () => pluginManager.initialize({ autoEnablePersisted: false }));
  agentManager.setPluginManager(pluginManager);
  await startupProfiler.time('agentPlugins.sync', () => agentManager.syncDefaultAgentPlugins(pluginManager));
  ctx.mcpServer._setupSuperagentService = setupSuperagentService;
  ctx.pluginManager = pluginManager;

  const ttsService = new TtsService({ db, pluginManager, agentManager });
  const sttService = new SttService({ db, runtimePaths: paths, pluginManager });
  const remoteGatewayManager = new RemoteGatewayManager({
    db,
    getCompanionServer: () => container.optional('companionServer')
  });

  container.register('ttsService', ttsService);
  container.register('sttService', sttService);
  container.register('ttsHttpEntrypoint', createTtsHttpEntrypoint({
    getTtsService: () => container.optional('ttsService')
  }));
  container.register('remoteGatewayManager', remoteGatewayManager);
  ctx.remoteGatewayManager = remoteGatewayManager;

  const memoryDaemon = new BackgroundMemoryDaemon(dispatcher, agentMemory, db, eventBus, {
    basePath: paths.backgroundDaemonBasePath,
    userProfilePath: paths.userProfilePath,
    taskQueueService
  });
  const workflowScheduler = new BackgroundWorkflowScheduler(ctx.workflowManager, db, eventBus);
  container.register('memoryDaemon', memoryDaemon);
  container.register('workflowScheduler', workflowScheduler);
  container.register('ollamaService', ollamaService);
  ctx.memoryDaemon = memoryDaemon;
  ctx.workflowScheduler = workflowScheduler;
}

async function setupBackgroundAndKnowledgeRuntime(ctx) {
  const { container, startupProfiler, db, paths, eventBus } = ctx;

  const knowledgeManager = new KnowledgeManager(db, { baseDir: paths.knowledgeBaseDir });
  container.register('knowledgeManager', knowledgeManager);
  await startupProfiler.time('knowledge.initialize', () => knowledgeManager.initialize());
  ctx.mcpServer.setKnowledgeManager(knowledgeManager);
  ctx.memoryDaemon.setKnowledgeManager(knowledgeManager);

  const researchRuntime = new ResearchRuntime(
    ctx.workflowManager,
    knowledgeManager,
    eventBus,
    paths.researchBasePath
  );
  researchRuntime.initialize();
  ctx.mcpServer.setResearchRuntime(researchRuntime);
  container.register('researchRuntime', researchRuntime);

  ctx.mcpServer.registerTool('explore_knowledge', {
    name: 'explore_knowledge',
    description: 'Get the knowledge file tree. Returns all knowledge items with metadata (titles, categories, tags, file paths, line counts). Use read_file to access specific knowledge content after exploring.',
    userDescription: 'Explore the personal knowledge store',
    inputSchema: { type: 'object' }
  }, async () => knowledgeManager.getKnowledgeTree());
  ctx.capabilityManager.registerCustomTool('explore_knowledge', true);
}

module.exports = {
  registerOrReplace,
  setupAgentAndPluginRuntime,
  setupBackgroundAndKnowledgeRuntime,
  setupCoreInfrastructure,
  setupInferenceAndWorkflow,
  setupSessionRuntime
};
