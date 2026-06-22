const fs = require('fs');
const path = require('path');
const { buildRuntimePaths } = require('./runtime-paths');
const { externalWebFetch, localProbeFetch } = require('./network-policy');

/**
 * SessionInitManager — Handles cold start vs warm start detection and
 * capability discovery for new chat sessions.
 *
 * Cold Start: 8+ hours since last activity → full discovery prompt, daemon start
 * Warm Start: daemon running, recent activity → minimal system prompt, subchat mode
 */
class SessionInitManager {
    constructor(db, agentMemory, eventBus, options = {}) {
        this.db = db;
        this.agentMemory = agentMemory;
        this.eventBus = eventBus;

        // 8 hours in milliseconds
        this.COLD_START_THRESHOLD = 8 * 60 * 60 * 1000;

        // Paths
        const runtimePaths = options.runtimePaths || buildRuntimePaths({
            ...options,
            agentinRoot: options.agentinPath || options.agentinRoot
        });
        this.agentinPath = options.agentinPath || runtimePaths.agentinRoot;
        this.templatePath = options.templatePath || path.join(this.agentinPath, 'prompts/templates/cold-start-discovery.md');
        this.connectorsDir = options.connectorsDir || runtimePaths.connectorsDir;
        this.userProfilePath = options.userProfilePath || runtimePaths.userProfilePath;
        this.memoryBasePath = options.memoryBasePath || runtimePaths.memoryBasePath;
    }

    /**
     * Determine if this is a cold start or warm start.
     * Returns { isColdStart: bool, hoursSinceLastActivity: number }
     */
    async detectStartType(daemonRunning = false) {
        // Check last activity timestamp
        const lastActivity = await this.db.getSetting('session.lastActivity');
        const now = Date.now();

        let hoursSince = 999; // Default: treat as cold if no record
        if (lastActivity) {
            const lastTime = new Date(lastActivity).getTime();
            hoursSince = (now - lastTime) / (60 * 60 * 1000);
        }

        const isColdStart = hoursSince >= (this.COLD_START_THRESHOLD / (60 * 60 * 1000)) || !daemonRunning;

        return { isColdStart, hoursSinceLastActivity: Math.round(hoursSince * 10) / 10 };
    }

    /**
     * Record current activity (called on each user message).
     */
    async recordActivity() {
        await this.db.saveSetting('session.lastActivity', new Date().toISOString());
    }

    /**
     * Build the cold start discovery prompt with full capability scan.
     * Returns the prompt string to inject into the system prompt.
     */
    async buildColdStartPrompt(hoursInactive) {
        const capabilities = await this._scanCapabilities();
        const recentMemory = await this._getRecentMemory();
        const userProfile = await this._getUserProfile();

        // Load template
        let template = this._loadTemplate();

        // Fill placeholders
        const prompt = template
            .replace('{hours_inactive}', Math.round(hoursInactive).toString())
            .replace('{capabilities_summary}', capabilities)
            .replace('{recent_memory}', recentMemory)
            .replace('{user_profile}', userProfile);

        return prompt;
    }

    /**
     * Build the init report for /baseinit command.
     * Returns structured data about the first-time setup.
     */
    async buildBaseInitReport() {
        const report = {
            model: null,
            connectivity: {},
            capabilities: null,
            memoryHealth: null,
        };

        // Check configured model
        const provider = await this.db.getSetting('llm.provider');
        const model = await this.db.getSetting('llm.model');
        report.model = { provider, model, configured: !!(provider && model) };

        // Connectivity (basic checks)
        report.connectivity = await this._checkConnectivity();

        // Capability scan
        report.capabilities = await this._scanCapabilitiesDetailed();

        // Memory health
        report.memoryHealth = await this._checkMemoryHealth();

        return report;
    }

    // ==================== Capability Scanning ====================

    async _scanCapabilities() {
        const lines = [];

        try {
            // Agents
            const agents = await this.db.getAgents();
            const proAgents = agents.filter(a => a.type === 'pro');
            const subAgents = agents.filter(a => a.type === 'sub');
            lines.push(`- **Agents:** ${proAgents.length} pro (${proAgents.map(a => a.name).join(', ')}), ${subAgents.length} sub`);

            // Connectors
            if (fs.existsSync(this.connectorsDir)) {
                const connectorFiles = fs.readdirSync(this.connectorsDir)
                    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
                lines.push(`- **Connectors:** ${connectorFiles.length} available (${connectorFiles.map(f => f.replace('.js', '')).join(', ')})`);
            }

            // Workflows
            const workflows = await this.db.getWorkflows();
            lines.push(`- **Workflows:** ${workflows.length} saved`);

            // Active rules
            const rules = await this.db.getActivePromptRules();
            const allRules = await this.db.getPromptRules();
            lines.push(`- **Rules:** ${rules.length} active / ${allRules.length} total`);

            // Memory state
            const stats = this.agentMemory.getStats();
            lines.push(`- **Memory:** daily=${stats.daily || 0}, global=${stats.global || 0}, tasks=${stats.tasks || 0}, images=${stats.images || 0}`);

            // Scheduled workflows
            try {
                const schedules = this.db.all('SELECT COUNT(*) as count FROM workflow_schedules WHERE enabled = 1');
                if (schedules[0]) {
                    lines.push(`- **Scheduled workflows:** ${schedules[0].count}`);
                }
            } catch (e) {
                // Table may not exist yet
            }

        } catch (err) {
            lines.push(`- **Error scanning capabilities:** ${err.message}`);
        }

        return lines.join('\n');
    }

    async _scanCapabilitiesDetailed() {
        const result = {
            agents: { pro: [], sub: [] },
            connectors: [],
            workflows: 0,
            rules: { active: 0, total: 0 },
            memory: {},
        };

        try {
            const agents = await this.db.getAgents();
            result.agents.pro = agents.filter(a => a.type === 'pro').map(a => ({ name: a.name, icon: a.icon, status: a.status }));
            result.agents.sub = agents.filter(a => a.type === 'sub').map(a => ({ name: a.name, icon: a.icon }));

            if (fs.existsSync(this.connectorsDir)) {
                result.connectors = fs.readdirSync(this.connectorsDir)
                    .filter(f => f.endsWith('.js') && !f.startsWith('_'))
                    .map(f => f.replace('.js', ''));
            }

            result.workflows = (await this.db.getWorkflows()).length;

            const allRules = await this.db.getPromptRules();
            const activeRules = await this.db.getActivePromptRules();
            result.rules = { active: activeRules.length, total: allRules.length };

            result.memory = this.agentMemory.getStats();
        } catch (e) {
            result.error = e.message;
        }

        return result;
    }

    async _getRecentMemory() {
        try {
            const dailyResult = await this.agentMemory.read('daily');
            if (dailyResult.content) {
                return dailyResult.content.substring(0, 600);
            }

            // Try yesterday
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toISOString().split('T')[0];
            const yResult = await this.agentMemory.read('daily', `${yStr}.md`);
            if (yResult.content) {
                return `(Yesterday) ${yResult.content.substring(0, 400)}`;
            }

            return 'No recent memory entries found.';
        } catch (e) {
            return 'Unable to read memory.';
        }
    }

    async _getUserProfile() {
        try {
            if (fs.existsSync(this.userProfilePath)) {
                const content = fs.readFileSync(this.userProfilePath, 'utf-8').trim();
                return content || 'No user profile data yet.';
            }
        } catch (e) { /* ignore */ }
        return 'No user profile data yet.';
    }

    async _checkConnectivity() {
        const result = { internet: false, providers: {} };

        // Basic internet check
        try {
            const response = await externalWebFetch('http://www.google.com', { method: 'HEAD' }, {
                label: 'Internet connectivity check',
                timeoutMs: 5000
            });
            result.internet = response.status < 400;
        } catch (e) {
            result.internet = false;
        }

        // Check Ollama
        try {
            const ollamaHost = process.env.OLLAMA_HOST || 'localhost:11434';
            const response = await localProbeFetch(`http://${ollamaHost}/api/tags`, {}, {
                label: 'Ollama startup probe',
                timeoutMs: 3000
            });
            result.providers.ollama = response.status === 200;
        } catch (e) {
            result.providers.ollama = false;
        }

        return result;
    }

    async _checkMemoryHealth() {
        const health = { ok: true, issues: [] };

        try {
            const stats = this.agentMemory.getStats();

            // Check if memory directories exist
            if (!fs.existsSync(this.memoryBasePath)) {
                health.ok = false;
                health.issues.push('Memory directory missing');
            }

            // Check user profile exists
            if (!fs.existsSync(this.userProfilePath)) {
                health.issues.push('User profile file missing (will be created on first observation)');
            }

            health.stats = stats;
        } catch (e) {
            health.ok = false;
            health.issues.push(e.message);
        }

        return health;
    }

    // ==================== Template ====================

    _loadTemplate() {
        try {
            if (fs.existsSync(this.templatePath)) {
                return fs.readFileSync(this.templatePath, 'utf-8');
            }
        } catch (e) { /* ignore */ }

        // Fallback
        return `You are starting a new session after {hours_inactive} hours of inactivity.

Discovered capabilities:
{capabilities_summary}

Recent memory:
{recent_memory}

User profile:
{user_profile}

Review your state and greet the user with awareness of what's available.`;
    }
}

module.exports = SessionInitManager;
