const CompanionAuth = require('../../src/main/companion-auth');

function createDb() {
  const settings = new Map();
  return {
    settings,
    getSettingSync(key) {
      return settings.get(key) || null;
    },
    async getSetting(key) {
      return settings.get(key) || null;
    },
    async saveSetting(key, value) {
      settings.set(key, String(value));
    }
  };
}

module.exports = {
  name: 'companion-artifact-ticket-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createDb();
    const auth = new CompanionAuth(db);
    await db.saveSetting('companion.devices', JSON.stringify([
      { deviceId: 'device-1', deviceName: 'Phone', platform: 'android', permissions: { preset: 'standard' } }
    ]));

    const issued = auth.issueArtifactTicket('device-1', 'session-1', 'image.png');
    assert.ok(issued.ticket && issued.ticket.length > 20, 'Expected artifact ticket to be an opaque random value');
    assert.ok(Number(issued.expiresIn) <= 300, 'Expected artifact ticket to be short-lived');

    const valid = await auth.validateArtifactTicket(issued.ticket, 'session-1', 'image.png');
    assert.equal(valid.valid, true, 'Expected matching artifact ticket to validate');
    assert.equal(valid.payload.deviceId, 'device-1', 'Expected validated ticket to resolve its paired device');

    const reused = await auth.validateArtifactTicket(issued.ticket, 'session-1', 'image.png');
    assert.equal(reused.valid, false, 'Expected artifact tickets to be one-time use');

    const second = auth.issueArtifactTicket('device-1', 'session-1', 'image.png');
    const wrongFile = await auth.validateArtifactTicket(second.ticket, 'session-1', 'other.png');
    assert.equal(wrongFile.valid, false, 'Expected artifact ticket to be bound to the requested file name');

    const third = auth.issueArtifactTicket('device-1', 'session-1', 'image.png');
    const wrongSession = await auth.validateArtifactTicket(third.ticket, 'session-2', 'image.png');
    assert.equal(wrongSession.valid, false, 'Expected artifact ticket to be bound to the requested session');
  }
};
