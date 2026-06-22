const fs = require('fs');
const path = require('path');
const { PluginModuleLoader } = require('../../src/main/plugin-module-loader');
const { createDirLink, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'plugin-module-loader-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const root = makeTempDir('localagent-plugin-loader-');
    const pluginDir = path.join(root, 'plugin-a');
    const outsideDir = path.join(root, 'outside');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'helper.js'), "module.exports = () => 'v1';");
    fs.writeFileSync(path.join(pluginDir, 'main.js'), "const helper = require('./helper'); module.exports = { version: helper() };");
    fs.writeFileSync(path.join(outsideDir, 'main.js'), "module.exports = { version: 'outside' };");

    const loader = new PluginModuleLoader();

    try {
      const plugin = { dir: pluginDir, manifest: { main: 'main.js' } };
      const first = loader.load(plugin);
      assert.equal(first.version, 'v1', 'Expected first load to read plugin module');

      fs.writeFileSync(path.join(pluginDir, 'helper.js'), "module.exports = () => 'v2';");
      const second = loader.load(plugin);
      assert.equal(second.version, 'v2', 'Expected loader to clear plugin subtree require cache');

      let traversalError = null;
      try {
        loader.resolveMainPath({ dir: pluginDir, manifest: { main: '../outside.js' } });
      } catch (error) {
        traversalError = error;
      }
      assert.ok(traversalError, 'Expected plugin entrypoint traversal to be rejected');
      assert.includes(
        traversalError.message,
        'inside plugin directory',
        'Expected traversal error to explain plugin directory containment'
      );

      createDirLink(outsideDir, path.join(pluginDir, 'linked'));
      traversalError = null;
      try {
        loader.resolveMainPath({ dir: pluginDir, manifest: { main: 'linked/main.js' } });
      } catch (error) {
        traversalError = error;
      }
      assert.ok(traversalError, 'Expected symlinked plugin entrypoint escape to be rejected');
      assert.includes(
        traversalError.message,
        'inside plugin directory',
        'Expected symlinked plugin entrypoint error to explain plugin directory containment'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
};
