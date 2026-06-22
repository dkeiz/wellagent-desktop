/**
 * BaseAdapter — Abstract base for all LLM provider adapters.
 *
 * Each provider extends this and implements:
 *   call(messages, options)  → { content, model, usage, stopped? }
 *   getModels()              → string[]
 *   stop()                   — abort running request
 */
class BaseAdapter {
    constructor(name, db) {
        this.name = name;
        this.db = db;
        this.activeRequests = new Map();
        this._requestSeq = 0;
    }

    /**
     * Send messages to the LLM and get a response.
     * @param {Array} messages - [{role, content}, ...]
     * @param {Object} options - { model, temperature, max_tokens, thinkingMode, ... }
     * @returns {Object} { content, model, usage: { prompt_tokens, completion_tokens, total_tokens }, stopped? }
     */
    async call(messages, options = {}) {
        throw new Error(`${this.name}: call() not implemented`);
    }

    /**
     * Fetch available models from the provider.
     * @returns {string[]} model IDs/names
     */
    async getModels() {
        return [];
    }

    /**
     * Abort in-flight requests. Without a request id, abort every active request.
     */
    stop(requestId = null) {
        const id = requestId ? String(requestId) : '';
        if (id) {
            const controller = this.activeRequests.get(id);
            if (!controller) return false;
            controller.abort();
            console.log(`[${this.name}] Generation stopped request=${id}`);
            return true;
        }

        if (this.activeRequests.size === 0) return false;
        for (const controller of this.activeRequests.values()) {
            controller.abort();
        }
        console.log(`[${this.name}] Generation stopped`);
        return true;
    }

    get isGenerating() {
        return this.activeRequests.size > 0;
    }

    getActiveRequestCount() {
        return this.activeRequests.size;
    }

    _nextRequestId() {
        this._requestSeq += 1;
        return `${this.name}-${Date.now()}-${this._requestSeq}`;
    }

    /**
     * Create a fresh AbortController for a new request.
     */
    _startRequest(requestId = null) {
        const id = requestId ? String(requestId) : this._nextRequestId();
        const controller = new AbortController();
        this.activeRequests.set(id, controller);
        return { requestId: id, signal: controller.signal };
    }

    /**
     * Clean up after request completes.
     */
    _endRequest(requestId) {
        if (requestId) {
            this.activeRequests.delete(String(requestId));
            return;
        }
        this.activeRequests.clear();
    }

    /**
     * Normalize response to standard shape.
     */
    _normalizeResponse({ content, reasoning, model, usage, stopped = false, context_length }) {
        const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
        const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
        const totalTokens = Number(usage?.total_tokens ?? (
            (promptTokens || completionTokens)
                ? promptTokens + completionTokens
                : 0
        )) || 0;
        const cachedTokens = usage?.prompt_tokens_details?.cached_tokens
            ?? usage?.input_tokens_details?.cached_tokens
            ?? usage?.cache_read_input_tokens
            ?? 0;
        const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens
            ?? usage?.cache_creation_input_tokens
            ?? 0;
        const result = {
            content: content || '',
            reasoning: reasoning || '',
            model: model || this.name,
            usage: {
                prompt_tokens: promptTokens || 0,
                completion_tokens: completionTokens || 0,
                total_tokens: totalTokens || 0,
                cached_tokens: cachedTokens || 0,
                cache_write_tokens: cacheWriteTokens || 0,
                prompt_tokens_details: usage?.prompt_tokens_details || null
            },
            stopped
        };
        if (context_length) result.context_length = context_length;
        return result;
    }
}

module.exports = BaseAdapter;
