class PluginStateStore {
  constructor(db) {
    this.db = db;
  }

  ensurePluginRow(manifest) {
    const existing = this.db.get('SELECT id, status FROM plugins WHERE id = ?', [manifest.id]);
    if (!existing) {
      this.db.run(
        'INSERT INTO plugins (id, name, version, status) VALUES (?, ?, ?, ?)',
        [manifest.id, manifest.name, manifest.version || '0.0.0', 'disabled']
      );
      return { id: manifest.id, status: 'disabled' };
    }
    return existing;
  }

  getStatus(pluginId) {
    const row = this.db.get('SELECT status FROM plugins WHERE id = ?', [pluginId]);
    return row?.status || null;
  }

  updateStatus(pluginId, status, error = null) {
    this.db.run(
      'UPDATE plugins SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, error, pluginId]
    );
  }

  sidebarVisibleSettingKey(pluginId) {
    return `plugin-ui.${pluginId}.visibleInSidebar`;
  }

  readSidebarVisible(pluginId) {
    try {
      const row = this.db.get('SELECT visible_in_sidebar FROM plugins WHERE id = ?', [pluginId]);
      if (row && row.visible_in_sidebar != null) {
        return row.visible_in_sidebar !== 0;
      }
    } catch (_) {}

    try {
      const setting = this.db.get('SELECT value FROM settings WHERE key = ?', [this.sidebarVisibleSettingKey(pluginId)]);
      if (setting?.value != null) {
        return String(setting.value).toLowerCase() === 'true';
      }
    } catch (_) {}

    return true;
  }

  setSidebarVisible(pluginId, visible) {
    const visibleInSidebar = visible === true;
    try {
      this.db.run(
        'UPDATE plugins SET visible_in_sidebar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [visibleInSidebar ? 1 : 0, pluginId]
      );
    } catch (_) {
      this.db.run(
        'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [this.sidebarVisibleSettingKey(pluginId), String(visibleInSidebar)]
      );
    }
    return visibleInSidebar;
  }
}

module.exports = PluginStateStore;
