const { getEffectiveLlmSelection } = require('./llm-state');
const {
  calculateConversationContextUsage,
  buildConversationContext,
  SessionConversationContextCache
} = require('./conversation-context');
const { isPrivateSessionId } = require('./private-session-store');

class ChatContextService {
  constructor(options = {}) {
    this.db = options.db;
    this.dispatcher = options.dispatcher || null;
    this.privateSessionStore = options.privateSessionStore || null;
    this.testClientMode = options.testClientMode === true;
    this.getTestMessages = typeof options.getTestMessages === 'function'
      ? options.getTestMessages
      : null;
    this.cache = options.cache || new SessionConversationContextCache({
      cleaners: options.cleaners || {}
    });
    this.logger = Object.prototype.hasOwnProperty.call(options, 'logger')
      ? options.logger
      : console;
    this.providerContextData = new Map();
  }

  async loadAllHistory(sessionId = null) {
    if (isPrivateSessionId(sessionId) && this.privateSessionStore) {
      return this.privateSessionStore.getMessages(sessionId, Number.MAX_SAFE_INTEGER);
    }

    if (
      this.testClientMode
      && this.getTestMessages
      && (this._isTestSessionId(sessionId) || !sessionId)
    ) {
      return this.getTestMessages(sessionId, Number.MAX_SAFE_INTEGER);
    }

    if (sessionId && typeof this.db?.loadChatSession === 'function') {
      return this.db.loadChatSession(sessionId, { includeHidden: true });
    }

    return this.db.getConversations(Number.MAX_SAFE_INTEGER, sessionId);
  }

  async resolveContextProfile(options = {}) {
    let provider = options.provider;
    let model = options.model;
    if ((!provider || !model) && this.db) {
      const selection = await getEffectiveLlmSelection(this.db);
      provider = provider || selection.provider;
      model = model || selection.model;
    }

    let contextWindow = options.contextWindow;
    if (this.dispatcher && typeof this.dispatcher.resolveContextWindow === 'function') {
      contextWindow = await this.dispatcher.resolveContextWindow({
        provider,
        model,
        modelSpec: options.modelSpec,
        runtimeConfig: options.runtimeConfig
      });
    } else if (!contextWindow) {
      contextWindow = (await this.db.getSetting('context_window')) || '8192';
    }

    return { provider: provider || null, model: model || null, contextWindow };
  }

  async resolveContextWindow(options = {}) {
    return (await this.resolveContextProfile(options)).contextWindow;
  }

  async buildContext(sessionId, currentPrompt = '', options = {}) {
    const contextWindow = await this.resolveContextWindow(options);
    const cachedHistory = await this.cache.getOrLoad(
      sessionId,
      () => this.loadAllHistory(sessionId)
    );
    const context = buildConversationContext(cachedHistory, {
      contextWindow,
      currentPrompt
    });
    this._logContext(sessionId, context);
    return context;
  }

  async buildPromptHistory(sessionId, currentPrompt = '', options = {}) {
    const context = await this.buildContext(sessionId, currentPrompt, options);
    return context.messages;
  }

  async getUsageEstimate(sessionId = null, currentPrompt = '', options = {}) {
    const promptText = String(currentPrompt || '');
    const profile = await this.resolveContextProfile(options);
    const hasPrompt = Boolean(promptText.trim());
    const providerData = hasPrompt ? null : this.getActiveProviderContextUsage(sessionId);
    const saved = providerData || hasPrompt ? null : await this.getProviderContextUsage(sessionId);
    const cachedHistory = await this.cache.getOrLoad(
      sessionId,
      () => this.loadAllHistory(sessionId)
    );
    const usage = calculateConversationContextUsage(cachedHistory, {
      contextWindow: saved?.context_length || profile.contextWindow,
      currentPrompt: promptText
    });
    return this._resolveDisplayedContextUsage(providerData || saved, usage, profile);
  }

  _resolveDisplayedContextUsage(providerData, localUsage, profile = {}) {
    const source = providerData?.source || 'local';
    const providerPrompt = Number(providerData?.prompt_tokens || providerData?.tokens || 0);
    const providerTokens = Number(providerPrompt || providerData?.total_tokens || 0);
    const localTokens = Number(localUsage?.tokens || 0);
    const contextLength = Number(providerData?.context_length || providerData?.contextLength || localUsage?.contextWindow || profile.contextWindow || 0);
    const resolvedProviderTokens = providerData && providerTokens > 0 ? providerTokens : 0;
    const tokens = resolvedProviderTokens > 0 ? resolvedProviderTokens : localTokens;
    return {
      ...(providerData || {}),
      tokens,
      prompt_tokens: providerPrompt || localTokens,
      total_tokens: Number(providerData?.total_tokens || tokens),
      provider_tokens: resolvedProviderTokens || null,
      local_tokens: localTokens,
      source,
      provider: providerData?.provider || profile.provider || null,
      model: providerData?.model || profile.model || null,
      context_length: contextLength,
      contextLength,
      total_messages: localUsage.totalMessages,
      overflow: tokens > contextLength,
      truncated_for_send: false,
      truncated: false
    };
  }

  _providerUsageSettingKey(sessionId) {
    const sid = String(sessionId || '').trim();
    return sid ? `session.contextUsage.${sid}` : null;
  }

  normalizeProviderContextUsage(response = {}) {
    const usage = response?.usage || {};
    const promptTokens = Number(usage.prompt_tokens || 0);
    const totalTokens = Number(usage.total_tokens || 0);
    const contextLength = Number(response.context_length || usage.contextLength || response.renderContext?.runtimeConfig?.contextWindow?.value || 0);
    if (usage.estimated === true || !contextLength || (promptTokens <= 0 && totalTokens <= 0)) return null;
    const tokens = promptTokens > 0 ? promptTokens : totalTokens;
    return {
      tokens,
      prompt_tokens: promptTokens,
      completion_tokens: Number(usage.completion_tokens || 0),
      total_tokens: totalTokens,
      cached_tokens: Number(usage.cached_tokens || 0),
      context_length: contextLength,
      contextLength,
      provider: response.renderContext?.provider || null,
      model: response.renderContext?.model || response.model || null,
      source: 'provider',
      updated_at: new Date().toISOString()
    };
  }

  async saveProviderContextUsage(sessionId, response = {}) {
    const key = this._providerUsageSettingKey(sessionId);
    if (!key || isPrivateSessionId(sessionId)) return null;
    const providerData = this.normalizeProviderContextUsage(response);
    if (!providerData) return null;
    this.providerContextData.set(key, providerData);
    if (this.db?.saveSetting) await this.db.saveSetting(key, JSON.stringify(providerData));
    return providerData;
  }

  getActiveProviderContextUsage(sessionId) {
    const key = this._providerUsageSettingKey(sessionId);
    return key ? this.providerContextData.get(key) || null : null;
  }

  async getProviderContextUsage(sessionId) {
    const key = this._providerUsageSettingKey(sessionId);
    if (!key || !this.db?.getSetting) return null;
    try {
      const raw = await this.db.getSetting(key);
      return this._normalizeStoredContextUsage(raw ? JSON.parse(raw) : null);
    } catch (_) {
      return null;
    }
  }

  _normalizeStoredContextUsage(value) {
    if (!value || typeof value !== 'object') return null;
    const tokens = Number(value.prompt_tokens || value.tokens || value.total_tokens || 0);
    const contextLength = Number(value.context_length || value.contextLength || 0);
    if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(contextLength) || contextLength <= 0) return null;
    return {
      ...value,
      tokens,
      prompt_tokens: Number(value.prompt_tokens || tokens),
      total_tokens: Number(value.total_tokens || tokens),
      context_length: contextLength,
      contextLength,
      source: 'saved',
      overflow: tokens > contextLength,
      truncated_for_send: false
    };
  }

  async clearProviderContextUsage(sessionId = null) {
    const key = this._providerUsageSettingKey(sessionId);
    if (key) {
      this.providerContextData.delete(key);
      if (this.db?.deleteSetting) return this.db.deleteSetting(key);
      return null;
    }
    this.providerContextData.clear();
    if (this.db?.run) this.db.run("DELETE FROM settings WHERE key LIKE 'session.contextUsage.%'");
    return null;
  }

  append(sessionId, message) {
    this.cache.append(sessionId, message);
  }

  invalidate(sessionId = null) {
    this.cache.invalidate(sessionId);
  }

  _isTestSessionId(sessionId) {
    return typeof sessionId === 'string' && sessionId.startsWith('testclient-');
  }

  _logContext(sessionId, context) {
    if (!this.logger?.log) return;
    this.logger.log(
      `[Context] session=${sessionId || 'current'} included=${context.includedMessages}/${context.totalMessages} ` +
      `estimated=${context.estimatedTokens}/${context.availableHistoryTokens} historyTokens window=${context.contextWindow}`
    );
  }
}

function createChatContextService(options = {}) {
  return new ChatContextService(options);
}

module.exports = {
  ChatContextService,
  createChatContextService
};
