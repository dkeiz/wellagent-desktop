const InferenceDispatcher = require('../../src/main/inference-dispatcher');
const { SessionConversationContextCache } = require('../../src/main/conversation-context');
const OpenAICompatibleAdapter = require('../../src/main/providers/openai-compatible-adapter');
const OpenRouterAdapter = require('../../src/main/providers/openrouter-adapter');
const LMStudioAdapter = require('../../src/main/providers/lmstudio-adapter');
const axios = require('axios');

module.exports = {
  name: 'pipeline-crucial-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    // ----------------------------------------------------
    // Test 1: Conversation Context Cache Cold Append (Bug #1)
    // ----------------------------------------------------
    const cache = new SessionConversationContextCache();
    // Cache is cold (not loaded yet). Append should keep a partial fallback,
    // but the next successful load must rebuild from durable storage.
    cache.append('session-cold', { role: 'user', content: 'hello cold world' });
    const loaded = await cache.getOrLoad('session-cold', async () => {
      return [
        { role: 'user', content: 'persisted older message' },
        { role: 'user', content: 'hello cold world' }
      ];
    });
    assert.equal(loaded.length, 2, 'Expected cold append cache to rebuild from DB when storage is available');
    assert.equal(loaded[0].content, 'persisted older message');

    const partialFallbackCache = new SessionConversationContextCache();
    partialFallbackCache.append('session-partial', { role: 'user', content: 'partial only' });
    const partialFallback = await partialFallbackCache.getOrLoad('session-partial', async () => {
      throw new Error('storage unavailable');
    });
    assert.equal(partialFallback.length, 1, 'Expected partial cache fallback when storage fails');
    assert.equal(partialFallback[0].content, 'partial only');

    // ----------------------------------------------------
    // Stub Axios Adapter globally for testing adapters
    // ----------------------------------------------------
    const originalAdapter = axios.defaults.adapter;
    
    let lastRequest = null;
    axios.defaults.adapter = function(config) {
      // Note: axios might wrap/format config or data.
      // If config.data is a string, parse it.
      let data = config.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (_) {}
      }
      lastRequest = { ...config, data };

      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: {
          choices: [{ message: { content: 'hello from assistant' } }],
          content: [{ type: 'text', text: 'hello from anthropic' }],
          model: data?.model || 'test-model',
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        }
      });
    };

    try {
      const fakeDb = {
        async getSetting(key) {
          if (key === 'llm.openai.url') return 'http://fake-openai';
          if (key === 'llm.openrouter.url') return 'http://fake-openrouter';
          if (key === 'llm.lmstudio.url') return 'http://fake-lmstudio';
          if (key === 'llm.anthropic.url') return 'http://fake-anthropic';
          return null;
        },
        async getAPIKey(provider) {
          return 'fake-key';
        }
      };

      // ----------------------------------------------------
      // Test 2: OpenAI Compatible Adapter max_tokens omission (Bug #4)
      // ----------------------------------------------------
      const openai = new OpenAICompatibleAdapter('openai', fakeDb, { apiKeyOptional: true });
      
      // Test call without max_tokens
      lastRequest = null;
      await openai.call([{ role: 'user', content: 'hello' }], { model: 'gpt-4' });
      assert.ok(lastRequest !== null, 'Expected axios call to be made');
      assert.equal(lastRequest.data.max_tokens, undefined, 'Expected max_tokens to be omitted by default');

      // Test call with max_tokens
      lastRequest = null;
      await openai.call([{ role: 'user', content: 'hello' }], { model: 'gpt-4', max_tokens: 200 });
      assert.equal(lastRequest.data.max_tokens, 200, 'Expected max_tokens to be passed when requested');

      // ----------------------------------------------------
      // Test 3: OpenRouter Adapter max_tokens omission & cache control (Bug #4 & #5)
      // ----------------------------------------------------
      const openrouter = new OpenRouterAdapter(fakeDb);
      
      // Test call without max_tokens
      lastRequest = null;
      await openrouter.call([{ role: 'user', content: 'hello' }], { model: 'anthropic/claude-3' });
      assert.equal(lastRequest.data.max_tokens, undefined, 'Expected OpenRouter max_tokens to be omitted by default');

      // Test call with max_tokens
      lastRequest = null;
      await openrouter.call([{ role: 'user', content: 'hello' }], { model: 'anthropic/claude-3', max_tokens: 150 });
      assert.equal(lastRequest.data.max_tokens, 150, 'Expected OpenRouter max_tokens to be passed when requested');

      // Test prompt caching on Anthropic models via OpenRouter
      lastRequest = null;
      await openrouter.call(
        [
          { role: 'system', content: 'system instructions' },
          { role: 'user', content: 'hello cache' }
        ],
        {
          model: 'anthropic/claude-3',
          promptCache: { enabled: true, key: 'test-session', retention: '1h' }
        }
      );
      assert.equal(lastRequest.data.session_id, 'test-session', 'Expected session_id sticky routing key');
      assert.equal(lastRequest.data.cache_control, undefined, 'Expected no misleading top-level cache_control field');
      assert.deepEqual(
        lastRequest.data.messages[0].content[0].cache_control,
        { type: 'ephemeral', ttl: '1h' },
        'Expected system content block to have cache_control'
      );
      assert.deepEqual(
        lastRequest.data.messages[1].content[0].cache_control,
        { type: 'ephemeral', ttl: '1h' },
        'Expected last user content block to have cache_control'
      );

      // ----------------------------------------------------
      // Test 4: LM Studio Adapter max_tokens omission (Bug #4)
      // ----------------------------------------------------
      const lmstudio = new LMStudioAdapter(fakeDb);
      lmstudio._ensureModelLoadConfig = async () => {};
      
      // Test call without max_tokens
      lastRequest = null;
      await lmstudio.call([{ role: 'user', content: 'hello' }], { model: 'local-model' });
      assert.equal(lastRequest.data.max_tokens, undefined, 'Expected LM Studio max_tokens to be omitted by default');

      // Test call with max_tokens
      lastRequest = null;
      await lmstudio.call([{ role: 'user', content: 'hello' }], { model: 'local-model', max_tokens: 50 });
      assert.equal(lastRequest.data.max_tokens, 50, 'Expected LM Studio max_tokens to be passed when requested');

      // ----------------------------------------------------
      // Test 5: Anthropic Direct Support Preprocessing (Bug #9)
      // ----------------------------------------------------
      const anthropic = new OpenAICompatibleAdapter('anthropic', fakeDb, { apiKeyOptional: true, defaultBaseURL: 'https://api.anthropic.com/v1' });
      lastRequest = null;
      await anthropic.call(
        [
          { role: 'system', content: 'system-instruction-1' },
          { role: 'system', content: 'system-instruction-2' },
          { role: 'user', content: 'actual user message' }
        ],
        { model: 'claude-3-opus' }
      );
      assert.equal(lastRequest.url.endsWith('/messages'), true, 'Expected direct Anthropic to route to /messages');
      assert.equal(lastRequest.data.system, 'system-instruction-1\n\nsystem-instruction-2', 'Expected system messages joined at top-level');
      assert.equal(lastRequest.data.messages.length, 1, 'Expected system message removed from messages array');
      assert.equal(lastRequest.data.messages[0].role, 'user');
      assert.equal(lastRequest.data.max_tokens, 8192, 'Expected direct Anthropic to fallback to 8192 if max_tokens is null');
      assert.equal(lastRequest.headers['x-api-key'], 'fake-key', 'Expected x-api-key authorization header');

      // ----------------------------------------------------
      // Test 6: Context Window Override logic (Bug #3)
      // ----------------------------------------------------
      const dispatcherDb = {
        savedSettings: [],
        settings: {
          'context_window': '60000',
          'llm.concurrency.enabled': 'false',
          'llm.thinkingMode': 'off'
        },
        async getSetting(key) {
          return this.settings[key] || null;
        },
        async saveSetting(key, value) {
          this.savedSettings.push({ key, value });
          this.settings[key] = value;
        },
        async getActivePromptRules() {
          return [];
        }
      };
      const dispatcher = new InferenceDispatcher(null, dispatcherDb, null);
      
      // Verify resolveContextWindow treats the picker as a request and clamps to known model max
      const modelSpecWithLowLimit = {
        capabilities: {
          contextWindow: { max: 4096 }
        }
      };
      const resolvedContext = await dispatcher.resolveContextWindow({
        provider: 'openai',
        model: 'gpt-4',
        modelSpec: modelSpecWithLowLimit,
        runtimeConfig: { contextWindow: { value: 2000 } }
      });
      assert.equal(resolvedContext, 4096, 'Expected UI context window picker to clamp to known model limits');

      const uiRuntime = { contextWindow: { value: 4096 } };
      Object.defineProperty(uiRuntime, '__uiContextWindowOverride', {
        value: true,
        enumerable: false
      });
      await dispatcher._rememberWorkingRuntimeParams(
        'openai',
        'gpt-4',
        { capabilities: { contextWindow: { configurable: true } } },
        uiRuntime,
        { context_length: 4096 }
      );
      assert.equal(dispatcherDb.savedSettings.length, 0, 'Expected UI-derived context values not to persist as model overrides');

      // Test system prompt hash in cache hint (Bug #6)
      const hint1 = dispatcher._buildPromptCacheHint({
        provider: 'openai',
        model: 'gpt-4',
        mode: 'chat',
        sessionId: 's1',
        agentId: 'a1',
        systemPrompt: 'prompt version A'
      });
      const hint2 = dispatcher._buildPromptCacheHint({
        provider: 'openai',
        model: 'gpt-4',
        mode: 'chat',
        sessionId: 's1',
        agentId: 'a1',
        systemPrompt: 'prompt version B'
      });
      assert.ok(hint1.key !== hint2.key, 'Expected cache keys to differ when system prompt contents differ');
    } finally {
      // Clean up require cache so other tests run with fresh/unmocked axios
      axios.defaults.adapter = originalAdapter;
    }
  }
};
