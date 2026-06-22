const assert = require('assert');
const InferenceDispatcher = require('../src/main/inference-dispatcher');

class MockDB {
  constructor() {
    this.settings = new Map();
  }

  async getSetting(key) {
    return this.settings.get(key) || null;
  }

  async saveSetting(key, value) {
    this.settings.set(key, String(value));
    return { key, value };
  }

  async getActivePromptRules() {
    return [{ content: 'Always be concise.' }];
  }
}

class MockAIService {
  constructor() {
    this.currentProvider = 'ollama';
    this.systemPrompt = 'SYSTEM_PROMPT';
    this.calls = [];
    this.stopCalls = 0;
    this.nextDelayMs = 0;
  }

  getCurrentProvider() {
    return this.currentProvider;
  }

  stopGeneration() {
    this.stopCalls += 1;
    return true;
  }

  async sendMessage(messages, options) {
    this.calls.push({ messages, options, at: Date.now() });
    const delay = this.nextDelayMs;
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
    return { content: 'mocked-response', model: options.model || 'mock-model' };
  }
}

function makeMcpServer() {
  return {
    toolStates: new Map(),
    getActiveTools: () => [{
      name: 'demo_tool',
      description: 'Demo test tool',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string', description: 'Query' } },
        required: ['q']
      },
      example: 'TOOL:demo_tool{"q":"x"}'
    }],
    getTools: () => []
  };
}

async function testMessageAssemblyAndInjection() {
  const db = new MockDB();
  db.settings.set('llm.model', 'mock-model');
  const ai = new MockAIService();
  const dispatcher = new InferenceDispatcher(ai, db, makeMcpServer());

  const history = [{ role: 'assistant', content: 'prev' }];
  await dispatcher.dispatch('hello', history, { mode: 'chat' });

  assert.strictEqual(ai.calls.length, 1);
  const sent = ai.calls[0].messages;
  assert.strictEqual(sent[0].role, 'system');
  assert(sent[0].content.includes('SYSTEM_PROMPT'));
  assert(sent[0].content.includes('<mcp_tools>'));
  assert(sent[0].content.includes('Active Rules:'));
  assert.strictEqual(sent[1].content, 'prev');
  assert.strictEqual(sent[2].content, 'hello');
}

async function testSerializationLock() {
  const db = new MockDB();
  db.settings.set('llm.model', 'mock-model');
  const ai = new MockAIService();
  const dispatcher = new InferenceDispatcher(ai, db, makeMcpServer());
  ai.nextDelayMs = 120;

  const t0 = Date.now();
  const p1 = dispatcher.dispatch('first', [], { mode: 'internal' });
  const p2 = dispatcher.dispatch('second', [], { mode: 'internal' });
  await Promise.all([p1, p2]);
  const elapsed = Date.now() - t0;

  assert.strictEqual(ai.calls.length, 2);
  assert(elapsed >= 220, `Expected serialized calls >=220ms, got ${elapsed}ms`);
}

async function testPreemptionSignal() {
  const db = new MockDB();
  db.settings.set('llm.model', 'mock-model');
  const ai = new MockAIService();
  const dispatcher = new InferenceDispatcher(ai, db, makeMcpServer());
  ai.nextDelayMs = 150;

  const pBg = dispatcher.dispatch('background', [], { mode: 'internal', preemptible: true });
  await new Promise(r => setTimeout(r, 20));
  await dispatcher.dispatch('foreground', [], { mode: 'chat' });
  await pBg;

  assert(ai.stopCalls >= 1, 'Expected stopGeneration to be called for preemption');
}

async function testUiContextOverrideDoesNotPersistAsModelOverride() {
  const db = new MockDB();
  const model = 'kimi-k2.5:cloud';
  db.settings.set('llm.model', model);
  db.settings.set('context_window', '65536');
  db.settings.set('llm.modelOverrides', JSON.stringify({
    'ollama::kimi-k2.5:cloud': {
      contextWindow: { value: 8192 }
    }
  }));

  const ai = new MockAIService();
  const dispatcher = new InferenceDispatcher(ai, db, makeMcpServer());

  await dispatcher.dispatch('hello', [], { mode: 'chat', model });

  assert.strictEqual(ai.calls.length, 1);
  assert.strictEqual(
    ai.calls[0].options.runtimeConfig.contextWindow.value,
    65536,
    'Expected dispatcher to use the UI-selected context instead of saved 8k runtime context'
  );

  const savedOverrides = JSON.parse(db.settings.get('llm.modelOverrides'));
  assert.strictEqual(
    savedOverrides['ollama::kimi-k2.5:cloud'].contextWindow.value,
    8192,
    'Expected UI-selected request context not to overwrite saved per-model overrides'
  );
}

async function main() {
  await testMessageAssemblyAndInjection();
  await testSerializationLock();
  await testPreemptionSignal();
  await testUiContextOverrideDoesNotPersistAsModelOverride();
  console.log('[test-dispatcher-mocked] PASS');
}

main().catch((err) => {
  console.error('[test-dispatcher-mocked] FAIL:', err);
  process.exit(1);
});
