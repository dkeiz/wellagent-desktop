const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const { isProviderRequestCanceled, providerRequest } = require('./provider-http');

const REQUEST_TIMEOUT_MS = 120000;
const MODEL_LIST_TIMEOUT_MS = 15000;

/**
 * OpenRouterAdapter — OpenRouter API (OpenAI-compatible).
 *
 * Uses /chat/completions for inference, /models for listing.
 * Requires API key.
 */
class OpenRouterAdapter extends BaseAdapter {
    constructor(db) {
        super('openrouter', db);
        this.baseURL = 'https://openrouter.ai/api/v1';
    }

    async call(messages, options = {}) {
        const { requestId, signal } = this._startRequest();
        const headers = await this._getHeaders();
        const runtimeConfig = options.runtimeConfig || {};
        const reasoningConfig = runtimeConfig.reasoning || {};
        const reasoningCaps = options.modelSpec?.capabilities?.reasoning || {};

        // Apply a prompt hint only for models that do not expose a real reasoning parameter.
        const processedMessages = this._applyThinkingMode(messages, options.thinkingMode, reasoningCaps);

        const requestBody = {
            model: options.model || 'openrouter/auto',
            messages: processedMessages,
            temperature: options.temperature || 0.7,
            stream: false
        };
        // CRITICAL WARNING: DO NOT hardcode a default max_tokens (like 1000) here or anywhere in this adapter!
        // Capping output tokens by default restricts the model output length and truncates responses.
        // Let the API provider / model config decide output limits by default unless options.max_tokens is explicitly provided.
        if (options.max_tokens != null) {
            requestBody.max_tokens = options.max_tokens;
        }
        this._applyPromptCacheHint(requestBody, options.promptCache);

        if (reasoningCaps.parameterMode === 'openrouter_reasoning' && reasoningCaps.supported) {
            requestBody.reasoning = {
                enabled: reasoningConfig.enabled,
                exclude: reasoningConfig.visibility === 'hide'
            };

            if (Array.isArray(reasoningCaps.effortLevels) && reasoningCaps.effortLevels.length > 0 && reasoningConfig.effort) {
                requestBody.reasoning.effort = reasoningConfig.effort;
            }

            if (reasoningCaps.maxTokens && reasoningConfig.maxTokens) {
                requestBody.reasoning.max_tokens = reasoningConfig.maxTokens;
            }
        }

        if (runtimeConfig.providerRouting?.requireParameters) {
            requestBody.provider = {
                require_parameters: true
            };
        }

        try {
            const response = await providerRequest(axios, {
                method: 'post',
                url: `${this.baseURL}/chat/completions`,
                data: requestBody,
                signal,
                headers
            }, { timeoutMs: REQUEST_TIMEOUT_MS, label: 'OpenRouter generation' });

            this._endRequest(requestId);

            const message = response.data.choices?.[0]?.message || {};
            const reasoning = this._extractReasoning(message, response.data);

            return this._normalizeResponse({
                content: message.content || '',
                reasoning,
                model: response.data.model,
                usage: response.data.usage
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
            const headers = await this._getHeaders();
            const response = await providerRequest(axios, {
                method: 'get',
                url: `${this.baseURL}/models`,
                headers
            }, { timeoutMs: MODEL_LIST_TIMEOUT_MS, label: 'OpenRouter model list' });
            return response.data.data.map(m => m.id);
        } catch (error) {
            console.error('[OpenRouter] Failed to fetch models:', error.message);
            return [];
        }
    }

    _applyPromptCacheHint(requestBody, promptCache = null) {
        if (!promptCache?.enabled) return;
        const key = String(promptCache.key || '').trim();
        if (!key) return;

        // OpenRouter session_id keeps multi-turn requests on a sticky provider
        // cache path. Anthropic prompt-cache breakpoints are content-block
        // annotations below, not top-level request fields.
        requestBody.session_id = key.slice(0, 256);

        const model = String(requestBody.model || '').toLowerCase();
        if (model.startsWith('anthropic/') || model.startsWith('~anthropic/')) {
            const cacheControl = { type: 'ephemeral' };
            if (promptCache.retention === '1h') {
                cacheControl.ttl = '1h';
            }

            const messages = requestBody.messages;
            if (Array.isArray(messages) && messages.length > 0) {
                if (messages[0]?.role === 'system') {
                    messages[0] = this._withAnthropicCacheBreakpoint(messages[0], cacheControl);
                }

                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user') {
                        messages[i] = this._withAnthropicCacheBreakpoint(messages[i], cacheControl);
                        break;
                    }
                }
            }
        }
    }

    _withAnthropicCacheBreakpoint(message, cacheControl) {
        return {
            ...message,
            content: this._contentWithCacheControl(message?.content, cacheControl)
        };
    }

    _contentWithCacheControl(content, cacheControl) {
        const cache = { ...cacheControl };
        if (typeof content === 'string') {
            return [{ type: 'text', text: content, cache_control: cache }];
        }
        if (Array.isArray(content)) {
            const blocks = content.map(part => {
                if (part && typeof part === 'object') return { ...part };
                return { type: 'text', text: String(part ?? '') };
            });
            for (let index = blocks.length - 1; index >= 0; index -= 1) {
                if (blocks[index] && typeof blocks[index] === 'object') {
                    blocks[index] = { ...blocks[index], cache_control: cache };
                    return blocks;
                }
            }
            return [{ type: 'text', text: '', cache_control: cache }];
        }
        if (content && typeof content === 'object') {
            return [{ ...content, cache_control: cache }];
        }
        return [{ type: 'text', text: String(content ?? ''), cache_control: cache }];
    }

    async _getHeaders() {
        const apiKey = await this.db.getAPIKey('openrouter') || await this.db.getSetting('llm.openrouter.apiKey');
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    /**
     * OpenRouter thinking mode — uses system prompt hints.
     * Some models behind OpenRouter support <think> tags natively.
     */
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (reasoningCaps.parameterMode === 'openrouter_reasoning') return messages;

        const result = [...messages];
        const hint = thinkingMode === 'think'
            ? 'Show your reasoning step by step inside <think></think> tags before giving your final answer.'
            : 'Do not include any reasoning or thinking tags. Give your answer directly.';

        if (result.length > 0 && result[0].role === 'system') {
            result[0] = { ...result[0], content: result[0].content + '\n\n' + hint };
        } else {
            result.unshift({ role: 'system', content: hint });
        }
        return result;
    }

    _extractReasoning(message = {}, payload = {}) {
        if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
            return message.reasoning.trim();
        }

        if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
            return message.reasoning_content.trim();
        }

        if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
            return message.reasoning_details
                .map(detail => detail?.text || detail?.content || detail?.reasoning || '')
                .filter(Boolean)
                .join('\n')
                .trim();
        }

        if (typeof payload.reasoning_content === 'string' && payload.reasoning_content.trim()) {
            return payload.reasoning_content.trim();
        }

        if (typeof payload.reasoning === 'string' && payload.reasoning.trim()) {
            return payload.reasoning.trim();
        }

        const choiceReasoning = payload?.choices?.[0]?.reasoning;
        if (typeof choiceReasoning === 'string' && choiceReasoning.trim()) {
            return choiceReasoning.trim();
        }

        return '';
    }
}

module.exports = OpenRouterAdapter;
