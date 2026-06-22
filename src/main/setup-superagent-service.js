const {
  getProviderConnectionConfig
} = require('./llm-config');
const { resolveEasyConnectHost } = require('./companion-network-utils');
const { configureCompanionServer, attachCompanionRelays } = require('./companion/companion-backend-dispatch');
const CompanionApiServer = require('./companion/companion-api-server');
const CompanionAuth = require('./companion-auth');
const { RemoteGatewayManager } = require('./companion/remote-gateway-manager');
const { quickSetupPlugin } = require('./plugin-setup-service');

const DISMISSED_ACTIONS_KEY = 'setupSuperagent.dismissedActions';
const CURATED_PLUGIN_IDS = ['searxng-search', 'http-tts-bridge'];

const SETUP_PRESETS = {
  chat_only: {
    label: 'Chat Only',
    icon: '💬',
    description: 'Just chat, no tools. Lightweight and private.',
    mainEnabled: true,
    groups: { web: false, files: 'off', terminal: 'off', unsafe: false, ports: false, memory: false },
    companion: false,
    plugins: []
  },
  research: {
    label: 'Research',
    icon: '🔍',
    description: 'Web research + file notes. Great for learning and collecting information.',
    mainEnabled: true,
    groups: { web: true, files: 'read', terminal: 'off', unsafe: false, ports: false, memory: true },
    companion: false,
    plugins: ['searxng-search']
  },
  developer: {
    label: 'Developer',
    icon: '💻',
    description: 'Code, terminal, files. Full development workflow.',
    mainEnabled: true,
    groups: { web: true, files: 'full', terminal: 'workspace', unsafe: false, ports: false, memory: true },
    companion: false,
    plugins: ['searxng-search']
  },
  power_user: {
    label: 'Power User',
    icon: '⚡',
    description: 'Everything on. Full capability suite with companion.',
    mainEnabled: true,
    groups: { web: true, files: 'full', terminal: 'system', unsafe: false, ports: true, memory: true },
    companion: true,
    plugins: ['searxng-search']
  }
};

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeBool(value) {
  return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
}

function buildCheck(id, title, status, detail, extra = {}) {
  return { id, title, status, detail, ...extra };
}

function countEnabledPlugins(curatedPlugins = []) {
  return curatedPlugins.filter((plugin) => plugin && plugin.enabled === true).length;
}

class SetupSuperagentService {
  constructor(container, options = {}) {
    this.container = container;
    this.db = options.db || container.get('db');
    this.sessionInitManager = options.sessionInitManager || container.optional('sessionInitManager');
    this.capabilityManager = options.capabilityManager || container.optional('capabilityManager');
    this.windowManager = options.windowManager || container.optional('windowManager');
    this.eventBus = options.eventBus || container.optional('eventBus');
  }

  async getAssessment(options = {}) {
    const maxRecommendations = Math.max(1, Math.min(2, Number(options.maxRecommendations) || 2));
    const dismissed = options.includeDismissed === true ? [] : await this.getDismissedActionIds();
    const state = await this.readCurrentState();
    const llmConfigured = state.llm.configured === true;
    const baseinitCompleted = state.baseinit.completed === true;
    const mainEnabled = state.capabilities.mainEnabled === true;
    const looksUsed = this.looksLikeExistingUser(state);

    const checks = [
      buildCheck(
        'baseinit',
        'Base Setup',
        baseinitCompleted ? 'ready' : 'needs_action',
        baseinitCompleted
          ? `Completed ${state.baseinit.timestamp ? `at ${state.baseinit.timestamp}` : 'previously'}.`
          : 'Initial setup has not been completed yet.'
      ),
      buildCheck(
        'llm',
        'LLM Provider',
        llmConfigured ? 'ready' : 'manual',
        llmConfigured
          ? `${state.llm.provider} / ${state.llm.model}`
          : 'Provider or model is not configured yet.'
      ),
      buildCheck(
        'capabilities',
        'Capabilities',
        mainEnabled ? 'ready' : 'needs_action',
        mainEnabled
          ? `Main switch is on. Enabled groups: ${state.capabilities.enabledGroups.join(', ') || 'none'}.`
          : 'Main capability switch is off, so tools are unavailable.'
      ),
      buildCheck(
        'companion',
        'Companion',
        state.companion.running ? 'ready' : (state.companion.enabled ? 'partial' : 'needs_action'),
        state.companion.running
          ? `${state.companion.host}:${state.companion.port} is live.`
          : (state.companion.enabled
            ? 'Companion is enabled in settings but not currently running.'
            : 'Companion is disabled.')
      ),
      buildCheck(
        'plugins',
        'Curated Plugins',
        state.curatedPlugins.some((plugin) => plugin.enabled) ? 'ready' : 'optional',
        state.curatedPlugins.map((plugin) => `${plugin.name}: ${plugin.enabled ? 'enabled' : 'disabled'}`).join(' | ')
      )
    ];

    const recommendedActions = [];
    const manualActions = [];

    const pushRecommended = (action) => {
      if (!action) return;
      if (dismissed.includes(action.id)) return;
      if (recommendedActions.some((entry) => entry.id === action.id)) return;
      recommendedActions.push(action);
    };

    const pushManual = (action) => {
      if (!action) return;
      if (manualActions.some((entry) => entry.id === action.id)) return;
      manualActions.push(action);
    };

    if (!baseinitCompleted) {
      pushRecommended(this.buildAction('run_baseinit'));
    }

    if (!llmConfigured) {
      pushManual(this.buildAction('configure_llm'));
    }

    if (llmConfigured && !mainEnabled) {
      pushRecommended(this.buildAction('enable_capability_main'));
    }

    if (llmConfigured && !state.companion.enabled && baseinitCompleted) {
      pushRecommended(this.buildAction('enable_companion'));
    }

    const searxngPlugin = state.curatedPlugins.find((plugin) => plugin.id === 'searxng-search');
    const webGroupEnabled = state.capabilities.enabledGroups.includes('web');
    if (llmConfigured && baseinitCompleted && !searxngPlugin?.enabled && webGroupEnabled) {
      pushRecommended(this.buildAction('quick_setup_searxng'));
    }

    if (state.capabilities.enabledGroups.includes('web') === false && llmConfigured) {
      pushRecommended(this.buildAction('enable_web_capability'));
    }

    const actionableCount = recommendedActions.length + manualActions.length;
    const userProfile = looksUsed ? 'returning' : 'fresh';
    let setupStage = 'ready';
    if (!baseinitCompleted && llmConfigured) {
      setupStage = 'init_missing';
    } else if (!llmConfigured) {
      setupStage = 'configuration_missing';
    } else if (actionableCount > 0) {
      setupStage = 'tuning_available';
    }

    let userMode = 'advanced';
    if (setupStage === 'configuration_missing' && userProfile === 'fresh') {
      userMode = 'new';
    } else if (setupStage !== 'ready') {
      userMode = 'partial';
    }

    return {
      generatedAt: new Date().toISOString(),
      userMode,
      userProfile,
      setupStage,
      summary: this.buildSummary({
        userMode,
        userProfile,
        setupStage,
        state,
        recommendedActions,
        manualActions
      }),
      checks,
      recommendedActions: recommendedActions.slice(0, maxRecommendations),
      manualActions,
      dismissedActionIds: dismissed,
      state
    };
  }

  looksLikeExistingUser(state) {
    const llmConfigured = state.llm?.configured === true;
    const mainEnabled = state.capabilities?.mainEnabled === true;
    const enabledGroups = Array.isArray(state.capabilities?.enabledGroups)
      ? state.capabilities.enabledGroups.length
      : 0;
    const companionRunning = state.companion?.running === true;
    const companionEnabled = state.companion?.enabled === true;
    const enabledCuratedPlugins = countEnabledPlugins(state.curatedPlugins || []);
    return llmConfigured || mainEnabled || enabledGroups > 0 || companionRunning || companionEnabled || enabledCuratedPlugins > 0;
  }

  buildSummary({ userMode, userProfile, setupStage, state, recommendedActions, manualActions }) {
    if (setupStage === 'configuration_missing') {
      if (userProfile === 'fresh') {
        return 'This looks like a fresh setup. Configure an LLM provider first, then finish the remaining setup steps.';
      }
      return 'This looks like an existing install with missing core model configuration. Restore the LLM provider first.';
    }
    if (setupStage === 'init_missing') {
      return 'This looks like an existing setup, but BaseInit was never completed or never recorded. Run it once to normalize the environment.';
    }
    if (userMode === 'new') {
      return 'This setup is still in onboarding. Complete the first core setup steps before optional enhancements.';
    }
    if (recommendedActions.length > 0) {
      return `This setup is usable. Recommended next change: ${recommendedActions[0].title}.`;
    }
    if (manualActions.length > 0) {
      return `This setup is mostly ready. Remaining manual step: ${manualActions[0].title}.`;
    }
    return 'This setup looks advanced and ready. No immediate core setup changes are required.';
  }

  async readCurrentState() {
    const [
      baseinitCompleted,
      baseinitTimestamp,
      provider,
      model,
      sessionInit,
      capabilityState,
      toolStates,
      companionStatus,
      curatedPlugins
    ] = await Promise.all([
      this.db.getSetting('baseinit.completed'),
      this.db.getSetting('baseinit.timestamp'),
      this.db.getSetting('llm.provider'),
      this.db.getSetting('llm.model'),
      this.sessionInitManager?.detectStartType
        ? this.sessionInitManager.detectStartType(this.container.optional('memoryDaemon')?.running === true).catch(() => null)
        : null,
      Promise.resolve(this.capabilityManager?.getState ? this.capabilityManager.getState() : null),
      typeof this.db.getToolStates === 'function' ? this.db.getToolStates().catch(() => ({})) : {},
      this.getCompanionStatus(),
      this.getCuratedPluginState()
    ]);

    const normalizedProvider = String(provider || '').trim();
    const normalizedModel = String(model || '').trim();
    const connection = normalizedProvider
      ? await getProviderConnectionConfig(this.db, normalizedProvider).catch(() => ({}))
      : {};

    const enabledGroups = [];
    for (const [groupId, value] of Object.entries(capabilityState?.groups || {})) {
      if (typeof value === 'boolean' ? value : String(value || '') !== 'off') {
        enabledGroups.push(groupId);
      }
    }

    const groupsConfig = this.capabilityManager?.getGroupsConfig
      ? this.capabilityManager.getGroupsConfig()
      : [];

    return {
      baseinit: {
        completed: normalizeBool(baseinitCompleted),
        timestamp: baseinitTimestamp || '',
        coldStart: sessionInit || null
      },
      llm: {
        configured: Boolean(normalizedProvider && normalizedModel),
        provider: normalizedProvider || '',
        model: normalizedModel || '',
        connectionConfigured: Object.keys(connection || {}).length > 0,
        connection
      },
      capabilities: {
        mainEnabled: capabilityState?.mainEnabled === true,
        enabledGroups,
        groupsConfig,
        activeToolCount: Number(capabilityState?.activeToolCount || 0),
        toolStates: toolStates || {}
      },
      companion: companionStatus,
      curatedPlugins,
      presets: SETUP_PRESETS,
      appliedPreset: null
    };
  }

  async getCuratedPluginState() {
    const pluginManager = this.container.optional('pluginManager');
    if (!pluginManager?.listPlugins) {
      return CURATED_PLUGIN_IDS.map((id) => ({
        id,
        name: id,
        enabled: false,
        status: 'unavailable',
        config: {}
      }));
    }

    const plugins = pluginManager.listPlugins();
    return Promise.all(CURATED_PLUGIN_IDS.map(async (pluginId) => {
      const plugin = plugins.find((entry) => entry.id === pluginId);
      return {
        id: pluginId,
        name: plugin?.name || pluginId,
        enabled: plugin?.status === 'enabled',
        status: plugin?.status || 'disabled',
        visibleInSidebar: plugin?.visibleInSidebar !== false,
        config: pluginManager.getPluginConfig ? await pluginManager.getPluginConfig(pluginId) : {}
      };
    }));
  }

  async getCompanionStatus() {
    const enabled = normalizeBool(await this.db.getSetting('companion.enabled'));
    const host = String(await this.db.getSetting('companion.host') || '0.0.0.0');
    const port = Number(await this.db.getSetting('companion.port')) || 8790;
    const devices = parseJsonArray(await this.db.getSetting('companion.devices'));
    const companionServer = this.container.optional('companionServer');
    return {
      enabled,
      running: Boolean(companionServer?.server),
      host,
      port,
      pairedDevices: devices.length,
      connectedDevices: Number(companionServer?._wsClients?.size || 0) + Number(companionServer?._remoteWsClients?.size || 0)
    };
  }

  buildAction(id) {
    const catalog = {
      run_baseinit: {
        id,
        kind: 'safe',
        title: 'Run BaseInit',
        description: 'Initialize the base runtime checks and enable background services.',
        action: 'run_baseinit',
        params: {}
      },
      configure_llm: {
        id,
        kind: 'manual',
        title: 'Configure LLM Provider',
        description: 'Open the API settings and provide the provider/model details manually.',
        action: 'configure_llm',
        params: {}
      },
      enable_capability_main: {
        id,
        kind: 'safe',
        title: 'Enable Main Capabilities',
        description: 'Turn on the main capability switch so tools are available.',
        action: 'set_capability_main',
        params: { enabled: true }
      },
      enable_web_capability: {
        id,
        kind: 'safe',
        title: 'Enable Web Capability',
        description: 'Turn on the web capability group for search and fetch tools.',
        action: 'set_capability_group',
        params: { groupId: 'web', enabled: true }
      },
      enable_companion: {
        id,
        kind: 'safe',
        title: 'Enable Companion',
        description: 'Start the companion server with the saved or default host and port.',
        action: 'enable_companion',
        params: {}
      },
      quick_setup_searxng: {
        id,
        kind: 'safe',
        title: 'Quick Setup SearXNG',
        description: 'Enable the bundled SearXNG plugin for lightweight web search support.',
        action: 'plugin_quick_setup',
        params: { pluginName: 'searxng' }
      }
    };
    return catalog[id] ? { ...catalog[id] } : null;
  }

  async runAction(input = {}) {
    const action = String(input.action || '').trim();
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    if (!action) {
      throw new Error('Setup action is required');
    }

    let result;
    switch (action) {
      case 'run_baseinit':
        result = await this.runBaseInit();
        break;
      case 'set_capability_main':
        result = await this.setCapabilityMain(params.enabled);
        break;
      case 'set_capability_group':
        result = await this.setCapabilityGroup(params.groupId, params.enabled);
        break;
      case 'set_files_mode':
        result = await this.setFilesMode(params.mode);
        break;
      case 'set_terminal_mode':
        result = await this.setTerminalMode(params.mode);
        break;
      case 'set_tool_active':
        result = await this.setToolActive(params.toolName, params.active);
        break;
      case 'plugin_enable':
        result = await this.enablePlugin(params.pluginId);
        break;
      case 'plugin_quick_setup':
        result = await this.quickSetupPlugin(params.pluginName);
        break;
      case 'plugin_set_config':
        result = await this.setPluginConfig(params.pluginId, params.key, params.value);
        break;
      case 'enable_companion':
        result = await this.enableCompanion(params);
        break;
      case 'apply_preset':
        result = await this.applyPreset(params.preset || params.presetName);
        break;
      case 'dismiss_action':
        result = await this.dismissAction(String(params.actionId || input.actionId || '').trim());
        break;
      case 'configure_llm':
        result = {
          success: false,
          manual: true,
          error: 'LLM configuration requires manual input in the provider settings UI.'
        };
        break;
      default:
        throw new Error(`Unsupported setup action "${action}"`);
    }

    return {
      success: result?.success !== false,
      action,
      result,
      assessment: await this.getAssessment()
    };
  }

  async dismissAction(actionId) {
    const normalized = String(actionId || '').trim();
    if (!normalized) return { success: false, error: 'actionId is required' };
    const current = await this.getDismissedActionIds();
    if (!current.includes(normalized)) {
      current.push(normalized);
      await this.db.saveSetting(DISMISSED_ACTIONS_KEY, JSON.stringify(current));
    }
    return { success: true, actionId: normalized };
  }

  async getDismissedActionIds() {
    const raw = await this.db.getSetting(DISMISSED_ACTIONS_KEY);
    return parseJsonArray(raw).map((value) => String(value || '').trim()).filter(Boolean);
  }

  async runBaseInit() {
    const completed = normalizeBool(await this.db.getSetting('baseinit.completed'));
    if (completed) {
      return { success: true, alreadyCompleted: true };
    }
    const report = await this.sessionInitManager?.buildBaseInitReport?.();
    const memoryDaemon = this.container.optional('memoryDaemon');
    const workflowScheduler = this.container.optional('workflowScheduler');
    if (memoryDaemon && !memoryDaemon.running) await memoryDaemon.start();
    if (workflowScheduler && !workflowScheduler.running) await workflowScheduler.start();
    await this.db.saveSetting('baseinit.completed', 'true');
    await this.db.saveSetting('baseinit.timestamp', new Date().toISOString());
    await this.db.saveSetting('baseinit.daemonEnabled', 'true');
    this.eventBus?.publish?.('init:baseinit-complete', { report });
    return { success: true, report: report || null };
  }

  async setCapabilityMain(enabled) {
    if (!this.capabilityManager?.setMainEnabled) {
      return { success: false, error: 'Capability manager unavailable' };
    }
    const value = this.capabilityManager.setMainEnabled(enabled === true);
    this.windowManager?.send?.('capability-update', this.capabilityManager.getState());
    return { success: true, mainEnabled: value };
  }

  async setCapabilityGroup(groupId, enabled) {
    const normalized = String(groupId || '').trim();
    if (!normalized) return { success: false, error: 'groupId is required' };
    if (!this.capabilityManager?.setGroupEnabled) {
      return { success: false, error: 'Capability manager unavailable' };
    }
    const value = this.capabilityManager.setGroupEnabled(normalized, enabled === true);
    this.windowManager?.send?.('capability-update', this.capabilityManager.getState());
    return { success: value === true, groupId: normalized, enabled: enabled === true };
  }

  async setToolActive(toolName, active) {
    const normalized = String(toolName || '').trim();
    if (!normalized) return { success: false, error: 'toolName is required' };
    if (typeof this.db.setToolActive !== 'function') {
      return { success: false, error: 'Tool state storage is unavailable' };
    }
    await this.db.setToolActive(normalized, active === true);
    const mcpServer = this.container.optional('mcpServer');
    if (mcpServer?.setToolActiveState) {
      await mcpServer.setToolActiveState(normalized, active === true);
    }
    if (active === true && this.capabilityManager?.getGroupForTool) {
      const groupId = this.capabilityManager.getGroupForTool(normalized);
      if (groupId && !this.capabilityManager.isGroupEnabled(groupId)) {
        this.capabilityManager.setGroupEnabled(groupId, true);
      }
      this.windowManager?.send?.('capability-update', this.capabilityManager.getState());
    }
    return { success: true, toolName: normalized, active: active === true };
  }

  async setFilesMode(mode) {
    const normalized = String(mode || '').trim();
    if (!['off', 'read', 'full'].includes(normalized)) {
      return { success: false, error: 'Invalid files mode. Use: off, read, full' };
    }
    if (!this.capabilityManager?.setFilesMode) {
      return { success: false, error: 'Capability manager unavailable' };
    }
    const value = this.capabilityManager.setFilesMode(normalized);
    this.windowManager?.send?.('capability-update', this.capabilityManager.getState());
    return { success: true, mode: value };
  }

  async setTerminalMode(mode) {
    const normalized = String(mode || '').trim();
    if (!['off', 'workspace', 'system'].includes(normalized)) {
      return { success: false, error: 'Invalid terminal mode. Use: off, workspace, system' };
    }
    if (!this.capabilityManager?.setTerminalMode) {
      return { success: false, error: 'Capability manager unavailable' };
    }
    const value = this.capabilityManager.setTerminalMode(normalized);
    this.windowManager?.send?.('capability-update', this.capabilityManager.getState());
    return { success: true, mode: value };
  }

  async applyPreset(presetName) {
    const normalized = String(presetName || '').trim().toLowerCase();
    const preset = SETUP_PRESETS[normalized];
    if (!preset) {
      const available = Object.keys(SETUP_PRESETS).join(', ');
      return { success: false, error: `Unknown preset "${normalized}". Available: ${available}` };
    }

    const applied = [];

    // 1. Main switch
    if (this.capabilityManager?.setMainEnabled) {
      this.capabilityManager.setMainEnabled(preset.mainEnabled);
      applied.push('mainEnabled');
    }

    // 2. Capability groups
    for (const [groupId, value] of Object.entries(preset.groups || {})) {
      if (groupId === 'files' && this.capabilityManager?.setFilesMode) {
        this.capabilityManager.setFilesMode(value);
        applied.push(`files:${value}`);
      } else if (groupId === 'terminal' && this.capabilityManager?.setTerminalMode) {
        this.capabilityManager.setTerminalMode(value);
        applied.push(`terminal:${value}`);
      } else if (this.capabilityManager?.setGroupEnabled) {
        this.capabilityManager.setGroupEnabled(groupId, value === true);
        applied.push(`${groupId}:${value}`);
      }
    }

    // 3. Companion
    if (preset.companion === true) {
      const companionResult = await this.enableCompanion({});
      if (companionResult.success) applied.push('companion');
    }

    // 4. Plugins
    for (const pluginName of (preset.plugins || [])) {
      try {
        await this.quickSetupPlugin(pluginName);
        applied.push(`plugin:${pluginName}`);
      } catch (_) {
        // Plugin setup is best-effort
      }
    }

    this.windowManager?.send?.('capability-update', this.capabilityManager?.getState?.());
    await this.db.saveSetting('setupSuperagent.appliedPreset', normalized);

    return {
      success: true,
      preset: normalized,
      label: preset.label,
      applied
    };
  }

  async quickToggle(target) {
    const normalized = String(target || '').trim().toLowerCase();
    if (!normalized) return { success: false, error: 'target is required' };

    // Main switch
    if (normalized === 'main' || normalized === 'capabilities') {
      const current = this.capabilityManager?.isMainEnabled?.() === true;
      return this.setCapabilityMain(!current);
    }

    // Companion
    if (normalized === 'companion') {
      const status = await this.getCompanionStatus();
      if (status.running) {
        return { success: true, note: 'Companion is already running. Stopping requires manual action.' };
      }
      return this.enableCompanion({});
    }

    // Curated plugins
    if (normalized.startsWith('plugin:')) {
      const pluginName = normalized.slice(7);
      return this.quickSetupPlugin(pluginName);
    }

    // Capability groups
    if (this.capabilityManager?.isGroupEnabled) {
      const current = this.capabilityManager.isGroupEnabled(normalized);
      return this.setCapabilityGroup(normalized, !current);
    }

    return { success: false, error: `Unknown toggle target "${normalized}"` };
  }

  async quickCheck(target) {
    const normalized = String(target || '').trim().toLowerCase();
    if (!normalized || normalized === 'all') {
      return { success: true, result: await this.readCurrentState() };
    }
    if (normalized === 'companion') {
      return { success: true, result: await this.getCompanionStatus() };
    }
    if (normalized === 'llm' || normalized === 'provider') {
      const provider = String(await this.db.getSetting('llm.provider') || '').trim();
      const model = String(await this.db.getSetting('llm.model') || '').trim();
      return { success: true, result: { configured: Boolean(provider && model), provider, model } };
    }
    if (normalized === 'capabilities' || normalized === 'tools') {
      const state = this.capabilityManager?.getState?.() || {};
      return { success: true, result: state };
    }
    if (normalized === 'plugins') {
      return { success: true, result: await this.getCuratedPluginState() };
    }
    return { success: false, error: `Unknown check target "${normalized}"` };
  }

  async enablePlugin(pluginId) {
    const normalized = String(pluginId || '').trim();
    const pluginManager = this.container.optional('pluginManager');
    if (!normalized) return { success: false, error: 'pluginId is required' };
    if (!pluginManager?.enablePlugin) return { success: false, error: 'Plugin manager unavailable' };
    await pluginManager.enablePlugin(normalized, { persistStatus: true });
    this.windowManager?.send?.('plugins:state-changed', {
      pluginId: normalized,
      source: 'setup-superagent',
      at: new Date().toISOString()
    });
    return { success: true, pluginId: normalized };
  }

  async quickSetupPlugin(pluginName) {
    const normalized = String(pluginName || '').trim();
    const pluginManager = this.container.optional('pluginManager');
    const runtimePaths = this.container.optional('runtimePaths');
    if (!normalized) return { success: false, error: 'pluginName is required' };
    if (!pluginManager || !runtimePaths?.pluginsDir) {
      return { success: false, error: 'Plugin system not ready' };
    }
    const result = await quickSetupPlugin({
      pluginName: normalized,
      pluginManager,
      pluginsDir: runtimePaths.pluginsDir
    });
    this.windowManager?.send?.('plugins:state-changed', {
      pluginId: result.pluginId,
      source: 'setup-superagent',
      at: new Date().toISOString()
    });
    return { success: true, ...result };
  }

  async setPluginConfig(pluginId, key, value) {
    const pluginManager = this.container.optional('pluginManager');
    if (!pluginManager?.setPluginConfig) return { success: false, error: 'Plugin manager unavailable' };
    await pluginManager.setPluginConfig(String(pluginId || '').trim(), String(key || '').trim(), value);
    this.windowManager?.send?.('plugins:state-changed', {
      pluginId: String(pluginId || '').trim(),
      source: 'setup-superagent',
      at: new Date().toISOString()
    });
    return { success: true, pluginId, key, value };
  }

  getCompanionAuth() {
    const existing = this.container.optional('companionAuth');
    if (existing) return existing;
    const auth = new CompanionAuth(this.db);
    this.container.replace('companionAuth', auth);
    return auth;
  }

  getRemoteGatewayManager() {
    let manager = this.container.optional('remoteGatewayManager');
    if (manager) return manager;
    manager = new RemoteGatewayManager({
      db: this.db,
      getCompanionServer: () => this.container.optional('companionServer')
    });
    this.container.replace('remoteGatewayManager', manager);
    return manager;
  }

  async enableCompanion(params = {}) {
    const host = resolveEasyConnectHost(params.host || await this.db.getSetting('companion.host') || '0.0.0.0');
    const port = Number(params.port || await this.db.getSetting('companion.port')) || 8790;
    const existing = this.container.optional('companionServer');
    if (existing?.server) {
      return { success: true, alreadyRunning: true, status: await this.getCompanionStatus() };
    }

    const companionServer = new CompanionApiServer({
      host,
      port,
      tlsManager: this.container.optional('companionTlsManager')
    });
    companionServer.setRemoteGatewayManager(this.getRemoteGatewayManager());
    configureCompanionServer({
      companionServer,
      container: this.container,
      db: this.db,
      companionAuth: this.getCompanionAuth()
    });
    attachCompanionRelays({
      companionServer,
      eventBus: this.eventBus,
      windowManager: this.windowManager,
      getCompanionServer: () => this.container.optional('companionServer')
    });

    await companionServer.start();
    this.container.replace('companionServer', companionServer);
    await this.db.saveSetting('companion.host', host);
    await this.db.saveSetting('companion.port', String(port));
    await this.db.saveSetting('companion.enabled', 'true');
    return {
      success: true,
      status: await this.getCompanionStatus()
    };
  }
}

module.exports = { SetupSuperagentService, parseJsonObject };
