const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { SetupSuperagentService } = require('../../src/main/setup-superagent-service');
const { MemoryDB, PluginCapabilityStub, makeTempDir } = require('../helpers/fakes');

class SetupDb {
  constructor(settings = {}) {
    this.settings = new Map(Object.entries(settings).map(([key, value]) => [key, String(value)]));
    this.toolStates = {};
  }

  async getSetting(key) {
    return this.settings.has(key) ? this.settings.get(key) : null;
  }

  async saveSetting(key, value) {
    this.settings.set(key, String(value));
    return { key, value };
  }

  async getToolStates() {
    return { ...this.toolStates };
  }

  async getCustomTools() {
    return [];
  }

  setSetting(key, value) {
    this.settings.set(key, String(value));
  }
}

class SetupContainer {
  constructor(map) {
    this.map = { ...map };
  }

  get(name) {
    if (!(name in this.map)) {
      throw new Error(`Missing service ${name}`);
    }
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }

  replace(name, value) {
    this.map[name] = value;
  }
}

class SetupCapabilityManager extends PluginCapabilityStub {
  constructor() {
    super();
    this.mainEnabled = false;
    this.groups = {
      web: false,
      unsafe: false,
      files: 'off',
      terminal: 'off',
      memory: false,
      ports: false
    };
  }

  getState() {
    return {
      mainEnabled: this.mainEnabled,
      groups: { ...this.groups },
      activeToolCount: this.mainEnabled ? 3 : 0
    };
  }

  setMainEnabled(enabled) {
    this.mainEnabled = enabled === true;
    return this.mainEnabled;
  }

  setGroupEnabled(groupId, enabled) {
    if (groupId === 'files') {
      this.groups.files = enabled ? 'read' : 'off';
    } else if (groupId === 'terminal') {
      this.groups.terminal = enabled ? 'workspace' : 'off';
    } else {
      this.groups[groupId] = enabled === true;
    }
    return true;
  }

  isGroupEnabled(groupId) {
    const val = this.groups[groupId];
    return typeof val === 'string' ? val !== 'off' : val === true;
  }

  setFilesMode(mode) {
    this.groups.files = mode;
    return mode;
  }

  getFilesMode() {
    return this.groups.files || 'off';
  }

  setTerminalMode(mode) {
    this.groups.terminal = mode;
    return mode;
  }

  getTerminalMode() {
    return this.groups.terminal || 'off';
  }

  getGroupForTool(toolName) {
    if (toolName === 'search_web_bing' || toolName === 'fetch_url' || toolName === 'inner_browser') return 'web';
    return null;
  }

  getGroupsConfig() {
    return Object.entries(this.groups).map(([id, val]) => {
      const isModeGroup = id === 'files' || id === 'terminal';
      const enabled = isModeGroup ? val !== 'off' : val === true;
      return {
        id,
        name: id.toUpperCase(),
        description: `${id} capabilities`,
        icon: '🔧',
        enabled,
        mode: isModeGroup ? val : undefined,
        modes: isModeGroup ? (id === 'files' ? { off: [], read: ['read_file'], full: ['read_file', 'write_file'] } : { off: [], workspace: ['run_command'], system: ['run_command'] }) : undefined,
        tools: [],
        allTools: []
      };
    });
  }
}

module.exports = {
  name: 'setup-superagent-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new SetupDb({
      'baseinit.completed': 'false',
      'llm.provider': '',
      'llm.model': '',
      'companion.enabled': 'false'
    });
    const capabilityManager = new SetupCapabilityManager();
    capabilityManager.registerCustomTool('setup_superagent', true);
    const mcpServer = new MCPServer(db, capabilityManager);
    const pluginState = [
      { id: 'searxng-search', name: 'SearXNG Search', status: 'disabled', visibleInSidebar: true },
      { id: 'http-tts-bridge', name: 'HTTP TTS Bridge', status: 'disabled', visibleInSidebar: true }
    ];
    const pluginManagerStub = {
      listPlugins() {
        return pluginState.slice();
      },
      async getPluginConfig() {
        return {};
      }
    };
    const sessionInitManager = {
      async detectStartType() {
        return { isColdStart: true, hoursSinceLastActivity: 999 };
      },
      async buildBaseInitReport() {
        return { model: { configured: false } };
      }
    };
    const container = new SetupContainer({
      db,
      mcpServer,
      capabilityManager,
      sessionInitManager,
      pluginManager: pluginManagerStub,
      windowManager: { send() {} },
      eventBus: { publish() {} },
      memoryDaemon: { running: false, async start() { this.running = true; } },
      workflowScheduler: { running: false, async start() { this.running = true; } }
    });

    const service = new SetupSuperagentService(container, {
      db,
      sessionInitManager,
      capabilityManager,
      windowManager: container.optional('windowManager'),
      eventBus: container.optional('eventBus')
    });
    container.replace('setupSuperagentService', service);
    mcpServer._setupSuperagentService = service;

    const firstAssessment = await service.getAssessment();
    assert.equal(firstAssessment.userMode, 'new', 'Expected fresh incomplete setup to classify as new');
    assert.equal(firstAssessment.userProfile, 'fresh', 'Expected missing usage signals to classify as fresh install');
    assert.equal(firstAssessment.setupStage, 'configuration_missing', 'Expected missing provider setup stage');
    assert.equal(firstAssessment.recommendedActions[0].id, 'run_baseinit', 'Expected BaseInit to be first safe recommendation');
    assert.equal(firstAssessment.manualActions[0].id, 'configure_llm', 'Expected missing LLM config to be a manual step');

    const baseInitResult = await service.runAction({ action: 'run_baseinit', params: {} });
    assert.equal(baseInitResult.success, true, 'Expected BaseInit action to succeed');
    assert.equal(await db.getSetting('baseinit.completed'), 'true', 'Expected BaseInit action to persist completion');

    db.setSetting('llm.provider', 'openai');
    db.setSetting('llm.model', 'gpt-5.2-codex');
    const capabilityResult = await service.runAction({ action: 'set_capability_main', params: { enabled: true } });
    assert.equal(capabilityResult.success, true, 'Expected capability main action to succeed');
    assert.equal(capabilityResult.assessment.state.capabilities.mainEnabled, true, 'Expected capability main state to update');
    assert.equal(capabilityResult.assessment.userProfile, 'returning', 'Expected configured setup to classify as existing user');
    assert.equal(capabilityResult.assessment.userMode, 'partial', 'Expected additional optional setup steps to keep setup in partial mode');

    db.setSetting('baseinit.completed', 'false');
    const inferredExisting = await service.getAssessment();
    assert.equal(inferredExisting.userProfile, 'returning', 'Expected active setup signals to override fresh install labeling');
    assert.equal(inferredExisting.userMode, 'partial', 'Expected missing init on an existing setup to classify as partial, not new');
    assert.equal(inferredExisting.setupStage, 'init_missing', 'Expected missing init stage when LLM is already configured');

    const toolInspect = await mcpServer.executeTool('setup_superagent', { action: 'inspect' });
    assert.equal(toolInspect.success, true, 'Expected setup_superagent inspect tool call to succeed');
    assert.ok(toolInspect.result.assessment, 'Expected inspect tool to return an assessment');
    assert.ok(toolInspect.result.assessment.state.presets, 'Expected inspect to include presets in state');
    assert.ok(toolInspect.result.assessment.state.presets.developer, 'Expected developer preset to exist');

    // === Preset application ===
    db.setSetting('baseinit.completed', 'true');
    const presetResult = await service.runAction({ action: 'apply_preset', params: { preset: 'developer' } });
    assert.equal(presetResult.success, true, 'Expected developer preset to apply successfully');
    assert.equal(presetResult.result.preset, 'developer', 'Expected preset name in result');
    assert.ok(presetResult.result.applied.length > 0, 'Expected preset to apply at least one setting');
    assert.equal(capabilityManager.mainEnabled, true, 'Expected developer preset to enable main switch');
    assert.equal(capabilityManager.groups.web, true, 'Expected developer preset to enable web group');

    const invalidPreset = await service.runAction({ action: 'apply_preset', params: { preset: 'nonexistent' } });
    assert.equal(invalidPreset.success, false, 'Expected unknown preset to fail');

    // === Quick toggle ===
    capabilityManager.groups.web = true;
    const toggleResult = await service.quickToggle('web');
    assert.equal(toggleResult.success, true, 'Expected web toggle to succeed');
    assert.equal(capabilityManager.groups.web, false, 'Expected web toggle to flip web group off');

    const toggleBackResult = await service.quickToggle('web');
    assert.equal(toggleBackResult.success, true, 'Expected web toggle back to succeed');
    assert.equal(capabilityManager.groups.web, true, 'Expected web toggle to flip web group back on');

    const unknownToggle = await service.quickToggle('nonexistent_group');
    // Should attempt to use capabilityManager.setGroupEnabled — the group may not exist but no crash expected

    // === Quick check ===
    const checkAll = await service.quickCheck('all');
    assert.equal(checkAll.success, true, 'Expected check all to succeed');
    assert.ok(checkAll.result, 'Expected check all to return state');

    const checkCompanion = await service.quickCheck('companion');
    assert.equal(checkCompanion.success, true, 'Expected companion check to succeed');
    assert.ok('enabled' in checkCompanion.result, 'Expected companion check to include enabled field');

    const checkLlm = await service.quickCheck('llm');
    assert.equal(checkLlm.success, true, 'Expected LLM check to succeed');
    assert.equal(checkLlm.result.provider, 'openai', 'Expected LLM check to return current provider');

    const checkCapabilities = await service.quickCheck('capabilities');
    assert.equal(checkCapabilities.success, true, 'Expected capabilities check to succeed');

    const checkPlugins = await service.quickCheck('plugins');
    assert.equal(checkPlugins.success, true, 'Expected plugins check to succeed');

    const checkUnknown = await service.quickCheck('nonexistent');
    assert.equal(checkUnknown.success, false, 'Expected unknown check target to fail');

    // === MCP tool: toggle action ===
    capabilityManager.groups.web = false;
    const toolToggle = await mcpServer.executeTool('setup_superagent', { action: 'toggle', target: 'web' });
    assert.equal(toolToggle.success, true, 'Expected toggle MCP tool action to succeed');
    assert.equal(toolToggle.result.action, 'toggle', 'Expected toggle action in response');
    assert.ok(toolToggle.result.assessment, 'Expected toggle to return updated assessment');

    // === MCP tool: check action ===
    const toolCheck = await mcpServer.executeTool('setup_superagent', { action: 'check', target: 'llm' });
    assert.equal(toolCheck.success, true, 'Expected check MCP tool action to succeed');
    assert.equal(toolCheck.result.action, 'check', 'Expected check action in response');

    // === File mode / terminal mode actions ===
    const filesModeResult = await service.runAction({ action: 'set_files_mode', params: { mode: 'full' } });
    assert.equal(filesModeResult.success, true, 'Expected set_files_mode action to succeed');

    const terminalModeResult = await service.runAction({ action: 'set_terminal_mode', params: { mode: 'workspace' } });
    assert.equal(terminalModeResult.success, true, 'Expected set_terminal_mode action to succeed');

    const invalidFilesMode = await service.runAction({ action: 'set_files_mode', params: { mode: 'invalid' } });
    assert.equal(invalidFilesMode.success, false, 'Expected invalid files mode to fail');

    const tempDir = makeTempDir('localagent-setup-superagent-');
    try {
      const uiDb = new MemoryDB();
      const uiCapabilityManager = new PluginCapabilityStub();
      const uiMcpServer = new MCPServer(uiDb, uiCapabilityManager);
      const uiContainer = new SetupContainer({
        db: uiDb,
        mcpServer: uiMcpServer,
        capabilityManager: uiCapabilityManager,
        setupSuperagentService: {
          async getAssessment() {
            return {
              userMode: 'partial',
              userProfile: 'returning',
              setupStage: 'init_missing',
              summary: 'One safe setup change is recommended.',
              checks: [{ title: 'Base Setup', status: 'ready', detail: 'Completed.' }],
              recommendedActions: [{
                id: 'enable_capability_main',
                kind: 'safe',
                title: 'Enable Main Capabilities',
                description: 'Turn on the main capability switch.',
                action: 'set_capability_main',
                params: { enabled: true }
              }],
              manualActions: [],
              state: {
                llm: { configured: true, provider: 'openai', model: 'gpt-5.2-codex' },
                capabilities: {
                  mainEnabled: true,
                  groupsConfig: [
                    { id: 'web', name: 'Web', enabled: true, icon: '🌐' },
                    { id: 'files', name: 'Files', enabled: true, mode: 'read', modes: { off: [], read: ['read_file'], full: ['read_file', 'write_file'] } },
                    { id: 'terminal', name: 'Terminal', enabled: false, mode: 'off', modes: { off: [], workspace: ['run_command'], system: ['run_command'] } },
                    { id: 'memory', name: 'Memory', enabled: false, icon: '🧠' }
                  ]
                },
                companion: { running: false, enabled: false },
                curatedPlugins: [
                  { id: 'searxng-search', name: 'SearXNG Search', enabled: false }
                ],
                presets: {
                  chat_only: { label: 'Chat Only', icon: '💬', description: 'Just chat.' },
                  developer: { label: 'Developer', icon: '💻', description: 'Dev workflow.' }
                }
              }
            };
          },
          async runAction() {
            return {
              success: true,
              result: { success: true },
              assessment: await this.getAssessment()
            };
          },
          async dismissAction() {
            return { success: true };
          }
        }
      });
      const uiPluginManager = new PluginManager(uiContainer);
      await uiPluginManager.initialize();
      await uiPluginManager.enablePlugin('agent-setup-superagent');

      const agentInfo = {
        id: 99,
        slug: 'setup-superagent',
        name: 'Setup Superagent',
        folderPath: tempDir
      };
      const pluginUi = await uiPluginManager.getAgentChatUI(agentInfo, {
        sessionId: 'setup-session',
        uiMode: 'plugin'
      });
      assert.ok(pluginUi, 'Expected setup plugin UI to resolve in plugin mode');
      assert.includes(pluginUi.html, 'Setup Superagent', 'Expected setup plugin UI to render title');
      assert.includes(pluginUi.html, 'Guided Setup', 'Expected setup plugin UI to present a wizard-like guided setup shell');
      assert.includes(pluginUi.html, 'Current Step', 'Expected setup plugin UI to highlight the active setup step');
      assert.includes(pluginUi.html, 'data-agent-ui-action="open-workspace-tab"', 'Expected setup plugin UI to open manual setup surfaces');
      assert.includes(pluginUi.html, 'Quick Toggles', 'Expected setup plugin UI to render quick toggles section');
      assert.includes(pluginUi.html, 'data-agent-ui-action="toggle-group"', 'Expected setup plugin UI to have toggle buttons');
      assert.includes(pluginUi.html, 'data-agent-ui-action="set-files-mode"', 'Expected setup plugin UI to have files mode selector');
      assert.includes(pluginUi.html, 'data-agent-ui-action="set-terminal-mode"', 'Expected setup plugin UI to have terminal mode selector');
      assert.includes(pluginUi.css, 'setup-superagent-toggle', 'Expected setup plugin CSS to include toggle styles');

      const openModelSetup = await uiPluginManager.runAgentChatUIAction(
        agentInfo,
        'open-workspace-tab',
        { tab: 'api' },
        { sessionId: 'setup-session', uiMode: 'plugin' }
      );
      assert.equal(openModelSetup.success, true, 'Expected setup plugin workspace navigation action to succeed');
      assert.equal(openModelSetup.openSidebarTab, 'api', 'Expected setup plugin to request API tab navigation for model setup');

      // Test toggle-group action
      const toggleAction = await uiPluginManager.runAgentChatUIAction(
        agentInfo,
        'toggle-group',
        { groupId: 'web' },
        { sessionId: 'setup-session', uiMode: 'plugin' }
      );
      assert.equal(toggleAction.success, true, 'Expected toggle-group plugin action to succeed');
      assert.ok(toggleAction.html, 'Expected toggle-group to return updated HTML');

      // Test set-files-mode action
      const filesModeAction = await uiPluginManager.runAgentChatUIAction(
        agentInfo,
        'set-files-mode',
        { mode: 'full' },
        { sessionId: 'setup-session', uiMode: 'plugin' }
      );
      assert.equal(filesModeAction.success, true, 'Expected set-files-mode plugin action to succeed');

      // Test set-terminal-mode action
      const terminalModeAction = await uiPluginManager.runAgentChatUIAction(
        agentInfo,
        'set-terminal-mode',
        { mode: 'workspace' },
        { sessionId: 'setup-session', uiMode: 'plugin' }
      );
      assert.equal(terminalModeAction.success, true, 'Expected set-terminal-mode plugin action to succeed');

      const classicUi = await uiPluginManager.getAgentChatUI(agentInfo, {
        sessionId: 'setup-session',
        uiMode: 'no_ui'
      });
      assert.equal(classicUi, null, 'Expected no_ui mode to bypass setup plugin UI');

      // Test sidebar widget was registered
      const widgets = uiPluginManager.getSidebarWidgets();
      const healthWidget = widgets.find(w => w.id === 'setup-health');
      assert.ok(healthWidget, 'Expected setup-health sidebar widget to be registered');
    } finally {
      require('fs').rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
