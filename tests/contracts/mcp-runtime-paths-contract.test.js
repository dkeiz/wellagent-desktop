const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const { makeTempDir } = require('../helpers/fakes');

function createCapabilityManager() {
  return {
    isToolActive() {
      return true;
    },
    getGroupsConfig() {
      return [];
    },
    getActiveTools() {
      return [];
    }
  };
}

function portablePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

module.exports = {
  name: 'mcp-runtime-paths-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-mcp-paths-');
    const promptBasePath = path.join(tempBase, 'prompts');
    const connectorsDir = path.join(tempBase, 'connectors');
    const promptPath = path.join(promptBasePath, 'system.md');
    const rulesPath = path.join(promptBasePath, 'rules');
    const settings = new Map();
    const db = {
      async getSetting(key) {
        if (key === 'tool_timeout_ms') return '5000';
        return settings.has(key) ? settings.get(key) : null;
      },
      async setSetting(key, value) {
        settings.set(key, value);
      }
    };
    const aiService = {
      prompt: 'Initial prompt',
      getSystemPrompt() {
        return this.prompt;
      },
      async setSystemPrompt(content) {
        this.prompt = content;
      }
    };
    const promptFileManager = {
      systemPromptPath: promptPath,
      rulesPath,
      ensureDirectories() {
        fs.mkdirSync(rulesPath, { recursive: true });
      },
      getSafeFilename(name, priority = 1) {
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return `${String(priority).padStart(3, '0')}-${safeName}.md`;
      },
      async saveSystemPrompt(content) {
        this.ensureDirectories();
        fs.writeFileSync(this.systemPromptPath, content, 'utf-8');
      }
    };
    const connectorRuntime = { connectorsDir };
    const server = new MCPServer(db, createCapabilityManager());
    server.setAIService(aiService);
    server.setPromptFileManager(promptFileManager);
    server.setConnectorRuntime(connectorRuntime);

    try {
      const promptResult = await server.executeTool('modify_system_prompt', {
        content: 'Temp runtime prompt'
      });
      assert.equal(promptResult.result.path, portablePath(promptPath), 'Expected prompt tool to write into the injected runtime prompt path');
      assert.equal(fs.readFileSync(promptPath, 'utf-8'), 'Temp runtime prompt', 'Expected prompt tool to update the injected prompt file');
      assert.equal(settings.get('system_prompt'), 'Temp runtime prompt', 'Expected prompt tool to persist DB state');

      const connectorResult = await server.executeTool('connector_op', {
        action: 'create',
        name: 'temp-connector',
        code: 'module.exports = { name: "temp-connector" };'
      });
      const connectorPath = path.join(connectorsDir, 'temp-connector.js');
      assert.equal(connectorResult.result.path, portablePath(connectorPath), 'Expected connector tool to write into the injected runtime connector path');
      assert.ok(fs.existsSync(connectorPath), 'Expected connector tool to create the connector file');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
