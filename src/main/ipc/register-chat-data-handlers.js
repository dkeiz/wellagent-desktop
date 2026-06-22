const fs = require('fs');
const path = require('path');
const { getModelRuntimeConfig } = require('../llm-config');
const { getEffectiveLlmSelection, rememberLastWorkingModel } = require('../llm-state');
const {
  stripToolPatterns,
  stripReasoningBlocks,
  buildAssistantContent
} = require('./shared-utils');
const { isPrivateSessionId } = require('../private-session-store');
const { saveGenericSetting } = require('../settings-security');
const { createChatContextService } = require('../chat-context-service');
function registerChatDataHandlers(ipcMain, runtime, helpers) {
  const {
    db,
    mcpServer,
    windowManager,
    chainController,
    agentLoop,
    agentManager,
    dispatcher,
    sessionWorkspace,
    sessionInitManager,
    promptFileManager,
    memoryDaemon,
    taskQueueService,
    executionDirectory,
    capabilityManager,
    privateSessionStore,
    privateModeDefault,
    testClientMode,
    testClientStore,
    artifactRegistry,
    chatContextService: runtimeChatContextService
  } = runtime;
  const { markUserActive, markUserIdle } = helpers;
  function isTestSessionId(sessionId) {
    return typeof sessionId === 'string' && sessionId.startsWith('testclient-');
  }
  function ensurePrivateSession(sessionId = null, options = {}) {
    if (!privateSessionStore) return sessionId;
    return (sessionId && isPrivateSessionId(sessionId)) ? privateSessionStore.ensureSession(sessionId).id : privateSessionStore.createSession(options || {}).id;
  }
  function ensureTestSession(sessionId = null) {
    if (!testClientMode) return sessionId;
    if (sessionId && isTestSessionId(sessionId)) {
      if (!testClientStore.sessions.has(sessionId)) testClientStore.sessions.set(sessionId, { id: sessionId, title: 'Test Client', created_at: new Date().toISOString(), messages: [] });
      return testClientStore.currentSessionId = sessionId;
    }
    if (testClientStore.currentSessionId && testClientStore.sessions.has(testClientStore.currentSessionId)) return testClientStore.currentSessionId;
    const id = `testclient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testClientStore.sessions.set(id, { id, title: `Test Chat ${new Date().toLocaleTimeString()}`, created_at: new Date().toISOString(), messages: [] });
    return testClientStore.currentSessionId = id;
  }
  function getTestMessages(sessionId, limit = 100) {
    const sid = ensureTestSession(sessionId);
    const session = testClientStore.sessions.get(sid);
    if (!session) return [];
    return session.messages.slice(-limit).map(m => ({ ...m, timestamp: m.timestamp || new Date().toISOString() }));
  }
  async function getHistory(limit = 100, sessionId = null) {
    if (isPrivateSessionId(sessionId) && privateSessionStore) return privateSessionStore.getMessages(sessionId, limit);
    if (testClientMode && (isTestSessionId(sessionId) || !sessionId)) return getTestMessages(sessionId, limit);
    return db.getConversations(limit, sessionId);
  }

  const chatContextService = runtimeChatContextService || createChatContextService({
    db,
    dispatcher,
    privateSessionStore,
    testClientMode,
    testClientStore,
    getTestMessages,
    cleaners: { stripToolPatterns, stripReasoningBlocks }
  });

  async function persistMessage(message, sessionId = null) {
    let result;
    if (isPrivateSessionId(sessionId) && privateSessionStore) {
      result = privateSessionStore.addMessage(sessionId, message);
    } else if (testClientMode && (isTestSessionId(sessionId) || !sessionId)) {
      const sid = ensureTestSession(sessionId);
      const session = testClientStore.sessions.get(sid);
      session.messages.push({ role: message.role, content: message.content, metadata: message.metadata || null, timestamp: new Date().toISOString() });
      result = message;
    } else {
      result = await db.addConversation(message, sessionId);
    }
    chatContextService.append(sessionId, message);
    return result;
  }
  async function resolveRuntimeForResponse(response) {
    const responseRuntime = response?.renderContext?.runtimeConfig;
    if (responseRuntime && typeof responseRuntime === 'object') return responseRuntime;
    const provider = response?.renderContext?.provider;
    const model = response?.renderContext?.model;
    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(db, provider, model);
      return runtime;
    }
    const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
    if (activeProvider && activeModel) {
      const { runtime } = await getModelRuntimeConfig(db, activeProvider, activeModel);
      return runtime;
    }
    return null;
  }
  function normalizeClientMessageMetadata(requestMeta) {
    if (!requestMeta || typeof requestMeta !== 'object') return null;
    const clientSource = String(requestMeta.clientSource || requestMeta.client_source || requestMeta.source || '').trim().toLowerCase();
    if (!clientSource) return null;
    const platform = String(requestMeta.platform || clientSource || '').trim().toLowerCase();
    const deviceId = String(requestMeta.deviceId || requestMeta.device_id || '').trim();
    const deviceName = String(requestMeta.deviceName || requestMeta.device_name || '').trim();
    const sourceLabel = String(requestMeta.sourceLabel || requestMeta.source_label || (clientSource === 'web' ? 'Web Client' : clientSource === 'mobile' ? 'Mobile Client' : 'Companion Client')).trim();
    return { clientSource, sourceLabel, platform: platform || clientSource, deviceId: deviceId || null, deviceName: deviceName || null };
  }
  const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.sh', '.ps1', '.bat', '.sql', '.xml', '.html', '.css', '.scss', '.less', '.csv', '.log']);
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
  const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);
  function artifactKindFromExt(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return 'binary';
  }
  ipcMain.handle('get-calendar-events', async () => db.getCalendarEvents());
  ipcMain.handle('add-calendar-event', async (event, calendarEvent) => {
    const result = await db.addCalendarEvent(calendarEvent);
    windowManager.send('calendar-update');
    return result;
  });
  ipcMain.handle('update-calendar-event', async (event, id, calendarEvent) => {
    const result = await db.updateCalendarEvent(id, calendarEvent);
    windowManager.send('calendar-update');
    return result;
  });
  ipcMain.handle('delete-calendar-event', async (event, id) => {
    const result = await db.deleteCalendarEvent(id);
    windowManager.send('calendar-update');
    return result;
  });
  ipcMain.handle('get-todos', async (event, sessionId = null) => db.getTodos(sessionId));
  ipcMain.handle('add-todo', async (event, todo, sessionId = null) => {
    const result = await db.addTodo(todo, sessionId);
    windowManager.send('todo-update');
    return result;
  });
  ipcMain.handle('update-todo', async (event, id, todo, sessionId = null) => {
    const result = await db.updateTodo(id, todo, sessionId);
    windowManager.send('todo-update');
    return result;
  });
  ipcMain.handle('delete-todo', async (event, id, sessionId = null) => {
    const result = await db.deleteTodo(id, sessionId);
    windowManager.send('todo-update');
    return result;
  });
  async function executeTaskAction(task, context = {}) {
    const action = String(task?.action || '').trim().toLowerCase();
    const payload = task?.payload && typeof task.payload === 'object' ? task.payload : {};
    if (!action || action === 'none' || action === 'chat.request_decision') {
      return {
        success: true,
        summary: `Task ${task.id} acknowledged for chat handling.`
      };
    }
    if (action === 'daemon.enqueue_memory_job') {
      const sessionId = String(payload.sessionId || '').trim();
      if (!sessionId) {
        throw new Error('Missing payload.sessionId for daemon.enqueue_memory_job');
      }
      if (isPrivateSessionId(sessionId)) {
        throw new Error('Private sessions cannot be queued for background memory jobs');
      }
      await db.enqueueMemoryJob({
        jobType: String(payload.jobType || 'summarize_session'),
        sessionId,
        payload: {
          source: payload.source || 'task_queue_manual_run',
          enqueued_at: new Date().toISOString(),
          global_task_id: task.id
        }
      });
      return {
        success: true,
        summary: `Queued ${payload.jobType || 'summarize_session'} for session ${sessionId}.`
      };
    }
    if (action === 'subagent.delegate') {
      if (!agentManager || typeof agentManager.invokeSubAgent !== 'function') {
        throw new Error('Sub-agent runtime is unavailable');
      }
      const subagentId = Number(payload.subagentId || payload.subagent_id || 0);
      const delegatedTask = String(payload.task || payload.prompt || '').trim();
      if (!subagentId || !delegatedTask) {
        throw new Error('subagent.delegate requires payload.subagentId and payload.task');
      }
      const parentSessionId = context.sessionId || null;
      const run = await agentManager.invokeSubAgent(parentSessionId, subagentId, delegatedTask, {
        contractType: payload.contract_type || payload.contractType || 'task_complete',
        expectedOutput: payload.expected_output || payload.expectedOutput || '',
        subagentMode: payload.subagent_mode || payload.subagentMode || 'no_ui',
        permissionsContract: payload.permissions_contract || payload.permissionsContract || null
      });
      return {
        success: true,
        delegated: true,
        run,
        summary: `Delegated to subagent ${subagentId} (${run.run_id}).`
      };
    }
    throw new Error(`Unsupported task action: ${action}`);
  }
  ipcMain.handle('task-queue:list', async (event, options = {}) => {
    if (!taskQueueService?.listTasks) return { success: false, error: 'Task queue service unavailable', tasks: [] };
    return taskQueueService.listTasks(options || {});
  });
  ipcMain.handle('task-queue:approve', async (event, taskId, options = {}) => {
    if (!taskQueueService?.approveTask) return { success: false, error: 'Task queue service unavailable' };
    return taskQueueService.approveTask(taskId, { actor: options.actor || 'chat-user' });
  });
  ipcMain.handle('task-queue:cancel', async (event, taskId, options = {}) => {
    if (!taskQueueService?.cancelTask) return { success: false, error: 'Task queue service unavailable' };
    return taskQueueService.cancelTask(taskId, { actor: options.actor || 'chat-user' });
  });
  ipcMain.handle('task-queue:defer', async (event, taskId, minutes = 5, options = {}) => {
    if (!taskQueueService?.deferTask) return { success: false, error: 'Task queue service unavailable' };
    return taskQueueService.deferTask(taskId, minutes, {
      actor: options.actor || 'chat-user',
      reason: options.reason || 'Deferred by user'
    });
  });
  ipcMain.handle('task-queue:run', async (event, taskId, context = {}) => {
    if (!taskQueueService?.claimTaskById) return { success: false, error: 'Task queue service unavailable' };
    const claimed = await taskQueueService.claimTaskById(taskId, {
      owner: context.owner || 'chat',
      actor: context.actor || 'chat-user',
      allowFuture: context.allowFuture === true
    });
    if (!claimed?.success) {
      return claimed || { success: false, error: 'Failed to claim task' };
    }
    try {
      const execResult = await executeTaskAction(claimed.task, context || {});
      if (execResult.deferred && taskQueueService?.deferTask) {
        await taskQueueService.deferTask(claimed.task.id, Number(execResult.deferMinutes || 5), {
          actor: context.actor || 'chat-user',
          reason: execResult.reason || 'Deferred by task executor'
        });
      } else {
        await taskQueueService.completeTask(claimed.task.id, {
          actor: context.actor || 'chat-user',
          summary: execResult.summary || 'Task executed successfully'
        });
      }
      if (memoryDaemon && context.triggerDaemonRun === true && memoryDaemon.runNow) {
        memoryDaemon.runNow().catch(() => {});
      }
      return { success: true, taskId: claimed.task.id, result: execResult };
    } catch (error) {
      await taskQueueService.failTask(claimed.task.id, error.message, { actor: context.actor || 'chat-user' });
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('task-queue:create-or-reuse', async (event, taskInput, options = {}) => {
    if (!taskQueueService?.createOrReuseTask) return { success: false, error: 'Task queue service unavailable' };
    return taskQueueService.createOrReuseTask(taskInput || {}, { actor: options.actor || 'chat-user' });
  });
  ipcMain.handle('get-conversations', async (event, limit = 100, sessionId = null) => {
    return getHistory(limit, sessionId);
  });
  ipcMain.handle('get-context-usage-estimate', async (event, sessionId = null, currentPrompt = '') => {
    return chatContextService.getUsageEstimate(sessionId, currentPrompt);
  });
  ipcMain.handle('add-conversation', async (event, message) => {
    const result = await persistMessage(message, null);
    windowManager.send('conversation-update');
    return result;
  });
  ipcMain.handle('clear-conversations', async () => {
    try {
      if (testClientMode) {
        const sid = ensureTestSession();
        const session = testClientStore.sessions.get(sid);
        session.messages = [];
        chatContextService.invalidate(sid);
        windowManager.send('conversation-update', { sessionId: sid });
        return { cleared: true, sessionId: sid };
      }
      const newSession = await db.createChatSession();
      await db.setCurrentSession(newSession.id);
      chatContextService.invalidate();
      windowManager.send('conversation-update');
      return { cleared: true, sessionId: newSession.id };
    } catch (error) {
      console.error('Error clearing conversations:', error);
      throw error;
    }
  });
  ipcMain.handle('get-prompt-rules', async () => db.getPromptRules());
  ipcMain.handle('get-active-prompt-rules', async () => db.getActivePromptRules());
  ipcMain.handle('add-prompt-rule', async (event, rule) => {
    const result = await db.addPromptRule(rule);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });
  ipcMain.handle('update-prompt-rule', async (event, id, rule) => {
    const result = await db.updatePromptRule(id, rule);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });
  ipcMain.handle('toggle-prompt-rule', async (event, id, active) => {
    const result = await db.togglePromptRule(id, active);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });
  ipcMain.handle('delete-prompt-rule', async (event, id) => {
    const result = await db.deletePromptRule(id);
    if (promptFileManager) await promptFileManager.syncToFiles();
    return result;
  });
  ipcMain.handle('save-setting', async (event, key, value) => saveGenericSetting(db, key, value));
  async function broadcastExecutionContextUpdate(contextPromise) {
    const context = await contextPromise;
    windowManager.send('execution-context-updated', context);
    return context;
  }
  ipcMain.handle('execution:get-context', async () => {
    if (!executionDirectory?.getContext) {
      return {
        rootPath: process.cwd(),
        configuredRoot: null,
        defaultRoot: process.cwd(),
        source: 'default',
        allowOutsideRoot: true
      };
    }
    return executionDirectory.getContext();
  });
  ipcMain.handle('execution:set-root', async (event, rootPath) => {
    if (!executionDirectory?.setRoot) {
      return { success: false, error: 'Execution folder service unavailable' };
    }
    return broadcastExecutionContextUpdate(executionDirectory.setRoot(rootPath));
  });
  ipcMain.handle('execution:clear-root', async () => {
    if (!executionDirectory?.clearRoot) {
      return { success: false, error: 'Execution folder service unavailable' };
    }
    return broadcastExecutionContextUpdate(executionDirectory.clearRoot());
  });
  ipcMain.handle('execution:set-allow-outside', async (event, allowOutsideRoot) => {
    if (!executionDirectory?.setAllowOutsideRoot) {
      return { success: false, error: 'Execution folder service unavailable' };
    }
    if (allowOutsideRoot === true && capabilityManager?.setTerminalMode) {
      capabilityManager.setTerminalMode('system');
    }
    return broadcastExecutionContextUpdate(
      executionDirectory.setAllowOutsideRoot(allowOutsideRoot === true)
    );
  });
  ipcMain.handle('create-chat-session', async (event, options = {}) => {
    if ((options?.private === true || privateModeDefault) && privateSessionStore) {
      return privateSessionStore.createSession({ title: options?.title || 'Private Chat' });
    }
    if (testClientMode) {
      const sid = ensureTestSession();
      return { id: sid, title: testClientStore.sessions.get(sid)?.title || 'Test Client' };
    }
    const session = await db.createChatSession();
    if (session?.id) {
      windowManager.send('conversation-update', { sessionId: session.id, currentSessionId: session.id });
    }
    return session;
  });
  ipcMain.handle('get-chat-sessions', async (event, date = null, limit = 6) => {
    if (testClientMode) {
      return Array.from(testClientStore.sessions.values())
        .map(s => ({
          id: s.id,
          title: s.title,
          created_at: s.created_at,
          last_message_at: s.messages.length ? s.messages[s.messages.length - 1].timestamp : s.created_at,
          message_count: s.messages.length,
          first_message: (s.messages.find(m => m.role === 'user') || {}).content || null
        }))
        .sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)))
        .slice(0, limit);
    }
    return db.getChatSessions(date, limit);
  });
  ipcMain.handle('load-chat-session', async (event, sessionId, options = {}) => {
    if (isPrivateSessionId(sessionId) && privateSessionStore) {
      return privateSessionStore.getMessages(sessionId, 1000);
    }
    if (testClientMode && isTestSessionId(sessionId)) {
      return getTestMessages(sessionId, 1000);
    }
    return db.loadChatSession(sessionId, { includeHidden: options?.includeHidden === true });
  });
  ipcMain.handle('get-chat-session-meta', async (event, sessionId) => {
    if (isPrivateSessionId(sessionId) && privateSessionStore) {
      const s = privateSessionStore.ensureSession(sessionId);
      return { id: s.id, title: s.title || 'Private Chat', agent_id: null, private: true };
    }
    if (testClientMode && isTestSessionId(sessionId)) return testClientStore.sessions.get(sessionId) || null;
    const row = db.get('SELECT id, title, agent_id FROM chat_sessions WHERE id = ?', [sessionId]) || null;
    if (row) row.contextUsage = await chatContextService.getProviderContextUsage(sessionId);
    return row;
  });
  ipcMain.handle('clear-chat-session', async (event, sessionId) => {
    try {
      if (isPrivateSessionId(sessionId) && privateSessionStore) {
        const result = privateSessionStore.clearSession(sessionId);
        chatContextService.invalidate(sessionId);
        windowManager.send('conversation-update', { sessionId });
        return result;
      }
      if (testClientMode && isTestSessionId(sessionId)) {
        const sid = ensureTestSession(sessionId);
        const session = testClientStore.sessions.get(sid);
        if (session) {
          session.messages = [];
        }
        chatContextService.invalidate(sid);
        windowManager.send('conversation-update', { sessionId: sid });
        return { cleared: true, sessionId: sid };
      }
      await db.clearChatSession(sessionId);
      chatContextService.invalidate(sessionId);
      await chatContextService.clearProviderContextUsage(sessionId);
      windowManager.send('conversation-update', { sessionId });
      return { cleared: true, sessionId };
    } catch (error) {
      console.error('Error clearing chat session:', error);
      throw error;
    }
  });
  ipcMain.handle('switch-chat-session', async (event, sessionId) => {
    try {
      if (isPrivateSessionId(sessionId) && privateSessionStore) {
        privateSessionStore.ensureSession(sessionId);
        if (mcpServer.setCurrentSessionId) {
          mcpServer.setCurrentSessionId(sessionId);
        }
        if (mcpServer.setCurrentAgentContext) {
          mcpServer.setCurrentAgentContext({ sessionId, private: true });
        }
        return { success: true, sessionId, private: true };
      }
      if (testClientMode && isTestSessionId(sessionId)) {
        ensureTestSession(sessionId);
        if (mcpServer.setCurrentSessionId) {
          mcpServer.setCurrentSessionId(sessionId);
        }
        return { success: true, sessionId };
      }
      if (agentLoop) {
        const prevSession = await db.getCurrentSession();
        if (prevSession && prevSession.id !== sessionId) {
          agentLoop.onSessionClose(prevSession.id).catch(e => console.error('[IPC] Session close error:', e));
        }
      }
      await db.setCurrentSession(sessionId);
      if (mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(sessionId);
      }
      if (mcpServer.setCurrentAgentContext) {
        const sessionRow = db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [sessionId]);
        mcpServer.setCurrentAgentContext(sessionRow?.agent_id ? { sessionId, agentId: sessionRow.agent_id } : null);
      }
      windowManager.send('conversation-update', { sessionId, currentSessionId: sessionId });
      return { success: true, sessionId };
    } catch (error) {
      console.error('Error switching session:', error);
      throw error;
    }
  });
  ipcMain.handle('delete-chat-session', async (event, sessionId) => {
    try {
      if (isPrivateSessionId(sessionId) && privateSessionStore) {
        const result = privateSessionStore.deleteSession(sessionId);
        chatContextService.invalidate(sessionId);
        windowManager.send('conversation-update');
        return result;
      }
      if (testClientMode && isTestSessionId(sessionId)) {
        testClientStore.sessions.delete(sessionId);
        if (testClientStore.currentSessionId === sessionId) {
          testClientStore.currentSessionId = null;
        }
        chatContextService.invalidate(sessionId);
        windowManager.send('conversation-update');
        return { success: true };
      }
      await db.deleteChatSession(sessionId);
      chatContextService.invalidate(sessionId);
      await chatContextService.clearProviderContextUsage(sessionId);
      windowManager.send('conversation-update');
      return { success: true };
    } catch (error) {
      console.error('Error deleting chat session:', error);
      throw error;
    }
  });
  ipcMain.handle('delete-all-conversations', async () => {
    try {
      if (testClientMode) {
        testClientStore.sessions.clear();
        testClientStore.currentSessionId = null;
        chatContextService.invalidate();
        windowManager.send('conversation-update');
        return { success: true, message: 'All test conversations deleted' };
      }
      await db.deleteAllConversations();
      chatContextService.invalidate();
      await chatContextService.clearProviderContextUsage();
      windowManager.send('conversation-update');
      return { success: true, message: 'All conversations deleted' };
    } catch (error) {
      console.error('Error deleting all conversations:', error);
      throw error;
    }
  });
  ipcMain.handle('private-session:close-summary', async (event, sessionId) => {
    if (!isPrivateSessionId(sessionId) || !privateSessionStore?.getCloseSummary) {
      return { success: false, error: 'Private session not found' };
    }
    return privateSessionStore.getCloseSummary(sessionId);
  });
  ipcMain.handle('private-session:discard', async (event, sessionId) => {
    if (!isPrivateSessionId(sessionId) || !privateSessionStore?.deleteSession) {
      return { success: false, error: 'Private session not found' };
    }
    agentManager?.subtaskRuntime?.clearPrivateRunsForSession?.(sessionId);
    const result = privateSessionStore.deleteSession(sessionId);
    chatContextService.invalidate(sessionId);
    windowManager.send('conversation-update');
    return result;
  });
  ipcMain.handle('private-session:save', async (event, sessionId, options = {}) => {
    if (!isPrivateSessionId(sessionId) || !privateSessionStore) {
      return { success: false, error: 'Private session not found' };
    }
    const messages = privateSessionStore.getMessages(sessionId, 100000);
    const created = await db.createChatSession(options?.title || 'Saved Private Chat');
    const publicSessionId = created?.id;
    for (const message of messages) {
      await db.addConversation({
        role: message.role || 'user',
        content: String(message.content || ''),
        metadata: message.metadata || null
      }, publicSessionId);
    }
    if (options?.enqueueMemory !== false && db?.enqueueMemoryJob) {
      await db.enqueueMemoryJob({
        jobType: 'summarize_session',
        sessionId: publicSessionId,
        payload: { source: 'private-session-save', enqueued_at: new Date().toISOString() }
      });
    }
    agentManager?.subtaskRuntime?.clearPrivateRunsForSession?.(sessionId);
    privateSessionStore.deleteSession(sessionId);
    chatContextService.invalidate(sessionId);
    chatContextService.invalidate(publicSessionId);
    windowManager.send('conversation-update');
    return { success: true, publicSessionId, messageCount: messages.length };
  });
  ipcMain.handle('chat-session:import-messages', async (event, sessionId, messages = []) => {
    const safeMessages = Array.isArray(messages) ? messages : [];
    for (const entry of safeMessages) {
      await persistMessage({
        role: entry?.role || 'user',
        content: String(entry?.content || ''),
        metadata: entry?.metadata || null
      }, sessionId);
    }
    windowManager.send('conversation-update', { sessionId });
    return { success: true, sessionId, imported: safeMessages.length };
  });
  ipcMain.handle('get-session-artifacts', async (event, sessionId = null) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: true, sessionId: effectiveSessionId, files: [], artifacts: [], fileCount: 0 };
      }
      const resolvedSessionId = effectiveSessionId || (await db.getCurrentSession())?.id || null;
      if (!resolvedSessionId) {
        return { success: true, sessionId: resolvedSessionId, files: [], artifacts: [], fileCount: 0 };
      }
      if (artifactRegistry) {
        const { artifacts, count } = artifactRegistry.listArtifacts(resolvedSessionId, { openableOnly: true });
        const files = artifacts.map(a => ({
          key: a.key,
          name: a.name,
          size: a.size || 0,
          created: a.timestamp,
          kind: a.kind,
          category: a.category,
          source: a.source,
          action: a.action,
          virtual: a.virtual || false,
          accepted: a.accepted || false
        }));
        return {
          success: true,
          sessionId: resolvedSessionId,
          files,
          artifacts: files,
          fileCount: count
        };
      }
      if (!sessionWorkspace?.listFiles) {
        return { success: true, sessionId: resolvedSessionId, files: [], artifacts: [], fileCount: 0 };
      }
      const files = sessionWorkspace.listFiles(resolvedSessionId)
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .map(file => ({
          name: file.name,
          size: file.size,
          created: file.created,
          kind: artifactKindFromExt(file.name)
        }));
      return {
        success: true,
        sessionId: resolvedSessionId,
        files,
        artifacts: files,
        fileCount: files.length
      };
    } catch (error) {
      console.error('Error getting session artifacts:', error);
      return { success: false, error: error.message, files: [], artifacts: [], fileCount: 0 };
    }
  });
  ipcMain.handle('read-session-artifact', async (event, sessionId, fileName) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: false, error: 'Test sessions do not expose workspace artifacts' };
      }
      if (!effectiveSessionId) {
        return { success: false, error: 'Missing sessionId' };
      }
      if (!sessionWorkspace?.getWorkspacePath) {
        return { success: false, error: 'Session workspace unavailable' };
      }
      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName !== String(fileName || '')) {
        return { success: false, error: 'Invalid artifact name' };
      }
      const workspaceDir = sessionWorkspace.getWorkspacePath(effectiveSessionId);
      const artifactPath = path.resolve(workspaceDir, safeName);
      if (!artifactPath.startsWith(path.resolve(workspaceDir) + path.sep)) {
        return { success: false, error: 'Requested artifact is outside workspace' };
      }
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        return { success: false, error: 'Artifact file not found' };
      }
      const stat = fs.statSync(artifactPath);
      const kind = artifactKindFromExt(safeName);
      const maxTextBytes = 1024 * 1024;
      let content = null;
      if (kind === 'text') {
        if (stat.size > maxTextBytes) {
          return {
            success: false,
            error: `Text artifact is too large to open (${Math.round(stat.size / 1024)} KB, max 1024 KB)`
          };
        }
        content = fs.readFileSync(artifactPath, 'utf-8');
      }
      return {
        success: true,
        name: safeName,
        size: stat.size,
        kind,
        path: artifactPath,
        content
      };
    } catch (error) {
      console.error('Error reading session artifact:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('write-session-artifact', async (event, sessionId, fileName, content) => {
    try {
      const effectiveSessionId = testClientMode ? ensureTestSession(sessionId) : sessionId;
      if (isTestSessionId(effectiveSessionId)) {
        return { success: false, error: 'Test sessions do not support artifact writes' };
      }
      if (!effectiveSessionId) {
        return { success: false, error: 'Missing sessionId' };
      }
      if (!sessionWorkspace?.getWorkspacePath) {
        return { success: false, error: 'Session workspace unavailable' };
      }
      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName !== String(fileName || '')) {
        return { success: false, error: 'Invalid artifact name' };
      }
      if (artifactKindFromExt(safeName) !== 'text') {
        return { success: false, error: 'Only text artifacts are editable' };
      }
      const workspaceDir = sessionWorkspace.getWorkspacePath(effectiveSessionId);
      const artifactPath = path.resolve(workspaceDir, safeName);
      if (!artifactPath.startsWith(path.resolve(workspaceDir) + path.sep)) {
        return { success: false, error: 'Requested artifact is outside workspace' };
      }
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        return { success: false, error: 'Artifact file not found' };
      }
      const normalizedContent = String(content ?? '');
      const maxBytes = 2 * 1024 * 1024;
      if (Buffer.byteLength(normalizedContent, 'utf-8') > maxBytes) {
        return { success: false, error: 'Edited content exceeds 2 MB limit' };
      }
      fs.writeFileSync(artifactPath, normalizedContent, 'utf-8');
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { success: true, name: safeName, size: Buffer.byteLength(normalizedContent, 'utf-8') };
    } catch (error) {
      console.error('Error writing session artifact:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('accept-artifact', async (event, sessionId, artifactKey) => {
    if (!artifactRegistry) return { success: false, error: 'Artifact registry unavailable' };
    const accepted = artifactRegistry.acceptArtifact(sessionId, artifactKey);
    return { success: accepted };
  });
  ipcMain.handle('clean-artifact', async (event, sessionId, artifactKey) => {
    if (!artifactRegistry) return { success: false, error: 'Artifact registry unavailable' };
    const cleaned = artifactRegistry.cleanArtifact(sessionId, artifactKey);
    return { success: cleaned };
  });
  ipcMain.handle('send-message', async (event, message, useChaining = true, sessionId = null, requestMeta = null) => {
    const effectiveSessionId = privateModeDefault && !sessionId
      ? ensurePrivateSession(null)
      : (testClientMode ? ensureTestSession(sessionId) : sessionId);
    const isTestSession = isTestSessionId(effectiveSessionId);
    const isPrivateSession = isPrivateSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession && !isPrivateSession) {
      markUserActive(activitySessionId);
    }
    try {
      const conversationHistory = await chatContextService.buildPromptHistory(effectiveSessionId, message);
      if (!isTestSession && !isPrivateSession && agentLoop) {
        agentLoop.recordActivity(activitySessionId);
      }
      if (!isTestSession && mcpServer.setCurrentSessionId) {
        mcpServer.setCurrentSessionId(activitySessionId);
      }
      if (!isTestSession && !isPrivateSession && effectiveSessionId) {
        await db.setCurrentSession(effectiveSessionId);
      }
      if (!isTestSession && !isPrivateSession && sessionInitManager) {
        sessionInitManager.recordActivity().catch(() => {});
      }
      await persistMessage({
        role: 'user',
        content: message,
        metadata: normalizeClientMessageMetadata(requestMeta)
      }, effectiveSessionId);
      const sessionRow = !isTestSession && !isPrivateSession && effectiveSessionId
        ? db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [effectiveSessionId])
        : null;
      const agentId = sessionRow ? sessionRow.agent_id : null;
      if (!isTestSession && mcpServer.setCurrentAgentContext) {
        mcpServer.setCurrentAgentContext(agentId ? { sessionId: effectiveSessionId, agentId } : null);
      }
      let response;
      if (chainController && useChaining) {
        console.log('[IPC] Using tool chain controller');
        const trace = {
          onToolQueued(payload) {
            windowManager.send('tool-preview-update', {
              ...payload,
              sessionId: effectiveSessionId,
              agentId,
              status: 'queued'
            });
          },
          onToolResult(payload) {
            windowManager.send('tool-preview-update', {
              ...payload,
              sessionId: effectiveSessionId,
              agentId,
              status: payload.success ? 'success' : 'error'
            });
          }
        };
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId: effectiveSessionId, agentId, trace });
        if (response && response.needsPermission) {
          windowManager.send('tool-permission-request', { ...response.permissionRequest, sessionId: effectiveSessionId });
          return { needsPermission: true, sessionId: effectiveSessionId, ...response.permissionRequest };
        }
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId, agentId });
      }
      if (!response || !response.content) {
        console.error('[IPC] No response from AI service');
        response = { content: 'Sorry, I was unable to generate a response. Please try again.', model: 'unknown' };
      }
      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      await chatContextService.saveProviderContextUsage(effectiveSessionId, response);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (!isPrivateSession && activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { ...response, content: cleanContent, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      if (!isTestSession && !isPrivateSession) {
        markUserIdle(activitySessionId);
      }
    }
  });
  ipcMain.handle('interpret-tool-result', async (event, toolName, params, toolResult, sessionId = null) => {
    const effectiveSessionId = privateModeDefault && !sessionId
      ? ensurePrivateSession(null)
      : (testClientMode ? ensureTestSession(sessionId) : sessionId);
    const isTestSession = isTestSessionId(effectiveSessionId);
    const isPrivateSession = isPrivateSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession && !isPrivateSession) {
      markUserActive(activitySessionId);
    }
    try {
      const toolContext = `Tool "${toolName}" was executed with parameters: ${JSON.stringify(params)}\n\nResult: ${JSON.stringify(toolResult, null, 2)}\n\nBased on this tool result, provide a natural, helpful response to the user. Do NOT call any tools.`;
      const conversationHistory = await chatContextService.buildPromptHistory(effectiveSessionId, toolContext);
      const response = await dispatcher.dispatch(toolContext, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId });
      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      await chatContextService.saveProviderContextUsage(effectiveSessionId, response);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (!isPrivateSession && activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { ...response, content: cleanContent, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error interpreting tool result:', error);
      return {
        content: `Tool ${toolName} returned: ${JSON.stringify(toolResult, null, 2)}`,
        model: 'fallback'
      };
    } finally {
      if (!isTestSession && !isPrivateSession) {
        markUserIdle(activitySessionId);
      }
    }
  });
  ipcMain.handle('handle-file-drop', async (event, filePath, sessionId = null) => {
    const fs = require('fs');
    const path = require('path');
    const activePrivateSessionId = mcpServer.getCurrentSessionId && isPrivateSessionId(mcpServer.getCurrentSessionId())
      ? mcpServer.getCurrentSessionId()
      : null;
    const requestedSessionId = sessionId || activePrivateSessionId;
    const effectiveSessionId = privateModeDefault && !requestedSessionId
      ? ensurePrivateSession(null)
      : (testClientMode ? ensureTestSession(requestedSessionId) : requestedSessionId);
    const isTestSession = isTestSessionId(effectiveSessionId);
    const isPrivateSession = isPrivateSessionId(effectiveSessionId);
    const activitySessionId = effectiveSessionId || 'default';
    if (!isTestSession && !isPrivateSession) {
      markUserActive(activitySessionId);
    }
    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let message;
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        message = `User dropped image "${fileName}". [Image data: ${base64.substring(0, 100)}... (base64 encoded)]`;
      } else {
        const content = fs.readFileSync(filePath, 'utf-8');
        message = `User dropped file "${fileName}". Content:\n\n---\n\n${content}`;
      }
      const conversationHistory = await chatContextService.buildPromptHistory(effectiveSessionId, message);
      await persistMessage({ role: 'user', content: message }, effectiveSessionId);
      let response;
      if (chainController) {
        response = await chainController.executeWithChaining(message, conversationHistory, { sessionId: effectiveSessionId });
      } else {
        response = await dispatcher.dispatch(message, conversationHistory, { mode: 'chat', sessionId: effectiveSessionId });
      }
      const runtimeConfig = await resolveRuntimeForResponse(response);
      const cleanContent = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
      await persistMessage({ role: 'assistant', content: cleanContent }, effectiveSessionId);
      await chatContextService.saveProviderContextUsage(effectiveSessionId, response);
      const { provider: activeProvider, model: activeModel } = await getEffectiveLlmSelection(db);
      if (!isPrivateSession && activeProvider && activeModel) {
        await rememberLastWorkingModel(db, activeProvider, activeModel);
      }
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      return { success: true, response: { ...response, content: cleanContent }, sessionId: effectiveSessionId };
    } catch (error) {
      console.error('Error handling file drop:', error);
      await persistMessage({ role: 'system', content: `Error processing file: ${error.message}` }, effectiveSessionId);
      windowManager.send('conversation-update', { sessionId: effectiveSessionId });
      throw error;
    } finally {
      if (!isTestSession && !isPrivateSession) {
        markUserIdle(activitySessionId);
      }
    }
  });
  ipcMain.handle('testclient:status', async () => {
    return {
      enabled: testClientMode,
      currentSessionId: testClientStore.currentSessionId,
      sessionCount: testClientStore.sessions.size
    };
  });
  ipcMain.handle('testclient:reset', async () => {
    if (!testClientMode) return { success: false, error: 'Not in --testclient mode' };
    testClientStore.sessions.clear();
    testClientStore.currentSessionId = null;
    chatContextService.invalidate();
    return { success: true };
  });
  ipcMain.handle('read-file', async (event, filePath) => {
    const fs = require('fs');
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });
}
module.exports = { registerChatDataHandlers };
