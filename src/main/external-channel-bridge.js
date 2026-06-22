const { stripToolPatterns, stripReasoningBlocks, buildAssistantContent } = require('./ipc/shared-utils');
const { getModelRuntimeConfig, saveModelRuntimeConfig } = require('./llm-config');
const {
  getEffectiveLlmSelection,
  rememberLastWorkingModel,
  rememberTestedModel,
  saveActiveSelection
} = require('./llm-state');

const SESSION_MAP_KEY = 'external.channelSessionMap';

function normalizeChannel(channel) {
  return String(channel || 'external').trim().toLowerCase() || 'external';
}

function normalizeChatId(chatId) {
  return String(chatId || '').trim();
}

function safeJsonParse(rawValue, fallback = {}) {
  if (!rawValue) return { ...fallback };
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...fallback };
    }
    return parsed;
  } catch (_) {
    return { ...fallback };
  }
}

class ExternalChannelBridge {
  constructor({
    db,
    dispatcher,
    chainController = null,
    windowManager = null,
    aiService = null,
    chatContextService = null
  }) {
    this.db = db;
    this.dispatcher = dispatcher;
    this.chainController = chainController;
    this.windowManager = windowManager;
    this.aiService = aiService;
    this.chatContextService = chatContextService;
  }

  async _getRuntimeForResponse(response) {
    const responseRuntime = response?.renderContext?.runtimeConfig;
    if (responseRuntime && typeof responseRuntime === 'object') {
      return responseRuntime;
    }

    const provider = response?.renderContext?.provider;
    const model = response?.renderContext?.model;
    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(this.db, provider, model);
      return runtime;
    }

    const selection = await getEffectiveLlmSelection(this.db);
    if (selection.provider && selection.model) {
      const { runtime } = await getModelRuntimeConfig(this.db, selection.provider, selection.model);
      return runtime;
    }

    return null;
  }

  _notifyConversationUpdate(sessionId) {
    if (!this.windowManager?.send) return;
    this.windowManager.send('conversation-update', { sessionId });
  }

  async _loadSessionMap() {
    const raw = await this.db.getSetting(SESSION_MAP_KEY);
    return safeJsonParse(raw, {});
  }

  async _saveSessionMap(map) {
    await this.db.saveSetting(SESSION_MAP_KEY, JSON.stringify(map || {}));
  }

  _buildSessionMapKey(channel, chatId) {
    return `${normalizeChannel(channel)}::${normalizeChatId(chatId)}`;
  }

  async _setMappedSession(channel, chatId, sessionId) {
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) return null;
    const map = await this._loadSessionMap();
    map[this._buildSessionMapKey(channel, normalizedChatId)] = String(sessionId);
    await this._saveSessionMap(map);
    return String(sessionId);
  }

  async _getMappedSession(channel, chatId) {
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) return null;
    const map = await this._loadSessionMap();
    const mapped = map[this._buildSessionMapKey(channel, normalizedChatId)];
    return mapped ? String(mapped) : null;
  }

  async resolveSession({ channel = 'external', chatId = '', sessionId = null }) {
    const explicit = String(sessionId || '').trim();
    if (explicit) {
      return explicit;
    }

    const mapped = await this._getMappedSession(channel, chatId);
    if (mapped) {
      return mapped;
    }

    const current = await this.db.getCurrentSession();
    const resolved = String(current?.id || '');
    if (!resolved) {
      const created = await this.db.createChatSession();
      const createdId = String(created?.id || '');
      if (createdId) {
        await this._setMappedSession(channel, chatId, createdId);
      }
      return createdId;
    }

    await this._setMappedSession(channel, chatId, resolved);
    return resolved;
  }

  _buildMessageMetadata(channelMeta = {}, hiddenFromUi = false, extra = {}) {
    return {
      external_channel: {
        channel: normalizeChannel(channelMeta.channel || 'external'),
        chat_id: normalizeChatId(channelMeta.chatId),
        message_id: channelMeta.messageId || null,
        username: channelMeta.username || '',
        content_type: channelMeta.contentType || 'text'
      },
      hidden_from_ui: hiddenFromUi === true,
      ...extra
    };
  }

  async appendMessage({
    sessionId,
    role,
    content,
    hidden = false,
    channelMeta = {},
    metadata = {}
  }) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('sessionId is required');
    }

    const entry = {
      role: String(role || 'system'),
      content: String(content || ''),
      metadata: this._buildMessageMetadata(channelMeta, hidden === true, metadata)
    };
    await this.db.addConversation(entry, normalizedSessionId);
    if (this.chatContextService?.append) this.chatContextService.append(normalizedSessionId, entry);

    this._notifyConversationUpdate(normalizedSessionId);
    return { success: true, sessionId: normalizedSessionId };
  }

  async requestReply({
    text,
    sessionId = null,
    duplicate = true,
    channelMeta = {}
  }) {
    const messageText = String(text || '').trim();
    if (!messageText) {
      return { success: false, error: 'text is required' };
    }

    const resolvedSessionId = await this.resolveSession({
      channel: channelMeta.channel || 'external',
      chatId: channelMeta.chatId || '',
      sessionId
    });
    if (!resolvedSessionId) {
      return { success: false, error: 'Unable to resolve session' };
    }

    const hidden = duplicate !== true;
    const history = this.chatContextService?.buildPromptHistory
      ? await this.chatContextService.buildPromptHistory(resolvedSessionId, messageText)
      : (typeof this.db.loadChatSession === 'function'
        ? await this.db.loadChatSession(resolvedSessionId, { includeHidden: true })
        : await this.db.getConversations(Number.MAX_SAFE_INTEGER, resolvedSessionId))
        .map((conversation) => ({
          role: conversation.role,
          content: conversation.role === 'assistant'
            ? stripReasoningBlocks(stripToolPatterns(conversation.content))
            : conversation.content
        }))
        .filter((entry) => entry.content && entry.content.trim().length > 0);

    const userEntry = {
      role: 'user',
      content: messageText,
      metadata: this._buildMessageMetadata(channelMeta, hidden, {
        source: 'external_inbound'
      })
    };
    await this.db.addConversation(userEntry, resolvedSessionId);
    if (this.chatContextService?.append) this.chatContextService.append(resolvedSessionId, userEntry);
    this._notifyConversationUpdate(resolvedSessionId);

    const sessionRow = this.db.get('SELECT agent_id FROM chat_sessions WHERE id = ?', [resolvedSessionId]);
    const agentId = sessionRow?.agent_id || null;

    let response;
    if (this.chainController?.executeWithChaining) {
      response = await this.chainController.executeWithChaining(messageText, history, {
        sessionId: resolvedSessionId,
        agentId
      });
    } else {
      response = await this.dispatcher.dispatch(messageText, history, {
        mode: 'chat',
        sessionId: resolvedSessionId,
        agentId
      });
    }

    if (!response || !response.content) {
      response = {
        content: 'Sorry, I was unable to generate a response. Please try again.',
        model: 'unknown'
      };
    }

    const runtimeConfig = await this._getRuntimeForResponse(response);
    const assistantText = stripToolPatterns(buildAssistantContent(response, runtimeConfig));
    const assistantEntry = {
      role: 'assistant',
      content: assistantText,
      metadata: this._buildMessageMetadata(channelMeta, hidden, {
        source: 'external_outbound'
      })
    };
    await this.db.addConversation(assistantEntry, resolvedSessionId);
    if (this.chatContextService?.append) this.chatContextService.append(resolvedSessionId, assistantEntry);
    if (this.chatContextService?.saveProviderContextUsage) {
      await this.chatContextService.saveProviderContextUsage(resolvedSessionId, response);
    }
    this._notifyConversationUpdate(resolvedSessionId);

    const selection = await getEffectiveLlmSelection(this.db);
    if (selection.provider && selection.model) {
      await rememberLastWorkingModel(this.db, selection.provider, selection.model);
    }

    return {
      success: true,
      sessionId: resolvedSessionId,
      content: assistantText,
      model: response.model || selection.model || '',
      provider: response?.renderContext?.provider || selection.provider || ''
    };
  }

  async newSession({ channel = 'external', chatId = '' }) {
    const created = await this.db.createChatSession();
    const newSessionId = String(created?.id || '');
    if (!newSessionId) {
      throw new Error('Failed to create a new chat session');
    }
    await this._setMappedSession(channel, chatId, newSessionId);
    this._notifyConversationUpdate(newSessionId);
    return { success: true, sessionId: newSessionId };
  }

  async getSession({ channel = 'external', chatId = '', sessionId = null }) {
    const resolved = await this.resolveSession({ channel, chatId, sessionId });
    return { success: true, sessionId: resolved };
  }

  async clearSession({ channel = 'external', chatId = '', sessionId = null }) {
    const resolved = await this.resolveSession({ channel, chatId, sessionId });
    if (!resolved) {
      throw new Error('Unable to resolve session for clear');
    }
    await this.db.clearChatSession(resolved);
    if (this.chatContextService?.invalidate) this.chatContextService.invalidate(resolved);
    if (this.chatContextService?.clearProviderContextUsage) {
      await this.chatContextService.clearProviderContextUsage(resolved);
    }
    this._notifyConversationUpdate(resolved);
    return { success: true, sessionId: resolved };
  }

  async listProviders() {
    if (!this.aiService?.getProviders) {
      return [];
    }
    return this.aiService.getProviders();
  }

  async listModels(provider) {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    if (!normalizedProvider || !this.aiService?.getModels) {
      return [];
    }
    const models = await this.aiService.getModels(normalizedProvider, false);
    return Array.isArray(models) ? models : [];
  }

  async setGlobalModel(provider, model) {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedModel = String(model || '').trim();
    if (!normalizedProvider || !normalizedModel) {
      throw new Error('provider and model are required');
    }

    await saveActiveSelection(this.db, normalizedProvider, normalizedModel);
    await rememberTestedModel(this.db, normalizedProvider, normalizedModel);
    await rememberLastWorkingModel(this.db, normalizedProvider, normalizedModel);
    if (this.aiService?.setProvider) {
      await this.aiService.setProvider(normalizedProvider);
    }

    return { success: true, provider: normalizedProvider, model: normalizedModel };
  }

  async getGlobalModel() {
    const selection = await getEffectiveLlmSelection(this.db);
    return {
      provider: selection.provider || '',
      model: selection.model || ''
    };
  }

  async setThinkingMode(mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase() === 'think' ? 'think' : 'off';
    const selection = await getEffectiveLlmSelection(this.db);
    if (selection.provider && selection.model) {
      const profile = await getModelRuntimeConfig(this.db, selection.provider, selection.model);
      await saveModelRuntimeConfig(this.db, selection.provider, selection.model, {
        reasoning: {
          ...profile.runtime.reasoning,
          enabled: normalizedMode === 'think'
        }
      });
    }
    await this.db.saveSetting('llm.thinkingMode', normalizedMode);
    await this.db.saveSetting('llm.showThinking', normalizedMode === 'think' ? 'true' : 'false');
    return { success: true, mode: normalizedMode };
  }

  async setContextWindow(tokens) {
    const parsed = Number.parseInt(tokens, 10);
    if (!Number.isFinite(parsed) || parsed < 2048 || parsed > 262144) {
      throw new Error('Context window must be between 2048 and 262144');
    }
    await this.db.saveSetting('context_window', String(parsed));
    return { success: true, context_window: parsed };
  }

  async stopGeneration() {
    const stopped = this.aiService?.stopGeneration ? this.aiService.stopGeneration() : false;
    if (this.chainController?.stopChain) {
      this.chainController.stopChain();
    }
    return { success: true, stopped: Boolean(stopped) };
  }
}

module.exports = ExternalChannelBridge;
