const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'npm-package-contract',
  tags: ['contract', 'fast', 'npm'],
  async run({ assert, rootDir }) {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const wellbotDir = path.join(rootDir, 'packages', 'wellbot');
    const wellbotPackage = JSON.parse(fs.readFileSync(path.join(wellbotDir, 'package.json'), 'utf8'));

    assert.equal(rootPackage.private, true, 'Root package must stay private to avoid publishing the desktop repo');
    assert.ok(
      Array.isArray(rootPackage.workspaces) && rootPackage.workspaces.includes('packages/*'),
      'Root package should include npm workspaces for publishable packages'
    );

    assert.equal(wellbotPackage.name, 'wellbot', 'Expected compact CLI package to own the wellbot npm name');
    assert.equal(wellbotPackage.bin?.wellbot, 'bin/wellbot.js', 'Expected wellbot CLI bin entry');
    assert.deepEqual(
      wellbotPackage.files,
      ['bin/', 'README.md', 'LICENSE'],
      'Expected wellbot package to publish only the compact CLI allowlist'
    );

    const binPath = path.join(wellbotDir, wellbotPackage.bin.wellbot);
    const binSource = fs.readFileSync(binPath, 'utf8');
    assert.includes(binSource, 'releases/latest', 'CLI should point users to GitHub desktop releases');
    assert.includes(binSource, 'expandDesktop', 'CLI should support expanding into the full desktop source');
    assert.includes(binSource, 'git', 'CLI should use git for source expansion and updates');
    assert.ok(!binSource.includes('agentin/a2a'), 'CLI package should not depend on runtime state paths');
  }
};
