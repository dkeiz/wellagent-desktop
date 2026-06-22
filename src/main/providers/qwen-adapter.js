const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const { isProviderRequestCanceled, providerRequest } = require('./provider-http');

/**
 * QwenAdapter — Qwen/DashScope API + CLI mode.
 *
 * Supports two modes:
 *   - api: DashScope REST API with API key
 *   - cli: local qwen CLI command
 *
 * Thinking mode uses /think or /nothink prefix (Qwen3 native).
 */
class QwenAdapter extends BaseAdapter {
    constructor(db) {
        super('qwen', db);
        this.baseURL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

        // Model cache with TTL
        this.modelCache = {
            models: [],
            lastSuccess: 0
        };
    }

    async call(messages, options = {}) {
        const mode = await this.db.getSetting('llm.qwen.mode') || 'cli';

        if (mode === 'cli') {
            return this._callCLI(messages, options);
        } else {
            return this._callAPI(messages, options, mode);
        }
    }

    async _callAPI(messages, options, mode = 'api') {
        const { requestId, signal } = this._startRequest();
        try {
            let apiKey = await this.db.getAPIKey('qwen') || await this.db.getSetting('llm.qwen.apiKey');
            const useOAuth = mode === 'oauth' || (await this.db.getSetting('llm.qwen.useOAuth')) === 'true';

            if (useOAuth) {
                apiKey = await this._getApiKeyFromOAuth();
            }

            if (!apiKey) throw new Error('Qwen API key not configured');

            const runtimeConfig = options.runtimeConfig || {};
            const reasoningConfig = runtimeConfig.reasoning || {};
            const reasoningCaps = options.modelSpec?.capabilities?.reasoning || {};
            const processedMessages = this._applyThinkingMode(messages, options.thinkingMode, reasoningCaps, mode);

            const requestBody = {
                model: options.model || 'qwen-turbo',
                messages: processedMessages
            };

            if (reasoningCaps.parameterMode === 'qwen_enable_thinking' && reasoningCaps.supported) {
                requestBody.parameters = {
                    result_format: 'message',
                    enable_thinking: reasoningConfig.enabled
                };

                if (reasoningCaps.maxTokens && reasoningConfig.maxTokens) {
                    requestBody.parameters.thinking_budget = reasoningConfig.maxTokens;
                }
            }

            const response = await providerRequest(axios, {
                method: 'post',
                url: this.baseURL,
                data: requestBody,
                signal,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }, { timeoutMs: 120000, label: 'Qwen generation' });

            this._endRequest(requestId);

            const normalized = this._extractMessage(response.data);

            return this._normalizeResponse({
                content: normalized.content,
                reasoning: normalized.reasoning,
                model: response.data.model || response.data.output?.model,
                usage: response.data.usage || response.data.output?.usage,
                context_length: runtimeConfig.contextWindow?.value || options.modelSpec?.runtime?.contextWindow?.value
            });
        } catch (error) {
            this._endRequest(requestId);

            if (isProviderRequestCanceled(axios, error)) {
                return this._normalizeResponse({
                    content: '[Generation stopped by user]',
                    model: options.model,
                    stopped: true
                });
            }
            const sourceError = error.cause || error;
            console.error('[Qwen API] Error:', sourceError.response?.data || sourceError.message);
            throw new Error(`Qwen API failed: ${sourceError.response?.data?.error?.message || sourceError.message}`);
        }
    }

    async _callCLI(messages, options) {
        const processedMessages = this._applyThinkingMode(
            messages,
            options.thinkingMode,
            options.modelSpec?.capabilities?.reasoning || {},
            'cli'
        );
        const prompt = this._formatMessagesForCli(processedMessages);
        const model = String(options.model || '');
        const args = [];
        if (model && model !== 'qwen-cli') {
            args.push('--model', model);
        }
        args.push(prompt);

        const { requestId, signal } = this._startRequest();
        let result;
        try {
            result = await this._runQwenCli(args, 30000, signal);
        } finally {
            this._endRequest(requestId);
        }
        if (result.stopped) {
            return this._normalizeResponse({
                content: '[Generation stopped by user]',
                model: options.model || 'qwen-cli',
                stopped: true
            });
        }
        if (result.code !== 0) {
            console.error('[Qwen CLI] Error:', result.error || result.stderr);
            throw new Error(`Qwen CLI failed: ${result.error?.message || result.stderr || `exit code ${result.code}`}`);
        }
        return this._normalizeResponse({
            content: result.stdout.trim(),
            model: options.model || 'qwen-cli',
            usage: { total_tokens: 0 }
        });
    }

    _runQwenCli(args, timeoutMs, signal = null) {
        const { spawn } = require('child_process');
        if (signal?.aborted) {
            return Promise.resolve({ stdout: '', stderr: '', code: 130, error: null, stopped: true });
        }
        return new Promise((resolve) => {
            const command = this._getQwenCommand();
            const child = spawn(command, args, {
                shell: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            let settled = false;
            let timeout = null;
            const finish = (payload) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                if (signal?.removeEventListener) {
                    signal.removeEventListener('abort', onAbort);
                }
                resolve(payload);
            };
            const onAbort = () => {
                try {
                    child.kill();
                } catch (_) {
                }
                finish({ stdout, stderr, code: 130, error: null, stopped: true });
            };
            if (signal?.addEventListener) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
            timeout = setTimeout(() => {
                try {
                    child.kill();
                } catch (_) {
                }
                finish({
                    stdout,
                    stderr,
                    code: 124,
                    error: new Error(`Qwen CLI timed out after ${timeoutMs}ms`)
                });
            }, timeoutMs);

            child.stdout.on('data', chunk => {
                stdout += String(chunk);
            });
            child.stderr.on('data', chunk => {
                stderr += String(chunk);
            });
            child.on('error', error => {
                finish({ stdout, stderr, code: 1, error });
            });
            child.on('exit', code => {
                finish({ stdout, stderr, code: Number(code || 0), error: null });
            });
        });
    }

    _formatMessagesForCli(messages = []) {
        return messages.map(message => {
            const role = String(message?.role || 'user').toUpperCase();
            const content = this._coerceContent(message?.content);
            return `${role}:\n${content}`;
        }).join('\n\n');
    }

    _getQwenCommand() {
        return process.platform === 'win32' ? 'qwen.cmd' : 'qwen';
    }

    async getModels(forceRefresh = false) {
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        // Return cache if valid
        if (!forceRefresh && this.modelCache.models.length > 0 &&
            Date.now() - this.modelCache.lastSuccess < oneWeek) {
            return this.modelCache.models;
        }

        try {
            let models = await this._fetchModels();

            // Fallback to CLI-based discovery if API/OAuth returned nothing
            if (!models || models.length === 0) {
                models = await this._fetchModelsCLI();
            }

            this.modelCache.models = models;
            this.modelCache.lastSuccess = Date.now();
            return models;
        } catch (error) {
            console.error('[Qwen] Model fetch failed:', error.message);

            // Last-chance fallback via CLI discovery
            try {
                const cliModels = await this._fetchModelsCLI();
                if (cliModels.length > 0) {
                    this.modelCache.models = cliModels;
                    this.modelCache.lastSuccess = Date.now();
                    return cliModels;
                }
            } catch (cliError) {
                console.error('[Qwen] CLI model fetch failed:', cliError.message);
            }

            if (this.modelCache.models.length > 0) {
                return this.modelCache.models;
            }
            return [];
        }
    }

    async _fetchModels() {
        // Try OAuth first
        const useOAuth = await this.db.getSetting('llm.qwen.useOAuth');
        if (useOAuth === 'true') {
            return this._fetchModelsOAuth();
        }

        // Try API key
        const apiKey = await this.db.getAPIKey('qwen') || await this.db.getSetting('llm.qwen.apiKey');
        if (apiKey) {
            try {
                const response = await providerRequest(axios, {
                    method: 'get',
                    url: 'https://dashscope.aliyuncs.com/api/v1/models',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                }, { timeoutMs: 120000, label: 'Qwen model list' });
                const models = this._extractModelsFromApiResponse(response.data);
                if (models.length > 0) {
                    return models;
                }
            } catch (error) {
                console.error('[Qwen] API key model fetch failed:', error.message);
            }
        }

        return [];
    }

    async _fetchModelsOAuth() {
        const apiKey = await this._getApiKeyFromOAuth();

        const response = await providerRequest(axios, {
            method: 'get',
            url: 'https://dashscope.aliyuncs.com/api/v1/models',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        }, { timeoutMs: 120000, label: 'Qwen OAuth model list' });

        const models = this._extractModelsFromApiResponse(response.data);
        if (models.length === 0) throw new Error('Empty model list');
        return models;
    }

    async _getApiKeyFromOAuth() {
        let oauthCredsStr = await this.db.getCredential?.('llm.qwen.oauthCreds') || null;
        if (!oauthCredsStr) {
            oauthCredsStr = await this.db.getSetting('llm.qwen.oauthCreds');
            if (oauthCredsStr && this.db.setCredential) {
                await this.db.setCredential('llm.qwen.oauthCreds', oauthCredsStr);
                await this.db.saveSetting?.('llm.qwen.oauthCreds', '');
            }
        }
        if (!oauthCredsStr) throw new Error('OAuth enabled but no credentials found');

        const oauthCreds = JSON.parse(oauthCredsStr);
        const token = oauthCreds.access_token || oauthCreds.token || oauthCreds.id_token || oauthCreds.accessToken;
        if (!token) throw new Error('No access token available');

        // Get API key from OAuth token
        const apiKeyResponse = await providerRequest(axios, {
            method: 'get',
            url: 'https://portal.qwen.ai/api/v1/auth/api_key',
            headers: { 'Authorization': `Bearer ${token}` }
        }, { timeoutMs: 120000, label: 'Qwen OAuth API key exchange' });

        const apiKey = apiKeyResponse?.data?.api_key || apiKeyResponse?.data?.data?.api_key || apiKeyResponse?.data?.key;
        if (!apiKey) throw new Error('Failed to retrieve API key from OAuth');
        return apiKey;
    }

    _extractModelsFromApiResponse(payload) {
        const raw = [];
        if (Array.isArray(payload?.data)) raw.push(...payload.data);
        if (Array.isArray(payload?.models)) raw.push(...payload.models);
        if (Array.isArray(payload?.output?.models)) raw.push(...payload.output.models);

        const models = raw
            .map(m => (typeof m === 'string' ? m : (m?.id || m?.model || m?.name || m?.model_id)))
            .filter(Boolean)
            .map(String);

        return Array.from(new Set(models));
    }

    async _fetchModelsCLI() {
        const argCandidates = [
            ['models'],
            ['list-models'],
            ['model', 'list'],
            ['list', 'models'],
            ['--models'],
            ['--list-models']
        ];

        for (const args of argCandidates) {
            try {
                const result = await this._runQwenCli(args, 8000);
                if (result.error && !result.stdout && !result.stderr) throw result.error;
                const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
                const parsed = this._parseModelsFromCliText(text);
                if (parsed.length > 0) return parsed;
            } catch (_) {
                // Try next candidate
            }
        }

        return [];
    }

    _parseModelsFromCliText(text) {
        if (!text) return [];

        const stop = new Set(['model', 'models', 'name', 'available', 'installed', 'default']);
        const out = new Set();

        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || /^[-=|+]+$/.test(trimmed)) continue;

            const first = trimmed.split(/\s+/)[0];
            if (!first) continue;
            if (stop.has(first.toLowerCase())) continue;
            if (!/^[a-zA-Z0-9._:/-]{3,}$/.test(first)) continue;

            out.add(first);
        }

        return Array.from(out);
    }

    /**
     * Qwen3 natively supports /think and /nothink prefixes.
     */
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}, mode = 'api') {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;
        if (reasoningCaps.parameterMode === 'qwen_enable_thinking' && mode !== 'cli') return messages;

        const result = [...messages];
        for (let i = result.length - 1; i >= 0; i--) {
            if (result[i].role === 'user') {
                const prefix = thinkingMode === 'think' ? '/think\n' : '/nothink\n';
                result[i] = { ...result[i], content: prefix + result[i].content };
                break;
            }
        }
        return result;
    }

    _extractMessage(payload = {}) {
        const directMessage = payload?.choices?.[0]?.message;
        const outputMessage = payload?.output?.choices?.[0]?.message;
        const message = directMessage || outputMessage || {};

        const content = this._coerceContent(message.content);
        const reasoning = this._coerceContent(
            message.thinking ||
            message.reasoning_content ||
            message.reasoning ||
            payload?.thinking ||
            payload?.reasoning_content ||
            payload?.reasoning ||
            payload?.output?.reasoning_content ||
            payload?.output?.thinking
        );

        return { content, reasoning };
    }

    _coerceContent(value) {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
            return value
                .map(part => {
                    if (typeof part === 'string') return part;
                    return part?.text || part?.content || '';
                })
                .filter(Boolean)
                .join('\n')
                .trim();
        }
        return '';
    }
}

module.exports = QwenAdapter;
