const fs = require('fs');
const os = require('os');
const path = require('path');

class MemoryDB {
  constructor() {
    this.settings = new Map();
    this.apiKeys = new Map();
    this.plugins = new Map();
    this.knowledge = new Map();
  }

  get(sql, args = []) {
    if (sql.includes('FROM plugins')) {
      const id = args[0];
      const plugin = this.plugins.get(id);
      if (!plugin) return undefined;
      if (sql.includes('SELECT id')) return {
        id: plugin.id,
        status: plugin.status,
        visible_in_sidebar: plugin.visible_in_sidebar ?? 1
      };
      if (sql.includes('SELECT status')) return { status: plugin.status };
      return plugin;
    }

    if (sql.includes('FROM api_keys')) {
      const row = this.apiKeys.get(args[0]);
      return row ? { ...row } : undefined;
    }

    if (sql.includes('FROM settings')) {
      const value = this.settings.get(args[0]);
      return value == null ? undefined : { value };
    }

    if (sql.includes('SELECT * FROM knowledge_items WHERE slug = ?')) {
      return this.knowledge.get(args[0]);
    }

    if (sql.includes('SELECT slug FROM knowledge_items WHERE slug = ?')) {
      return this.knowledge.get(args[0]);
    }

    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'active'")) {
      return { count: Array.from(this.knowledge.values()).filter(item => item.status === 'active').length };
    }

    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'staged'")) {
      return { count: Array.from(this.knowledge.values()).filter(item => item.status === 'staged').length };
    }

    if (sql.includes('COUNT(*) as count FROM knowledge_items')) {
      return { count: this.knowledge.size };
    }

    return undefined;
  }

  all(sql, args = []) {
    if (sql.includes('SELECT key, value FROM settings WHERE key LIKE')) {
      const prefix = String(args[0] || '').replace('%', '');
      return Array.from(this.settings.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    }

    if (sql.includes('SELECT * FROM knowledge_items')) {
      return Array.from(this.knowledge.values());
    }

    return [];
  }

  run(sql, args = []) {
    if (sql.startsWith('INSERT INTO plugins')) {
      const [id, name, version, status] = args;
      this.plugins.set(id, { id, name, version, status, visible_in_sidebar: 1, error: null });
      return;
    }

    if (sql.startsWith('UPDATE plugins SET visible_in_sidebar')) {
      const [visible, id] = args;
      const plugin = this.plugins.get(id) || { id, name: id, version: '0.0.0', status: 'disabled', error: null };
      plugin.visible_in_sidebar = visible;
      this.plugins.set(id, plugin);
      return;
    }

    if (sql.startsWith('UPDATE plugins SET status')) {
      const [status, error, id] = args;
      const plugin = this.plugins.get(id) || { id, name: id, version: '0.0.0', error: null };
      plugin.status = status;
      plugin.error = error;
      this.plugins.set(id, plugin);
      return;
    }

    if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
      this.settings.set(args[0], String(args[1]));
      return;
    }

    if (sql.startsWith('INSERT OR REPLACE INTO api_keys')) {
      const [provider, key, encrypted] = args;
      this.apiKeys.set(provider, { provider, key, encrypted });
      return;
    }

    if (sql.startsWith('DELETE FROM api_keys')) {
      this.apiKeys.delete(args[0]);
      return;
    }

    if (sql.startsWith('DELETE FROM settings')) {
      this.settings.delete(args[0]);
      return;
    }

    if (sql.includes('INSERT OR REPLACE INTO knowledge_items')) {
      const [slug, title, category, status, tags, source, confidence, folderPath] = args;
      this.knowledge.set(slug, {
        slug,
        title,
        category,
        status,
        tags,
        source,
        confidence,
        folder_path: folderPath
      });
      return;
    }

    if (sql.startsWith('UPDATE knowledge_items SET folder_path')) {
      const [folderPath, slug] = args;
      const item = this.knowledge.get(slug);
      if (item) item.folder_path = folderPath;
      return;
    }

    if (sql.startsWith('UPDATE knowledge_items SET status = ?, confirmed_at')) {
      const [status, slug] = args;
      const item = this.knowledge.get(slug);
      if (item) item.status = status;
      return;
    }

    if (sql.startsWith('DELETE FROM knowledge_items')) {
      this.knowledge.delete(args[0]);
    }
  }

  async getSetting(key) {
    return this.settings.get(key) || null;
  }

  async setSetting(key, value) {
    this.settings.set(key, String(value));
    return { key, value };
  }

  async saveSetting(key, value) {
    return this.setSetting(key, value);
  }

  async getCustomTools() {
    return [];
  }
}

class TestContainer {
  constructor(map) {
    this.map = map;
  }

  get(name) {
    if (!(name in this.map)) {
      throw new Error(`Missing service ${name}`);
    }
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }
}

class PluginCapabilityStub {
  constructor() {
    this.safeTools = new Map();
    this.mainEnabled = false;
    this.groups = {
      web: false,
      unsafe: false,
      files: 'off',
      terminal: 'off',
      memory: false,
      ports: false
    };
  }

  registerCustomTool(toolName, isSafe = false) {
    this.safeTools.set(toolName, isSafe);
  }

  unregisterCustomTool(toolName) {
    this.safeTools.delete(toolName);
  }

  isToolActive(toolName) {
    return this.safeTools.get(toolName) === true;
  }

  getActiveTools() {
    return Array.from(this.safeTools.entries())
      .filter(([, isSafe]) => isSafe === true)
      .map(([toolName]) => toolName);
  }

  isMainEnabled() {
    return this.mainEnabled;
  }

  setMainEnabled(enabled) {
    this.mainEnabled = enabled === true;
    return this.mainEnabled;
  }

  setGroupEnabled(groupId, enabled) {
    if (groupId === 'files') {
      this.groups.files = enabled ? 'read' : 'off';
    } else if (groupId === 'terminal') {
      this.groups.terminal = enabled ? 'workspace' : 'off';
    } else {
      this.groups[groupId] = enabled === true;
    }
    return true;
  }

  isGroupEnabled(groupId) {
    const val = this.groups[groupId];
    return typeof val === 'string' ? val !== 'off' : val === true;
  }

  setFilesMode(mode) {
    this.groups.files = mode;
    return mode;
  }

  getFilesMode() {
    return this.groups.files || 'off';
  }

  setTerminalMode(mode) {
    this.groups.terminal = mode;
    return mode;
  }

  getTerminalMode() {
    return this.groups.terminal || 'off';
  }

  getState() {
    return {
      mainEnabled: this.mainEnabled,
      groups: { ...this.groups },
      activeToolCount: this.safeTools.size
    };
  }

  getGroupsConfig() {
    return Object.entries(this.groups).map(([id, val]) => {
      const isModeGroup = id === 'files' || id === 'terminal';
      const enabled = isModeGroup ? val !== 'off' : val === true;
      return {
        id,
        name: id.toUpperCase(),
        description: `${id} capabilities`,
        icon: '🔧',
        enabled,
        mode: isModeGroup ? val : undefined,
        modes: isModeGroup ? (id === 'files' ? { off: [], read: ['read_file'], full: ['read_file', 'write_file'] } : { off: [], workspace: ['run_command'], system: ['run_command'] }) : undefined,
        tools: [],
        allTools: []
      };
    });
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createDirLink(targetPath, linkPath) {
  fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

module.exports = {
  createDirLink,
  MemoryDB,
  TestContainer,
  PluginCapabilityStub,
  makeTempDir
};
