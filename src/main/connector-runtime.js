const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { normalizeConnectorName } = require('./connector-name-policy');
const { buildRuntimePaths } = require('./runtime-paths');
const { SECRET_SETTING_REDACTION, isSecretSettingKey } = require('./settings-security');
const { isPathInside, resolveBoundaryPath } = require('./path-boundary');

/**
 * ConnectorRuntime - Manages dynamic connector scripts in worker threads
 * 
 * Connectors are JS files in agentin/connectors/ that export:
 *   { name, description, configSchema, start(context), stop() }
 * 
 * Each connector runs in its own worker_thread with hooks back to the
 * main process for LLM invocation, config access, and logging.
 */
class ConnectorRuntime extends EventEmitter {
    constructor(dispatcher, db, options = {}) {
        super();
        this.dispatcher = dispatcher;
        this.db = db;
        this.eventBus = options.eventBus || null;
        this.externalChannelBridge = options.externalChannelBridge || null;
        this.connectors = new Map(); // name -> { worker, config, status, meta, logs }
        this.connectorsDir = options.connectorsDir || buildRuntimePaths(options).connectorsDir;
        this.workerPath = path.join(__dirname, 'connector-worker.js');
        this.maxLogs = 100;

        this._ensureDir();
    }

    _ensureDir() {
        if (!fs.existsSync(this.connectorsDir)) {
            fs.mkdirSync(this.connectorsDir, { recursive: true });
        }
    }

    // ==================== Connector Lifecycle ====================

    /**
     * Scan connectors directory and return metadata for all connectors
     */
    async listConnectors() {
        const files = fs.readdirSync(this.connectorsDir)
            .filter(f => f.endsWith('.js') && !f.startsWith('_'));

        const results = [];
        for (const file of files) {
            const name = path.basename(file, '.js');
            const running = this.connectors.has(name);
            const connector = this.connectors.get(name);

            // Try to read metadata from file without executing
            let meta = { name, description: '' };
            try {
                const content = fs.readFileSync(path.join(this.connectorsDir, file), 'utf-8');
                const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
                const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/);
                if (nameMatch) meta.name = nameMatch[1];
                if (descMatch) meta.description = descMatch[1];
            } catch (e) { /* ignore */ }

            results.push({
                file,
                name: meta.name,
                description: meta.description,
                status: running ? connector.status : 'stopped',
                error: running ? connector.error : null
            });
        }
        return results;
    }

    /**
     * Start a connector by filename (without .js extension)
     */
    async startConnector(name) {
        name = normalizeConnectorName(name);
        if (this.connectors.has(name) && this.connectors.get(name).status === 'running') {
            throw new Error(`Connector "${name}" is already running`);
        }

        const scriptPath = this._resolveConnectorScriptPath(name);

        // Load config from DB
        const config = await this._loadConfig(name, { includeSecrets: true });

        console.log(`[ConnectorRuntime] Starting connector "${name}"...`);

        return new Promise((resolve, reject) => {
            const worker = new Worker(this.workerPath, {
                workerData: {
                    scriptPath,
                    config,
                    connectorName: name
                }
            });

            const connectorState = {
                worker,
                config,
                status: 'starting',
                error: null,
                meta: { name },
                logs: []
            };

            this.connectors.set(name, connectorState);

            // Handle messages from worker
            worker.on('message', async (msg) => {
                switch (msg.type) {
                    case 'started':
                        connectorState.status = 'running';
                        connectorState.meta = msg.meta || { name };
                        this._log(name, `Connector started`);
                        this.emit('connector-started', { name });
                        this.eventBus?.publish('connector:started', { name });
                        resolve({ success: true, name });
                        break;

                    case 'log':
                        this._log(name, msg.message);
                        break;

                    case 'invoke':
                        try {
                            const response = await this.dispatcher.dispatch(String(msg.prompt || ''), [], { mode: 'connector' });
                            worker.postMessage({
                                type: 'invoke-response',
                                requestId: msg.requestId,
                                response: response.content
                            });
                        } catch (error) {
                            worker.postMessage({
                                type: 'invoke-response',
                                requestId: msg.requestId,
                                error: error.message
                            });
                        }
                        break;

                    case 'error':
                        connectorState.error = msg.error;
                        this._log(name, `Error: ${msg.error}`);
                        this.emit('connector-error', { name, error: msg.error });
                        this.eventBus?.publish('connector:error', { name, error: msg.error });
                        break;

                    case 'start-failed':
                        connectorState.status = 'error';
                        connectorState.error = msg.error;
                        this._log(name, `Start failed: ${msg.error}`);
                        reject(new Error(msg.error));
                        break;

                    case 'rpc':
                        await this._handleWorkerRpc(name, connectorState, worker, msg);
                        break;
                }
            });

            worker.on('error', (error) => {
                connectorState.status = 'error';
                connectorState.error = error.message;
                this._log(name, `Worker error: ${error.message}`);
                this.emit('connector-error', { name, error: error.message });
                this.eventBus?.publish('connector:error', { name, error: error.message });
            });

            worker.on('exit', (code) => {
                connectorState.status = 'stopped';
                connectorState.worker = null;
                this._log(name, `Worker exited with code ${code}`);
                this.emit('connector-stopped', { name, code });
                this.eventBus?.publish('connector:stopped', { name, code });
            });

            // Timeout for startup
            setTimeout(() => {
                if (connectorState.status === 'starting') {
                    connectorState.status = 'error';
                    connectorState.error = 'Startup timeout';
                    worker.terminate();
                    reject(new Error('Connector startup timeout (30s)'));
                }
            }, 30000);
        });
    }

    /**
     * Stop a running connector
     */
    async stopConnector(name) {
        name = normalizeConnectorName(name);
        const connector = this.connectors.get(name);
        if (!connector || connector.status !== 'running') {
            throw new Error(`Connector "${name}" is not running`);
        }

        console.log(`[ConnectorRuntime] Stopping connector "${name}"...`);

        // Send stop command to worker
        connector.worker.postMessage({ type: 'stop' });

        // Give it 5 seconds to clean up, then force terminate
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (connector.worker) {
                    connector.worker.terminate();
                }
                connector.status = 'stopped';
                this._log(name, 'Force terminated');
                resolve({ success: true, name });
            }, 5000);

            connector.worker.once('exit', () => {
                clearTimeout(timeout);
                connector.status = 'stopped';
                this._log(name, 'Stopped gracefully');
                resolve({ success: true, name });
            });
        });
    }

    /**
     * Stop all connectors (called on app quit)
     */
    async stopAll() {
        const names = Array.from(this.connectors.keys());
        for (const name of names) {
            if (this.connectors.get(name)?.status === 'running') {
                try {
                    await this.stopConnector(name);
                } catch (e) {
                    console.error(`[ConnectorRuntime] Failed to stop "${name}":`, e.message);
                }
            }
        }
    }

    // ==================== Config Management ====================

    _credentialName(name, key) {
        return `connector.${name}.${String(key || '').trim()}`;
    }

    _resolveConnectorScriptPath(name) {
        const scriptPath = path.join(this.connectorsDir, `${normalizeConnectorName(name)}.js`);
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Connector script not found: ${scriptPath}`);
        }
        const realConnectorsDir = resolveBoundaryPath(this.connectorsDir);
        const realScriptPath = resolveBoundaryPath(scriptPath);
        if (!isPathInside(realConnectorsDir, realScriptPath)) {
            throw new Error(`Connector script must stay inside connectors directory: ${name}`);
        }
        return realScriptPath;
    }

    async _loadConfig(name, options = {}) {
        name = normalizeConnectorName(name);
        const config = {};
        const prefix = `connector.${name}.`;
        const settings = await this.db.getAllSettings();
        for (const [key, value] of Object.entries(settings)) {
            if (key.startsWith(prefix)) {
                const configKey = key.slice(prefix.length);
                if (isSecretSettingKey(configKey)) {
                    const secret = this.db.getCredential
                        ? await this.db.getCredential(this._credentialName(name, configKey))
                        : value;
                    config[configKey] = options.includeSecrets === true
                        ? (secret || value || '')
                        : (secret || value ? SECRET_SETTING_REDACTION : '');
                } else {
                    config[configKey] = value;
                }
            }
        }
        return config;
    }

    async setConfig(name, key, value) {
        name = normalizeConnectorName(name);
        const settingKey = `connector.${name}.${key}`;
        const normalizedValue = value == null ? '' : String(value);
        if (isSecretSettingKey(key) && this.db.setCredential) {
            await this.db.setCredential(this._credentialName(name, key), normalizedValue);
            await this.db.saveSetting(settingKey, normalizedValue ? SECRET_SETTING_REDACTION : '');
        } else {
            await this.db.saveSetting(settingKey, normalizedValue);
        }

        // Update running connector's config
        const connector = this.connectors.get(name);
        if (connector) {
            connector.config[key] = normalizedValue;
        }

        return { success: true, name, key };
    }

    async getConfig(name, options = {}) {
        name = normalizeConnectorName(name);
        return await this._loadConfig(name, options);
    }

    // ==================== Logging ====================

    _log(name, message) {
        const connector = this.connectors.get(name);
        if (!connector) return;

        const entry = {
            timestamp: new Date().toISOString(),
            message
        };

        connector.logs.push(entry);
        if (connector.logs.length > this.maxLogs) {
            connector.logs.shift();
        }

        console.log(`[Connector:${name}] ${message}`);
        this.emit('connector-log', { name, ...entry });
    }

    getLogs(name, limit = 50) {
        name = normalizeConnectorName(name);
        const connector = this.connectors.get(name);
        if (!connector) return [];
        return connector.logs.slice(-limit);
    }

    async _handleWorkerRpc(name, connectorState, worker, msg = {}) {
        const requestId = msg.requestId;
        const op = String(msg.op || '').trim();
        const payload = msg.payload || {};

        if (!requestId || !op) {
            worker.postMessage({
                type: 'rpc-response',
                requestId,
                error: 'Invalid RPC request'
            });
            return;
        }

        try {
            let result = null;
            if (op === 'invoke') {
                const prompt = String(payload.prompt || '');
                const response = await this.dispatcher.dispatch(prompt, [], { mode: 'connector' });
                result = response?.content || '';
            } else if (op === 'config:get') {
                if (payload.key) {
                    result = connectorState.config?.[String(payload.key)] ?? '';
                } else {
                    result = { ...(connectorState.config || {}) };
                }
            } else if (op === 'config:set') {
                if (!payload.key) {
                    throw new Error('config:set requires key');
                }
                const key = String(payload.key);
                const value = payload.value == null ? '' : String(payload.value);
                await this.setConfig(name, key, value);
                result = { success: true, key, value };
            } else if (op === 'chat:request-reply') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.requestReply(payload);
            } else if (op === 'chat:new-session') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.newSession(payload);
            } else if (op === 'chat:get-session') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.getSession(payload);
            } else if (op === 'chat:clear-session') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.clearSession(payload);
            } else if (op === 'chat:append-message') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.appendMessage(payload);
            } else if (op === 'models:list-providers') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.listProviders();
            } else if (op === 'models:list-models') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.listModels(payload.provider);
            } else if (op === 'models:set-global') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.setGlobalModel(payload.provider, payload.model);
            } else if (op === 'models:get-global') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.getGlobalModel();
            } else if (op === 'settings:set-thinking') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.setThinkingMode(payload.mode);
            } else if (op === 'settings:set-context-window') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.setContextWindow(payload.tokens);
            } else if (op === 'control:stop-generation') {
                this._assertExternalBridge(op);
                result = await this.externalChannelBridge.stopGeneration();
            } else {
                throw new Error(`Unsupported RPC op: ${op}`);
            }

            worker.postMessage({
                type: 'rpc-response',
                requestId,
                result
            });
        } catch (error) {
            worker.postMessage({
                type: 'rpc-response',
                requestId,
                error: error.message
            });
        }
    }

    _assertExternalBridge(op) {
        if (!this.externalChannelBridge) {
            throw new Error(`Connector RPC "${op}" requires external channel bridge`);
        }
    }
}

module.exports = ConnectorRuntime;
