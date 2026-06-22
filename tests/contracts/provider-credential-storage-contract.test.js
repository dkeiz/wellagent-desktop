const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'provider-credential-storage-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const llmHandlers = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-llm-handlers.js'), 'utf8');
    const qwenAdapter = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'qwen-adapter.js'), 'utf8');
    const lmstudioAdapter = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'lmstudio-adapter.js'), 'utf8');

    assert.includes(llmHandlers, "db.setCredential('llm.qwen.oauthCreds'", 'Expected Qwen OAuth import to write credential storage');
    assert.includes(qwenAdapter, "this.db.getCredential?.('llm.qwen.oauthCreds')", 'Expected Qwen OAuth reads to prefer credential storage');
    assert.includes(lmstudioAdapter, "this.db.getAPIKey?.('lmstudio')", 'Expected LM Studio adapter to prefer encrypted provider API key storage');
    assert.includes(llmHandlers, 'async function getLmstudioApiKey()', 'Expected LM Studio IPC paths to share the provider credential helper');
    assert.ok(!llmHandlers.includes("const apiKey = await db.getSetting('llm.lmstudio.apiKey');"), 'Expected LM Studio IPC paths not to read API keys only from settings');
  }
};
