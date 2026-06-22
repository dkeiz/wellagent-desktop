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
      if (String(value || '') === '') settings.delete(key);
      else settings.set(key, String(value));
    },
    async getCredential(name) {
      return credentials.get(String(name || '').toLowerCase()) || null;
    },
    async setCredential(name, value) {
      const key = String(name || '').toLowerCase();
      if (String(value || '') === '') credentials.delete(key);
      else credentials.set(key, String(value));
    },
    async deleteCredential(name) {
      credentials.delete(String(name || '').toLowerCase());
    }
  };
}

module.exports = {
  name: 'companion-token-lifecycle-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createDb();
    const auth = new CompanionAuth(db);
    await db.saveSetting('companion.devices', JSON.stringify([
      { deviceId: 'device-1', deviceName: 'Phone', platform: 'android' }
    ]));
    await auth._storeAccessToken('device-1', 'session-secret');

    const firstAuth = await auth.authenticate({ deviceId: 'device-1', sessionToken: 'session-secret' });
    assert.equal(firstAuth.success, true, 'Expected session token auth to succeed');
    assert.ok(String(firstAuth.accessToken || '').includes('.'), 'Expected bearer token to use opaque structured format');
    assert.ok(Number(firstAuth.accessTokenExpiresAt) > Date.now(), 'Expected auth response to include bearer expiry');
    assert.ok(Number(firstAuth.accessTokenExpiresIn) > 0, 'Expected auth response to include bearer TTL');

    const firstValidation = await auth.validateAccessToken(firstAuth.accessToken);
    assert.equal(firstValidation.valid, true, 'Expected issued bearer token to validate before expiry');
    assert.equal(firstValidation.payload.deviceId, 'device-1', 'Expected token validation to return device payload');

    const secondAuth = await auth.authenticate({ deviceId: 'device-1', sessionToken: 'session-secret' });
    assert.equal(secondAuth.success, true, 'Expected re-auth to rotate bearer token');
    assert.notEqual(secondAuth.accessToken, firstAuth.accessToken, 'Expected re-auth to issue a different bearer token');

    const oldToken = await auth.validateAccessToken(firstAuth.accessToken);
    assert.equal(oldToken.valid, false, 'Expected rotated-out bearer token to stop validating');

    const wsTicket = auth.issueWsTicket('device-1');
    const firstWsValidation = auth.validateWsTicket(wsTicket);
    assert.equal(firstWsValidation.valid, true, 'Expected issued websocket ticket to validate once');
    assert.equal(firstWsValidation.deviceId, 'device-1', 'Expected websocket ticket validation to return the device id');
    const reusedWsTicket = auth.validateWsTicket(wsTicket);
    assert.equal(reusedWsTicket.valid, false, 'Expected websocket tickets to be single-use');

    const realNow = Date.now;
    try {
      Date.now = () => Number(secondAuth.accessTokenExpiresAt) + 1000;
      const expired = await auth.validateAccessToken(secondAuth.accessToken);
      assert.equal(expired.valid, false, 'Expected expired bearer token to be rejected');
      assert.includes(expired.error, 'expired', 'Expected expired bearer token error to mention expiry');
    } finally {
      Date.now = realNow;
    }
  }
};
