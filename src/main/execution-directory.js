const fs = require('fs');
const path = require('path');
const {
    isPathInside,
    normalizePathForCompare,
    resolveBoundaryPath
} = require('./path-boundary');

const EXECUTION_ROOT_SETTING = 'execution.rootPath';
const EXECUTION_ALLOW_OUTSIDE_SETTING = 'execution.allowOutsideRoot';

function normalizeBoolean(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

class ExecutionDirectory {
    constructor(db, options = {}) {
        this.db = db;
        this.defaultRoot = resolveBoundaryPath(options.defaultRoot || process.cwd());
    }

    getDefaultRoot() {
        return this.defaultRoot;
    }

    async getConfiguredRoot() {
        const configured = this.db?.getSetting
            ? await this.db.getSetting(EXECUTION_ROOT_SETTING)
            : null;
        const normalized = String(configured || '').trim();
        return normalized ? resolveBoundaryPath(normalized) : null;
    }

    async getRoot() {
        return await this.getConfiguredRoot() || this.defaultRoot;
    }

    async isOutsideAllowed() {
        const value = this.db?.getSetting
            ? await this.db.getSetting(EXECUTION_ALLOW_OUTSIDE_SETTING)
            : null;
        return normalizeBoolean(value);
    }

    async getContext() {
        const configuredRoot = await this.getConfiguredRoot();
        return {
            rootPath: configuredRoot || this.defaultRoot,
            configuredRoot,
            defaultRoot: this.defaultRoot,
            source: configuredRoot ? 'configured' : 'default',
            allowOutsideRoot: await this.isOutsideAllowed()
        };
    }

    async setRoot(rawPath) {
        const resolved = path.resolve(String(rawPath || '').trim());
        if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            throw new Error('Execution folder must be an existing directory');
        }
        const canonical = resolveBoundaryPath(resolved);
        if (!this.db?.saveSetting) {
            throw new Error('Settings storage is unavailable');
        }
        await this.db.saveSetting(
            EXECUTION_ROOT_SETTING,
            normalizePathForCompare(canonical) === normalizePathForCompare(this.defaultRoot) ? '' : canonical
        );
        return this.getContext();
    }

    async clearRoot() {
        if (!this.db?.saveSetting) {
            throw new Error('Settings storage is unavailable');
        }
        await this.db.saveSetting(EXECUTION_ROOT_SETTING, '');
        return this.getContext();
    }

    async setAllowOutsideRoot(value) {
        if (!this.db?.saveSetting) {
            throw new Error('Settings storage is unavailable');
        }
        await this.db.saveSetting(EXECUTION_ALLOW_OUTSIDE_SETTING, value ? 'true' : 'false');
        return this.getContext();
    }

    async assertPathAllowed(rawPath, options = {}) {
        const candidate = resolveBoundaryPath(rawPath);
        if (await this.isOutsideAllowed()) {
            return true;
        }

        const roots = [await this.getRoot(), ...(options.extraRoots || [])]
            .filter(Boolean)
            .map(root => resolveBoundaryPath(root));
        if (roots.some(root => isPathInside(root, candidate))) {
            return true;
        }

        const error = new Error(`Path is outside the execution folder: ${candidate}`);
        error.code = 'OUTSIDE_EXECUTION_ROOT';
        error.executionRoot = roots[0] || null;
        throw error;
    }
}

module.exports = {
    EXECUTION_ALLOW_OUTSIDE_SETTING,
    EXECUTION_ROOT_SETTING,
    ExecutionDirectory,
    isInsidePath: isPathInside,
    isPathInside
};
