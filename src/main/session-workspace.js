const fs = require('fs');
const path = require('path');
const { buildRuntimePaths } = require('./runtime-paths');

/**
 * SessionWorkspace — Per-session temp folder manager.
 *
 * Each chat session (or subagent) gets a personal workspace directory
 * under agentin/workspaces/{sessionId}/.  Terminal output, temp files,
 * and other ephemeral artifacts live here.
 *
 * Workspaces are cleaned on session close and stale ones purged on startup.
 */
class SessionWorkspace {
    constructor(basePath = null) {
        this.basePath = path.resolve(basePath || buildRuntimePaths().sessionWorkspaceBase);
        this._ensureBase();
    }

    _ensureBase() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
    }

    _normalizeSessionId(sessionId) {
        const normalized = String(sessionId ?? '').trim();
        if (!normalized) {
            throw new Error('Session workspace requires a session id');
        }
        if (normalized === '.' || normalized === '..') {
            throw new Error('Invalid session workspace id');
        }
        if (path.isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\')) {
            throw new Error('Invalid session workspace id');
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
            throw new Error('Invalid session workspace id');
        }
        return normalized;
    }

    _assertInsideBase(resolvedPath) {
        const base = this.basePath.endsWith(path.sep) ? this.basePath : `${this.basePath}${path.sep}`;
        if (resolvedPath !== this.basePath && !resolvedPath.startsWith(base)) {
            throw new Error('Session workspace path escaped base directory');
        }
        return resolvedPath;
    }

    _resolveWorkspacePath(sessionId) {
        const safeSessionId = this._normalizeSessionId(sessionId);
        return this._assertInsideBase(path.resolve(this.basePath, safeSessionId));
    }

    /**
     * Get (and create) the workspace directory for a session.
     */
    getWorkspacePath(sessionId) {
        const dir = this._resolveWorkspacePath(sessionId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Write content to a file in the session workspace.
     * Returns { filePath, fileName, size }.
     */
    writeOutput(sessionId, label, content) {
        const dir = this.getWorkspacePath(sessionId);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = (label || 'output').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
        const fileName = `${safeName}_${timestamp}.log`;
        const filePath = path.join(dir, fileName);

        fs.writeFileSync(filePath, content, 'utf-8');

        return { filePath, fileName, size: Buffer.byteLength(content, 'utf-8') };
    }

    /**
     * List all files in a session workspace.
     */
    listFiles(sessionId) {
        const dir = this._resolveWorkspacePath(sessionId);
        if (!fs.existsSync(dir)) return [];

        return fs.readdirSync(dir)
            .filter(f => !f.startsWith('.'))
            .map(f => {
                const fp = path.join(dir, f);
                const stat = fs.statSync(fp);
                return {
                    name: f,
                    path: fp,
                    size: stat.size,
                    created: stat.birthtime
                };
            });
    }

    /**
     * Search file contents in a session workspace (grep-like).
     */
    searchFiles(sessionId, query) {
        const files = this.listFiles(sessionId);
        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.path, 'utf-8');
                const lines = content.split('\n');
                const matches = [];

                lines.forEach((line, i) => {
                    if (line.toLowerCase().includes(lowerQuery)) {
                        matches.push({ line: i + 1, content: line.trim().substring(0, 200) });
                    }
                });

                if (matches.length > 0) {
                    results.push({
                        file: file.name,
                        path: file.path,
                        matchCount: matches.length,
                        matches: matches.slice(0, 20) // Cap at 20 matches per file
                    });
                }
            } catch (e) { /* skip binary/unreadable files */ }
        }

        return results;
    }

    /**
     * Delete an entire session workspace.
     */
    cleanup(sessionId) {
        const dir = this._resolveWorkspacePath(sessionId);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`[SessionWorkspace] Cleaned up workspace for session ${sessionId}`);
            return true;
        }
        return false;
    }

    /**
     * Remove workspaces older than maxAgeDays.
     * Called on app startup.
     */
    cleanupStale(maxAgeDays = 30) {
        if (!fs.existsSync(this.basePath)) return 0;

        let cleaned = 0;
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

        const entries = fs.readdirSync(this.basePath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dirPath = path.join(this.basePath, entry.name);
            try {
                const stat = fs.statSync(dirPath);
                if (stat.mtime.getTime() < cutoff) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    cleaned++;
                    console.log(`[SessionWorkspace] Purged stale workspace: ${entry.name}`);
                }
            } catch (e) { /* skip */ }
        }

        if (cleaned > 0) {
            console.log(`[SessionWorkspace] Purged ${cleaned} stale workspace(s)`);
        }
        return cleaned;
    }
}

module.exports = SessionWorkspace;
