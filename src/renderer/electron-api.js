const { contextBridge, ipcRenderer } = require('electron');

const IPC_DEBUG_LIMIT = 40;
const rawInvoke = ipcRenderer.invoke.bind(ipcRenderer);
const ipcDebugErrors = [];
const rendererDebugEvents = [];
const RENDERER_DEBUG_ENABLED = typeof process !== 'undefined'
  && process?.env?.LOCALAGENT_RENDERER_DEBUG === '1';

function pushRendererDebugEvent(entry) {
  rendererDebugEvents.push({
    at: new Date().toISOString(),
    ...entry
  });
  if (rendererDebugEvents.length > IPC_DEBUG_LIMIT) {
    rendererDebugEvents.splice(0, rendererDebugEvents.length - IPC_DEBUG_LIMIT);
  }
}

function summarizeIpcArg(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 220 ? `${value.slice(0, 220)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length };
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value).slice(0, 12)
    };
  }
  return typeof value;
}

function pushIpcDebugError(channel, args, error) {
  const entry = {
    channel,
    args: Array.isArray(args) ? args.map(summarizeIpcArg) : [],
    message: error?.message || String(error || 'Unknown IPC error')
  };
  ipcDebugErrors.push({
    at: new Date().toISOString(),
    ...entry
  });
  if (ipcDebugErrors.length > IPC_DEBUG_LIMIT) {
    ipcDebugErrors.splice(0, ipcDebugErrors.length - IPC_DEBUG_LIMIT);
  }
  pushRendererDebugEvent({
    type: 'ipc',
    ...entry
  });
}

function createDebugApi() {
  const api = {
    getRecentIpcErrors: () => ipcDebugErrors.slice(),
    getRecentErrors: () => rendererDebugEvents.slice(),
    clearRecentIpcErrors: () => {
      ipcDebugErrors.length = 0;
      return true;
    },
    clearRecentErrors: () => {
      ipcDebugErrors.length = 0;
      rendererDebugEvents.length = 0;
      return true;
    }
  };

  if (RENDERER_DEBUG_ENABLED) {
    api.invokeRaw = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
  }

  return api;
}

ipcRenderer.invoke = async (channel, ...args) => {
  try {
    return await rawInvoke(channel, ...args);
  } catch (error) {
    pushIpcDebugError(channel, args, error);
    console.warn(`[IPC] invoke failed for ${channel}:`, error);
    throw error;
  }
};

if (typeof window.addEventListener === 'function') {
  window.addEventListener('error', (event) => {
    pushRendererDebugEvent({
      type: 'window-error',
      message: event?.message || 'Unknown renderer error',
      source: event?.filename || '',
      line: Number(event?.lineno || 0),
      column: Number(event?.colno || 0),
      stack: event?.error?.stack || ''
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    pushRendererDebugEvent({
      type: 'unhandledrejection',
      message: reason?.message || String(reason || 'Unhandled promise rejection'),
      stack: reason?.stack || ''
    });
  });
}

const debugApi = createDebugApi();

// Expose only the renderer API surface used by the app.
const electronApi = {
  // Convenience wrappers
  sendMessage: (msg, sessionId) => ipcRenderer.invoke('send-message', msg, true, sessionId),
  createChatSession: (options = {}) => ipcRenderer.invoke('create-chat-session', options),
  openNewWindow: () => ipcRenderer.invoke('open-new-window'),
  getConversations: (limit, sessionId) => ipcRenderer.invoke('get-conversations', limit, sessionId),
  getContextUsageEstimate: (sessionId, currentPrompt = '') => ipcRenderer.invoke('get-context-usage-estimate', sessionId, currentPrompt),
  clearConversations: () => ipcRenderer.invoke('clear-conversations'),
  getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt'),
  setSystemPrompt: (prompt) => ipcRenderer.invoke('set-system-prompt', prompt),
  getSetting: (key) => ipcRenderer.invoke('get-setting-value', key),
  getContextSetting: () => ipcRenderer.invoke('get-context-setting'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  setContextSetting: (value) => ipcRenderer.invoke('set-context-setting', value),
  getProviders: () => ipcRenderer.invoke('get-providers'),
  handleFileDrop: (filePath) => ipcRenderer.invoke('handle-file-drop', filePath),
  getMCPTools: (context = {}) => ipcRenderer.invoke('get-mcp-tools', context),
  getMCPToolInventory: () => ipcRenderer.invoke('get-mcp-tool-inventory'),
  getMCPToolsDocumentation: () => ipcRenderer.invoke('get-mcp-tools-documentation'),
  executeMCPTool: (toolName, params) => ipcRenderer.invoke('execute-mcp-tool', toolName, params),
  executeMCPToolOnce: (toolName, params, options = {}) => ipcRenderer.invoke('execute-mcp-tool-once', toolName, params, options),
  readFileContent: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getToolStates: () => ipcRenderer.invoke('get-tool-states'),
  setToolActive: (toolName, active, context = {}) => ipcRenderer.invoke('set-tool-active', toolName, active, context),
  createCustomTool: (toolData) => ipcRenderer.invoke('create-custom-tool', toolData),
  getCustomTools: () => ipcRenderer.invoke('get-custom-tools'),
  updateCustomTool: (existingName, updates) => ipcRenderer.invoke('update-custom-tool', existingName, updates),
  deleteCustomTool: (toolName) => ipcRenderer.invoke('delete-custom-tool', toolName),
  // Tool Groups
  getToolGroups: () => ipcRenderer.invoke('get-tool-groups'),
  activateToolGroup: (groupId) => ipcRenderer.invoke('activate-tool-group', groupId),
  deactivateToolGroup: (groupId) => ipcRenderer.invoke('deactivate-tool-group', groupId),
  getActiveTools: () => ipcRenderer.invoke('get-active-tools'),
  getCalendarEvents: () => ipcRenderer.invoke('get-calendar-events'),
  addCalendarEvent: (calendarEvent) => ipcRenderer.invoke('add-calendar-event', calendarEvent),
  updateCalendarEvent: (id, calendarEvent) => ipcRenderer.invoke('update-calendar-event', id, calendarEvent),
  deleteCalendarEvent: (id) => ipcRenderer.invoke('delete-calendar-event', id),
  getTodos: (sessionId = null) => ipcRenderer.invoke('get-todos', sessionId),
  addTodo: (todo, sessionId = null) => ipcRenderer.invoke('add-todo', todo, sessionId),
  updateTodo: (id, todo, sessionId = null) => ipcRenderer.invoke('update-todo', id, todo, sessionId),
  deleteTodo: (id, sessionId = null) => ipcRenderer.invoke('delete-todo', id, sessionId),

  getChatSessions: (date, limit) => ipcRenderer.invoke('get-chat-sessions', date, limit),
  getChatSessionMeta: (sessionId) => ipcRenderer.invoke('get-chat-session-meta', sessionId),
  loadChatSession: (sessionId) => ipcRenderer.invoke('load-chat-session', sessionId),
  importChatSessionMessages: (sessionId, messages) => ipcRenderer.invoke('chat-session:import-messages', sessionId, messages),
  switchChatSession: (sessionId) => ipcRenderer.invoke('switch-chat-session', sessionId),
  clearChatSession: (sessionId) => ipcRenderer.invoke('clear-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
  deleteAllConversations: () => ipcRenderer.invoke('delete-all-conversations'),
  getSessionArtifacts: (sessionId) => ipcRenderer.invoke('get-session-artifacts', sessionId),
  readSessionArtifact: (sessionId, fileName) => ipcRenderer.invoke('read-session-artifact', sessionId, fileName),
  writeSessionArtifact: (sessionId, fileName, content) => ipcRenderer.invoke('write-session-artifact', sessionId, fileName, content),
  acceptArtifact: (sessionId, artifactKey) => ipcRenderer.invoke('accept-artifact', sessionId, artifactKey),
  cleanArtifact: (sessionId, artifactKey) => ipcRenderer.invoke('clean-artifact', sessionId, artifactKey),
  privateSession: {
    create: (options = {}) => ipcRenderer.invoke('create-chat-session', { ...options, private: true }),
    closeSummary: (sessionId) => ipcRenderer.invoke('private-session:close-summary', sessionId),
    discard: (sessionId) => ipcRenderer.invoke('private-session:discard', sessionId),
    save: (sessionId, options = {}) => ipcRenderer.invoke('private-session:save', sessionId, options)
  },
  execution: {
    getContext: () => ipcRenderer.invoke('execution:get-context'),
    setRoot: (rootPath) => ipcRenderer.invoke('execution:set-root', rootPath),
    clearRoot: () => ipcRenderer.invoke('execution:clear-root'),
    setAllowOutsideRoot: (allowOutsideRoot) => ipcRenderer.invoke('execution:set-allow-outside', allowOutsideRoot)
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getSettingValue: (key) => ipcRenderer.invoke('get-setting-value', key),
  verifyQwenKey: (apiKey) => ipcRenderer.invoke('verify-qwen-key', apiKey),
  getPromptRules: () => ipcRenderer.invoke('get-prompt-rules'),
  addPromptRule: (rule) => ipcRenderer.invoke('add-prompt-rule', rule),
  updatePromptRule: (id, rule) => ipcRenderer.invoke('update-prompt-rule', id, rule),
  togglePromptRule: (id, active) => ipcRenderer.invoke('toggle-prompt-rule', id, active),
  deletePromptRule: (id) => ipcRenderer.invoke('delete-prompt-rule', id),
  llm: {
    getModels: (provider, forceRefresh = false) => ipcRenderer.invoke('llm:get-models', provider, forceRefresh),
    saveConfig: (config) => ipcRenderer.invoke('llm:save-config', config),
    getConfig: () => ipcRenderer.invoke('llm:get-config'),
    getProviderConnectionConfig: (provider) => ipcRenderer.invoke('llm:get-provider-connection-config', provider),
    getProviderProfiles: () => ipcRenderer.invoke('llm:get-provider-profiles'),
    getModelProfile: (provider, model) => ipcRenderer.invoke('llm:get-model-profile', provider, model),
    saveModelRuntime: (provider, model, runtimeConfig) => ipcRenderer.invoke('llm:save-model-runtime', { provider, model, runtimeConfig }),
    getCodexStatus: () => ipcRenderer.invoke('llm:codex-status'),
    launchCodexLogin: () => ipcRenderer.invoke('llm:codex-login'),
    fetchQwenOAuth: () => ipcRenderer.invoke('llm:fetch-qwen-oauth'),
    testModel: (provider, model) => ipcRenderer.invoke('llm:test-model', { provider, model }),
    setThinkingMode: (mode) => ipcRenderer.invoke('llm:set-thinking-mode', mode),
    getThinkingMode: () => ipcRenderer.invoke('llm:get-thinking-mode'),
    setShowThinking: (show) => ipcRenderer.invoke('llm:set-show-thinking', show)
  },
  // Workflow API
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  saveWorkflow: (workflow) => ipcRenderer.invoke('save-workflow', workflow),
  runWorkflow: (workflowId) => ipcRenderer.invoke('run-workflow', workflowId),
  runWorkflowAdvanced: (workflowId, options) => ipcRenderer.invoke('run-workflow-advanced', workflowId, options),
  executeWorkflow: (workflowId, paramOverrides) => ipcRenderer.invoke('execute-workflow', workflowId, paramOverrides),
  getWorkflowRun: (runId) => ipcRenderer.invoke('get-workflow-run', runId),
  listWorkflowRuns: (filters) => ipcRenderer.invoke('list-workflow-runs', filters),
  captureWorkflow: (trigger, toolChain, name) => ipcRenderer.invoke('capture-workflow', trigger, toolChain, name),
  searchWorkflows: (query) => ipcRenderer.invoke('search-workflows', query),
  deleteWorkflow: (workflowId) => ipcRenderer.invoke('delete-workflow', workflowId),
  copyWorkflow: (workflowId, newName) => ipcRenderer.invoke('copy-workflow', workflowId, newName),
  updateWorkflow: (workflowId, data) => ipcRenderer.invoke('update-workflow', workflowId, data),
  interpretToolResult: (toolName, params, result) => ipcRenderer.invoke('interpret-tool-result', toolName, params, result),
  // Generation control
  stopGeneration: () => ipcRenderer.invoke('stop-generation'),
  isGenerating: () => ipcRenderer.invoke('is-generating'),
  onConversationUpdate: (callback) => ipcRenderer.on('conversation-update', callback),
  onArtifactUpdate: (callback) => ipcRenderer.on('artifact-update', callback),
  onTaskQueueUpdate: (callback) => ipcRenderer.on('task-queue-update', callback),
  onCalendarUpdate: (callback) => ipcRenderer.on('calendar-update', callback),
  onTodoUpdate: (callback) => ipcRenderer.on('todo-update', callback),
  onToolUpdate: (callback) => ipcRenderer.on('tool-update', callback),
  onToolPreviewUpdate: (callback) => ipcRenderer.on('tool-preview-update', callback),
  onToolPermissionRequest: (callback) => ipcRenderer.on('tool-permission-request', callback),
  onCapabilityUpdate: (callback) => ipcRenderer.on('capability-update', callback),
  // Capability Management API
  capability: {
    getState: () => ipcRenderer.invoke('capability:get-state'),
    getGroups: () => ipcRenderer.invoke('capability:get-groups'),
    setMain: (enabled) => ipcRenderer.invoke('capability:set-main', enabled),
    setGroup: (groupId, enabled) => ipcRenderer.invoke('capability:set-group', groupId, enabled),
    setFilesMode: (mode) => ipcRenderer.invoke('capability:set-files-mode', mode),
    setTerminalMode: (mode) => ipcRenderer.invoke('capability:set-terminal-mode', mode),
    getActiveTools: (context = {}) => ipcRenderer.invoke('capability:get-active-tools', context),
    addPortListener: (listener) => ipcRenderer.invoke('capability:add-port-listener', listener),
    removePortListener: (port) => ipcRenderer.invoke('capability:remove-port-listener', port),
    getPortListeners: () => ipcRenderer.invoke('capability:get-port-listeners'),
    setCustomToolSafe: (toolName, isSafe) => ipcRenderer.invoke('capability:set-custom-tool-safe', toolName, isSafe)
  },
  // Port Listener API
  portListener: {
    register: (config) => ipcRenderer.invoke('port-listener:register', config),
    unregister: (port) => ipcRenderer.invoke('port-listener:unregister', port),
    list: () => ipcRenderer.invoke('port-listener:list')
  },
  onPortListenerUpdate: (callback) => ipcRenderer.on('port-listener-update', callback),
  a2a: {
    getStatus: () => ipcRenderer.invoke('a2a:get-status'),
    setExposure: (enabled) => ipcRenderer.invoke('a2a:set-exposure', enabled),
    listTargets: () => ipcRenderer.invoke('a2a:list-targets'),
    describeTarget: (targetId) => ipcRenderer.invoke('a2a:describe-target', targetId)
  },
  onA2AStatusUpdate: (callback) => ipcRenderer.on('a2a-status-update', callback),
  onExecutionContextUpdate: (callback) => ipcRenderer.on('execution-context-updated', callback),
  companion: {
    getStatus: () => ipcRenderer.invoke('companion:status'),
    enable: (options = {}) => ipcRenderer.invoke('companion:enable', options),
    disable: () => ipcRenderer.invoke('companion:disable'),
    setAndroidBrowserHttps: (enabled) => ipcRenderer.invoke('companion:set-android-browser-https', enabled),
    setupAndroidBrowserHttps: () => ipcRenderer.invoke('companion:setup-android-browser-https'),
    generatePairing: () => ipcRenderer.invoke('companion:generate-pairing'),
    getPairing: () => ipcRenderer.invoke('companion:get-pairing'),
    renderQr: (payload) => ipcRenderer.invoke('companion:render-qr', payload),
    cancelPairing: () => ipcRenderer.invoke('companion:cancel-pairing'),
    listDevices: () => ipcRenderer.invoke('companion:list-devices'),
    removeDevice: (deviceId) => ipcRenderer.invoke('companion:remove-device', deviceId),
    updateDevicePermissions: (deviceId, permissions) => ipcRenderer.invoke('companion:update-device-permissions', deviceId, permissions),
    getPermissionPresets: () => ipcRenderer.invoke('companion:get-permission-presets'),
    notifyStateChanged: (scope, payload = {}) => ipcRenderer.invoke('companion:notify-state-changed', scope, payload)
  },
  remoteGateway: {
    getStatus: () => ipcRenderer.invoke('remote-gateway:status'),
    connect: (options = {}) => ipcRenderer.invoke('remote-gateway:connect', options),
    disconnect: () => ipcRenderer.invoke('remote-gateway:disconnect'),
    deploy: (sshConfig = {}) => ipcRenderer.invoke('remote-gateway:deploy', sshConfig),
    setup: (options = {}) => ipcRenderer.invoke('remote-gateway:setup', options),
    generateSecret: () => ipcRenderer.invoke('remote-gateway:generate-secret')
  },
  // Agent Memory API
  agentMemory: {
    append: (type, content, filename) => ipcRenderer.invoke('agent-memory:append', type, content, filename),
    read: (type, filename) => ipcRenderer.invoke('agent-memory:read', type, filename),
    list: (type) => ipcRenderer.invoke('agent-memory:list', type),
    stats: () => ipcRenderer.invoke('agent-memory:stats'),
    saveImage: (imageBuffer, name) => ipcRenderer.invoke('agent-memory:save-image', imageBuffer, name)
  },
  // Agent Management API
  agents: {
    list: (type) => ipcRenderer.invoke('get-agents', type),
    get: (id) => ipcRenderer.invoke('get-agent', id),
    create: (data) => ipcRenderer.invoke('create-agent', data),
    update: (id, data) => ipcRenderer.invoke('update-agent', id, data),
    setSidebarVisible: (id, visible) => ipcRenderer.invoke('set-agent-sidebar-visible', id, visible),
    delete: (id) => ipcRenderer.invoke('delete-agent', id),
    activate: (id) => ipcRenderer.invoke('activate-agent', id),
    deactivate: (id) => ipcRenderer.invoke('deactivate-agent', id),
    compact: (id) => ipcRenderer.invoke('compact-agent', id),
    listFiles: (id) => ipcRenderer.invoke('list-agent-files', id),
    readFile: (id, relativePath) => ipcRenderer.invoke('read-agent-file', id, relativePath),
    getChatUI: (id, uiContext = {}) => ipcRenderer.invoke('get-agent-chat-ui', id, uiContext),
    runChatUIAction: (id, action, payload = {}, uiContext = {}) => ipcRenderer.invoke('run-agent-chat-ui-action', id, action, payload, uiContext),
    chatUIEvent: (id, eventName, payload = {}, uiContext = {}) => ipcRenderer.invoke('agent-chat-ui-event', id, eventName, payload, uiContext),
  },
  subagents: {
    listRuns: (filters = {}) => ipcRenderer.invoke('subagents:list-runs', filters),
    getRun: (runId) => ipcRenderer.invoke('subagents:get-run', runId),
    stopRun: (runId) => ipcRenderer.invoke('subagents:stop-run', runId),
    closeRun: (runId) => ipcRenderer.invoke('subagents:close-run', runId),
    clearRuns: (filters = {}) => ipcRenderer.invoke('subagents:clear-runs', filters)
  },
  onAgentUpdate: (callback) => ipcRenderer.on('agent-update', callback),

  // Background Daemon API
  daemon: {
    memoryStart: () => ipcRenderer.invoke('daemon:memory-start'),
    memoryStop: () => ipcRenderer.invoke('daemon:memory-stop'),
    memoryStatus: () => ipcRenderer.invoke('daemon:memory-status'),
    memoryRunNow: () => ipcRenderer.invoke('daemon:memory-run-now'),
    workflowStart: () => ipcRenderer.invoke('daemon:workflow-start'),
    workflowStop: () => ipcRenderer.invoke('daemon:workflow-stop'),
    workflowStatus: () => ipcRenderer.invoke('daemon:workflow-status'),
    addSchedule: (workflowId, intervalMinutes, name) => ipcRenderer.invoke('daemon:add-schedule', workflowId, intervalMinutes, name),
    removeSchedule: (scheduleId) => ipcRenderer.invoke('daemon:remove-schedule', scheduleId),
    toggleSchedule: (scheduleId, enabled) => ipcRenderer.invoke('daemon:toggle-schedule', scheduleId, enabled),
    getSchedules: () => ipcRenderer.invoke('daemon:get-schedules'),
  },

  // Session Init API
  sessionInit: {
    detect: () => ipcRenderer.invoke('session-init:detect'),
    getColdStartPrompt: (hoursInactive) => ipcRenderer.invoke('session-init:cold-start-prompt', hoursInactive),
  },

  // BaseInit API
  baseinit: {
    check: () => ipcRenderer.invoke('baseinit:check'),
    run: () => ipcRenderer.invoke('baseinit:run'),
  },

  setupSuperagent: {
    getAssessment: (options = {}) => ipcRenderer.invoke('setup-superagent:get-assessment', options),
    runAction: (input = {}) => ipcRenderer.invoke('setup-superagent:run-action', input),
    dismissAction: (actionId) => ipcRenderer.invoke('setup-superagent:dismiss-action', actionId)
  },

  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    scan: () => ipcRenderer.invoke('plugins:scan'),
    enable: (pluginId) => ipcRenderer.invoke('plugins:enable', pluginId),
    disable: (pluginId) => ipcRenderer.invoke('plugins:disable', pluginId),
    setSidebarVisible: (pluginId, visible) => ipcRenderer.invoke('plugins:set-sidebar-visible', pluginId, visible),
    inspect: (pluginId) => ipcRenderer.invoke('plugins:inspect', pluginId),
    getSetupUI: (pluginId) => ipcRenderer.invoke('plugins:get-setup-ui', pluginId),
    getConfig: (pluginId) => ipcRenderer.invoke('plugins:get-config', pluginId),
    setConfig: (pluginId, key, value) => ipcRenderer.invoke('plugins:set-config', pluginId, key, value),
    runAction: (pluginId, action, params = {}) => ipcRenderer.invoke('plugins:run-action', pluginId, action, params),
    openStudio: (options = {}) => ipcRenderer.invoke('plugins:open-studio', options),
    quickSetup: (pluginName) => ipcRenderer.invoke('plugins:quick-setup', pluginName),
    getSidebarWidgets: () => ipcRenderer.invoke('plugins:get-sidebar-widgets'),
    runSidebarWidgetAction: (widgetId, action, params = {}) => ipcRenderer.invoke('plugins:run-sidebar-widget-action', widgetId, action, params)
  },

  dialogs: {
    pickDirectory: (options = {}) => ipcRenderer.invoke('dialog:pick-directory', options),
    pickFile: (options = {}) => ipcRenderer.invoke('dialog:pick-file', options)
  },

  app: {
    refresh: () => ipcRenderer.invoke('app:refresh-window'),
    restart: () => ipcRenderer.invoke('app:restart')
  },
  appearance: {
    getTypefaces: () => ipcRenderer.invoke('ui:get-typefaces')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item-in-folder', filePath)
  },

  tts: {
    getContract: () => ipcRenderer.invoke('tts:get-contract'),
    getSettings: () => ipcRenderer.invoke('tts:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('tts:save-settings', settings),
    listProviders: (options = {}) => ipcRenderer.invoke('tts:list-providers', options),
    listVoices: (params = {}) => ipcRenderer.invoke('tts:list-voices', params),
    speak: (params = {}) => ipcRenderer.invoke('tts:speak', params),
    stop: (params = {}) => ipcRenderer.invoke('tts:stop', params)
  },

  stt: {
    getContract: () => ipcRenderer.invoke('stt:get-contract'),
    getSettings: () => ipcRenderer.invoke('stt:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('stt:save-settings', settings),
    listProviders: (options = {}) => ipcRenderer.invoke('stt:list-providers', options),
    transcribeAudio: (params = {}) => ipcRenderer.invoke('stt:transcribe-audio', params)
  },

  // EventBus API
  eventBus: {
    getLog: (category, limit) => ipcRenderer.invoke('eventbus:get-log', category, limit),
  },
  onBackgroundEvent: (callback) => ipcRenderer.on('background-event', callback),
  onBackgroundNotification: (callback) => ipcRenderer.on('background-notification', callback),
  onLlmSoftAlert: (callback) => ipcRenderer.on('llm-soft-alert', callback),
  onPluginStudioOpen: (callback) => ipcRenderer.on('plugins:open-studio', callback),
  onPluginStateChanged: (callback) => ipcRenderer.on('plugins:state-changed', callback),
  onWorkflowUpdate: (callback) => ipcRenderer.on('workflow-update', callback),
  permissions: {
    getContext: (context = {}) => ipcRenderer.invoke('permissions:get-context', context),
    getAgentProfile: (agentId) => ipcRenderer.invoke('permissions:get-agent-profile', agentId),
    setAgentGroup: (agentId, groupId, value) => ipcRenderer.invoke('permissions:set-agent-group', agentId, groupId, value),
    setAgentTool: (agentId, toolName, active) => ipcRenderer.invoke('permissions:set-agent-tool', agentId, toolName, active),
    applyAgentPreset: (agentId, presetId) => ipcRenderer.invoke('permissions:apply-agent-preset', agentId, presetId),
    resetAgentProfile: (agentId) => ipcRenderer.invoke('permissions:reset-agent-profile', agentId)
  },
  tasks: {
    list: (options = {}) => ipcRenderer.invoke('task-queue:list', options),
    run: (taskId, context = {}) => ipcRenderer.invoke('task-queue:run', taskId, context),
    defer: (taskId, minutes = 5, options = {}) => ipcRenderer.invoke('task-queue:defer', taskId, minutes, options),
    approve: (taskId, options = {}) => ipcRenderer.invoke('task-queue:approve', taskId, options),
    cancel: (taskId, options = {}) => ipcRenderer.invoke('task-queue:cancel', taskId, options),
    createOrReuse: (taskInput = {}, options = {}) => ipcRenderer.invoke('task-queue:create-or-reuse', taskInput, options)
  },
  debug: debugApi
};

contextBridge.exposeInMainWorld('electronBridge', electronApi);
contextBridge.exposeInMainWorld('localAgentDebug', debugApi);
