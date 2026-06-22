const CompanionAuth = require('../../src/main/companion-auth');

function createDb() {
  const settings = new Map();
  const credentials = new Map();
  return {
    settings,
    credentials,
    getSettingSync(key) {
      return settings.get(key) || null;
    },
    async getSetting(key) {
      return settings.get(key) || null;
    },
    async saveSetting(key, value) {
      settings.set(key, String(value));
    },
    async getCredential(name) {
      return credentials.get(String(name || '').toLowerCase()) || null;
    },
    async setCredential(name, value) {
      credentials.set(String(name || '').toLowerCase(), String(value));
    },
    async deleteCredential(name) {
      credentials.delete(String(name || '').toLowerCase());
    }
  };
}

module.exports = {
  name: 'companion-credential-storage-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createDb();
    const auth = new CompanionAuth(db);
    await db.saveSetting('companion.devices', JSON.stringify([
      { deviceId: 'device-1', deviceName: 'Phone', platform: 'android' }
    ]));

    await auth._storeAccessToken('device-1', 'session-secret', 'bearer-secret');
    assert.equal(await db.getSetting('companion.accessToken.device-1'), null, 'Expected companion session token legacy setting to be empty');
    assert.equal(await db.getSetting('companion.bearerToken.device-1'), null, 'Expected companion bearer token legacy setting to be empty');
    assert.equal(await db.getCredential('companion.sessionToken.device-1'), 'session-secret', 'Expected companion session token in credential storage');
    const bearerCredential = JSON.parse(await db.getCredential('companion.bearerToken.device-1'));
    assert.equal(bearerCredential.token, 'bearer-secret', 'Expected companion bearer token in credential storage');
    assert.ok(Number(bearerCredential.expiresAt) > Date.now(), 'Expected companion bearer token to have an expiry');

    const valid = await auth.validateAccessToken('bearer-secret');
    assert.equal(valid.valid, true, 'Expected bearer token to validate from credential storage');

    await db.saveSetting('companion.accessToken.legacy-device', 'legacy-session');
    await db.saveSetting('companion.bearerToken.legacy-device', 'legacy-bearer');
    await db.saveSetting('companion.devices', JSON.stringify([
      { deviceId: 'legacy-device', deviceName: 'Legacy', platform: 'web' }
    ]));
    const migrated = await auth.validateAccessToken('legacy-bearer');
    assert.equal(migrated.valid, true, 'Expected legacy bearer token to migrate and validate');
    const migratedCredential = JSON.parse(await db.getCredential('companion.bearerToken.legacy-device'));
    assert.equal(migratedCredential.token, 'legacy-bearer', 'Expected legacy bearer token to move into credential storage');
    assert.ok(Number(migratedCredential.expiresAt) > Date.now(), 'Expected migrated legacy bearer token to get an expiry');
    assert.equal(await db.getSetting('companion.bearerToken.legacy-device'), null, 'Expected legacy bearer token setting to be cleared after migration');
  }
};
