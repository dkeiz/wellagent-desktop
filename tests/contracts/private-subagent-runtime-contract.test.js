const fs = require('fs');
const path = require('path');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const SessionWorkspace = require('../../src/main/session-workspace');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'private-subagent-runtime-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-private-subagent-');
    const sessionWorkspace = new SessionWorkspace(path.join(tempBase, 'workspaces'));
    const basePath = path.join(tempBase, 'subtasks');
    const delivered = [];
    const db = {
      async addConversation() {
        throw new Error('Private subagent should not write DB conversations');
      }
    };
    const runtime = new SubtaskRuntime(db, sessionWorkspace, null, basePath, {
      async persistConversationMessage(message, sessionId) {
        delivered.push({ message, sessionId });
      }
    });

    try {
      runtime.initialize();
      const privateRun = runtime.createRun({
        parentSessionId: 'private-parent',
        subagentId: 7,
        agentName: 'Private Worker',
        task: 'private task'
      });

      assert.equal(privateRun.private, true, 'Expected private parent session to create private subagent run');
      assert.includes(privateRun.run_id, 'private-subtask-', 'Expected private run id namespace');
      assert.equal(privateRun.run_dir, null, 'Expected private run not to expose durable run dir');
      assert.equal(privateRun.trace_path, null, 'Expected private run not to expose trace file');
      assert.equal(runtime.listRuns({}).some(run => run.run_id === privateRun.run_id), false, 'Expected global run list to hide private runs');
      assert.equal(
        runtime.listRuns({ parentSessionId: 'private-parent' }).some(run => run.run_id === privateRun.run_id),
        true,
        'Expected explicit private parent filter to see its private runs'
      );

      runtime.appendMessage(privateRun.run_id, { role: 'user', content: 'secret prompt' });
      runtime.appendToolEvent(privateRun.run_id, {
        tool_name: 'demo',
        params: { secret: true },
        result: { ok: true }
      });
      const completed = runtime.completeRun(privateRun.run_id, {
        contract: { status: 'task_complete', summary: 'done', data: {}, artifacts: [], notes: '' }
      });
      assert.equal(completed.status, 'task_complete', 'Expected private run completion to stay in memory');

      const delivery = await runtime.deliverToParent(privateRun.run_id, {
        status: 'task_complete',
        summary: 'done',
        contract: completed.result.contract
      });
      assert.equal(delivery.private, true, 'Expected private delivery record');
      assert.equal(delivery.delivery_path, null, 'Expected private delivery not to write inbox file');
      assert.equal(delivered.length, 1, 'Expected private delivery to route through injected private writer');

      const runFiles = fs.readdirSync(path.join(basePath, 'runs'));
      assert.equal(runFiles.includes(privateRun.run_id), false, 'Expected no durable private run folder');

      const normalRun = runtime.createRun({
        parentSessionId: 'normal-parent',
        subagentId: 7,
        agentName: 'Normal Worker',
        task: 'normal task'
      });
      assert.equal(normalRun.private === true, false, 'Expected normal parent session not to create private run');
      assert.equal(fs.existsSync(normalRun.trace_path), true, 'Expected normal run to keep durable trace file');

      const cleanup = runtime.clearPrivateRunsForSession('private-parent');
      assert.equal(cleanup.removed, 1, 'Expected private cleanup to remove in-memory run');
      assert.equal(runtime.getRun(privateRun.run_id), null, 'Expected private run to disappear after cleanup');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
