const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const SessionWorkspace = require('../../src/main/session-workspace');
const {
  EXECUTION_ALLOW_OUTSIDE_SETTING,
  ExecutionDirectory
} = require('../../src/main/execution-directory');
const { MemoryDB, createDirLink, makeTempDir } = require('../helpers/fakes');

function createServer(db) {
  return new MCPServer(db, {
    isToolActive() { return true; },
    getGroupsConfig() { return []; },
    getActiveTools() { return []; }
  });
}

module.exports = {
  name: 'file-tool-execution-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-file-policy-');
    const outsideBase = makeTempDir('localagent-file-policy-outside-');
    const executionRoot = path.join(tempBase, 'project');
    const workspaceRoot = path.join(tempBase, 'agentin', 'workspaces');
    const outsidePath = path.join(outsideBase, 'outside.txt');
    const insidePath = path.join(executionRoot, 'inside.txt');
    const linkedOutsideDir = path.join(executionRoot, 'linked-outside');
    const db = new MemoryDB();
    const server = createServer(db);
    const sessionWorkspace = new SessionWorkspace(workspaceRoot);

    try {
      fs.mkdirSync(executionRoot, { recursive: true });
      fs.writeFileSync(insidePath, 'inside', 'utf-8');
      fs.writeFileSync(outsidePath, 'outside', 'utf-8');
      createDirLink(outsideBase, linkedOutsideDir);

      server.setExecutionDirectory(new ExecutionDirectory(db, { defaultRoot: executionRoot }));
      server.setSessionWorkspace(sessionWorkspace);
      server.setCurrentSessionId('file-policy-session');

      const insideRead = await server.executeTool('read_file', { path: insidePath });
      assert.equal(insideRead.success, true, 'Expected file reads inside execution root to pass');
      assert.equal(insideRead.result.content, 'inside', 'Expected inside file content to be returned');

      let deniedMessage = '';
      try {
        await server.executeTool('read_file', { path: outsidePath });
      } catch (error) {
        deniedMessage = error.message || '';
      }
      assert.includes(deniedMessage, 'outside the execution folder', 'Expected central execution path denial');

      let linkedReadDenied = '';
      try {
        await server.executeTool('read_file', { path: path.join(linkedOutsideDir, 'outside.txt') });
      } catch (error) {
        linkedReadDenied = error.message || '';
      }
      assert.includes(
        linkedReadDenied,
        'outside the execution folder',
        'Expected symlinked directory reads to be denied by real-path containment'
      );

      let linkedWriteDenied = '';
      try {
        await server.executeTool('write_file', {
          path: path.join(linkedOutsideDir, 'new.txt'),
          content: 'blocked write'
        });
      } catch (error) {
        linkedWriteDenied = error.message || '';
      }
      assert.includes(
        linkedWriteDenied,
        'outside the execution folder',
        'Expected symlinked directory writes to be denied by real-path containment'
      );

      const workspaceWrite = await server.executeTool('write_file', {
        path: '{workspace}/note.txt',
        content: 'workspace artifact'
      });
      assert.equal(workspaceWrite.success, true, 'Expected session workspace writes to remain allowed');
      assert.equal(
        fs.existsSync(path.join(sessionWorkspace.getWorkspacePath('file-policy-session'), 'note.txt')),
        true,
        'Expected workspace artifact to be written through the file tool'
      );

      await db.saveSetting(EXECUTION_ALLOW_OUTSIDE_SETTING, 'true');
      const outsideRead = await server.executeTool('read_file', { path: outsidePath });
      assert.equal(outsideRead.success, true, 'Expected outside reads to follow the explicit allow-outside setting');
      assert.equal(outsideRead.result.content, 'outside', 'Expected outside file content after allow-outside');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
      fs.rmSync(outsideBase, { recursive: true, force: true });
    }
  }
};
