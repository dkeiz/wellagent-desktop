const { getEffectiveLlmSelection } = require('./llm-state');
const { InferenceScheduler } = require('./inference/inference-scheduler');
const { InferenceRuntimeConfig } = require('./inference/inference-runtime-config');
const { InferencePromptBuilder } = require('./inference/inference-prompt-builder');

/**
 * InferenceDispatcher — Central routing layer for all LLM inference calls.
 *
 * Every code path that needs an LLM response calls dispatcher.dispatch()
 * instead of aiService.sendMessage() directly.  The dispatcher builds
 * mode-appropriate system prompts and messages, then delegates to AIService.
 *
 * Modes:
 *   chat          — full system prompt + tools + rules  (user conversation)
 *   internal      — minimal prompt, no tools, no rules  (automemory, summaries)
 *   connector     — minimal prompt, no tools, no rules  (connector invoke)
 *   port-listener — minimal prompt, no tools, no rules  (HTTP → LLM bridge)
 */
class InferenceDispatcher {
    constructor(aiService, db, mcpServer) {
        this.aiService = aiService;
        this.db = db;
        this.mcpServer = mcpServer;
        this.agentManager = null;
        this.scheduler = new InferenceScheduler({ aiService, db });
        this.runtimeConfigResolver = new InferenceRuntimeConfig({ db, aiService });
        this.promptBuilder = new InferencePromptBuilder({
            aiService,
            db,
            mcpServer,
            getAgentManager: () => this.agentManager
        });
    }

    setAgentManager(agentManager) {
        this.agentManager = agentManager;
    }

    /**
     * Resolve the effective context window for a given provider/model/options selection,
     * taking into account database settings, model specifications, and UI overrides/clamps.
     */
    async resolveContextWindow(options = {}) {
        const provider = String(options.provider || this.aiService.getCurrentProvider() || 'ollama').trim().toLowerCase() || 'ollama';
        let model = options.model;
        if (!model) {
            const selection = await getEffectiveLlmSelection(this.db);
            model = selection.model;
        }
        if (!model) {
            const savedContext = await this.db.getSetting('context_window');
            const parsedContext = Number.parseInt(savedContext, 10);
            return Number.isFinite(parsedContext) && parsedContext > 0 ? parsedContext : 8192;
        }

        let modelSpec = options.modelSpec;
        let runtimeConfig = options.runtimeConfig;
        if (!runtimeConfig) {
            const config = await this.runtimeConfigResolver.loadModelRuntime(provider, model);
            modelSpec = config.spec;
            runtimeConfig = config.runtime;
        }

        return this.runtimeConfigResolver.resolveContextWindow({ provider, model, modelSpec, runtimeConfig });
    }

    // ------- public API -------

    /**
     * Single entry point for all inference calls.
     *
     * @param {string|null} prompt   — user/caller message (null on chain continuation)
     * @param {Array}       history  — preceding messages [{role, content}, ...]
     * @param {Object}      options
     * @param {string}      options.mode          — 'chat'|'internal'|'connector'|'port-listener'
     * @param {string}      [options.sessionId]   — chat session id (required for 'chat')
     * @param {boolean}     [options.includeTools] — override: inject tool docs (default per mode)
     * @param {boolean}     [options.includeRules] — override: inject active rules (default per mode)
     * @param {string}      [options.model]        — model override
     * @returns {Object}    { content, model, usage, ... }
     */
    async dispatch(prompt, history = [], options = {}) {
        const mode = options.mode || 'chat';
        const preemptible = options.preemptible === true;
        const provider = String(options.provider || this.aiService.getCurrentProvider() || 'ollama').trim().toLowerCase() || 'ollama';
        const concurrencyMode = this.scheduler.normalizeConcurrencyMode(
            options.concurrencyMode || options.concurrency_mode || (options.skipLock ? 'parallel' : 'queued')
        );
        this.scheduler.preemptBackgroundIfNeeded(mode, preemptible);

        // Decide what to inject based on mode (callers can override)
        const includeTools = options.includeTools ?? (mode === 'chat');
        const includeRules = options.includeRules ?? (mode === 'chat');
        const includeEnv = options.includeEnv ?? (mode === 'chat' || mode === 'internal');
        const skipMemoryOnStart = options.skipMemoryOnStart === true;

        // Resolve model once here (not in each adapter)
        if (!options.model) {
            const { model } = await getEffectiveLlmSelection(this.db);
            if (model) options.model = model;
        }

        // Read thinking mode settings
        if (!options.runtimeConfig && options.model) {
            const { spec, runtime } = await this.runtimeConfigResolver.loadModelRuntime(provider, options.model);
            options.modelSpec = spec;
            options.runtimeConfig = runtime;
        }

        if (options.modelSpec && options.runtimeConfig) {
            options.runtimeConfig = await this.runtimeConfigResolver.applyUiRuntimeOverrides(options.modelSpec, options.runtimeConfig);
        }

        const scheduling = await this.scheduler.resolveSchedulingDecision({
            provider,
            concurrencyMode,
            modelSpec: options.modelSpec,
            runtimeConfig: options.runtimeConfig
        });

        if (!options.thinkingMode) {
            if (options.runtimeConfig?.reasoning) {
                options.thinkingMode = options.runtimeConfig.reasoning.enabled ? 'think' : 'off';
            }
            const thinkingMode = await this.db.getSetting('llm.thinkingMode');
            if (!options.runtimeConfig?.reasoning && thinkingMode && thinkingMode !== 'off') {
                options.thinkingMode = thinkingMode;
            }
        }

        // Build system prompt (with optional agent override)
        const agentId = options.agentId || null;
        const systemPrompt = await this.promptBuilder.buildSystemPrompt({
            includeTools,
            includeRules,
            includeEnv,
            skipMemoryOnStart,
            sessionId: options.sessionId,
            agentId,
            completionTools: options.completionTools || []
        });

        // Assemble messages array
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            ...(prompt ? [{ role: 'user', content: prompt }] : [])
        ];
        const promptCache = this._buildPromptCacheHint({
            provider,
            model: options.model,
            mode,
            sessionId: options.sessionId,
            agentId,
            systemPrompt
        });

        const execute = async () => {
            console.log(`[Dispatcher] mode=${mode} model=${options.model || 'default'} tools=${includeTools} rules=${includeRules} provider=${provider} concurrency=${scheduling.effectiveMode} lane=${scheduling.laneKey || 'none'} historyLen=${history.length}`);
            const response = await this.aiService.sendMessage(messages, { ...options, provider, promptCache });
            response.renderContext = {
                provider,
                model: options.model || response.model || '',
                runtimeConfig: options.runtimeConfig ? JSON.parse(JSON.stringify(options.runtimeConfig)) : null,
                concurrency: {
                    requestedMode: scheduling.requestedMode,
                    effectiveMode: scheduling.effectiveMode,
                    needsEnablement: scheduling.needsEnablement
                }
            };
            response.concurrency = {
                requested_mode: scheduling.requestedMode,
                effective_mode: scheduling.effectiveMode,
                provider,
                lane: scheduling.laneKey || null,
                global_enabled: scheduling.globalEnabled,
                needs_enablement: scheduling.needsEnablement
            };
            await this.runtimeConfigResolver.rememberWorkingRuntimeParams(provider, options.model, options.modelSpec, options.runtimeConfig, response);
            return response;
        };

        return this.scheduler.executeScheduled(scheduling.laneKey, execute, { mode, preemptible, provider });
    }

    async _buildSystemPrompt(options = {}) {
        return this.promptBuilder.buildSystemPrompt(options);
    }

    async _buildToolContext(options = {}) {
        return this.promptBuilder.buildToolContext(options);
    }

    async _rememberWorkingRuntimeParams(provider, model, modelSpec, runtimeConfig, response) {
        return this.runtimeConfigResolver.rememberWorkingRuntimeParams(provider, model, modelSpec, runtimeConfig, response);
    }

    _buildPromptCacheHint({ provider, model, mode, sessionId, agentId, systemPrompt }) {
        if (mode !== 'chat') return null;
        const scopedSession = String(sessionId || 'default').trim() || 'default';
        const scopedAgent = String(agentId || 'chat').trim() || 'chat';
        const scopedModel = String(model || 'default').trim() || 'default';
        // Include a lightweight fingerprint of the system prompt so cache keys
        // don't collide when agents/rules change within the same session.
        const promptFingerprint = this._hashPromptFingerprint(systemPrompt);
        return {
            enabled: true,
            key: `localagent:${provider || 'provider'}:${scopedModel}:${scopedAgent}:${scopedSession}:${promptFingerprint}`,
            retention: provider === 'openrouter' ? '1h' : null
        };
    }

    _hashPromptFingerprint(text) {
        const s = String(text || '');
        // Fast non-crypto hash: length + djb2 of first 200 chars.
        const sample = s.slice(0, 200);
        let hash = 5381;
        for (let i = 0; i < sample.length; i++) {
            hash = ((hash << 5) + hash + sample.charCodeAt(i)) >>> 0;
        }
        return `${s.length}x${hash.toString(36)}`;
    }

}

module.exports = InferenceDispatcher;
