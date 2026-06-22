const { EventEmitter } = require('events');
const { PluginConfigStore } = require('./plugin-config-store');
const PluginAgentUiService = require('./plugin-agent-ui-service');
const { RuntimePolicy } = require('./runtime-policy');
const { buildRuntimePaths } = require('./runtime-paths');
const PluginProcessService = require('./plugin-process-service');
const { PluginDiscoveryService } = require('./plugin-discovery-service');
const { PluginModuleLoader } = require('./plugin-module-loader');
const PluginSummaryService = require('./plugin-summary-service');
const PluginStateStore = require('./plugin-state-store');

/**
 * PluginManager — Discovers, loads, and manages plugins.
 * 
 * Plugins live in agentin/plugins/<id>/plugin.json.
 * When enabled, their main.js is loaded and onEnable(context) is called.
 * Plugins register handlers via context.registerHandler() which delegates
 * to MCPServer.registerTool() — the existing mechanism.
 * 
 * When enabled, a knowledge item is auto-generated in agentin/knowledge/
 * describing the plugin's available handlers for LLM discovery.
 */
class PluginManager extends EventEmitter {
    constructor(container, options = {}) {
        super();
        this.container = container;
        this.db = container.get('db');
        this.mcpServer = container.get('mcpServer');
        this.capabilityManager = container.optional('capabilityManager');
        this.stateStore = options.stateStore || new PluginStateStore(this.db);
        this.configStore = new PluginConfigStore(this.db);
        this.agentUi = new PluginAgentUiService(this);
        this.runtimePolicy = options.runtimePolicy || container.optional('runtimePolicy') || new RuntimePolicy();
        this.pluginsDir = options.pluginsDir || buildRuntimePaths(options).pluginsDir;
        this.plugins = new Map(); // id -> { manifest, status, module, handlers[] }
        this.processService = options.processService || new PluginProcessService({ plugins: this.plugins });
        this.moduleLoader = options.moduleLoader || new PluginModuleLoader();
        this.summaryService = options.summaryService || new PluginSummaryService();
        this.discovery = options.discoveryService || new PluginDiscoveryService({
            db: this.db,
            pluginsDir: this.pluginsDir,
            stateStore: this.stateStore
        });
        this._ensureDir();
    }

    _ensureDir() {
        this.discovery.ensureDir();
    }

    // ==================== Discovery ====================

    async initialize(options = {}) {
        await this.scanPlugins();
        const cleanup = this._cleanupOrphanedPluginTools();
        if (cleanup.removed > 0) {
            console.warn(`[PluginManager] Removed ${cleanup.removed} stale plugin tool registration(s): ${cleanup.toolNames.join(', ')}`);
        }
        if (options.autoEnablePersisted !== false) {
            await this.enablePersistedPlugins();
        }
        const contract = this._validatePluginToolContracts();
        if (!contract.ok) {
            console.error('[PluginManager] Plugin contract validation failed:', contract.issues);
        }
        console.log(`[PluginManager] Initialized ${this.plugins.size} plugin(s)`);
    }

    async enablePersistedPlugins() {
        for (const [id, plugin] of this.plugins) {
            const shouldEnable = (this.stateStore.getStatus(id) || plugin.persistedStatus) === 'enabled';
            if (shouldEnable) {
                try {
                    await this.enablePlugin(id);
                } catch (e) {
                    console.error(`[PluginManager] Failed to auto-enable "${id}":`, e.message);
                    this._updateDbStatus(id, 'error', e.message);
                }
            }
        }
    }

    async scanPlugins(options = {}) {
        this.discovery.scanInto(this.plugins, options);
    }

    async rescanPlugins() {
        const before = new Set(this.plugins.keys());
        await this.scanPlugins({ preserveExisting: true });
        const added = [...this.plugins.keys()].filter(id => !before.has(id));
        return { added, total: this.plugins.size };
    }

    // ==================== Lifecycle ====================

    async enablePlugin(pluginId, options = {}) {
        const persistStatus = options.persistStatus !== false;
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status === 'enabled' && plugin.module && plugin.context) {
            if (persistStatus && plugin.persistedStatus !== 'enabled') {
                plugin.persistedStatus = 'enabled';
                this._updateDbStatus(pluginId, 'enabled');
            }
            return;
        }

        try {
            const pluginModule = this.moduleLoader.load(plugin);
            plugin.module = pluginModule;
            plugin.handlers = [];
            plugin.chatUIs = [];
            plugin.sidebarWidgets = [];

            // Build context for the plugin
            const context = this._buildPluginContext(pluginId, plugin);
            plugin.context = context;

            // Call onEnable
            if (typeof pluginModule.onEnable === 'function') {
                await pluginModule.onEnable(context);
            }
        } catch (error) {
            this._cleanupPluginHandlers(plugin);
            plugin.module = null;
            plugin.context = null;
            plugin.status = 'error';
            this._updateDbStatus(pluginId, 'error', error.message);
            throw error;
        }

        plugin.status = 'enabled';
        if (persistStatus) {
            plugin.persistedStatus = 'enabled';
            this._updateDbStatus(pluginId, 'enabled');
        }
        
        // Auto-generate knowledge item for this plugin
        await this._generatePluginKnowledge(pluginId, plugin);

        this.emit('plugin-enabled', { id: pluginId, handlers: plugin.handlers.map(h => h.name) });
        console.log(`[PluginManager] Enabled "${pluginId}" with ${plugin.handlers.length} handler(s)`);
    }

    async disablePlugin(pluginId, options = {}) {
        const persistStatus = options.persistStatus !== false;
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status !== 'enabled') return;

        // Call onDisable
        if (plugin.module && typeof plugin.module.onDisable === 'function') {
            try {
                await plugin.module.onDisable(plugin.context);
            } catch (e) {
                console.error(`[PluginManager] onDisable error for "${pluginId}":`, e.message);
            }
        }
        this._terminateManagedProcesses(plugin, `disable:${pluginId}`);

        this._cleanupPluginHandlers(plugin);
        plugin.status = 'disabled';
        plugin.module = null;
        plugin.context = null;
        if (persistStatus) {
            plugin.persistedStatus = 'disabled';
            this._updateDbStatus(pluginId, 'disabled');
        }

        this.emit('plugin-disabled', { id: pluginId });
        console.log(`[PluginManager] Disabled "${pluginId}"`);
    }

    // ==================== Plugin Context ====================

    _buildPluginContext(pluginId, plugin) {
        const self = this;
        const config = this._loadPluginConfig(pluginId, { includeSecrets: true });
        const manifestAgentScopes = this._resolveManifestAgentScopes(plugin.manifest);
        const connectorRuntime = this.container.optional('connectorRuntime');
        const setupSuperagentService = this.container.optional('setupSuperagentService');

        return {
            config,
            pluginId,
            pluginDir: plugin.dir,

            registerHandler(name, definition, handler) {
                self._assertPluginRuntime(plugin, 'plugin.handler.register', { handlerName: name });
                const toolName = `plugin_${pluginId.replace(/-/g, '_')}_${name}`;
                const definitionScope = self._normalizeScopeList(definition?.agentScope);
                const effectiveScope = definitionScope || manifestAgentScopes;
                
                self.mcpServer.registerTool(toolName, {
                    name: toolName,
                    description: `[Plugin: ${plugin.manifest.name}] ${definition.description || name}`,
                    userDescription: definition.description || name,
                    inputSchema: definition.inputSchema || { type: 'object' },
                    isPlugin: true,
                    pluginId,
                    privateSafe: definition.privateSafe === true || plugin.manifest.privateSafe === true,
                    ...(effectiveScope ? { agentScope: effectiveScope } : {})
                }, async (params, toolContext = {}) => {
                    try {
                        const enrichedParams = await self._enrichPluginHandlerParams(params, toolContext);
                        return await handler(enrichedParams, toolContext);
                    } catch (e) {
                        console.error(`[Plugin:${pluginId}] Handler "${name}" error:`, e.message);
                        throw e;
                    }
                });

                if (self.capabilityManager) {
                    // Plugin enablement is already an explicit user action.
                    self.capabilityManager.registerCustomTool(toolName, true);
                }

                // Track handler for cleanup on disable
                plugin.handlers.push({ name, toolName, definition });
                console.log(`[PluginManager] Registered handler: ${toolName}`);
            },

            registerChatUI(contribution) {
                self._assertPluginRuntime(plugin, 'plugin.chatui.register', {
                    title: contribution?.title || plugin.manifest.name
                });
                if (!contribution || typeof contribution !== 'object') {
                    throw new Error('registerChatUI requires a contribution object');
                }
                plugin.chatUIs.push({
                    title: contribution.title || plugin.manifest.name,
                    renderPanel: contribution.renderPanel || null,
                    html: contribution.html || '',
                    css: contribution.css || '',
                    actions: contribution.actions && typeof contribution.actions === 'object'
                        ? contribution.actions
                        : {},
                    onTabActivated: contribution.onTabActivated || null,
                    onTabDeactivated: contribution.onTabDeactivated || null
                });
                console.log(`[PluginManager] Registered chat UI for "${pluginId}"`);
            },

            registerSidebarWidget(contribution) {
                self._assertPluginRuntime(plugin, 'plugin.sidebar.register', {
                    title: contribution?.title || plugin.manifest.name
                });
                if (!contribution || typeof contribution !== 'object') {
                    throw new Error('registerSidebarWidget requires a contribution object');
                }
                const widget = {
                    id: contribution.id || `sidebar-${pluginId}-${(plugin.sidebarWidgets || []).length}`,
                    pluginId,
                    title: contribution.title || plugin.manifest.name,
                    html: contribution.html || '',
                    css: contribution.css || '',
                    chrome: contribution.chrome !== false,
                    renderPanel: contribution.renderPanel || null,
                    actions: contribution.actions && typeof contribution.actions === 'object'
                        ? contribution.actions
                        : {},
                    position: contribution.position || 'before-calendar'
                };
                const existingIndex = plugin.sidebarWidgets.findIndex(entry => entry.id === widget.id);
                if (existingIndex >= 0) {
                    plugin.sidebarWidgets[existingIndex] = widget;
                } else {
                    plugin.sidebarWidgets.push(widget);
                }
                self.emit('sidebar-widget-registered', { id: widget.id, pluginId });
                console.log(`[PluginManager] Registered sidebar widget "${widget.id}" for "${pluginId}"`);
            },

            log(message) {
                self._assertPluginRuntime(plugin, 'plugin.log');
                console.log(`[Plugin:${pluginId}] ${message}`);
            },

            getConfig(key) {
                self._assertPluginRuntime(plugin, 'plugin.config.read', { key });
                if (typeof key === 'undefined') {
                    return self._loadPluginConfig(pluginId, { includeSecrets: true });
                }
                return self.configStore.get(pluginId, plugin.manifest, key, { includeSecrets: true });
            },

            async setConfig(key, value) {
                self._assertPluginRuntime(plugin, 'plugin.config.write', { key });
                const result = await self.setPluginConfig(pluginId, key, value);
                if (!result?.preserved) {
                    config[key] = String(result?.value ?? value ?? '');
                }
            },

            registerManagedProcess(proc, metadata = {}) {
                self._assertPluginRuntime(plugin, 'plugin.process.manage', metadata);
                return self._registerManagedProcess(plugin, proc, metadata);
            },

            connectors: {
                async list() {
                    self._assertPluginRuntime(plugin, 'plugin.connector.list');
                    if (!connectorRuntime?.listConnectors) return [];
                    return connectorRuntime.listConnectors();
                },
                async start(name) {
                    self._assertPluginRuntime(plugin, 'plugin.connector.start', { connectorName: String(name || '') });
                    if (!connectorRuntime?.startConnector) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.startConnector(String(name || ''));
                },
                async stop(name) {
                    self._assertPluginRuntime(plugin, 'plugin.connector.stop', { connectorName: String(name || '') });
                    if (!connectorRuntime?.stopConnector) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.stopConnector(String(name || ''));
                },
                async getConfig(name) {
                    self._assertPluginRuntime(plugin, 'plugin.connector.config.read', { connectorName: String(name || '') });
                    if (!connectorRuntime?.getConfig) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.getConfig(String(name || ''), { includeSecrets: true });
                },
                async setConfig(name, key, value) {
                    self._assertPluginRuntime(plugin, 'plugin.connector.config.write', {
                        connectorName: String(name || ''),
                        key
                    });
                    if (!connectorRuntime?.setConfig) {
                        throw new Error('Connector runtime is unavailable');
                    }
                    return connectorRuntime.setConfig(
                        String(name || ''),
                        String(key || ''),
                        String(value == null ? '' : value)
                    );
                }
            },

            setupSuperagent: {
                async getAssessment(options = {}) {
                    self._assertPluginRuntime(plugin, 'plugin.setupsuperagent.read');
                    if (!setupSuperagentService?.getAssessment) {
                        throw new Error('Setup superagent service is unavailable');
                    }
                    return setupSuperagentService.getAssessment(options);
                },
                async runAction(input = {}) {
                    self._assertPluginRuntime(plugin, 'plugin.setupsuperagent.write', {
                        action: input?.action || ''
                    });
                    if (!setupSuperagentService?.runAction) {
                        throw new Error('Setup superagent service is unavailable');
                    }
                    return setupSuperagentService.runAction(input);
                },
                async dismissAction(actionId) {
                    self._assertPluginRuntime(plugin, 'plugin.setupsuperagent.write', { actionId });
                    if (!setupSuperagentService?.dismissAction) {
                        throw new Error('Setup superagent service is unavailable');
                    }
                    return setupSuperagentService.dismissAction(actionId);
                }
            }
        };
    }

    _assertPluginRuntime(plugin, action, metadata = {}) {
        if (!this.runtimePolicy?.assert) {
            return true;
        }
        return this.runtimePolicy.assert({
            principal: this.runtimePolicy.createPluginPrincipal
                ? this.runtimePolicy.createPluginPrincipal(plugin.manifest.id, plugin.manifest)
                : { type: 'plugin', id: `plugin:${plugin.manifest.id}`, profile: 'plugin-legacy' },
            action,
            resource: metadata.resource || plugin.dir,
            manifest: plugin.manifest,
            metadata: {
                pluginId: plugin.manifest.id,
                pluginDir: plugin.dir,
                ...metadata
            }
        });
    }

    // ==================== Knowledge Generation ====================

    async _generatePluginKnowledge(pluginId, plugin) {
        const knowledgeManager = this.container.optional('knowledgeManager');
        if (!knowledgeManager) return; // Knowledge system not yet initialized

        const manifest = plugin.manifest;
        const handlers = plugin.handlers;

        // Build knowledge content describing this plugin's handlers
        let content = `# Plugin: ${manifest.name}\n`;
        content += `Version: ${manifest.version || '0.0.0'}\n`;
        content += `Description: ${manifest.description || 'No description'}\n\n`;
        content += `## Available Handlers\n\n`;

        for (const handler of handlers) {
            content += `### ${handler.toolName}\n`;
            content += `${handler.definition.description || handler.name}\n`;
            if (handler.definition.inputSchema?.properties) {
                content += `Parameters:\n`;
                for (const [key, prop] of Object.entries(handler.definition.inputSchema.properties)) {
                    const required = (handler.definition.inputSchema.required || []).includes(key);
                    content += `  - ${key} (${prop.type})${required ? ' [REQUIRED]' : ''}: ${prop.description || ''}\n`;
                }
            }
            content += `\n`;
        }

        if (manifest.configSchema) {
            content += `## Configuration\n\n`;
            for (const [key, schema] of Object.entries(manifest.configSchema)) {
                content += `- ${key}: ${schema.description || schema.type}${schema.required ? ' [REQUIRED]' : ''}\n`;
            }
        }

        try {
            await knowledgeManager.createItem({
                title: `Plugin: ${manifest.name}`,
                content,
                category: 'plugins',
                tags: ['plugin', pluginId, 'auto-generated'],
                source: 'plugin-manager',
                confidence: 1.0,
                slug: `plugin-${pluginId}`
            });
        } catch (e) {
            // May already exist — update instead
            try {
                await knowledgeManager.updateItemContent(`plugin-${pluginId}`, content);
            } catch (e2) {
                console.error(`[PluginManager] Failed to generate knowledge for "${pluginId}":`, e2.message);
            }
        }
    }

    // ==================== Config ====================

    _loadPluginConfig(pluginId, options = {}) {
        const plugin = this.plugins.get(pluginId);
        return this.configStore.load(pluginId, plugin?.manifest || {}, options);
    }

    async setPluginConfig(pluginId, key, value, options = {}) {
        const plugin = this.plugins.get(pluginId);
        const result = this.configStore.set(pluginId, plugin?.manifest || {}, key, value);
        if (plugin?.context?.config && !result.preserved) {
            plugin.context.config[result.key] = String(result.value ?? '');
        }

        if (
            options?.notifyHook !== false
            && !result.preserved
            && plugin?.status === 'enabled'
            && plugin?.module
            && typeof plugin.module.onConfigChanged === 'function'
        ) {
            await plugin.module.onConfigChanged(String(result.key), String(result.value ?? ''), plugin.context);
        }
        return result;
    }

    async getPluginConfig(pluginId, options = {}) {
        return this._loadPluginConfig(pluginId, options);
    }

    setPluginSidebarVisible(pluginId, visible) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        plugin.visibleInSidebar = this.stateStore.setSidebarVisible(pluginId, visible);
        return { id: pluginId, visibleInSidebar: plugin.visibleInSidebar };
    }

    // ==================== State ====================

    _updateDbStatus(pluginId, status, error = null) {
        this.stateStore.updateStatus(pluginId, status, error);
    }

    _cleanupOrphanedPluginTools() {
        let removed = 0;
        const toolNames = [];
        for (const [toolName, tool] of this.mcpServer.tools) {
            const def = tool?.definition;
            if (!def?.isPlugin) continue;
            this.mcpServer.tools.delete(toolName);
            if (this.capabilityManager) {
                this.capabilityManager.unregisterCustomTool(toolName);
            }
            removed++;
            toolNames.push(toolName);
        }
        return { removed, toolNames };
    }

    _validatePluginToolContracts() {
        const issues = [];

        for (const [toolName, tool] of this.mcpServer.tools) {
            const def = tool?.definition;
            if (!def?.isPlugin) continue;
            const pluginId = def.pluginId;
            const plugin = this.plugins.get(pluginId);
            if (!plugin) {
                issues.push(`Tool ${toolName} references missing plugin "${pluginId}"`);
                continue;
            }
            if (plugin.status !== 'enabled') {
                issues.push(`Tool ${toolName} is registered but plugin "${pluginId}" is status="${plugin.status}"`);
                continue;
            }
            const listed = plugin.handlers.some(h => h.toolName === toolName);
            if (!listed) {
                issues.push(`Tool ${toolName} is registered but not tracked in plugin.handlers for "${pluginId}"`);
            }
        }

        for (const [pluginId, plugin] of this.plugins) {
            if (plugin.status !== 'enabled') continue;
            for (const handler of plugin.handlers) {
                if (!this.mcpServer.tools.has(handler.toolName)) {
                    issues.push(`Enabled plugin "${pluginId}" missing registered tool "${handler.toolName}"`);
                }
            }
        }

        return { ok: issues.length === 0, issues };
    }

    listPlugins() {
        return this.summaryService.list(this.plugins);
    }

    getAgentPlugin(agentSlug) {
        return this.agentUi.getAgentPlugin(agentSlug);
    }

    resolvePrimaryAgentChatUIPlugin(agentInfo, options = {}) {
        return this.agentUi.resolvePrimaryAgentChatUIPlugin(agentInfo, options);
    }

    getPluginsByCapability(capability, options = {}) {
        return this.agentUi.getPluginsByCapability(capability, options);
    }

    getAgentPlugins(agentSlug) {
        return this.agentUi.getAgentPlugins(agentSlug);
    }

    async getAgentChatUI(agentInfo, uiContext = {}) {
        return this.agentUi.getAgentChatUI(agentInfo, uiContext);
    }

    async runAgentChatUIAction(agentInfo, action, payload = {}, uiContext = {}) {
        return this.agentUi.runAgentChatUIAction(agentInfo, action, payload, uiContext);
    }

    async handleAgentChatUIEvent(agentInfo, eventName, payload = {}, uiContext = {}) {
        return this.agentUi.handleAgentChatUIEvent(agentInfo, eventName, payload, uiContext);
    }

    getPluginDetail(pluginId) {
        return this.summaryService.detail(this.plugins, pluginId, {
            loadConfig: id => this._loadPluginConfig(id)
        });
    }

    async getPluginSetupUI(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        const pluginModule = plugin.module || this.moduleLoader.load(plugin);
        const renderer = pluginModule.renderSetupUI || pluginModule.renderSetup || pluginModule.getSetupUI;
        if (typeof renderer !== 'function') return null;

        this._assertPluginRuntime(plugin, 'plugin.setup.render');
        const context = plugin.context || this._buildPluginContext(pluginId, plugin);
        const result = await renderer(context);
        if (!result || typeof result !== 'object') return null;

        return {
            html: String(result.html || ''),
            css: String(result.css || ''),
            mode: String(result.mode || 'plugin')
        };
    }

    async runPluginAction(pluginId, action, params = {}) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
        if (plugin.status !== 'enabled') throw new Error(`Plugin "${pluginId}" must be enabled to run actions`);
        if (!plugin.module) throw new Error(`Plugin "${pluginId}" module is not loaded`);
        this._assertPluginRuntime(plugin, 'plugin.action.run', { action });

        if (typeof plugin.module.runAction === 'function') {
            return plugin.module.runAction(action, params, plugin.context);
        }

        if (plugin.module.actions && typeof plugin.module.actions[action] === 'function') {
            return plugin.module.actions[action](params, plugin.context);
        }

        throw new Error(`Plugin "${pluginId}" does not implement action "${action}"`);
    }

    // ==================== Shutdown ====================

    async disableAll(options = {}) {
        for (const [id, plugin] of this.plugins) {
            if (plugin.status === 'enabled') {
                try {
                    await this.disablePlugin(id, options);
                } catch (e) {
                    console.error(`[PluginManager] Failed to disable "${id}":`, e.message);
                }
            }
        }
    }

    _registerManagedProcess(plugin, proc, metadata = {}) {
        return this.processService.register(plugin, proc, metadata);
    }

    _terminateManagedProcesses(plugin, reason = '') {
        this.processService.terminatePlugin(plugin, reason);
    }

    _terminateManagedProcess(proc, reason = '', metadata = {}) {
        this.processService.terminate(proc, reason, metadata);
    }

    _emergencyTerminateAllManagedProcesses(reason = 'emergency-exit') {
        this.processService.terminateAll(reason);
    }

    _cleanupPluginHandlers(plugin) {
        for (const handler of plugin.handlers) {
            this.mcpServer.tools.delete(handler.toolName);
            if (this.capabilityManager) {
                this.capabilityManager.unregisterCustomTool(handler.toolName);
            }
        }
        plugin.handlers = [];
        plugin.chatUIs = [];
        plugin.sidebarWidgets = [];
    }

    getSidebarWidgets() {
        const widgets = [];
        for (const [pluginId, plugin] of this.plugins) {
            if (plugin.status !== 'enabled') continue;
            for (const widget of (plugin.sidebarWidgets || [])) {
                widgets.push({
                    id: String(widget.id || ''),
                    pluginId: String(widget.pluginId || pluginId),
                    title: String(widget.title || plugin.manifest?.name || pluginId),
                    html: String(widget.html || ''),
                    css: String(widget.css || ''),
                    chrome: widget.chrome !== false,
                    position: String(widget.position || 'before-calendar'),
                    actionNames: Object.keys(widget.actions || {})
                });
            }
        }
        return widgets;
    }

    async runSidebarWidgetAction(widgetId, action, params = {}) {
        const normalizedWidgetId = String(widgetId || '').trim();
        const normalizedAction = String(action || '').trim();
        if (!normalizedWidgetId) throw new Error('Sidebar widget id is required');
        if (!normalizedAction) throw new Error('Sidebar widget action is required');

        for (const [pluginId, plugin] of this.plugins) {
            if (plugin.status !== 'enabled') continue;
            for (const widget of (plugin.sidebarWidgets || [])) {
                if (String(widget.id || '') !== normalizedWidgetId) continue;
                const handler = widget.actions?.[normalizedAction];
                if (typeof handler !== 'function') {
                    throw new Error(`Sidebar widget action "${normalizedAction}" not found`);
                }
                return handler({
                    widgetId: normalizedWidgetId,
                    pluginId,
                    payload: params || {},
                    context: plugin.context
                });
            }
        }

        throw new Error(`Sidebar widget "${normalizedWidgetId}" not found`);
    }

    _normalizeScopeList(rawScope) {
        if (!rawScope) return null;
        const values = Array.isArray(rawScope) ? rawScope : [rawScope];
        const normalized = values
            .map(value => String(value || '').trim())
            .filter(Boolean);
        if (normalized.length === 0 || normalized.includes('*')) {
            return null;
        }
        return Array.from(new Set(normalized));
    }

    async _enrichPluginHandlerParams(params = {}, toolContext = {}) {
        const context = toolContext?.context || {};
        if (params?._agentInfo || !context.agentId) return params;
        const agentManager = this.container.optional('agentManager');
        if (!agentManager?.getAgent || !agentManager?.resolveAgentFolder) return params;
        const agent = await agentManager.getAgent(context.agentId);
        if (!agent) return params;
        const folderPath = await agentManager.resolveAgentFolder(context.agentId);
        const slug = agentManager._getSafeFolderName
            ? agentManager._getSafeFolderName(agent.name)
            : String(agent.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return {
            ...params,
            _agentInfo: {
                ...agent,
                id: context.agentId,
                slug,
                folderPath
            }
        };
    }

    _resolveManifestAgentScopes(manifest = {}) {
        const scopes = [
            manifest.agentSlug,
            ...(Array.isArray(manifest.agentSlugs) ? manifest.agentSlugs : [])
        ];
        return this._normalizeScopeList(scopes);
    }
}

module.exports = PluginManager;
