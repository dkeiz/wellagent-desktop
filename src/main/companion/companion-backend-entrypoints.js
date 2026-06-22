const fs = require('fs');
const path = require('path');
const { getEffectiveLlmSelection } = require('../llm-state');
const { getModelRuntimeConfig, saveModelRuntimeConfig } = require('../llm-config');
const { createChatContextService } = require('../chat-context-service');
const {
  stripToolPatterns,
  stripReasoningBlocks,
  buildAssistantContent
} = require('../ipc/shared-utils');

function normalizeClientMessageMetadata(requestMeta) {
  if (!requestMeta || typeof requestMeta !== 'object') return null;
  const clientSource = String(
    requestMeta.clientSource || requestMeta.client_source || requestMeta.source || ''
  ).trim().toLowerCase();
  if (!clientSource) return null;
  return {
    clientSource,
    sourceLabel: String(
      requestMeta.sourceLabel
      || requestMeta.source_label
      || (clientSource === 'web' ? 'Web Client' : clientSource === 'mobile' ? 'Mobile Client' : 'Companion Client')
    ).trim(),
    platform: String(requestMeta.platform || clientSource || '').trim().toLowerCase() || clientSource,
    deviceId: String(requestMeta.deviceId || requestMeta.device_id || '').trim() || null,
    deviceName: String(requestMeta.deviceName || requestMeta.device_name || '').trim() || null
  };
}

function artifactKindFromExt(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) return 'audio';
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts', '.log', '.csv'].includes(ext)) return 'text';
  return 'binary';
}

async function getSessionRow(db, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  if (typeof db.get === 'function') {
    return db.get('SELECT * FROM chat_sessions WHERE id = ?', [sid]) || null;
  }
  if (typeof db.getChatSessions === 'function') {
    const sessions = await db.getChatSessions(null, 1000);
    return (sessions || []).find(session => String(session.id) === sid) || null;
  }
  return null;
}

function createCompanionBackendEntrypoints(container) {
  const db = container.get('db');
  const dispatcher = container.optional('dispatcher');
  const aiService = container.optional('aiService');
  const capabilityManager = container.optional('capabilityManager');
  const agentManager = container.optional('agentManager');
  const memoryDaemon = container.optional('memoryDaemon');
  const workflowScheduler = container.optional('workflowScheduler');
  const chainController = container.optional('chainController');
  const sessionWorkspace = container.optional('sessionWorkspace');
  const taskQueueService = container.optional('taskQueueService');
  const mcpServer = container.optional('mcpServer');
  const artifactRegistry = container.optional('artifactRegistry');
  const windowManager = container.optional('windowManager');
  const chatContextService = container.optional('chatContextService') || createChatContextService({
    db,
    dispatcher,
    cleaners: { stripToolPatterns, stripReasoningBlocks }
  });

  async function resolveChatSession(sessionId = null, { requireExisting = false } = {}) {
    const requested = String(sessionId || '').trim();
    let sid = requested;
    if (!sid) {
      sid = String((await db.getCurrentSession())?.id || '').trim();
    }
    if (!sid) return { success: false, error: 'No active session' };

    const sessionRow = await getSessionRow(db, sid);
    if (!sessionRow && (requested || requireExisting)) {
      return { success: false, error: `Chat session not found: ${sid}`, sessionId: sid };
    }

    await db.setCurrentSession(sid);
    if (mcpServer?.setCurrentSessionId) mcpServer.setCurrentSessionId(sid);
    if (mcpServer?.setCurrentAgentContext) {
      const agentId = sessionRow?.agent_id || null;
      mcpServer.setCurrentAgentContext(agentId ? { sessionId: sid, agentId } : null);
    }
    return { success: true, sessionId: sid, session: sessionRow || null };
  }

  return {
    async getSettingsSnapshot() {
      const { provider, model } = await getEffectiveLlmSelection(db);
      let runtimeConfig = null;
      if (provider && model) {
        runtimeConfig = (await getModelRuntimeConfig(db, provider, model)).runtime;
      }
      return {
        model: model || '',
        runtimeConfig: runtimeConfig || null,
        concurrencyEnabled: (await db.getSetting('llm.concurrency.enabled')) === 'true',
        capabilities: capabilityManager?.getState?.() || { mainEnabled: false, groups: {}, activeToolCount: 0 },
        agents: agentManager?.getAgents ? await agentManager.getAgents() : [],
        memoryStatus: memoryDaemon?.getStatus ? memoryDaemon.getStatus() : { running: false },
        workflowStatus: workflowScheduler?.getStatus ? workflowScheduler.getStatus() : { running: false }
      };
    },

    async listAgents() {
      return agentManager?.getAgents ? agentManager.getAgents() : [];
    },

    async setAgentActive(agentId, active) {
      if (!agentManager) return { success: false, error: 'Agent manager unavailable' };
      if (active === false) {
        await agentManager.deactivateAgent(agentId);
        return { success: true };
      }
      return agentManager.activateAgent(agentId);
    },

    async listChatSessions(limit = 20) {
      return db.getChatSessions(null, limit);
    },

    async getCurrentChatSession() {
      return db.getCurrentSession();
    },

    async createChatSession() {
      const session = await db.createChatSession();
      await resolveChatSession(session?.id, { requireExisting: false });
      if (session?.id) {
        windowManager?.send?.('conversation-update', { sessionId: session.id, currentSessionId: session.id });
      }
      return session;
    },

    async switchChatSession(sessionId) {
      if (!String(sessionId || '').trim()) return { success: false, error: 'Missing sessionId' };
      const result = await resolveChatSession(sessionId, { requireExisting: true });
      if (result?.success && result.sessionId) {
        windowManager?.send?.('conversation-update', { sessionId: result.sessionId, currentSessionId: result.sessionId });
      }
      return result;
    },

    async getConversations(limit = 80, sessionId = '') {
      return db.getConversations(limit, String(sessionId || '').trim() || null);
    },

    async sendMessage(message, sessionId = null, requestMeta = null) {
      const text = String(message || '').trim();
      if (!text) throw new Error('Message is required');
      const resolved = await resolveChatSession(sessionId, { requireExisting: Boolean(sessionId) });
      if (!resolved.success) return resolved;
      const sid = resolved.sessionId;

      const history = await chatContextService.buildPromptHistory(sid, text);

      await db.addConversation({
        role: 'user',
        content: text,
        metadata: normalizeClientMessageMetadata(requestMeta)
      }, sid);
      chatContextService.append(sid, {
        role: 'user',
        content: text,
        metadata: normalizeClientMessageMetadata(requestMeta)
      });
      windowManager?.send?.('conversation-update', { sessionId: sid, currentSessionId: sid, phase: 'user-message' });

      const agentId = resolved.session?.agent_id || null;
      const response = chainController?.executeWithChaining
        ? await chainController.executeWithChaining(text, history, { sessionId: sid, agentId })
        : await dispatcher.dispatch(text, history, { mode: 'chat', sessionId: sid, agentId });
      if (response?.needsPermission) {
        return { needsPermission: true, sessionId: sid, ...response.permissionRequest, ...response };
      }
      const cleanContent = stripToolPatterns(buildAssistantContent(response, response?.renderContext?.runtimeConfig || null));
      await db.addConversation({ role: 'assistant', content: cleanContent }, sid);
      chatContextService.append(sid, { role: 'assistant', content: cleanContent });
      await chatContextService.saveProviderContextUsage(sid, response);
      windowManager?.send?.('conversation-update', { sessionId: sid, currentSessionId: sid });
      return { ...response, content: cleanContent, sessionId: sid };
    },

    stopGeneration() {
      const stopped = aiService?.stopGeneration ? aiService.stopGeneration() : false;
      if (chainController?.stopChain) chainController.stopChain();
      return { stopped };
    },

    async setThinkingMode(mode) {
      const nextMode = mode === 'off' ? 'off' : 'think';
      const { provider, model } = await getEffectiveLlmSelection(db);
      if (provider && model) {
        const profile = await getModelRuntimeConfig(db, provider, model);
        const saved = await saveModelRuntimeConfig(db, provider, model, {
          reasoning: {
            ...profile.runtime.reasoning,
            enabled: nextMode === 'think'
          }
        });
        await db.saveSetting('llm.thinkingMode', saved.runtime.reasoning.enabled ? 'think' : 'off');
        await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
        await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
      } else {
        await db.saveSetting('llm.thinkingMode', nextMode);
      }
      return { success: true, mode: nextMode };
    },

    setCapabilityMain(enabled) {
      if (!capabilityManager?.setMainEnabled) return { success: false, error: 'Capability manager unavailable' };
      const value = capabilityManager.setMainEnabled(enabled === true);
      return { success: true, mainEnabled: value };
    },

    async setCapabilityGroup(groupId, enabled) {
      if (!capabilityManager?.setGroupEnabled) return { success: false, error: 'Capability manager unavailable' };
      const value = capabilityManager.setGroupEnabled(groupId, enabled === true);
      return { success: value };
    },

    async setDaemonRunning(kind, running) {
      const daemonKind = kind === 'workflow' ? 'workflow' : 'memory';
      if (daemonKind === 'memory') {
        if (!memoryDaemon) return { success: false, error: 'Memory daemon unavailable' };
        if (running) await memoryDaemon.start();
        else memoryDaemon.stop();
        return { success: true };
      }
      if (!workflowScheduler) return { success: false, error: 'Workflow scheduler unavailable' };
      if (running) await workflowScheduler.start();
      else workflowScheduler.stop();
      return { success: true };
    },

    async listTaskQueue(actionable = true) {
      if (!taskQueueService?.listTasks) return { success: false, error: 'Task queue unavailable', tasks: [] };
      return taskQueueService.listTasks({ actionable: actionable !== false });
    },

    async updateTask(action, taskId) {
      if (!taskQueueService) return { success: false, error: 'Task queue unavailable' };
      if (action === 'approve' && taskQueueService.approveTask) {
        return taskQueueService.approveTask(taskId, { actor: 'companion-web' });
      }
      if (action === 'cancel' && taskQueueService.cancelTask) {
        return taskQueueService.cancelTask(taskId, { actor: 'companion-web' });
      }
      if (action === 'defer' && taskQueueService.deferTask) {
        return taskQueueService.deferTask(taskId, 15, { actor: 'companion-web', reason: 'Deferred by companion' });
      }
      return { success: false, error: 'Unsupported task action' };
    },

    async clearChatSession(sessionId) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { success: false, error: 'Missing sessionId' };
      await db.clearChatSession(sid);
      chatContextService.invalidate(sid);
      return { cleared: true, sessionId: sid };
    },

    async getSessionArtifacts(sessionId = null) {
      const sid = String(sessionId || '').trim() || (await db.getCurrentSession())?.id || null;
      if (!sid) {
        return { success: true, sessionId: sid, files: [], artifacts: [], fileCount: 0 };
      }
      if (String(sessionId || '').trim() && !(await getSessionRow(db, sid))) {
        return { success: false, error: `Chat session not found: ${sid}`, sessionId: sid, files: [], artifacts: [], fileCount: 0 };
      }
      if (artifactRegistry?.listArtifacts) {
        const { artifacts, count } = artifactRegistry.listArtifacts(sid, { openableOnly: true });
        const files = artifacts.map(artifact => ({
          key: artifact.key,
          name: artifact.name,
          size: artifact.size || 0,
          created: artifact.timestamp,
          kind: artifact.kind,
          category: artifact.category,
          source: artifact.source,
          action: artifact.action,
          virtual: artifact.virtual || false,
          accepted: artifact.accepted || false
        }));
        return { success: true, sessionId: sid, files, artifacts: files, fileCount: count };
      }
      if (!sessionWorkspace?.listFiles) {
        return { success: true, sessionId: sid, files: [], artifacts: [], fileCount: 0 };
      }
      const files = sessionWorkspace.listFiles(sid)
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .map((file) => ({
          name: file.name,
          size: file.size,
          created: file.created,
          kind: artifactKindFromExt(file.name)
        }));
      return { success: true, sessionId: sid, files, artifacts: files, fileCount: files.length };
    },

    async readSessionArtifact(sessionId, fileName) {
      const sid = String(sessionId || '').trim();
      if (!sid) return { success: false, error: 'Missing sessionId' };
      if (!(await getSessionRow(db, sid))) return { success: false, error: `Chat session not found: ${sid}` };
      if (!sessionWorkspace?.getWorkspacePath) return { success: false, error: 'Session workspace unavailable' };
      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName !== String(fileName || '')) return { success: false, error: 'Invalid artifact name' };
      const workspaceDir = sessionWorkspace.getWorkspacePath(sid);
      const artifactPath = path.resolve(workspaceDir, safeName);
      if (!artifactPath.startsWith(path.resolve(workspaceDir) + path.sep)) {
        return { success: false, error: 'Requested artifact is outside workspace' };
      }
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        return { success: false, error: 'Artifact file not found' };
      }
      const stat = fs.statSync(artifactPath);
      const kind = artifactKindFromExt(safeName);
      let content = null;
      if (kind === 'text' && stat.size <= 1024 * 1024) {
        content = fs.readFileSync(artifactPath, 'utf-8');
      }
      return { success: true, name: safeName, size: stat.size, kind, path: artifactPath, content };
    }
  };
}

module.exports = {
  createCompanionBackendEntrypoints
};
