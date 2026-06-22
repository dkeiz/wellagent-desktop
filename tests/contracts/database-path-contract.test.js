const fs = require('fs');
const path = require('path');
const { resolveDbPath } = require('../../src/main/database-paths');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'database-path-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-db-path-');
    const userData = path.join(tempDir, 'userData');
    const appDir = path.join(tempDir, 'app');
    const execPath = path.join(appDir, 'LocalAgent.exe');
    const legacyDbPath = path.join(appDir, 'agentin', 'memory', 'localagent.db');
    const fakeApp = {
      isPackaged: true,
      getPath(name) {
        return name === 'userData' ? userData : null;
      }
    };

    fs.mkdirSync(path.dirname(legacyDbPath), { recursive: true });
    fs.writeFileSync(legacyDbPath, 'legacy database bytes', 'utf-8');

    try {
      const resolved = resolveDbPath({ app: fakeApp, execPath });

      assert.equal(resolved, path.join(userData, 'localagent.db'), 'Packaged database should live in userData');
      assert.equal(
        fs.readFileSync(resolved, 'utf-8'),
        'legacy database bytes',
        'Expected first packaged run after upgrade to copy the old executable-adjacent DB'
      );

      fs.writeFileSync(resolved, 'current database bytes', 'utf-8');
      fs.writeFileSync(legacyDbPath, 'stale legacy database bytes', 'utf-8');
      const secondResolved = resolveDbPath({ app: fakeApp, execPath });

      assert.equal(secondResolved, resolved, 'Expected DB path to remain stable across launches');
      assert.equal(
        fs.readFileSync(resolved, 'utf-8'),
        'current database bytes',
        'Existing userData DB must not be overwritten by stale legacy files'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
