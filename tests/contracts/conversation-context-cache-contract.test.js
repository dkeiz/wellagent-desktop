const {
  buildConversationContext,
  calculateConversationContextUsage,
  SessionConversationContextCache
} = require('../../src/main/conversation-context');

module.exports = {
  name: 'conversation-context-cache-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index + 1} short content`
    }));

    const assembled = buildConversationContext(rows, {
      contextWindow: 32768,
      currentPrompt: 'next user prompt'
    });

    assert.ok(assembled.includedMessages > 20, 'Expected context assembly to avoid arbitrary 20-message caps');
    assert.equal(assembled.messages[0].content, 'message-1 short content');
    assert.equal(assembled.messages[assembled.messages.length - 1].content, 'message-60 short content');
    const fitted = buildConversationContext(rows, {
      contextWindow: 1000,
      currentPrompt: 'next user prompt'
    });
    const fittedUsage = calculateConversationContextUsage(rows, {
      contextWindow: 1000,
      currentPrompt: 'next user prompt'
    });
    assert.equal(fitted.includedMessages, rows.length, 'Expected dispatch context to include the full saved session while input fits the context window');
    assert.equal(fittedUsage.truncatedForSend, false, 'Expected fitted full input not to be marked truncated for send');
    const fullUsage = calculateConversationContextUsage(rows, {
      contextWindow: 128,
      currentPrompt: 'next user prompt'
    });
    assert.equal(fullUsage.totalMessages, 61, 'Expected full context calculation to include every saved message plus current prompt');
    assert.ok(fullUsage.tokens > fullUsage.contextWindow, 'Expected full context calculation to report overflow instead of truncating display tokens');
    assert.equal(fullUsage.truncatedForSend, false, 'Expected application chat context never to truncate even when full input overflows the model window');
    const overflowPacked = buildConversationContext(rows, {
      contextWindow: 128,
      currentPrompt: 'next user prompt'
    });
    assert.equal(overflowPacked.includedMessages, rows.length, 'Expected overflowing dispatch context to still include the entire saved session');

    const cache = new SessionConversationContextCache();
    const loaded = await cache.getOrLoad('s1', async () => rows.slice(0, 2));
    assert.equal(loaded.length, 2, 'Expected cache miss to load full saved chat');

    cache.append('s1', { role: 'user', content: 'appended message' });
    const fallback = await cache.getOrLoad('s1', async () => {
      throw new Error('storage unavailable');
    });

    assert.equal(fallback.length, 3, 'Expected cache failure to keep appended runtime context');
    assert.equal(fallback[2].content, 'appended message');

    const coldAppendCache = new SessionConversationContextCache();
    coldAppendCache.append('cold-import', { role: 'user', content: 'new imported row' });
    const rebuilt = await coldAppendCache.getOrLoad('cold-import', async () => [
      { role: 'user', content: 'older persisted row' },
      { role: 'assistant', content: 'older assistant row' },
      { role: 'user', content: 'new imported row' }
    ]);
    assert.equal(rebuilt.length, 3, 'Expected cold partial cache to rebuild from DB instead of hiding old rows');
    assert.equal(rebuilt[0].content, 'older persisted row');

    const partialOnlyCache = new SessionConversationContextCache();
    partialOnlyCache.append('cold-fallback', { role: 'user', content: 'runtime-only row' });
    const partialOnly = await partialOnlyCache.getOrLoad('cold-fallback', async () => {
      throw new Error('storage unavailable');
    });
    assert.equal(partialOnly.length, 1, 'Expected cold partial cache fallback only when storage fails');
    assert.equal(partialOnly[0].content, 'runtime-only row');
  }
};
