const { decryptSecret, encryptSecret } = require('./secure-secret-store');
const { SECRET_SETTING_REDACTION, isSecretSettingKey } = require('./settings-security');

function normalizePluginConfigKey(key) {
    const normalized = String(key || '').trim();
    if (!normalized) throw new Error('Plugin config key is required');
    return normalized;
}

function pluginSettingKey(pluginId, key) {
    return `plugin.${pluginId}.${key}`;
}

function credentialName(pluginId, key) {
    return pluginSettingKey(pluginId, key);
}

function credentialProviderName(name) {
    return `credential:${String(name || '').trim().toLowerCase()}`;
}

function isSchemaSecretField(definition = {}) {
    return definition?.secret === true || String(definition?.type || '').toLowerCase() === 'password';
}

class PluginConfigStore {
    constructor(db) {
        this.db = db;
    }

    isSecret(pluginId, manifest, key) {
        const normalized = normalizePluginConfigKey(key);
        const schema = manifest?.configSchema || {};
        return isSchemaSecretField(schema[normalized]) || isSecretSettingKey(pluginSettingKey(pluginId, normalized));
    }

    load(pluginId, manifest = {}, options = {}) {
        const includeSecrets = options.includeSecrets === true;
        const config = {};
        const prefix = `plugin.${pluginId}.`;
        const rows = this.db.all('SELECT key, value FROM settings WHERE key LIKE ?', [`${prefix}%`]);
        const seen = new Set();

        for (const row of rows) {
            const key = row.key.slice(prefix.length);
            seen.add(key);
            if (this.isSecret(pluginId, manifest, key)) {
                this._loadSecret(config, pluginId, key, row.value, includeSecrets);
            } else {
                config[key] = row.value;
            }
        }

        for (const key of this._manifestSecretKeys(manifest)) {
            if (seen.has(key)) continue;
            const credential = this._getCredential(credentialName(pluginId, key));
            if (credential == null) continue;
            config[key] = includeSecrets ? credential : SECRET_SETTING_REDACTION;
        }

        return config;
    }

    get(pluginId, manifest = {}, key, options = {}) {
        const normalized = normalizePluginConfigKey(key);
        const includeSecrets = options.includeSecrets === true;
        if (this.isSecret(pluginId, manifest, normalized)) {
            const credential = this._getCredential(credentialName(pluginId, normalized));
            if (credential != null) return includeSecrets ? credential : SECRET_SETTING_REDACTION;
            const row = this._getSetting(pluginSettingKey(pluginId, normalized));
            if (!row || String(row.value || '') === '') return undefined;
            if (this._setCredential(credentialName(pluginId, normalized), row.value)) {
                this._deleteSetting(pluginSettingKey(pluginId, normalized));
            }
            return includeSecrets ? String(row.value || '') : SECRET_SETTING_REDACTION;
        }
        const row = this._getSetting(pluginSettingKey(pluginId, normalized));
        if (!row) return undefined;
        if (!this.isSecret(pluginId, manifest, normalized)) return row.value;
        return includeSecrets ? String(row.value || '') : SECRET_SETTING_REDACTION;
    }

    set(pluginId, manifest = {}, key, value) {
        const normalized = normalizePluginConfigKey(key);
        if (this.isSecret(pluginId, manifest, normalized)) {
            return this._setSecret(pluginId, normalized, value);
        }

        this.db.run(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [pluginSettingKey(pluginId, normalized), String(value)]
        );
        return { key: normalized, value: String(value), secret: false, preserved: false };
    }

    _loadSecret(config, pluginId, key, legacyValue, includeSecrets) {
        const name = credentialName(pluginId, key);
        let credential = this._getCredential(name);
        const hasLegacyValue = legacyValue != null && String(legacyValue) !== '';

        if (credential == null && hasLegacyValue && this._setCredential(name, legacyValue)) {
            credential = String(legacyValue);
            this._deleteSetting(pluginSettingKey(pluginId, key));
        }

        if (credential != null) {
            config[key] = includeSecrets ? credential : SECRET_SETTING_REDACTION;
        } else if (hasLegacyValue) {
            config[key] = includeSecrets ? String(legacyValue) : SECRET_SETTING_REDACTION;
        }
    }

    _setSecret(pluginId, key, value) {
        if (String(value) === SECRET_SETTING_REDACTION) {
            return { key, secret: true, preserved: true };
        }

        const name = credentialName(pluginId, key);
        const nextValue = String(value || '');
        if (!nextValue) {
            this._deleteCredential(name);
            this._deleteSetting(pluginSettingKey(pluginId, key));
            return { key, value: '', secret: true, preserved: false };
        }

        if (!this._setCredential(name, nextValue)) {
            this.db.run(
                'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [pluginSettingKey(pluginId, key), nextValue]
            );
        } else {
            this._deleteSetting(pluginSettingKey(pluginId, key));
        }
        return { key, value: nextValue, secret: true, preserved: false };
    }

    _manifestSecretKeys(manifest = {}) {
        return Object.entries(manifest.configSchema || {})
            .filter(([, definition]) => isSchemaSecretField(definition))
            .map(([key]) => key);
    }

    _getCredential(name) {
        if (!this.db?.get) return null;
        try {
            const row = this.db.get('SELECT key, encrypted FROM api_keys WHERE provider = ?', [credentialProviderName(name)]);
            if (!row) return null;
            return decryptSecret(row.key, Boolean(row.encrypted));
        } catch (error) {
            return null;
        }
    }

    _getSetting(settingKey) {
        try {
            return this.db.get('SELECT value FROM settings WHERE key = ?', [settingKey]);
        } catch (error) {
            return null;
        }
    }

    _setCredential(name, value) {
        if (!this.db?.run) return false;
        try {
            const encrypted = encryptSecret(value);
            this.db.run(
                'INSERT OR REPLACE INTO api_keys (provider, key, encrypted) VALUES (?, ?, ?)',
                [credentialProviderName(name), encrypted.value, encrypted.encrypted ? 1 : 0]
            );
            return this._getCredential(name) === String(value);
        } catch (error) {
            return false;
        }
    }

    _deleteCredential(name) {
        try {
            this.db.run('DELETE FROM api_keys WHERE provider = ?', [credentialProviderName(name)]);
        } catch (error) {}
    }

    _deleteSetting(settingKey) {
        try {
            this.db.run('DELETE FROM settings WHERE key = ?', [settingKey]);
        } catch (error) {}
    }
}

module.exports = {
    PluginConfigStore,
    credentialName,
    credentialProviderName,
    pluginSettingKey
};
