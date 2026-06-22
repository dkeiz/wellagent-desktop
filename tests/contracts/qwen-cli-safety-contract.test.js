const fs = require('fs');
const path = require('path');
const QwenAdapter = require('../../src/main/providers/qwen-adapter');

module.exports = {
  name: 'qwen-cli-safety-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const source = fs.readFileSync(
      path.join(rootDir, 'src', 'main', 'providers', 'qwen-adapter.js'),
      'utf8'
    );
    assert.equal(source.includes('exec('), false, 'Qwen CLI adapter should not build shell command strings with exec');
    assert.includes(source, 'spawn(command, args', 'Expected Qwen CLI adapter to spawn qwen with an argument array');
    assert.includes(source, "process.platform === 'win32' ? 'qwen.cmd' : 'qwen'", 'Expected Windows qwen.cmd shim handling');

    const adapter = new QwenAdapter({
      async getSetting() {
        return null;
      }
    });
    const seen = [];
    adapter._runQwenCli = async (args, timeoutMs) => {
      seen.push({ args, timeoutMs });
      return { stdout: 'ok\n', stderr: '', code: 0, error: null };
    };

    const dangerousModel = 'model" & whoami';
    const dangerousPrompt = 'hello " && calc | echo bad';
    const response = await adapter._callCLI(
      [{ role: 'user', content: dangerousPrompt }],
      { model: dangerousModel, thinkingMode: 'off', modelSpec: { capabilities: {} } }
    );

    assert.equal(response.content, 'ok', 'Expected mocked CLI response to be normalized');
    assert.deepEqual(
      seen[0].args,
      ['--model', dangerousModel, `USER:\n${dangerousPrompt}`],
      'Expected dangerous model and formatted prompt text to stay as argv entries'
    );
    assert.equal(seen[0].timeoutMs, 30000, 'Expected generation timeout to remain bounded');

    seen.length = 0;
    await adapter._callCLI(
      [
        { role: 'system', content: 'system rules' },
        { role: 'user', content: 'older user' },
        { role: 'assistant', content: 'older assistant' },
        { role: 'user', content: 'latest user' }
      ],
      { model: 'qwen-cli', thinkingMode: 'off', modelSpec: { capabilities: {} } }
    );
    assert.equal(seen[0].args.length, 1, 'Expected qwen-cli default model to pass only the prompt argv entry');
    assert.includes(seen[0].args[0], 'SYSTEM:\nsystem rules', 'Expected CLI prompt to include system context');
    assert.includes(seen[0].args[0], 'ASSISTANT:\nolder assistant', 'Expected CLI prompt to include assistant history');
    assert.includes(seen[0].args[0], 'USER:\nlatest user', 'Expected CLI prompt to include latest user message');
  }
};
