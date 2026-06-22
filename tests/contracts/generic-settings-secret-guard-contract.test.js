const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'generic-settings-secret-guard-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const policy = require(path.join(rootDir, 'src', 'main', 'settings-security.js'));
    const chatHandlers = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-chat-data-handlers.js'), 'utf8');
    const llmHandlers = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-llm-handlers.js'), 'utf8');
    const workflowHandlers = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-workflow-handlers.js'), 'utf8');

    assert.equal(policy.isSecretSettingKey('llm.openai.apiKey'), true, 'Expected API key settings to be secret-like');
    assert.equal(policy.isSecretSettingKey('companion.bearerToken.device-1'), true, 'Expected companion bearer tokens to be secret-like');
    assert.equal(policy.isSecretSettingKey('llm.qwen.oauthCreds'), true, 'Expected OAuth credential settings to be secret-like');
    assert.equal(policy.isSecretSettingKey('plugin.telegram.proxyPassword'), true, 'Expected plugin password settings to be secret-like');
    assert.equal(policy.isSecretSettingKey('llm.qwen.useOAuth'), false, 'Expected non-secret OAuth mode flag to remain readable');
    assert.equal(policy.isSecretSettingKey('ui.theme'), false, 'Expected ordinary UI preferences to remain generic settings');
    assert.equal(policy.isOrdinarySettingKey('ui.theme'), true, 'Expected UI theme to be on ordinary setting allowlist');
    assert.equal(policy.isOrdinarySettingKey('unclassified.setting'), false, 'Expected unknown setting keys not to be generic');

    const saved = [];
    const db = {
      async saveSetting(key, value) {
        saved.push({ key, value });
        return { key, value };
      },
      async getSetting(key) {
        return key === 'ui.theme' ? 'dark' : 'secret-value';
      }
    };

    await policy.saveGenericSetting(db, 'ui.theme', 'dark');
    assert.deepEqual(saved, [{ key: 'ui.theme', value: 'dark' }], 'Expected ordinary settings to save generically');

    let deniedMessage = '';
    try {
      await policy.saveGenericSetting(db, 'llm.openai.apiKey', 'sk-secret');
    } catch (error) {
      deniedMessage = error.message || '';
    }
    assert.includes(deniedMessage, 'credential-specific IPC path', 'Expected generic secret setting writes to be denied');

    let allowlistMessage = '';
    try {
      await policy.saveGenericSetting(db, 'unclassified.setting', 'value');
    } catch (error) {
      allowlistMessage = error.message || '';
    }
    assert.includes(allowlistMessage, 'generic settings allowlist', 'Expected non-ordinary settings to be denied');

    assert.equal(await policy.getGenericSettingValue(db, 'ui.theme'), 'dark', 'Expected ordinary setting reads to pass');
    assert.equal(await policy.getGenericSettingValue(db, 'llm.openai.apiKey'), null, 'Expected generic secret reads to be redacted');

    const redacted = policy.redactSettingsForRenderer({
      'ui.theme': 'dark',
      'llm.openai.apiKey': 'sk-secret',
      'llm.qwen.useOAuth': 'true'
    });
    assert.deepEqual(redacted, {
      'ui.theme': 'dark',
      'llm.openai.apiKey': policy.SECRET_SETTING_REDACTION,
      'llm.qwen.useOAuth': 'true'
    }, 'Expected bulk settings reads to redact secret-like values only');

    assert.includes(chatHandlers, 'saveGenericSetting(db, key, value)', 'Expected save-setting IPC to use the generic settings guard');
    assert.includes(llmHandlers, 'getGenericSettingValue(db, key)', 'Expected get-setting-value IPC to use the generic settings guard');
    assert.includes(workflowHandlers, 'redactSettingsForRenderer(await db.getAllSettings())', 'Expected get-settings IPC to redact secret-like values');
    assert.includes(workflowHandlers, 'saveGenericSetting(db, key, value)', 'Expected update-settings IPC to use the generic settings guard');

    const migrated = [];
    const deleted = [];
    await policy.migrateSecretSettingsToCredentials({
      async getAllSettings() {
        return {
          'ui.theme': 'dark',
          'llm.openai.apiKey': 'sk-secret'
        };
      },
      async setCredential(name, value) {
        migrated.push({ name, value });
      },
      async deleteSetting(key) {
        deleted.push(key);
      }
    });
    assert.deepEqual(migrated, [{ name: 'setting.llm.openai.apiKey', value: 'sk-secret' }], 'Expected old plaintext secrets to migrate to credentials');
    assert.deepEqual(deleted, ['llm.openai.apiKey'], 'Expected migrated plaintext secret settings to be deleted');

    const credentialStore = new Map([['setting.remoteGateway.secret', 'generic-migrated-secret']]);
    const remoteDeletedSettings = [];
    const remoteDeletedCredentials = [];
    await policy.migrateRemoteGatewaySecret({
      async getCredential(name) {
        return credentialStore.get(name) || null;
      },
      async setCredential(name, value) {
        credentialStore.set(name, value);
      },
      async getSetting(key) {
        return key === 'remoteGateway.secret' ? 'legacy-plain-secret' : null;
      },
      async deleteSetting(key) {
        remoteDeletedSettings.push(key);
      },
      async deleteCredential(name) {
        remoteDeletedCredentials.push(name);
        credentialStore.delete(name);
      }
    });
    assert.equal(credentialStore.get('remoteGateway.secret'), 'generic-migrated-secret', 'Expected Remote Gateway secret to migrate to canonical credential storage');
    assert.deepEqual(remoteDeletedSettings, ['remoteGateway.secret'], 'Expected plaintext Remote Gateway secret setting to be deleted');
    assert.deepEqual(remoteDeletedCredentials, ['setting.remoteGateway.secret'], 'Expected generic migrated Remote Gateway credential to be removed after canonical migration');
  }
};
