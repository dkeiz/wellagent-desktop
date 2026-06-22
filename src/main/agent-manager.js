const fs = require('fs');
const path = require('path');
const { getDefaultAgents } = require('./agent-defaults');
const { buildRuntimePaths } = require('./runtime-paths');

const { invokeMultipleSubAgents } = require('./agent-batch-invoker');
const SubtaskRuntime = require('./subtask-runtime');
const AgentSubagentContractMethods = require('./agent-subagent-contract-methods');
const AgentSubagentRunMethods = require('./agent-subagent-run-methods');

const DEFAULT_AGENT_ADDITION_SYNC_KEY = 'agents.defaultAdditionsSynced.v4.book-comfy-setup-search';
const DEFAULT_AGENT_PLUGIN_SYNC_KEY = 'agents.defaultPluginsSynced.v3.book-comfy-setup';
const DEFAULT_AGENT_ADDITION_NAMES = ['Book Writer', 'ComfyUI Studio', 'Setup Superagent', 'Search Agent'];

class AgentManager {
    constructor(db, dispatcher, agentLoop, agentMemory, sessionWorkspace = null, chainController = null, eventBus = null, subtaskRuntime = null, options = {}) {
        this.db = db;
        this.dispatcher = dispatcher;
        this.agentLoop = agentLoop;
        this.agentMemory = agentMemory;
        this.sessionWorkspace = sessionWorkspace;
        this.chainController = chainController;
        this.eventBus = eventBus;
        this.subtaskRuntime = subtaskRuntime || new SubtaskRuntime(db, sessionWorkspace, eventBus);
        this.pendingSubtasks = new Map();
        this.activeSubtaskCounts = new Map();
        this.providerSubtaskQueues = new Map();
        this.cancelledSubtaskRuns = new Set();
        this.pluginManager = options.pluginManager || null;
        this.toolPermissionService = options.toolPermissionService || null;
        this.basePath = options.basePath || buildRuntimePaths(options).agentBasePath;
        this.maxDelegatedCompletionRetries = Math.max(0, Number(options.maxDelegatedCompletionRetries) || 2);
    }

    setPluginManager(pluginManager) {
        this.pluginManager = pluginManager;
    }

    setToolPermissionService(toolPermissionService) {
        this.toolPermissionService = toolPermissionService || null;
    }

    async initialize() {
        const dirs = [
            this.basePath,
            path.join(this.basePath, 'pro'),
            path.join(this.basePath, 'sub')
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        await this._migrateBackgroundDaemonOutOfPro();
        await this._migrateDefaultAgentNames();
        await this._seedDefaultAgents(await this.db.getAgents());
        await this._syncDefaultAgentAdditions();

        for (const agent of await this.db.getAgents()) {
            this._ensureAgentFolder(agent);
        }

        if (this.subtaskRuntime) {
            this.subtaskRuntime.initialize();
        }
    }

    async _seedDefaultAgents(existingAgents = null) {
        const seedSettingKey = 'agents.defaultsSeeded.v1';
        const seedState = await this.db.getSetting(seedSettingKey);
        if (String(seedState || '').toLowerCase() === 'true') {
            return;
        }

        const defaults = getDefaultAgents();
        const currentAgents = existingAgents || await this.db.getAgents();
        const existingNames = new Set(currentAgents
            .map(agent => String(agent.name || '').trim().toLowerCase()));
        let created = 0;

        for (const agentDef of defaults) {
            if (existingNames.has(String(agentDef.name).trim().toLowerCase())) {
                continue;
            }
            try {
                await this.createAgent(agentDef);
                created++;
            } catch (e) {
                console.error(`[AgentManager] Failed to seed agent "${agentDef.name}":`, e.message);
            }
        }

        await this.db.saveSetting(seedSettingKey, 'true');
        if (created > 0) {
            console.log(`[AgentManager] Seeded ${created} default agent(s)`);
        }
    }

    _parseAgentConfig(raw) {
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw !== 'string') return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    _defaultAgentAdditions() {
        const wanted = new Set(DEFAULT_AGENT_ADDITION_NAMES.map(name => name.toLowerCase()));
        return getDefaultAgents().filter(agent => wanted.has(String(agent.name || '').toLowerCase()));
    }

    _buildDefaultAgentRepair(existing, agentDef) {
        const patch = {};
        if (String(existing.type || '').toLowerCase() !== String(agentDef.type || 'pro').toLowerCase()) {
            patch.type = agentDef.type || 'pro';
        }
        if (!existing.icon && agentDef.icon) patch.icon = agentDef.icon;
        if (!existing.description && agentDef.description) patch.description = agentDef.description;
        if (!existing.system_prompt && agentDef.system_prompt) patch.system_prompt = agentDef.system_prompt;

        const existingConfig = this._parseAgentConfig(existing.config);
        const requiredPlugin = agentDef.config?.chat_ui_plugin;
        if (requiredPlugin && existingConfig.chat_ui_plugin !== requiredPlugin) {
            patch.config = { ...existingConfig, chat_ui_plugin: requiredPlugin };
        }

        const folderName = this._getSafeFolderName(agentDef.name);
        const folderPath = `${agentDef.type || 'pro'}/${folderName}`;
        if (!existing.folder_path) patch.folder_path = folderPath;

        return patch;
    }

    async _syncDefaultAgentAdditions() {
        const syncState = await this.db.getSetting(DEFAULT_AGENT_ADDITION_SYNC_KEY);
        if (String(syncState || '').toLowerCase() === 'true') return;

        const additions = this._defaultAgentAdditions();
        const agents = await this.db.getAgents();
        const existingByName = new Map(
            agents.map(agent => [String(agent.name || '').trim().toLowerCase(), agent])
        );

        let created = 0;
        let repaired = 0;
        let errors = 0;
        for (const agentDef of additions) {
            const key = String(agentDef.name || '').trim().toLowerCase();
            const existing = existingByName.get(key);
            if (!existing) {
                try {
                    await this.createAgent(agentDef);
                    created++;
                } catch (e) {
                    errors++;
                    console.error(`[AgentManager] Failed to add default agent "${agentDef.name}":`, e.message);
                }
                continue;
            }

            const patch = this._buildDefaultAgentRepair(existing, agentDef);
            if (Object.keys(patch).length > 0) {
                try {
                    this._ensureAgentFolder({ ...existing, ...patch, name: agentDef.name });
                    await this.updateAgent(existing.id, patch);
                    repaired++;
                } catch (e) {
                    errors++;
                    console.error(`[AgentManager] Failed to repair default agent "${agentDef.name}":`, e.message);
                }
            }
        }

        if (errors === 0) {
            await this.db.saveSetting(DEFAULT_AGENT_ADDITION_SYNC_KEY, 'true');
        }
        if (created > 0 || repaired > 0) {
            console.log(`[AgentManager] Synced default agent additions: ${created} created, ${repaired} repaired`);
        }
    }

    async syncDefaultAgentPlugins(pluginManager = this.pluginManager) {
        if (!pluginManager?.enablePlugin) {
            return { success: false, error: 'PluginManager unavailable', enabled: [] };
        }
        const syncState = await this.db.getSetting(DEFAULT_AGENT_PLUGIN_SYNC_KEY);
        if (String(syncState || '').toLowerCase() === 'true') {
            return { success: true, skipped: true, enabled: [] };
        }

        const pluginIds = new Set();
        for (const agentDef of this._defaultAgentAdditions()) {
            const pluginId = String(agentDef.config?.chat_ui_plugin || '').trim();
            if (pluginId) pluginIds.add(pluginId);
        }

        const enabled = [];
        const missing = [];
        const errors = [];
        for (const pluginId of pluginIds) {
            if (pluginManager.plugins && !pluginManager.plugins.has(pluginId)) {
                missing.push(pluginId);
                continue;
            }
            try {
                await pluginManager.enablePlugin(pluginId, { persistStatus: true });
                enabled.push(pluginId);
            } catch (e) {
                errors.push({ pluginId, error: e.message });
                console.error(`[AgentManager] Failed to enable default agent plugin "${pluginId}":`, e.message);
            }
        }

        if (errors.length === 0 && missing.length === 0) {
            await this.db.saveSetting(DEFAULT_AGENT_PLUGIN_SYNC_KEY, 'true');
        }
        return { success: errors.length === 0, enabled, missing, errors };
    }

    _ensureAgentFolder(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const subDirs = agent.type === 'pro'
            ? ['memory', 'config', 'tasks', 'outputs']
            : ['temp', 'tasks', 'outputs'];

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        for (const sub of subDirs) {
            const subPath = path.join(folderPath, sub);
            if (!fs.existsSync(subPath)) {
                fs.mkdirSync(subPath, { recursive: true });
            }
        }

        const systemFile = path.join(folderPath, 'system.md');
        if (!fs.existsSync(systemFile) && agent.system_prompt) {
            fs.writeFileSync(systemFile, agent.system_prompt, 'utf-8');
        }
    }

    _getAgentFolderPath(agent) {
        const safeName = this._getSafeFolderName(agent.name || `agent-${agent.id || 'unknown'}`);
        const relativePath = String(agent.folder_path || path.join(agent.type || 'pro', safeName)).replace(/\\/g, '/');
        const base = path.resolve(this.basePath);
        const resolved = path.resolve(base, relativePath);
        if (resolved !== base && !resolved.startsWith(base + path.sep)) {
            throw new Error('Agent folder path is outside the agent root');
        }
        return resolved;
    }

    _getSafeFolderName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    }

    async _migrateBackgroundDaemonOutOfPro() {
        const agents = await this.db.getAgents();
        for (const agent of agents) {
            const name = String(agent?.name || '').trim().toLowerCase();
            if (name !== 'background daemon') continue;
            if (String(agent?.type || '').toLowerCase() !== 'pro') continue;
            const folderName = this._getSafeFolderName(agent.name || 'background-daemon');
            await this.db.updateAgent(agent.id, {
                type: 'daemon',
                folder_path: `daemon/${folderName}`
            });
        }
    }

    async _migrateDefaultAgentNames() {
        const agents = await this.db.getAgents();
        const byName = new Map(
            agents.map((agent) => [String(agent?.name || '').trim().toLowerCase(), agent])
        );
        const oldName = 'web researcher';
        const newName = 'web search';
        if (!byName.has(oldName) || byName.has(newName)) {
            return;
        }

        const source = byName.get(oldName);
        await this.db.updateAgent(source.id, {
            name: 'Web Search'
        });
    }

    async createAgent({ name, type = 'pro', icon = '🤖', system_prompt, description, config }) {
        const folderName = this._getSafeFolderName(name);
        const folderPath = `${type}/${folderName}`;

        const agent = await this.db.addAgent({
            name, type, icon, system_prompt, description, config, folder_path: folderPath
        });

        this._ensureAgentFolder({ ...agent, type, name });

        return agent;
    }

    async updateAgent(id, data) {
        const result = await this.db.updateAgent(id, data);

        if (data.system_prompt) {
            const agent = await this.db.getAgent(id);
            if (agent) {
                const folderPath = this._getAgentFolderPath(agent);
                const systemFile = path.join(folderPath, 'system.md');
                fs.writeFileSync(systemFile, data.system_prompt, 'utf-8');
            }
        }

        return result;
    }

    async setAgentSidebarVisible(id, visible) {
        const visibleInSidebar = visible === true;
        await this.db.updateAgent(id, { visible_in_sidebar: visibleInSidebar ? 1 : 0 });
        return { id, visibleInSidebar };
    }

    async deleteAgent(id) {
        const agent = await this.db.getAgent(id);
        const folderPath = agent ? this._getAgentFolderPath(agent) : null;
        const result = await this.db.deleteAgent(id);
        let folderRemoved = false;
        if (folderPath && fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            folderRemoved = true;
        }
        return { ...result, folderRemoved };
    }

    async getAgents(type = null) {
        return await this.db.getAgents(type);
    }

    async getAgent(id) {
        return await this.db.getAgent(id);
    }

    _agentAsSubagentRun(agent) {
        if (!agent || agent.type !== 'sub') {
            return null;
        }
        // Represent sub-agent records in the run manager so the user can manage
        // backend sub-agents even when they have no delegated run history yet.
        return {
            id: agent.id,
            run_id: String(agent.id),
            status: agent.status || 'idle',
            subagent_id: agent.id,
            agent_name: agent.name || `Subagent ${agent.id}`,
            parent_session_id: null,
            child_session_id: null,
            task: agent.description || '',
            summary: '',
            error: null,
            created_at: agent.created_at || null,
            completed_at: null,
            subagent_mode: 'no_ui',
            source: 'agent'
        };
    }

    async activateAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);

        await this.db.updateAgent(agentId, { status: 'active' });

        let session = await this.db.getAgentSession(agentId);
        if (!session) {
            session = await this.db.createAgentSession(agentId);
        }



        return { agent, sessionId: session.id };
    }

    async deactivateAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) return;

        if (agent.type === 'pro') {
            try {
                await this.compactAgent(agentId);
            } catch (e) {
                console.error(`[AgentManager] Compact failed for agent ${agentId}:`, e.message);
            }
        }



        await this.db.updateAgent(agentId, { status: 'idle' });
    }

    async compactAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent || agent.type !== 'pro') return;

        const session = await this.db.getAgentSession(agentId);
        if (!session) return;

        const messages = await this.db.getConversations(100, session.id);
        if (messages.length < 4) return; // Not enough to summarize

        const historyText = messages
            .map(m => `${m.role}: ${m.content}`)
            .slice(-20)  // Last 20 messages
            .join('\n');

        try {
            const result = await this.dispatcher.dispatch(
                `Summarize this conversation concisely. Focus on key decisions, findings, and action items:\n\n${historyText}`,
                [],
                { mode: 'internal', includeTools: false, includeRules: false }
            );

            const folderPath = this._getAgentFolderPath(agent);
            const compactFile = path.join(folderPath, 'memory', 'compact.md');
            const timestamp = new Date().toISOString();
            const entry = `\n\n---\n[${timestamp}] Session Compact\n${result.content}\n`;

            fs.appendFileSync(compactFile, entry);
            console.log(`[AgentManager] Compacted agent "${agent.name}" to ${compactFile}`);
        } catch (e) {
            console.error(`[AgentManager] Compact dispatch failed:`, e.message);
        }
    }

    /**
     * Get the system prompt for an agent, loading from file if available.
     * Falls back to DB system_prompt field.
     */
    getAgentSystemPrompt(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const systemFile = path.join(folderPath, 'system.md');

        try {
            if (fs.existsSync(systemFile)) {
                return fs.readFileSync(systemFile, 'utf-8');
            }
        } catch (e) {
            console.error(`[AgentManager] Failed to read agent system.md:`, e.message);
        }

        return agent.system_prompt || '';
    }

    /**
     * Get compact memory for an agent (if exists).
     */
    getAgentMemory(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const compactFile = path.join(folderPath, 'memory', 'compact.md');

        try {
            if (fs.existsSync(compactFile)) {
                return fs.readFileSync(compactFile, 'utf-8');
            }
        } catch (e) {
        }

        return null;
    }

    async resolveAgentFolder(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) return null;
        return this._getAgentFolderPath(agent);
    }

    async invokeMultipleSubAgents(parentSessionId, tasks, options = {}) {
        return invokeMultipleSubAgents(this, parentSessionId, tasks, options);
    }

    async onAppQuit() {
        const agents = await this.db.getAgents();
        for (const agent of agents) {
            if (agent.status === 'active') {
                await this.deactivateAgent(agent.id);
            }
        }
    }
}

function applyMixin(target, sourcePrototype) {
    const descriptors = Object.getOwnPropertyDescriptors(sourcePrototype);
    delete descriptors.constructor;
    Object.defineProperties(target, descriptors);
}

applyMixin(AgentManager.prototype, AgentSubagentContractMethods.prototype);
applyMixin(AgentManager.prototype, AgentSubagentRunMethods.prototype);

module.exports = AgentManager;
