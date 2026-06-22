const fs = require('fs');
const path = require('path');
const {
  isProviderRequestCanceled,
  normalizeProviderHttpError,
  providerRequest
} = require('../../src/main/providers/provider-http');

module.exports = {
  name: 'provider-http-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const timeout = normalizeProviderHttpError({ code: 'ECONNABORTED', message: 'timeout exceeded' }, 'Test provider');
    assert.equal(timeout.code, 'PROVIDER_TIMEOUT', 'Expected timeout errors to get a stable provider code');
    assert.equal(isProviderRequestCanceled({ isCancel: () => true }, {}), true, 'Expected axios cancellation to be recognized');

    let captured = null;
    const response = await providerRequest({
      async request(config) {
        captured = config;
        return { data: { ok: true } };
      }
    }, { method: 'get', url: 'http://example.test' }, { timeoutMs: 1234, label: 'Example' });
    assert.equal(response.data.ok, true, 'Expected provider request helper to return axios responses');
    assert.equal(captured.timeout, 1234, 'Expected provider request helper to apply timeout policy');

    const adapterFiles = [
      'src/main/providers/openai-compatible-adapter.js',
      'src/main/providers/openrouter-adapter.js',
      'src/main/providers/ollama-adapter.js',
      'src/main/providers/lmstudio-adapter.js',
      'src/main/providers/qwen-adapter.js'
    ];
    for (const relativePath of adapterFiles) {
      const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
      assert.includes(source, 'providerRequest', `Expected ${relativePath} to use centralized provider HTTP policy`);
      assert.includes(source, 'isProviderRequestCanceled', `Expected ${relativePath} to use centralized cancellation detection`);
    }

    const llmHandlers = fs.readFileSync(path.join(rootDir, 'src/main/ipc/register-llm-handlers.js'), 'utf8');
    assert.includes(llmHandlers, "require('../providers/provider-http')", 'Expected LLM IPC handlers to import provider HTTP policy');
    assert.includes(llmHandlers, 'LM Studio direct model discovery', 'Expected LM Studio IPC discovery to use labeled provider requests');
    assert.ok(!llmHandlers.includes('axios.get('), 'Expected LLM IPC handlers not to call axios.get directly');
    assert.ok(!llmHandlers.includes('axios.post('), 'Expected LLM IPC handlers not to call axios.post directly');
  }
};
