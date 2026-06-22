const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const { ExecutionDirectory } = require('../../src/main/execution-directory');
const { makeTempDir } = require('../helpers/fakes');

function createDb() {
  const rules = new Map();
  let nextRuleId = 1;
  return {
    async getSetting() { return null; },
    async setSetting() { return true; },
    async getPromptRules() { return Array.from(rules.values()); },
    async getActivePromptRules() {
      return Array.from(rules.values()).filter(rule => rule.active);
    },
    async addPromptRule(rule) {
      const id = nextRuleId++;
      rules.set(rule.name, { id, name: rule.name, content: rule.content || '', active: true });
      return { id };
    },
    async updatePromptRule(id, patch) {
      for (const [name, rule] of rules.entries()) {
        if (rule.id === id) {
          rules.delete(name);
          rules.set(patch.name || name, { ...rule, ...patch });
          return true;
        }
      }
      return false;
    },
    async togglePromptRule(id, active) {
      for (const rule of rules.values()) {
        if (rule.id === id) rule.active = Boolean(active);
      }
      return true;
    },
    async deletePromptRule(id) {
      for (const [name, rule] of rules.entries()) {
        if (rule.id === id) rules.delete(name);
      }
      return true;
    },
    async get(sql, args = []) {
      if (!sql.includes('FROM prompt_rules')) return null;
      const rule = rules.get(args[0]);
      return rule ? { id: rule.id } : null;
    },
    async getCustomTools() { return []; }
  };
}

function createServer(db, executionRoot, promptFileManager) {
  const server = new MCPServer(db, {
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  });
  server.setExecutionDirectory(new ExecutionDirectory(db, { defaultRoot: executionRoot }));
  server.setPromptFileManager(promptFileManager);
  server.setAIService({
    getSystemPrompt() { return 'old prompt'; },
    async setSystemPrompt() { return true; },
    getCurrentProvider() { return 'test'; }
  });
  return server;
}

function createPromptFileManager(basePath, overrides = {}) {
  const systemPromptPath = overrides.systemPromptPath || path.join(basePath, 'system.md');
  const rulesPath = overrides.rulesPath || path.join(basePath, 'rules');
  return {
    basePath,
    systemPromptPath,
    rulesPath,
    ensureDirectories() {
      fs.mkdirSync(path.dirname(systemPromptPath), { recursive: true });
      fs.mkdirSync(rulesPath, { recursive: true });
    },
    getSafeFilename(name, priority = 1) {
      const safeName = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return `${String(priority).padStart(3, '0')}-${safeName}.md`;
    },
    async saveSystemPrompt(content) {
      fs.mkdirSync(path.dirname(systemPromptPath), { recursive: true });
      fs.writeFileSync(systemPromptPath, content, 'utf-8');
    }
  };
}

module.exports = {
  name: 'prompt-tool-execution-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-prompt-policy-');
    const outsideBase = makeTempDir('localagent-prompt-policy-outside-');
    const executionRoot = path.join(tempBase, 'project');
    const promptRoot = path.join(tempBase, 'agentin', 'prompts');
    const db = createDb();

    try {
      fs.mkdirSync(executionRoot, { recursive: true });
      const promptFileManager = createPromptFileManager(promptRoot);
      const server = createServer(db, executionRoot, promptFileManager);

      const promptResult = await server.executeTool('modify_system_prompt', { content: 'new prompt' });
      assert.equal(promptResult.success, true, 'Prompt writes under the prompt root should be allowed');
      assert.equal(fs.readFileSync(path.join(promptRoot, 'system.md'), 'utf-8'), 'new prompt');

      const ruleResult = await server.executeTool('manage_rule', {
        action: 'create',
        name: 'Code Style',
        content: 'Use small files',
        active: true
      });
      assert.equal(ruleResult.success, true, 'Rule writes under the prompt root should be allowed');

      const badPromptManager = createPromptFileManager(promptRoot, {
        systemPromptPath: path.join(outsideBase, 'system.md')
      });
      const badServer = createServer(db, executionRoot, badPromptManager);
      let deniedMessage = '';
      try {
        await badServer.executeTool('modify_system_prompt', { content: 'escape' });
      } catch (error) {
        deniedMessage = error.message || '';
      }
      assert.includes(deniedMessage, 'outside the execution folder', 'Prompt tool writes should use central path denial');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
      fs.rmSync(outsideBase, { recursive: true, force: true });
    }
  }
};
