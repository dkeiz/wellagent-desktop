const BaseAdapter = require('./base-adapter');
const OpenAICompatibleAdapter = require('./openai-compatible-adapter');
const { CodexCliAdapter } = require('./codex-cli-adapter');

class OpenAIHybridAdapter extends BaseAdapter {
    constructor(db) {
        super('openai', db);
        this.api = new OpenAICompatibleAdapter('openai', db, {
            label: 'OpenAI',
            defaultBaseURL: 'https://api.openai.com/v1',
            apiPrefix: '/v1'
        });
        this.codex = new CodexCliAdapter(db);
    }

    async call(messages, options = {}) {
        const transport = await this._getTransport();
        if (transport === 'api-key') {
            return this.api.call(messages, options);
        }
        return this.codex.call(messages, options);
    }

    async getModels(forceRefresh = false) {
        const transport = await this._getTransport();
        if (transport === 'api-key') {
            return this.api.getModels(forceRefresh);
        }
        return this.codex.getModels(forceRefresh);
    }

    stop(requestId = null) {
        return this.api.stop(requestId) || this.codex.stop(requestId);
    }

    get isGenerating() {
        return this.api.isGenerating || this.codex.isGenerating;
    }

    getActiveRequestCount() {
        return this.api.getActiveRequestCount() + this.codex.getActiveRequestCount();
    }

    async getCodexStatus() {
        return this.codex.getStatus();
    }

    async launchCodexLogin() {
        return this.codex.launchLogin();
    }

    async _getTransport() {
        const transport = await this.db.getSetting('llm.openai.transport');
        return transport === 'api-key' ? 'api-key' : 'codex-cli';
    }
}

module.exports = OpenAIHybridAdapter;
