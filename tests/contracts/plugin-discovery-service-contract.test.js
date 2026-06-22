const fs = require('fs');
const path = require('path');
const { PluginDiscoveryService } = require('../../src/main/plugin-discovery-service');
const { MemoryDB, createDirLink, makeTempDir } = require('../helpers/fakes');

function writePlugin(dir, id, manifestPatch = {}) {
  const pluginDir = path.join(dir, id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'main.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    main: 'main.js',
    ...manifestPatch
  }, null, 2));
  return pluginDir;
}

module.exports = {
  name: 'plugin-discovery-service-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const pluginsDir = makeTempDir('localagent-plugin-discovery-');
    const outsideDir = makeTempDir('localagent-plugin-discovery-outside-');
    const db = new MemoryDB();
    const discovery = new PluginDiscoveryService({ db, pluginsDir });
    const plugins = new Map();

    try {
      writePlugin(pluginsDir, 'valid-plugin', {
        runtimePermissions: {
          profile: 'plugin-strict',
          actions: ['plugin.handler.register']
        }
      });
      writePlugin(pluginsDir, 'invalid-runtime-plugin', {
        runtimePermissions: {
          unexpected: true
        }
      });
      writePlugin(outsideDir, 'linked-escape-plugin', {
        runtimePermissions: {
          profile: 'plugin-strict',
          actions: ['plugin.handler.register']
        }
      });
      createDirLink(
        path.join(outsideDir, 'linked-escape-plugin'),
        path.join(pluginsDir, 'linked-escape-plugin')
      );

      const result = discovery.scanInto(plugins);
      assert.equal(result.scanned, 3, 'Expected discovery to inspect direct child plugin manifests, including linked local plugins');
      assert.equal(result.loaded, 2, 'Expected discovery to load valid plugin manifests, including linked local plugins');
      assert.equal(result.skipped, 1, 'Expected discovery to skip invalid in-boundary plugin manifests');
      assert.ok(plugins.has('valid-plugin'), 'Expected valid plugin to be registered');
      assert.ok(plugins.has('linked-escape-plugin'), 'Expected linked plugin directory to be discoverable again');
      assert.equal(plugins.has('invalid-runtime-plugin'), false, 'Expected invalid plugin to be skipped');
      assert.equal(db.plugins.get('valid-plugin')?.status, 'disabled', 'Expected discovery to seed plugin DB row');
      assert.equal(db.plugins.get('linked-escape-plugin')?.status, 'disabled', 'Expected linked plugin discovery to seed plugin DB state');

      db.run('UPDATE plugins SET visible_in_sidebar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [0, 'valid-plugin']);
      discovery.scanInto(plugins, { preserveExisting: true });
      assert.equal(
        plugins.get('valid-plugin')?.visibleInSidebar,
        false,
        'Expected preserve scan to refresh sidebar visibility from plugin state storage'
      );
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }
};
