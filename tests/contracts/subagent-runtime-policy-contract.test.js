const fs = require('fs');
const path = require('path');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'subagent-runtime-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-subagent-policy-');
    const runtime = new SubtaskRuntime({}, null, null, tempDir);
    try {
      runtime.initialize();
      const run = runtime.createRun({
        parentSessionId: 'parent-1',
        subagentId: 42,
        agentName: 'Strict Worker',
        task: 'Do one thing',
        runtimePolicyProfile: 'wide-agent',
        runtimePolicyGrants: { actions: ['network.local'] }
      });

      assert.equal(run.runtime_policy_profile, 'wide-agent', 'Expected runtime policy profile on run payload');
      assert.deepEqual(run.runtime_policy_grants, { actions: ['network.local'] }, 'Expected runtime policy grants on run payload');

      const request = JSON.parse(fs.readFileSync(path.join(run.run_dir, 'request.json'), 'utf-8'));
      const status = JSON.parse(fs.readFileSync(path.join(run.run_dir, 'status.json'), 'utf-8'));
      assert.equal(request.runtime_policy_profile, 'wide-agent', 'Expected profile persisted to request file');
      assert.equal(status.runtime_policy_profile, 'wide-agent', 'Expected profile persisted to status file');
      assert.deepEqual(status.runtime_policy_grants, { actions: ['network.local'] }, 'Expected grants persisted to status file');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
