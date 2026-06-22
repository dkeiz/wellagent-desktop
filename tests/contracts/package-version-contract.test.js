const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'package-version-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const packagePath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const artifactName = String(pkg.build?.artifactName || '');

    assert.ok(pkg.version, 'Expected package.json to declare an app version');
    assert.includes(
      artifactName,
      '${version}',
      'Packaged artifact names should use the package version instead of a hard-coded release number'
    );
    assert.ok(
      !/\d+\.\d+\.\d+\.\d+[a-z]?/i.test(artifactName),
      'Artifact name should not carry a second hard-coded version scheme'
    );
    assert.ok(
      Array.isArray(pkg.build?.files) && pkg.build.files.includes('src/**/*'),
      'Build config should include application source files'
    );
    const agentinBundle = Array.isArray(pkg.build?.extraFiles)
      ? pkg.build.extraFiles.find(entry => entry.from === 'agentin')
      : null;
    assert.ok(agentinBundle, 'Build config should include bundled agentin defaults for first-run seeding');
    assert.ok(
      Array.isArray(agentinBundle.filter) && !agentinBundle.filter.includes('**/*'),
      'Build config should curate bundled agentin defaults instead of shipping raw agentin/**'
    );
    for (const excluded of [
      '!a2a/tasks/**/*',
      '!a2a/events/**/*',
      '!agents/sub/*-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*/**/*',
      '!memory/**/*',
      '!subtasks/**/*',
      '!tasks/**/*',
      '!userabout/**/*',
      '!workspaces/**/*',
      '!knowledge/library/**/*',
      '!knowledge/staging/**/*',
      '!**/__pycache__/**/*',
      '!**/*.pyc'
    ]) {
      assert.includes(agentinBundle.filter, excluded, `Expected agentin bundle filter to exclude ${excluded}`);
    }
  }
};
