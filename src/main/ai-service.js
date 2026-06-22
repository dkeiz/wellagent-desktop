const OllamaAdapter = require('./providers/ollama-adapter');
const LMStudioAdapter = require('./providers/lmstudio-adapter');
const OpenRouterAdapter = require('./providers/openrouter-adapter');
const OpenAICompatibleAdapter = require('./providers/openai-compatible-adapter');
const OpenAIHybridAdapter = require('./providers/openai-hybrid-adapter');
const QwenAdapter = require('./providers/qwen-adapter');
const { getEffectiveLlmSelection } = require('./llm-state');

/**
 * AIService — Manages LLM provider adapters and routing.
 *
 * All actual inference is delegated to provider adapters.
 * This class handles:
 *   - Provider registration and switching
 *   - Config persistence (provider, model, API keys)
 *   - Routing sendMessage → adapter.call()
 */
class AIService {
  constructor(db, mcpServer = null, options = {}) {
    this.db = db;
    this.mcpServer = mcpServer;
    this.windowManager = options.windowManager || null;
    this.currentProvider = 'ollama';
    this.systemPrompt = 'You are a helpful AI assistant with access to calendar and todo functions.';

    // Provider adapters
    this.adapters = {
      ollama: new OllamaAdapter(db),
      lmstudio: new LMStudioAdapter(db, {
        onSoftAlert: ({ message, level = 'info', provider = 'lmstudio' } = {}) => {
          if (!this.windowManager?.send || !message) return;
          this.windowManager.send('llm-soft-alert', { provider, level, message });
        }
      }),
      openrouter: new OpenRouterAdapter(db),
      qwen: new QwenAdapter(db),
      openai: new OpenAIHybridAdapter(db),
      groq: new OpenAICompatibleAdapter('groq', db, {
        label: 'Groq',
        defaultBaseURL: 'https://api.groq.com/openai/v1',
        apiPrefix: '/v1'
      }),
      deepseek: new OpenAICompatibleAdapter('deepseek', db, {
        label: 'DeepSeek',
        defaultBaseURL: 'https://api.deepseek.com/v1',
        apiPrefix: '/v1'
      }),
      mistral: new OpenAICompatibleAdapter('mistral', db, {
        label: 'Mistral',
        defaultBaseURL: 'https://api.mistral.ai/v1',
        apiPrefix: '/v1'
      }),
      anthropic: new OpenAICompatibleAdapter('anthropic', db, {
        label: 'Anthropic',
        defaultBaseURL: 'https://api.anthropic.com/v1',
        apiPrefix: '/v1',
        defaultHeaders: {
          'anthropic-version': '2023-06-01'
        }
      }),
      byok: new OpenAICompatibleAdapter('byok', db, {
        label: 'BYOK',
        apiPrefix: '/v1',
        apiKeyOptional: true
      }),
      'local-openai': new OpenAICompatibleAdapter('local-openai', db, {
        label: 'Local Server',
        defaultBaseURL: 'http://127.0.0.1:8000/v1',
        apiPrefix: '/v1',
        apiKeyOptional: true
      })
    };
  }

  /**
   * Stop current generation — delegates to active adapter.
   */
  stopGeneration(provider = null) {
    const targetProvider = String(provider || this.currentProvider || '').trim().toLowerCase();
    const adapter = this.adapters[targetProvider];
    if (adapter) {
      return adapter.stop();
    }
    return false;
  }

  /**
   * Check if currently generating.
   */
  get isGenerating() {
    const adapter = this.adapters[this.currentProvider];
    return adapter ? adapter.isGenerating : false;
  }

  async initialize() {
    const { provider } = await getEffectiveLlmSelection(this.db);
    this.currentProvider = provider || 'ollama';
    console.log('AI Service initialized with provider:', this.currentProvider);

    // Load system prompt
    const savedPrompt = await this.db.getSetting('system_prompt');
    if (savedPrompt) this.systemPrompt = savedPrompt;
  }

  /**
   * Send messages to the current LLM provider.
   *
   * @param {Array} messages - Pre-built [{role, content}, ...] array
   * @param {Object} options - { model, temperature, max_tokens, thinkingMode, ... }
   * @returns {Object} { content, model, usage, stopped? }
   */
  async sendMessage(messages, options = {}) {
    const targetProvider = String(options.provider || this.currentProvider || '').trim().toLowerCase();
    const adapter = this.adapters[targetProvider];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${targetProvider || this.currentProvider}`);
    }

    try {
      return await adapter.call(messages, options);
    } catch (error) {
      console.error(`[AIService] ${targetProvider} error:`, error.message);
      throw error;
    }
  }

  /**
   * Get models for a specific provider.
   */
  async getModels(provider = null, forceRefresh = false) {
    const targetProvider = provider || this.currentProvider;
    const adapter = this.adapters[targetProvider];
    if (!adapter) return [];

    try {
      return await adapter.getModels(forceRefresh);
    } catch (error) {
      console.error(`Error fetching models from ${targetProvider}:`, error.message);
      return [];
    }
  }

  async setProvider(provider) {
    if (!this.adapters[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    this.currentProvider = provider;
    await this.db.setSetting('llm.provider', provider);
    console.log('Provider changed to:', provider);
  }

  async setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    await this.db.setSetting('system_prompt', prompt);
  }

  async setAPIKey(provider, key) {
    if (!this.adapters[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    await this.db.setAPIKey(provider, key);
  }

  getCurrentProvider() {
    return this.currentProvider;
  }

  getSystemPrompt() {
    return this.systemPrompt;
  }

  getProviders() {
    return Object.keys(this.adapters);
  }
}

module.exports = AIService;
