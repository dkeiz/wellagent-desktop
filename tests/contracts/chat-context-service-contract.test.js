const { createChatContextService } = require('../../src/main/chat-context-service');

function createDb(messages) {
  const settings = {};
  return {
    async getSetting(key) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) return settings[key];
      if (key === 'context_window') return '32768';
      if (key === 'llm.provider') return 'ollama';
      if (key === 'llm.model') return 'test-model';
      return null;
    },
    async saveSetting(key, value) {
      settings[key] = value;
      return { key, value };
    },
    async deleteSetting(key) {
      delete settings[key];
      return { key };
    },
    async getConversations(limit, sessionId) {
      return messages
        .filter(message => !sessionId || message.sessionId === sessionId)
        .slice(-Number(limit || 20));
    },
    async loadChatSession(sessionId) {
      return messages.filter(message => message.sessionId === sessionId);
    }
  };
}

module.exports = {
  name: 'chat-context-service-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const rows = Array.from({ length: 48 }, (_, index) => ({
      sessionId: 's-packed',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `packed-message-${index + 1}`
    }));
    const db = createDb(rows);
    const dispatcher = {
      async resolveContextWindow() {
        return 32768;
      }
    };

    const desktopContext = createChatContextService({ db, dispatcher, logger: null });
    const companionContext = createChatContextService({ db, dispatcher, logger: null });

    const desktopHistory = await desktopContext.buildPromptHistory('s-packed', 'next prompt');
    const companionHistory = await companionContext.buildPromptHistory('s-packed', 'next prompt');
    assert.ok(companionHistory.length > 20, 'Expected companion packed context to include more than 20 prior messages');
    assert.deepEqual(companionHistory, desktopHistory, 'Expected desktop and companion packed histories to match');

    const desktopUsage = await desktopContext.getUsageEstimate('s-packed', 'next prompt');
    const companionUsage = await companionContext.getUsageEstimate('s-packed', 'next prompt');
    assert.deepEqual(companionUsage, desktopUsage, 'Expected desktop and companion usage estimates to agree');
    assert.equal(desktopUsage.source, 'local', 'Expected missing saved provider usage to fall back to local full-history context calculation');
    assert.equal(desktopUsage.total_messages, 49, 'Expected local context calculation to include full session history plus current prompt');
    assert.ok(desktopUsage.tokens > 0, 'Expected local context calculation to return a token count');

    await desktopContext.saveProviderContextUsage('s-packed', {
      usage: { prompt_tokens: 12000, completion_tokens: 80, total_tokens: 12080, cached_tokens: 64 },
      context_length: 32768,
      renderContext: { provider: 'ollama', model: 'test-model' }
    });
    const activeProviderUsage = await desktopContext.getUsageEstimate('s-packed');
    assert.equal(activeProviderUsage.source, 'provider', 'Expected same-process context display to prefer current provider data');
    assert.equal(activeProviderUsage.tokens, 12000, 'Expected provider data to report direct provider prompt tokens');
    const savedUsage = await companionContext.getUsageEstimate('s-packed');
    assert.equal(savedUsage.source, 'saved', 'Expected chat-load context to use saved provider usage before local calculation');
    assert.equal(savedUsage.tokens, 12000, 'Expected saved provider prompt usage to be restored for the session');
    assert.equal(savedUsage.context_length, 32768, 'Expected saved provider context length to be restored for the session');

    await desktopContext.saveProviderContextUsage('s-packed', {
      usage: { prompt_tokens: 1, total_tokens: 1 },
      context_length: 32768,
      renderContext: { provider: 'ollama', model: 'test-model' }
    });
    const mergedUsage = await companionContext.getUsageEstimate('s-packed');
    assert.equal(mergedUsage.source, 'saved', 'Expected saved provider data to remain the preferred provider source');
    assert.equal(mergedUsage.tokens, 1, 'Expected saved provider data to preserve direct provider tokens');
    assert.ok(mergedUsage.local_tokens > 1, 'Expected full session context calculation to remain available alongside saved provider data');
    assert.equal(mergedUsage.total_messages, 48, 'Expected saved-provider display to still calculate the entire saved session');

    await desktopContext.saveProviderContextUsage('s-packed', { usage: {}, context_length: 32768 });
    assert.equal((await companionContext.getUsageEstimate('s-packed')).source, 'saved', 'Expected missing provider usage not to erase saved session context');
    await db.saveSetting('session.contextUsage.s-packed', '{bad json');
    assert.equal((await companionContext.getUsageEstimate('s-packed')).source, 'local', 'Expected corrupt saved usage to fall back to local calculation');
  }
};
