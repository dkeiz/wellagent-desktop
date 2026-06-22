const fs = require('fs');
const path = require('path');

function migrateLegacyPackagedDb(options, targetDbPath) {
    const electronApp = options.app || null;
    if (!electronApp?.isPackaged || fs.existsSync(targetDbPath)) {
        return;
    }

    const execPath = options.execPath || process.execPath;
    const legacyPath = path.join(path.dirname(execPath), 'agentin', 'memory', 'localagent.db');
    if (!fs.existsSync(legacyPath)) {
        return;
    }

    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    fs.copyFileSync(legacyPath, targetDbPath);
}

function resolveDbPath(options = {}) {
    if (options.dbPath) {
        return options.dbPath;
    }
    const electronApp = options.app || require('electron').app;
    if (!electronApp || typeof electronApp.getPath !== 'function') {
        throw new Error('Electron app context is unavailable. Pass dbPath when constructing DatabaseWrapper outside Electron.');
    }
    const dbPath = path.join(electronApp.getPath('userData'), 'localagent.db');
    migrateLegacyPackagedDb(options, dbPath);
    return dbPath;
}

module.exports = {
    migrateLegacyPackagedDb,
    resolveDbPath
};
