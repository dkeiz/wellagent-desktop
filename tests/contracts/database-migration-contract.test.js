const path = require('path');
const { runElectronScript } = require('../helpers/electron-contract');

module.exports = {
  name: 'database-migration-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    await runElectronScript(rootDir, path.join('tools', 'test-database-migrations.js'));
    assert.ok(true, 'Expected Electron-backed database migration contract to pass');
  }
};
