const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'release-direct-fixes-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const portListener = fs.readFileSync(path.join(rootDir, 'src/main/port-listener-manager.js'), 'utf8');
    assert.ok(!portListener.includes('http://localhost:*'), 'Port listener must not emit an invalid wildcard localhost CORS origin');
    assert.includes(portListener, 'getAllowedCorsOrigin', 'Port listener should reflect only explicit loopback origins');
    assert.includes(portListener, 'clearTimeout(timer)', 'Port listener body parser should clear request timeout timers');

    const database = fs.readFileSync(path.join(rootDir, 'src/main/database.js'), 'utf8');
    assert.includes(database, 'SELECT * FROM prompt_rules WHERE id = ?', 'addPromptRule should return the database row with DB defaults');
    assert.includes(database, 'DELETE FROM chat_sessions WHERE agent_id = ?', 'deleteAgent should clean agent sessions');
    assert.includes(database, 'DELETE FROM agent_tool_states WHERE agent_id = ?', 'deleteAgent should clean per-agent tool state');

    const agentManager = fs.readFileSync(path.join(rootDir, 'src/main/agent-manager.js'), 'utf8');
    assert.ok(!agentManager.includes('getAgentFolderPathById'), 'Dead getAgentFolderPathById helper should stay removed');
    assert.includes(agentManager, 'fs.rmSync(folderPath, { recursive: true, force: true })', 'deleteAgent should remove the owned agent folder');

    const chainController = fs.readFileSync(path.join(rootDir, 'src/main/tool-chain-controller.js'), 'utf8');
    assert.ok(!chainController.includes('isEchoingResult('), 'Dead isEchoingResult helper should stay removed');

    const toolsHandlers = fs.readFileSync(path.join(rootDir, 'src/main/ipc/register-tools-capability-handlers.js'), 'utf8');
    assert.ok(!toolsHandlers.includes('activate-tool-group called with'), 'activate-tool-group debug logging should stay removed');

    const llmHandlers = fs.readFileSync(path.join(rootDir, 'src/main/ipc/register-llm-handlers.js'), 'utf8');
    assert.ok(!llmHandlers.includes('llm:get-models called with provider'), 'LLM model debug logging should stay removed');
    assert.ok(!llmHandlers.includes('Models from ${provider}'), 'LLM model list debug logging should stay removed');
  }
};
