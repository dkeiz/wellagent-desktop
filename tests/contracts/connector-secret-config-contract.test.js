const ConnectorRuntime = require('../../src/main/connector-runtime');

module.exports = {
  name: 'connector-secret-config-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const settings = new Map();
    const credentials = new Map();
    const db = {
      async getAllSettings() {
        return Object.fromEntries(settings.entries());
      },
      async saveSetting(key, value) {
        settings.set(key, String(value));
      },
      async setCredential(name, value) {
        credentials.set(name, String(value));
      },
      async getCredential(name) {
        return credentials.get(name) || null;
      }
    };
    const runtime = new ConnectorRuntime(null, db, { connectorsDir: __dirname });

    await runtime.setConfig('demo', 'password', 'secret');
    assert.equal(credentials.get('connector.demo.password'), 'secret', 'Expected connector secret config in credential storage');
    assert.equal(settings.get('connector.demo.password'), 'configured', 'Expected connector setting row to be redacted');

    const publicConfig = await runtime.getConfig('demo');
    assert.equal(publicConfig.password, 'configured', 'Expected public connector config to stay redacted');

    const runtimeConfig = await runtime.getConfig('demo', { includeSecrets: true });
    assert.equal(runtimeConfig.password, 'secret', 'Expected connector runtime config to receive real secret');
  }
};
