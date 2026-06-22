const fs = require('fs');
const path = require('path');
const { SECRET_SETTING_REDACTION } = require('../../src/main/settings-security');
const { PluginConfigStore, credentialProviderName, pluginSettingKey } = require('../../src/main/plugin-config-store');

function makeDb() {
  const settings = new Map();
  const apiKeys = new Map();
  return {
    settings,
    apiKeys,
    all(sql, args = []) {
      if (!sql.includes('FROM settings')) return [];
      const prefix = String(args[0] || '').replace('%', '');
      return Array.from(settings.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
    get(sql, args = []) {
      if (sql.includes('FROM api_keys')) {
        const row = apiKeys.get(args[0]);
        return row ? { ...row } : undefined;
      }
      if (sql.includes('FROM settings')) {
        const value = settings.get(args[0]);
        return value == null ? undefined : { value };
      }
      return undefined;
    },
    run(sql, args = []) {
      if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
        settings.set(args[0], String(args[1]));
        return;
      }
      if (sql.startsWith('DELETE FROM settings')) {
        settings.delete(args[0]);
        return;
      }
      if (sql.startsWith('INSERT OR REPLACE INTO api_keys')) {
        const [provider, key, encrypted] = args;
        apiKeys.set(provider, { provider, key, encrypted });
        return;
      }
      if (sql.startsWith('DELETE FROM api_keys')) {
        apiKeys.delete(args[0]);
      }
    }
  };
}

module.exports = {
  name: 'plugin-secret-config-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const manifestPath = path.join(rootDir, 'agentin', 'plugins', 'telegram-relay', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const secretFields = ['botToken', 'apiHash', 'sessionString', 'proxyPassword', 'proxySecret'];

    for (const key of secretFields) {
      assert.equal(manifest.configSchema[key]?.secret, true, `Expected ${key} to be declared as a secret field`);
    }

    const db = makeDb();
    const store = new PluginConfigStore(db);
    db.settings.set(pluginSettingKey('telegram-relay', 'botToken'), 'legacy-token');
    db.settings.set(pluginSettingKey('telegram-relay', 'ownerChatId'), '123');

    const internal = store.load('telegram-relay', manifest, { includeSecrets: true });
    assert.equal(internal.botToken, 'legacy-token', 'Plugin runtime config should receive the real secret');
    assert.equal(internal.ownerChatId, '123', 'Ordinary plugin config should still load from settings');
    assert.equal(db.settings.has(pluginSettingKey('telegram-relay', 'botToken')), false, 'Legacy secret setting should migrate out of settings');
    assert.equal(
      db.apiKeys.get(credentialProviderName('plugin.telegram-relay.botToken'))?.key,
      'legacy-token',
      'Secret config should be stored through credential storage'
    );

    const rendererConfig = store.load('telegram-relay', manifest);
    assert.equal(rendererConfig.botToken, SECRET_SETTING_REDACTION, 'Renderer-facing config should redact stored secrets');
    assert.equal(rendererConfig.ownerChatId, '123', 'Renderer-facing config should keep ordinary values readable');

    store.set('telegram-relay', manifest, 'botToken', SECRET_SETTING_REDACTION);
    assert.equal(
      db.apiKeys.get(credentialProviderName('plugin.telegram-relay.botToken'))?.key,
      'legacy-token',
      'Saving an unchanged redaction marker should preserve the existing secret'
    );

    store.set('telegram-relay', manifest, 'botToken', 'next-token');
    assert.equal(
      db.apiKeys.get(credentialProviderName('plugin.telegram-relay.botToken'))?.key,
      'next-token',
      'Saving a new secret should replace the credential value'
    );
    assert.equal(db.settings.has(pluginSettingKey('telegram-relay', 'botToken')), false, 'New secrets should not be written to settings');

    store.set('telegram-relay', manifest, 'mtprotoPhoneCodeHash', 'phone-code-hash');
    assert.equal(
      store.get('telegram-relay', manifest, 'mtprotoPhoneCodeHash', { includeSecrets: true }),
      'phone-code-hash',
      'Direct secret reads should work for hidden secret-like plugin keys'
    );

    store.set('telegram-relay', manifest, 'botToken', '');
    assert.equal(
      db.apiKeys.has(credentialProviderName('plugin.telegram-relay.botToken')),
      false,
      'Saving an empty secret should delete the credential'
    );
  }
};
