const BaseAdapter = require('../../src/main/providers/base-adapter');
const OpenAICompatibleAdapter = require('../../src/main/providers/openai-compatible-adapter');
const OpenRouterAdapter = require('../../src/main/providers/openrouter-adapter');

module.exports = {
  name: 'provider-prompt-cache-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const openai = new OpenAICompatibleAdapter('openai', {}, { label: 'OpenAI' });
    const requestBody = {};
    openai._applyPromptCacheHint(requestBody, {
      enabled: true,
      key: 'localagent:openai:model:chat:session',
      retention: '24h'
    });

    assert.equal(
      requestBody.prompt_cache_key,
      'localagent:openai:model:chat:session',
      'Expected OpenAI adapter to send real provider prompt-cache key'
    );
    assert.equal(requestBody.prompt_cache_retention, '24h', 'Expected OpenAI cache retention to pass through when requested');

    const local = new OpenAICompatibleAdapter('local-openai', {}, { apiKeyOptional: true });
    const localBody = {};
    local._applyPromptCacheHint(localBody, { enabled: true, key: 'same-session' });
    assert.deepEqual(localBody, {}, 'Expected local OpenAI-compatible servers not to receive unsupported cache fields');

    const openrouter = new OpenRouterAdapter({});
    const routerBody = {
      model: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'assistant', content: 'older answer' },
        { role: 'user', content: 'latest user' }
      ]
    };
    openrouter._applyPromptCacheHint(routerBody, {
      enabled: true,
      key: 'localagent:openrouter:model:chat:session',
      retention: '1h'
    });
    assert.equal(routerBody.session_id, 'localagent:openrouter:model:chat:session', 'Expected OpenRouter sticky cache session id');
    assert.equal(routerBody.cache_control, undefined, 'Expected OpenRouter not to send top-level cache_control');
    assert.deepEqual(
      routerBody.messages[0].content[0].cache_control,
      { type: 'ephemeral', ttl: '1h' },
      'Expected OpenRouter Anthropic system breakpoint on a content block'
    );
    assert.deepEqual(
      routerBody.messages[2].content[0].cache_control,
      { type: 'ephemeral', ttl: '1h' },
      'Expected OpenRouter Anthropic latest-user breakpoint on a content block'
    );

    const base = new BaseAdapter('test', {});
    const normalized = base._normalizeResponse({
      content: 'ok',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        prompt_tokens_details: { cached_tokens: 8 }
      }
    });
    assert.equal(normalized.usage.cached_tokens, 8, 'Expected provider cache-hit tokens to be surfaced');
  }
};
