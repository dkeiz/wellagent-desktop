const fs = require('fs');
const os = require('os');
const path = require('path');
const SessionWorkspace = require('../../src/main/session-workspace');

function assertThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message || '').includes(expectedMessage)) {
      throw new Error(`Expected error to include "${expectedMessage}", received "${error.message}"`);
    }
    return;
  }
  throw new Error(`Expected function to throw "${expectedMessage}"`);
}

module.exports = {
  name: 'session-workspace-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-session-workspace-'));
    const workspaceBase = path.join(tempBase, 'workspaces');
    const sessionWorkspace = new SessionWorkspace(workspaceBase);

    try {
      const validPath = sessionWorkspace.getWorkspacePath('private-1234-abcd');
      assert.equal(
        validPath,
        path.join(workspaceBase, 'private-1234-abcd'),
        'Expected valid session ids to map inside workspace base'
      );
      sessionWorkspace.writeOutput('session-1', 'note', 'hello');
      assert.equal(sessionWorkspace.listFiles('session-1').length, 1, 'Expected valid session files to list');

      assertThrows(() => sessionWorkspace.getWorkspacePath('../outside'), 'Invalid session workspace id');
      assertThrows(() => sessionWorkspace.listFiles('..'), 'Invalid session workspace id');
      assertThrows(() => sessionWorkspace.cleanup(path.resolve(tempBase, 'outside')), 'Invalid session workspace id');
      assert.equal(fs.existsSync(path.join(tempBase, 'outside')), false, 'Traversal checks must not create outside paths');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
