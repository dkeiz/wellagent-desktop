const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUNTIME_PATTERNS = [
  /^agentin\/a2a\/tasks\//,
  /^agentin\/a2a\/events\//,
  /^agentin\/memory\//,
  /^agentin\/workspaces\//,
  /^agentin\/userabout\//,
  /^agentin\/knowledge\/library\//,
  /^agentin\/knowledge\/staging\//,
  /^agentin\/subtasks\//,
  /^agentin\/tasks\//,
  /^agentin\/agents\/sub\/[^/]*-\d{10,}\//,
  /(^|\/)__pycache__\//,
  /\.py[co]$/,
  /\.log$/
];
const RUNTIME_MARKER_FILES = new Set(['.gitignore', '.gitkeep', 'README.md']);

function isRuntimeMarkerFile(file) {
  return RUNTIME_MARKER_FILES.has(path.posix.basename(file));
}

function trackedFiles(rootDir) {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/).filter(Boolean).map(file => file.replace(/\\/g, '/'));
  } catch (_) {
    return [];
  }
}

module.exports = {
  name: 'release-runtime-artifacts-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const agentinBundle = (pkg.build?.extraFiles || []).find(entry => entry.from === 'agentin');
    assert.ok(agentinBundle, 'Expected desktop build to bundle curated agentin defaults');
    assert.ok(Array.isArray(agentinBundle.filter), 'Expected agentin bundle to use explicit filters');
    assert.ok(!agentinBundle.filter.includes('**/*'), 'Expected agentin bundle not to ship raw agentin/**');

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
      assert.includes(agentinBundle.filter, excluded, `Expected package filter to exclude ${excluded}`);
    }

    const offenders = trackedFiles(rootDir)
      .filter(file => !isRuntimeMarkerFile(file))
      .filter(file => RUNTIME_PATTERNS.some(pattern => pattern.test(file)));
    assert.deepEqual(offenders, [], `Runtime artifacts must not be tracked or bundled:\n${offenders.join('\n')}`);
  }
};
