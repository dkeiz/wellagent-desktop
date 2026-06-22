const path = require('path');

module.exports = {
  name: 'tts-plugin-routing-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const pluginMain = require(path.join(rootDir, 'agentin', 'plugins', 'http-tts-bridge', 'main.js'));
    const manifest = require(path.join(rootDir, 'agentin', 'plugins', 'http-tts-bridge', 'plugin.json'));

    const builtin = pluginMain._test.resolveVoiceChoice(
      { provider: 'fast-qwen', voice: 'qwen-builtin:serena' },
      { builtinModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', cloneModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', piperVoiceId: 'en_US-lessac-medium' }
    );
    assert.equal(builtin.modelName, 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', 'Expected built-in Qwen voices to use the CustomVoice model');
    assert.equal(builtin.backendVoice, 'serena', 'Expected built-in Qwen voice id to map cleanly');

    const clone = pluginMain._test.resolveVoiceChoice(
      { provider: 'fast-qwen', voice: 'qwen-clone:my_voice' },
      { builtinModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', cloneModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', piperVoiceId: 'en_US-lessac-medium' }
    );
    assert.equal(clone.modelName, 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', 'Expected clone voices to use the Base model');
    assert.equal(clone.backendVoice, 'my_voice', 'Expected custom clone voice id to map cleanly');

    const piper = pluginMain._test.resolveVoiceChoice(
      { provider: 'piper', voice: 'piper:en_US-lessac-medium' },
      { builtinModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', cloneModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', piperVoiceId: 'en_US-lessac-medium' }
    );
    assert.equal(piper.modelName, 'piper:en_US-lessac-medium', 'Expected Piper to use a piper:* model id');

    const configured = pluginMain._test.resolveVoiceChoice(
      {},
      { selectedProvider: 'piper', selectedVoice: 'piper:en_US-lessac-medium', builtinModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', cloneModel: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', piperVoiceId: 'en_US-lessac-medium' }
    );
    assert.equal(configured.provider, 'piper', 'Expected plugin-owned config to choose the provider route');
    assert.equal(configured.modelName, 'piper:en_US-lessac-medium', 'Expected plugin-owned config to choose the voice route');

    const actions = manifest.capabilityContracts?.tts?.actions || [];
    for (const action of ['getBackendStatus', 'getModels', 'getStreamPlan', 'prepareVoice', 'importPiperAssets']) {
      assert.ok(actions.includes(action), `Expected manifest to expose ${action}`);
    }
    for (const configKey of ['selectedProvider', 'selectedVoice', 'voiceDescription']) {
      assert.ok(manifest.configSchema?.[configKey], `Expected plugin-owned config schema for ${configKey}`);
    }
  }
};
