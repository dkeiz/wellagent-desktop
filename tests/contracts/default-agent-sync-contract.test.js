const fs = require('fs');
const path = require('path');
const AgentManager = require('../../src/main/agent-manager');
const { makeTempDir } = require('../helpers/fakes');

class AgentSyncDB {
  constructor({ agents = [], settings = {} } = {}) {
    this.agents = agents.map(agent => ({ ...agent }));
    this.settings = new Map(Object.entries(settings));
    this.nextId = this.agents.reduce((max, agent) => Math.max(max, Number(agent.id) || 0), 0) + 1;
  }

  async getSetting(key) {
    return this.settings.has(key) ? this.settings.get(key) : null;
  }

  async saveSetting(key, value) {
    this.settings.set(key, String(value));
    return { key, value };
  }

  async getAgents(type = null) {
    const agents = type ? this.agents.filter(agent => agent.type === type) : this.agents;
    return agents.map(agent => ({ ...agent }));
  }

  async getAgent(id) {
    const agent = this.agents.find(item => Number(item.id) === Number(id));
    return agent ? { ...agent } : null;
  }

  async addAgent(agent) {
    const row = {
      ...agent,
      id: this.nextId++,
      status: 'idle',
      config: agent.config ? JSON.stringify(agent.config) : null
    };
    this.agents.push(row);
    return { ...row };
  }

  async updateAgent(id, patch) {
    const index = this.agents.findIndex(agent => Number(agent.id) === Number(id));
    if (index >= 0) {
      this.agents[index] = {
        ...this.agents[index],
        ...patch,
        config: patch.config && typeof patch.config === 'object'
          ? JSON.stringify(patch.config)
          : (patch.config ?? this.agents[index].config)
      };
    }
    return { id, ...patch };
  }
}

function createManager(db, basePath) {
  return new AgentManager(db, null, null, null, null, null, null, null, { basePath });
}

module.exports = {
  name: 'default-agent-sync-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-agent-sync-');
    try {
      const db = new AgentSyncDB({
        agents: [{ id: 1, name: 'Web Search', type: 'pro', status: 'idle' }],
        settings: { 'agents.defaultsSeeded.v1': 'true' }
      });
      const manager = createManager(db, path.join(tempDir, 'agents-a'));
      await manager.initialize();

      const names = (await db.getAgents()).map(agent => agent.name).sort();
      assert.ok(names.includes('Book Writer'), 'Expected Book Writer to be added to existing installs');
      assert.ok(names.includes('ComfyUI Studio'), 'Expected ComfyUI Studio to be added to existing installs');
      assert.ok(names.includes('Setup Superagent'), 'Expected Setup Superagent to be added to existing installs');
      assert.ok(names.includes('Search Agent'), 'Expected Search Agent subagent to be restored for existing installs');
      assert.equal(names.includes('Code Reviewer'), false, 'Existing installs should not resurrect every old default agent');

      const book = (await db.getAgents()).find(agent => agent.name === 'Book Writer');
      assert.equal(book.type, 'pro', 'Book Writer should be a pro/super agent');
      assert.equal(JSON.parse(book.config).chat_ui_plugin, 'agent-book-writer', 'Book Writer should be wired to its plugin');
      assert.ok(fs.existsSync(path.join(tempDir, 'agents-a', 'pro', 'book-writer')), 'Book Writer folder should exist');
      const setup = (await db.getAgents()).find(agent => agent.name === 'Setup Superagent');
      assert.equal(setup.type, 'pro', 'Setup Superagent should be a pro/super agent');
      assert.equal(JSON.parse(setup.config).chat_ui_plugin, 'agent-setup-superagent', 'Setup Superagent should be wired to its plugin');
      assert.ok(fs.existsSync(path.join(tempDir, 'agents-a', 'pro', 'setup-superagent')), 'Setup Superagent folder should exist');
      const search = (await db.getAgents()).find(agent => agent.name === 'Search Agent');
      assert.equal(search.type, 'sub', 'Search Agent should remain a sub-agent');
      assert.ok(fs.existsSync(path.join(tempDir, 'agents-a', 'sub', 'search-agent')), 'Search Agent folder should exist');

      const repairDb = new AgentSyncDB({
        agents: [{ id: 7, name: 'Book Writer', type: 'sub', status: 'idle', config: '{}', folder_path: '' }],
        settings: { 'agents.defaultsSeeded.v1': 'true' }
      });
      const repairManager = createManager(repairDb, path.join(tempDir, 'agents-b'));
      await repairManager.initialize();
      const repaired = (await repairDb.getAgents()).find(agent => agent.name === 'Book Writer');
      assert.equal(repaired.type, 'pro', 'Existing malformed Book Writer should be repaired to pro');
      assert.equal(JSON.parse(repaired.config).chat_ui_plugin, 'agent-book-writer', 'Existing Book Writer should gain plugin config');

      const freshPartialDb = new AgentSyncDB({
        agents: [{ id: 11, name: 'Imported Agent', type: 'pro', status: 'idle' }],
        settings: { 'agents.defaultsSeeded.v1': 'false' }
      });
      const freshPartialManager = createManager(freshPartialDb, path.join(tempDir, 'agents-c'));
      await freshPartialManager.initialize();
      const freshPartialNames = (await freshPartialDb.getAgents()).map(agent => agent.name).sort();
      assert.ok(freshPartialNames.includes('Search Agent'), 'First seed should add missing default subagents even when another agent already exists');
      assert.ok(freshPartialNames.includes('Web Search'), 'First seed should add missing default pro agents even when the table is not empty');
      assert.equal(
        await freshPartialDb.getSetting('agents.defaultsSeeded.v1'),
        'true',
        'Successful first seed should persist completion state'
      );

      const pluginCalls = [];
      const pluginManager = {
        plugins: new Map([['agent-book-writer', {}], ['agent-comfy-studio', {}], ['agent-setup-superagent', {}]]),
        async enablePlugin(pluginId, options) {
          pluginCalls.push({ pluginId, options });
        }
      };
      const pluginResult = await manager.syncDefaultAgentPlugins(pluginManager);
      assert.equal(pluginResult.success, true, 'Default agent plugin sync should succeed');
      assert.deepEqual(
        pluginCalls.map(call => call.pluginId).sort(),
        ['agent-book-writer', 'agent-comfy-studio', 'agent-setup-superagent'],
        'Default agent plugin sync should enable all default companion plugins'
      );
      assert.equal(pluginCalls.every(call => call.options?.persistStatus === true), true, 'Plugin sync should persist enabled state');

      pluginCalls.length = 0;
      await manager.syncDefaultAgentPlugins(pluginManager);
      assert.equal(pluginCalls.length, 0, 'Plugin sync should be one-time so user disables are respected later');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
