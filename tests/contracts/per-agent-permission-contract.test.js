const ToolPermissionStore = require('../../src/main/tool-permission-store');
const ToolPermissionService = require('../../src/main/tool-permission-service');

class CapabilityStub {
  constructor() {
    this.groupState = {
      unsafe: false,
      web: true,
      files: 'read',
      terminal: 'workspace',
      ports: true,
      visual: false
    };
    this.config = {
      safeTools: {
        tools: ['current_time', 'read_file']
      }
    };
    this.customToolSafety = new Map();
  }

  isMainEnabled() {
    return true;
  }

  getGroupsConfig() {
    return [
      { id: 'unsafe', enabled: this.groupState.unsafe, tools: ['create_tool'], allTools: ['create_tool'] },
      { id: 'web', enabled: this.groupState.web, tools: [], allTools: [] },
      {
        id: 'files',
        mode: this.groupState.files,
        tools: [],
        allTools: ['read_file'],
        modes: { off: [], read: ['read_file'], full: ['read_file'] }
      },
      {
        id: 'terminal',
        mode: this.groupState.terminal,
        tools: ['run_command'],
        allTools: ['run_command'],
        modes: { off: [], workspace: ['run_command'], system: ['run_command'] }
      },
      { id: 'ports', enabled: this.groupState.ports, tools: [], allTools: [] },
      { id: 'visual', enabled: this.groupState.visual, tools: [], allTools: [] }
    ];
  }

  getGroupForTool(toolName) {
    if (toolName === 'create_tool') return 'unsafe';
    if (toolName === 'run_command') return 'terminal';
    return null;
  }

  isCustomToolSafe(toolName) {
    return this.customToolSafety.get(toolName) === true;
  }

  setGroupEnabled(groupId, value) {
    if (groupId === 'files') {
      this.groupState.files = String(value || 'read');
      return;
    }
    this.groupState[groupId] = groupId === 'terminal' ? String(value || 'workspace') : Boolean(value);
  }
}

class FakeDB {
  constructor() {
    this.settings = new Map();
    this.agentProfiles = new Map();
    this.agentToolStates = new Map();
    this.chatSessions = new Map();
    this.agents = new Map();
  }

  run(sql, args = []) {
    const text = String(sql);
    if (text.includes('CREATE TABLE IF NOT EXISTS agent_permission_profiles')) return;
    if (text.includes('ALTER TABLE agent_permission_profiles')) return;
    if (text.includes('CREATE TABLE IF NOT EXISTS agent_tool_states')) return;

    if (text.includes('INSERT OR REPLACE INTO agent_permission_profiles')) {
      const [
        agentId,
        mainEnabled,
        presetId,
        filesMode,
        unsafeEnabled,
        webEnabled,
        terminalEnabled,
        terminalMode,
        portsEnabled,
        visualEnabled
      ] = args;
      this.agentProfiles.set(Number(agentId), {
        agent_id: Number(agentId),
        main_enabled: mainEnabled ? 1 : 0,
        preset_id: String(presetId || ''),
        files_mode: String(filesMode),
        unsafe_enabled: unsafeEnabled ? 1 : 0,
        web_enabled: webEnabled ? 1 : 0,
        terminal_enabled: terminalEnabled ? 1 : 0,
        terminal_mode: String(terminalMode || (terminalEnabled ? 'workspace' : 'off')),
        ports_enabled: portsEnabled ? 1 : 0,
        visual_enabled: visualEnabled ? 1 : 0
      });
      return;
    }

    if (text.includes('DELETE FROM agent_permission_profiles')) {
      this.agentProfiles.delete(Number(args[0]));
      return;
    }
    if (text.includes('DELETE FROM agent_tool_states WHERE agent_id')) {
      this.agentToolStates.delete(Number(args[0]));
      return;
    }
    if (text.includes('INSERT OR REPLACE INTO agent_tool_states')) {
      const [agentId, toolName, active] = args;
      const id = Number(agentId);
      if (!this.agentToolStates.has(id)) this.agentToolStates.set(id, new Map());
      this.agentToolStates.get(id).set(String(toolName), active ? 1 : 0);
      return;
    }
  }

  get(sql, args = []) {
    const text = String(sql);
    if (text.includes('SELECT * FROM agent_permission_profiles WHERE agent_id')) {
      return this.agentProfiles.get(Number(args[0])) || undefined;
    }
    if (text.includes('SELECT agent_id FROM chat_sessions WHERE id')) {
      const row = this.chatSessions.get(Number(args[0]));
      return row ? { agent_id: row.agent_id } : undefined;
    }
    return undefined;
  }

  all(sql, args = []) {
    const text = String(sql);
    if (text.includes('SELECT agent_id FROM agent_permission_profiles')) {
      return Array.from(this.agentProfiles.keys())
        .sort((a, b) => a - b)
        .map(agentId => ({ agent_id: agentId }));
    }
    if (text.includes('SELECT tool_name, active FROM agent_tool_states WHERE agent_id')) {
      const rows = this.agentToolStates.get(Number(args[0])) || new Map();
      return Array.from(rows.entries()).map(([toolName, active]) => ({
        tool_name: toolName,
        active
      }));
    }
    return [];
  }

  async getSetting(key) {
    return this.settings.get(String(key)) || null;
  }

  async setSetting(key, value) {
    this.settings.set(String(key), String(value));
    return { key, value };
  }

  addAgent(agent) {
    this.agents.set(Number(agent.id), { ...agent });
  }

  getAgent(agentId) {
    return this.agents.get(Number(agentId)) || null;
  }

  addChatSession(session) {
    this.chatSessions.set(Number(session.id), { ...session });
  }
}

module.exports = {
  name: 'per-agent-permission-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new FakeDB();
    const capabilityManager = new CapabilityStub();
    const tools = new Map([
      ['run_command', { definition: { name: 'run_command' } }],
      ['current_time', { definition: { name: 'current_time' } }],
      ['create_tool', { definition: { name: 'create_tool' } }],
      ['read_file', { definition: { name: 'read_file' } }],
      ['plugin_scoped_tool', { definition: { name: 'plugin_scoped_tool', agentScopeSlugs: ['file-manager-a'] } }]
    ]);

    db.addAgent({ id: 101, name: 'File Manager A', type: 'pro' });
    db.addAgent({ id: 102, name: 'File Manager B', type: 'pro' });
    db.addChatSession({ id: 5001, agent_id: 101 });
    db.addChatSession({ id: 5002, agent_id: 102 });

    await db.setSetting('tool.run_command.active', 'false');
    await db.setSetting('tool.current_time.active', 'true');
    await db.setSetting('tool.create_tool.active', 'false');
    await db.setSetting('tool.read_file.active', 'false');
    await db.setSetting('tool.plugin_scoped_tool.active', 'false');

    const mcpServer = {
      tools,
      getTools() {
        return [...tools.values()].map(entry => entry.definition);
      },
      async getToolActiveState(toolName) {
        const state = await db.getSetting(`tool.${toolName}.active`);
        return state !== 'false';
      }
    };
    const agentManager = {
      async getAgent(id) {
        return db.getAgent(id);
      },
      _getSafeFolderName(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      }
    };

    const service = new ToolPermissionService({
      db,
      capabilityManager,
      mcpServer,
      agentManager,
      store: new ToolPermissionStore(db)
    });
    await service.initialize();

    const global = await service.resolveContext({});
    assert.equal(global.scope, 'global', 'Expected global resolution without agent context');
    assert.equal(global.toolStates.run_command, false, 'Expected global run_command disabled by setting');

    const resolvedABySession = await service.resolveContext({ sessionId: 5001 });
    assert.equal(resolvedABySession.scope, 'agent', 'Expected agent-scoped resolution for agent session');
    assert.equal(resolvedABySession.agentId, 101, 'Expected session context to resolve correct agent');

    const resolvedA = await service.resolveContext({ agentId: 101 });
    const resolvedB = await service.resolveContext({ agentId: 102 });
    assert.equal(resolvedA.toolStates.plugin_scoped_tool, true, 'Expected scoped plugin tool auto-enabled for matching agent');
    assert.equal(resolvedB.toolStates.plugin_scoped_tool, false, 'Expected scoped plugin tool disabled for non-matching agent');
    assert.equal(global.toolStates.plugin_scoped_tool, false, 'Expected scoped plugin tool hidden in global context');

    await service.setAgentTool(101, 'run_command', true);
    const resolvedAAfterOverride = await service.resolveContext({ agentId: 101 });
    const resolvedBAfterOverride = await service.resolveContext({ agentId: 102 });
    assert.equal(resolvedAAfterOverride.toolStates.run_command, true, 'Expected agent A override to enable run_command');
    assert.equal(resolvedBAfterOverride.toolStates.run_command, false, 'Expected agent B to remain independent');

    const developerApplied = await service.applyAgentPreset(102, 'developer');
    assert.equal(developerApplied.activePresetId, 'developer', 'Expected developer preset to be marked active');
    assert.equal(developerApplied.profile.preset_id, 'developer', 'Expected profile row to store preset id');
    assert.equal(developerApplied.profile.files_mode, 'full', 'Expected developer preset to grant full file access');
    assert.equal(developerApplied.toolStates.run_command, true, 'Expected developer preset to allow terminal tool');
    assert.equal(developerApplied.toolStates.create_tool, true, 'Expected developer preset to allow unsafe tool');
    assert.equal(developerApplied.toolStates.read_file, true, 'Expected developer preset to allow file tool');

    await service.setAgentTool(102, 'run_command', false);
    const developerEdited = await service.getAgentProfile(102);
    assert.equal(developerEdited.activePresetId, '', 'Expected manual tool edit to exit developer preset mode');
    assert.equal(developerEdited.toolStates.run_command, false, 'Expected explicit override to remain after leaving preset mode');

    const developerReset = await service.resetAgentProfile(102);
    assert.equal(developerReset.activePresetId, '', 'Expected reset to clear preset state');
    assert.equal(developerReset.toolStates.run_command, false, 'Expected reset to restore global terminal state');
    assert.equal(developerReset.toolStates.create_tool, false, 'Expected reset to restore global unsafe state');

    db.addAgent({ id: 103, name: 'File Manager C', type: 'pro' });
    await db.setSetting('tool.plugin_scoped_tool.active', 'true');
    await service.resetAgentProfile(101);
    const globalWithScopedEnabled = await service.resolveContext({});
    const resolvedAMatchingScope = await service.resolveContext({ agentId: 101 });
    const resolvedCNonMatchingScope = await service.resolveContext({ agentId: 103 });
    assert.equal(globalWithScopedEnabled.toolStates.plugin_scoped_tool, false, 'Expected scoped tool to remain hidden when globally enabled');
    assert.equal(resolvedAMatchingScope.toolStates.plugin_scoped_tool, true, 'Expected matching agent to retain scoped tool visibility when globally enabled');
    assert.equal(resolvedCNonMatchingScope.toolStates.plugin_scoped_tool, false, 'Expected non-matching agent to keep scoped tool hidden when globally enabled');

    capabilityManager.setGroupEnabled('unsafe', true);
    await db.setSetting('tool.create_tool.active', 'true');
    await service.syncUnsafeFromGlobal();
    const resolvedAAfterUnsafeSync = await service.resolveContext({ agentId: 101 });
    const resolvedBAfterUnsafeSync = await service.resolveContext({ agentId: 102 });
    assert.equal(resolvedAAfterUnsafeSync.groups.unsafe, true, 'Expected unsafe group to sync to agent A');
    assert.equal(resolvedBAfterUnsafeSync.groups.unsafe, true, 'Expected unsafe group to sync to agent B');
    assert.equal(resolvedAAfterUnsafeSync.toolStates.create_tool, true, 'Expected unsafe tool active for agent A after sync');
    assert.equal(resolvedBAfterUnsafeSync.toolStates.create_tool, true, 'Expected unsafe tool active for agent B after sync');
    assert.equal(resolvedBAfterUnsafeSync.toolStates.run_command, false, 'Expected safe tool state unchanged by unsafe sync');

    const noGrantReadAllowed = await service.isToolAllowed({
      toolName: 'read_file',
      context: { agentId: 101, subagentRunId: 'run-1' }
    });
    assert.equal(noGrantReadAllowed, false, 'Expected safe tool to remain blocked before run-scoped grant');

    service.setRunScopedGrant('run-1', 101, {
      safe_tools: ['read_file'],
      unsafe_tools: ['create_tool']
    });
    const withGrantReadAllowed = await service.isToolAllowed({
      toolName: 'read_file',
      context: { agentId: 101, subagentRunId: 'run-1' }
    });
    const withGrantUnsafeAllowed = await service.isToolAllowed({
      toolName: 'create_tool',
      context: { agentId: 101, subagentRunId: 'run-1' }
    });
    assert.equal(withGrantReadAllowed, true, 'Expected run-scoped safe grant to allow read_file');
    assert.equal(withGrantUnsafeAllowed, true, 'Expected unsafe tool remains governed by profile/global, not auto-granted');

    service.clearRunScopedGrant('run-1');
    const afterClearReadAllowed = await service.isToolAllowed({
      toolName: 'read_file',
      context: { agentId: 101, subagentRunId: 'run-1' }
    });
    assert.equal(afterClearReadAllowed, false, 'Expected run-scoped grant removal to revoke extra safe tool access');
  }
};
