const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const { isProviderRequestCanceled, providerRequest } = require('./provider-http');
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const REQUEST_TIMEOUT_MS = 120000;

/**
 * OllamaAdapter — Ollama local + cloud model support.
 *
 * Uses /api/chat for inference, /api/tags for model listing.
 * Supports AbortController, context window (num_ctx), and thinking mode.
 */
class OllamaAdapter extends BaseAdapter {
    constructor(db) {
        super('ollama', db);
    }

    async call(messages, options = {}) {
        const { requestId, signal } = this._startRequest();
        const runtimeConfig = options.runtimeConfig || {};
        const contextLength = runtimeConfig.contextWindow?.value || options.modelSpec?.runtime?.contextWindow?.value || 8192;

        // Apply thinking mode if set
        const processedMessages = this._applyThinkingMode(
            messages,
            options.thinkingMode,
            options.modelSpec?.capabilities?.reasoning || {},
            runtimeConfig
        );

        const requestBody = {
            model: options.model,
            messages: processedMessages,
            stream: false,
            options: {
                temperature: options.temperature || 0.7,
                top_p: options.top_p || 0.9,
                num_ctx: contextLength
            }
        };

        console.log(`[Ollama] model=${options.model} num_ctx=${contextLength}`);

        try {
            const baseURL = await this._getBaseURL();
            const response = await providerRequest(axios, {
                method: 'post',
                url: `${baseURL}/api/chat`,
                data: requestBody,
                signal,
                headers: await this._getHeaders()
            }, { timeoutMs: REQUEST_TIMEOUT_MS, label: 'Ollama generation' });

            this._endRequest(requestId);
            const message = response.data?.message || {};
            const content = this._coerceContent(message.content);
            const reasoning = this._coerceContent(
                message.reasoning_content
                || message.reasoning
                || message.thinking
                || response.data?.reasoning_content
                || response.data?.reasoning
                || response.data?.thinking
            );

            return this._normalizeResponse({
                content,
                reasoning,
                model: response.data.model,
                context_length: contextLength,
                usage: {
                    prompt_tokens: response.data.prompt_eval_count || 0,
                    completion_tokens: response.data.eval_count || 0,
                    total_tokens: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
                }
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
            throw error;
        }
    }

    async getModels() {
        try {
            const baseURL = await this._getBaseURL();
            const response = await providerRequest(axios, {
                method: 'get',
                url: `${baseURL}/api/tags`,
                headers: await this._getHeaders()
            }, { timeoutMs: 15000, label: 'Ollama model list' });
            const models = Array.isArray(response.data?.models) ? response.data.models : [];
            return models
                .map(entry => String(entry?.name || '').trim())
                .filter(Boolean);
        } catch (error) {
            console.error('[Ollama] Failed to fetch models:', error.message);
            return [];
        }
    }

    async _getBaseURL() {
        const stored = await this.db.getSetting('llm.ollama.url');
        const envHost = process.env.OLLAMA_HOST || '';
        const envURL = /^https?:\/\//i.test(envHost) ? envHost : (envHost ? `http://${envHost}` : '');
        return this._normalizeBaseURL(stored || envURL || DEFAULT_OLLAMA_URL);
    }

    async _getHeaders() {
        const apiKey = await this.db.getAPIKey('ollama') || await this.db.getSetting('llm.ollama.apiKey');
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }
        return headers;
    }

    _normalizeBaseURL(url) {
        const raw = String(url || '').trim();
        if (!raw) return DEFAULT_OLLAMA_URL;
        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
        return withProtocol.replace(/\/+$/, '');
    }

    /**
     * Apply thinking mode for Qwen3/DeepSeek-style models.
     * Prepends /think or /nothink to the last user message.
     */
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}, runtimeConfig = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;

        const result = [...messages];
        if (reasoningCaps.parameterMode === 'prompt_hint') {
            const effort = runtimeConfig?.reasoning?.effort;
            const effortText = effort ? ` Target reasoning effort: ${effort}.` : '';
            const hint = runtimeConfig?.reasoning?.visibility === 'hide'
                ? 'Reason internally if needed, but do not expose chain-of-thought in the final answer.'
                : (thinkingMode === 'think'
                    ? `Show concise reasoning before the final answer when the model supports it.${effortText}`
                    : 'Give the answer directly without exposed reasoning unless strictly required.');
            if (result.length > 0 && result[0].role === 'system') {
                result[0] = { ...result[0], content: `${result[0].content}\n\n${hint}` };
            } else {
                result.unshift({ role: 'system', content: hint });
            }
            return result;
        }

        // Default Ollama reasoning control uses slash directives.
        for (let i = result.length - 1; i >= 0; i--) {
            if (result[i].role === 'user') {
                const prefix = thinkingMode === 'think' ? '/think\n' : '/nothink\n';
                result[i] = { ...result[i], content: prefix + result[i].content };
                break;
            }
        }
        return result;
    }

    _coerceContent(value) {
        if (typeof value === 'string') return value;
        if (!Array.isArray(value)) return '';

        return value
            .map(part => {
                if (typeof part === 'string') return part;
                return part?.text || part?.content || part?.reasoning || '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
}

module.exports = OllamaAdapter;
