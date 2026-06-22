const fs = require('fs');
const path = require('path');
const { buildRuntimePaths, ensureMutableAgentinRoot } = require('../../src/main/runtime-paths');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'runtime-paths-packaged-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-runtime-packaged-');
    const bundledRoot = path.join(tempDir, 'resources', 'agentin');
    const userData = path.join(tempDir, 'userData');
    const bundledPrompt = path.join(bundledRoot, 'prompts', 'system.md');
    const bundledPlugin = path.join(bundledRoot, 'plugins', 'demo-plugin', 'plugin.json');

    fs.mkdirSync(path.dirname(bundledPrompt), { recursive: true });
    fs.mkdirSync(path.dirname(bundledPlugin), { recursive: true });
    fs.writeFileSync(bundledPrompt, 'default prompt v1', 'utf-8');
    fs.writeFileSync(bundledPlugin, '{"id":"demo-plugin"}\n', 'utf-8');

    const fakeApp = {
      isPackaged: true,
      getPath(name) {
        return name === 'userData' ? userData : null;
      }
    };

    try {
      const paths = buildRuntimePaths({
        app: fakeApp,
        bundledAgentinRoot: bundledRoot
      });

      assert.equal(paths.agentinRoot, path.join(userData, 'agentin'), 'Packaged mutable agentin root should live under userData');
      assert.equal(paths.bundledAgentinRoot, bundledRoot, 'Bundled defaults should remain discoverable');
      assert.equal(paths.seedMutableAgentinRoot, true, 'Packaged userData root should be marked for first-run seeding');
      assert.equal(paths.promptBasePath, path.join(userData, 'agentin', 'prompts'), 'Prompt path should use mutable root');
      assert.equal(paths.pluginsDir, path.join(userData, 'agentin', 'plugins'), 'Plugin path should use mutable root');
      assert.equal(paths.memoryBasePath, path.join(userData, 'agentin', 'memory'), 'Memory path should use mutable root');

      const firstSeed = ensureMutableAgentinRoot(paths);
      assert.equal(firstSeed.skipped, false, 'Expected packaged defaults to seed mutable agentin');
      assert.ok(firstSeed.copied >= 2, 'Expected bundled files to be copied on first run');
      assert.equal(
        fs.readFileSync(path.join(paths.promptBasePath, 'system.md'), 'utf-8'),
        'default prompt v1',
        'Expected missing prompt file to be seeded'
      );

      fs.writeFileSync(path.join(paths.promptBasePath, 'system.md'), 'user edited prompt', 'utf-8');
      fs.writeFileSync(bundledPrompt, 'default prompt v2', 'utf-8');
      fs.writeFileSync(bundledPlugin, '{"id":"demo-plugin","version":"2"}\n', 'utf-8');
      const newBundledRule = path.join(bundledRoot, 'prompts', 'rules', '001-new-rule.md');
      fs.mkdirSync(path.dirname(newBundledRule), { recursive: true });
      fs.writeFileSync(newBundledRule, 'new bundled rule', 'utf-8');

      const secondSeed = ensureMutableAgentinRoot(paths);
      assert.ok(secondSeed.updated >= 1, 'Expected unchanged seeded files to receive bundled updates');
      assert.equal(
        fs.readFileSync(path.join(paths.promptBasePath, 'system.md'), 'utf-8'),
        'user edited prompt',
        'Expected user-modified files to survive a later bundled update'
      );
      assert.equal(
        fs.readFileSync(path.join(paths.pluginsDir, 'demo-plugin', 'plugin.json'), 'utf-8'),
        '{"id":"demo-plugin","version":"2"}\n',
        'Expected unchanged seeded plugin defaults to update when bundled content changes'
      );
      assert.equal(
        fs.readFileSync(path.join(paths.promptBasePath, 'rules', '001-new-rule.md'), 'utf-8'),
        'new bundled rule',
        'Expected new bundled files to be added without overwriting existing files'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
