const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BaseAdapter = require('./base-adapter');

const DEFAULT_MODELS = [
    'gpt-5.2-codex',
    'gpt-5-codex',
    'gpt-5.2',
    'gpt-5.2-pro',
    'gpt-5-mini',
    'gpt-5-nano'
];

class CodexCliAdapter extends BaseAdapter {
    constructor(db) {
        super('codex-cli', db);
        this.children = new Map();
    }

    async call(messages, options = {}) {
        const { requestId, signal } = this._startRequest();
        const prompt = this._formatPrompt(messages);
        const model = options.model || await this.db.getSetting('llm.openai.codexModel') || DEFAULT_MODELS[0];
        const cwd = await this._getWorkingDirectory();
        const sandbox = await this.db.getSetting('llm.openai.codexSandbox') || 'read-only';
        const searchEnabled = (await this.db.getSetting('llm.openai.codexSearch')) === 'true';
        const timeoutMs = Number(await this.db.getSetting('llm.openai.codexTimeoutMs')) || 120000;
        const maxOutput = Number(await this.db.getSetting('llm.openai.codexMaxOutput')) || 120000;

        const args = [];
        if (searchEnabled) args.push('--search');
        args.push(
            'exec',
            '--cd', cwd,
            '--sandbox', this._sanitizeSandbox(sandbox),
            '--color', 'never',
            '-m', model
        );
        args.push(prompt);

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const command = this._resolveCodexCommand();
            const child = spawn(command, args, {
                cwd,
                windowsHide: true,
                shell: false,
                env: { ...process.env, NO_COLOR: '1' }
            });

            this.children.set(requestId, child);
            const timer = setTimeout(() => {
                if (settled) return;
                child.kill();
                settled = true;
                this.children.delete(requestId);
                this._endRequest(requestId);
                reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            signal.addEventListener('abort', () => {
                if (settled) return;
                child.kill();
                settled = true;
                clearTimeout(timer);
                this.children.delete(requestId);
                this._endRequest(requestId);
                resolve(this._normalizeResponse({
                    content: '[Generation stopped by user]',
                    model,
                    stopped: true
                }));
            });

            child.stdout.on('data', chunk => {
                stdout = this._appendLimited(stdout, chunk, maxOutput);
            });
            child.stderr.on('data', chunk => {
                stderr = this._appendLimited(stderr, chunk, maxOutput);
            });
            child.on('error', error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.children.delete(requestId);
                this._endRequest(requestId);
                reject(new Error(`Codex CLI failed to start: ${error.message}`));
            });
            child.on('close', code => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.children.delete(requestId);
                this._endRequest(requestId);
                if (code !== 0) {
                    return reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`.trim()));
                }
                resolve(this._normalizeResponse({
                    content: this._cleanOutput(stdout) || stderr.trim(),
                    model
                }));
            });
        });
    }

    async getModels() {
        return DEFAULT_MODELS;
    }

    stop(requestId = null) {
        const id = requestId ? String(requestId) : '';
        let stoppedChild = false;
        if (id) {
            const child = this.children.get(id);
            if (child) {
                child.kill();
                this.children.delete(id);
                stoppedChild = true;
            }
        } else {
            stoppedChild = this.children.size > 0;
            for (const child of this.children.values()) {
                child.kill();
            }
            this.children.clear();
        }
        return super.stop(requestId) || stoppedChild;
    }

    async getStatus() {
        const command = this._resolveCodexCommand();
        const version = spawnSync(command, ['--version'], {
            encoding: 'utf8',
            windowsHide: true
        });
        if (version.error) {
            return {
                installed: fs.existsSync(command),
                loggedIn: false,
                path: fs.existsSync(command) ? command : '',
                error: version.error.message,
                models: DEFAULT_MODELS
            };
        }

        const auth = spawnSync(command, ['exec', '--help'], {
            encoding: 'utf8',
            windowsHide: true
        });
        return {
            installed: true,
            loggedIn: auth.status === 0,
            path: command,
            version: `${version.stdout || version.stderr}`.trim(),
            models: DEFAULT_MODELS
        };
    }

    async launchLogin() {
        const command = this._resolveCodexCommand();
        const args = ['login'];
        const child = spawn(command, args, {
            detached: true,
            stdio: process.platform === 'win32' ? 'ignore' : 'ignore',
            windowsHide: false
        });
        child.unref();
        return { launched: true };
    }

    async _getWorkingDirectory() {
        const configured = await this.db.getSetting('llm.openai.codexCwd');
        const executionRoot = await this.db.getSetting('execution.rootPath');
        return configured || executionRoot || path.resolve(process.cwd());
    }

    _formatPrompt(messages = []) {
        return messages.map(message => {
            const role = String(message.role || 'user').toUpperCase();
            return `${role}:\n${message.content || ''}`;
        }).join('\n\n');
    }

    _appendLimited(current, chunk, maxOutput) {
        const next = current + chunk.toString();
        return next.length > maxOutput ? next.slice(next.length - maxOutput) : next;
    }

    _cleanOutput(output) {
        return String(output || '').trim();
    }

    _sanitizeSandbox(value) {
        return ['read-only', 'workspace-write', 'danger-full-access'].includes(value)
            ? value
            : 'read-only';
    }

    _resolveCodexCommand() {
        const configured = process.env.LOCALAGENT_CODEX_PATH || process.env.CODEX_CLI_PATH;
        if (configured && fs.existsSync(configured)) return configured;

        const fromPath = process.platform === 'win32'
            ? this._findOnPath('codex.exe') || this._findOnPath('codex.cmd')
            : this._findOnPath('codex');
        if (fromPath) return fromPath;

        if (process.platform === 'win32') {
            const vscode = path.join(os.homedir(), '.vscode', 'extensions');
            const extensionMatch = this._findNewestCodexInExtensions(vscode);
            if (extensionMatch) return extensionMatch;
        }

        return process.platform === 'win32' ? 'codex.exe' : 'codex';
    }

    _findOnPath(binary) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const candidate = path.join(entry, binary);
            if (fs.existsSync(candidate)) return candidate;
        }
        return '';
    }

    _findNewestCodexInExtensions(root) {
        if (!fs.existsSync(root)) return '';
        const matches = fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
            .map(entry => path.join(root, entry.name, 'bin', 'windows-x86_64', 'codex.exe'))
            .filter(candidate => fs.existsSync(candidate))
            .sort()
            .reverse();
        return matches[0] || '';
    }
}

module.exports = {
    CodexCliAdapter,
    DEFAULT_MODELS
};
