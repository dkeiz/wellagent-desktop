const fs = require('fs');
const path = require('path');
const { buildRuntimePaths } = require('../../src/main/runtime-paths');

function walkJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

module.exports = {
  name: 'runtime-paths-coverage-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const paths = buildRuntimePaths({ agentinRoot: 'C:/agentin-test' });
    assert.equal(paths.workflowBasePath.replace(/\\/g, '/'), 'C:/agentin-test/workflows', 'Expected workflow path from runtime paths');
    assert.equal(paths.researchBasePath.replace(/\\/g, '/'), 'C:/agentin-test/research', 'Expected research path from runtime paths');
    assert.equal(paths.subtaskBasePath.replace(/\\/g, '/'), 'C:/agentin-test/subtasks', 'Expected subtask path from runtime paths');

    const bootstrap = fs.readFileSync(path.join(rootDir, 'src', 'main', 'bootstrap.js'), 'utf8');
    assert.includes(bootstrap, 'workflowsDir: paths.workflowBasePath', 'Expected workflow manager to receive runtime path');
    assert.includes(bootstrap, 'paths.subtaskBasePath', 'Expected subtask runtime to receive runtime path');
    assert.includes(bootstrap, 'paths.researchBasePath', 'Expected research runtime to receive runtime path');

    const allowedFallbacks = new Set([
      path.join(rootDir, 'src', 'main', 'providers', 'codex-cli-adapter.js')
    ]);
    const offenders = [];
    for (const filePath of walkJsFiles(path.join(rootDir, 'src', 'main'))) {
      if (allowedFallbacks.has(filePath)) continue;
      const source = fs.readFileSync(filePath, 'utf8');
      if (/path\.(?:join|resolve)\(\s*process\.cwd\(\)/.test(source)) {
        offenders.push(path.relative(rootDir, filePath).replace(/\\/g, '/'));
      }
      if (/path\.join\(\s*__dirname\s*,\s*['"]\.\.\/\.\.\/agentin/.test(source)) {
        offenders.push(path.relative(rootDir, filePath).replace(/\\/g, '/'));
      }
    }
    assert.deepEqual(offenders, [], 'Expected production agentin path fallbacks to go through runtime-paths');
  }
};
