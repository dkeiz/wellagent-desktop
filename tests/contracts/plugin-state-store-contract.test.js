const PluginStateStore = require('../../src/main/plugin-state-store');
const { MemoryDB } = require('../helpers/fakes');

module.exports = {
  name: 'plugin-state-store-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new MemoryDB();
    const store = new PluginStateStore(db);

    const existing = store.ensurePluginRow({
      id: 'state-plugin',
      name: 'State Plugin',
      version: '1.0.0'
    });
    assert.equal(existing.status, 'disabled', 'Expected new plugin rows to default to disabled');
    assert.equal(store.getStatus('state-plugin'), 'disabled', 'Expected status lookup to read seeded row');

    store.updateStatus('state-plugin', 'enabled');
    assert.equal(store.getStatus('state-plugin'), 'enabled', 'Expected status update to persist');

    assert.equal(store.readSidebarVisible('state-plugin'), true, 'Expected sidebar visibility to default on');
    const hidden = store.setSidebarVisible('state-plugin', false);
    assert.equal(hidden, false, 'Expected sidebar setter to normalize false');
    assert.equal(store.readSidebarVisible('state-plugin'), false, 'Expected sidebar visibility to persist');
  }
};
