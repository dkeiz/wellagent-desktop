const fs = require('fs');
const os = require('os');
const path = require('path');

const ArtifactRegistry = require('../../src/main/artifact-registry');
const SessionWorkspace = require('../../src/main/session-workspace');

module.exports = {
  name: 'artifact-registry-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-registry-'));

    try {
      const sessionWorkspace = new SessionWorkspace(tempRoot);
      const registry = new ArtifactRegistry(sessionWorkspace);
      const sessionId = 's1';
      const workspaceDir = sessionWorkspace.getWorkspacePath(sessionId);

      const keptPath = path.join(workspaceDir, 'kept.txt');
      fs.writeFileSync(keptPath, 'keep', 'utf8');
      registry.registerFile(sessionId, {
        name: 'kept.txt',
        path: keptPath,
        source: 'edit_file',
        action: 'edited'
      });

      const externalPath = path.join(tempRoot, 'outside.txt');
      fs.writeFileSync(externalPath, 'outside', 'utf8');
      registry.registerFile(sessionId, {
        name: 'outside.txt',
        path: externalPath,
        source: 'write_file'
      });

      const nestedDir = path.join(workspaceDir, 'nested');
      fs.mkdirSync(nestedDir, { recursive: true });
      const nestedPath = path.join(nestedDir, 'deep.txt');
      fs.writeFileSync(nestedPath, 'nested', 'utf8');
      registry.registerFile(sessionId, {
        name: 'deep.txt',
        path: nestedPath,
        source: 'write_file'
      });

      const deletedPath = path.join(workspaceDir, 'gone.txt');
      registry.registerFile(sessionId, {
        name: 'gone.txt',
        path: deletedPath,
        source: 'delete_file',
        action: 'deleted'
      });

      registry.registerVirtual(sessionId, {
        name: 'todo item',
        kind: 'todo',
        source: 'todo_op'
      });

      const openable = registry.listArtifacts(sessionId, { openableOnly: true });
      assert.equal(openable.count, 1, 'Expected only one openable artifact');
      assert.equal(openable.artifacts[0].name, 'kept.txt', 'Expected workspace file to remain openable');
      assert.equal(openable.artifacts[0].virtual, false, 'Expected openable artifact list not to include virtual entries');

      const all = registry.listArtifacts(sessionId);
      assert.equal(all.count, 5, 'Expected unfiltered artifact list to retain virtual, deleted, nested, and external entries');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
};
