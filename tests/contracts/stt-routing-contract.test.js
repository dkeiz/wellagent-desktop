const fs = require('fs');
const path = require('path');

function createSettingsDb(values = {}) {
  const store = { ...values };
  return {
    async getSetting(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : '';
    },
    async saveSetting(key, value) {
      store[key] = String(value ?? '');
    }
  };
}

module.exports = {
  name: 'stt-routing-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const SttService = require(path.join(rootDir, 'src', 'main', 'stt-service.js'));
    const manifest = require(path.join(rootDir, 'agentin', 'plugins', 'http-tts-bridge', 'plugin.json'));
    const packageJson = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'stt-service.js'), 'utf8');
    const rendererVoice = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-voice.js'), 'utf8');
    const electronApi = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(rootDir, 'src', 'main', 'bootstrap-phases.js'), 'utf8');
    const externalStt = fs.readFileSync(path.join(rootDir, 'tests', 'external', 'stt-ipc-routing.external-test.js'), 'utf8');

    assert.equal(manifest.capabilities.includes('stt'), false, 'Expected bundled voice plugin not to imply STT support');
    assert.includes(serviceSource, "'stt.defaultPluginId'", 'Expected STT service to use saved plugin override setting');
    assert.includes(serviceSource, "'embedded-whisper'", 'Expected STT service to expose one built-in desktop STT provider');
    assert.includes(serviceSource, 'NativeWhisperSttBackend', 'Expected STT service to use native ONNX Whisper backend');
    assert.equal(serviceSource.includes('openai-whisper-api'), false, 'Expected cloud Whisper fallback to stay out of core STT');
    assert.equal(serviceSource.includes('local-whisper'), false, 'Expected local Node Whisper fallback to stay out of core STT');
    assert.includes(bootstrap, 'new SttService({ db, runtimePaths: paths, pluginManager })', 'Expected STT service to receive plugin manager at bootstrap');
    assert.includes(electronApi, "transcribeAudio: (params = {}) => ipcRenderer.invoke('stt:transcribe-audio', params)", 'Expected renderer bridge to expose STT IPC');
    assert.includes(rendererVoice, 'AudioContext', 'Expected desktop voice input to record PCM audio bytes');
    assert.includes(rendererVoice, "mimeType: 'audio/wav'", 'Expected desktop voice input to send native STT WAV audio');
    assert.includes(rendererVoice, 'electronBridge.stt.transcribeAudio', 'Expected desktop voice input to use backend STT IPC');
    assert.includes(rendererVoice, "document.getElementById('message-input').value = transcript", 'Expected desktop STT transcript to fill the compose field');
    assert.equal(rendererVoice.includes('SpeechRecognition'), false, 'Expected desktop voice input not to use browser SpeechRecognition');
    assert.includes(externalStt, "stt:save-settings', [{ defaultPluginId: '' }]", 'Expected external STT test to clear plugin override and use built-in desktop STT');
    assert.includes(externalStt, 'stt-speech-probe.wav', 'Expected external STT proof to default to a spoken fixture');
    assert.includes(externalStt, 'desktop_text=', 'Expected external STT proof to print desktop recognized text');
    assert.includes(externalStt, 'companion_text=', 'Expected external STT proof to print companion recognized text');
    assert.equal(externalStt.includes('LOCALAGENT_HTTP_TTS_BRIDGE_STT_MOCK'), false, 'Expected external STT acceptance test not to use STT mock env');
    assert.equal(externalStt.includes("plugins:enable', ['http-tts-bridge']"), false, 'Expected external STT acceptance test not to select the bundled plugin');
    assert.includes(packageJson, '@xenova/transformers', 'Expected native Whisper ONNX runtime dependency');
    assert.equal(packageJson.includes('@huggingface/transformers'), false, 'Expected core package to avoid bundled Node Whisper dependency');
    assert.equal(packageJson.includes('audio-decode'), false, 'Expected core package to avoid bundled audio-decode dependency');
    assert.equal(packageJson.includes('wavefile'), false, 'Expected core package to avoid bundled wavefile dependency');

    const pluginCalls = [];
    const selectedService = new SttService({
      db: createSettingsDb({ 'stt.defaultPluginId': 'stt-plugin' }),
      runtimePaths: null,
      pluginManager: {
        getPluginsByCapability(capability, options = {}) {
          if (capability !== 'stt' || options.enabledOnly !== true) return [];
          return [{ id: 'stt-plugin', status: 'enabled', contract: 'stt.v1' }];
        },
        async runPluginAction(pluginId, action, payload) {
          pluginCalls.push({ pluginId, action, payload });
          return { success: true, text: 'plugin transcript', provider: 'plugin-stt' };
        }
      }
    });
    const pluginResult = await selectedService.transcribeAudio({
      audioBase64: Buffer.from('fixture').toString('base64'),
      mimeType: 'audio/wav'
    });
    assert.equal(pluginResult.success, true, 'Expected selected STT plugin to transcribe');
    assert.equal(pluginResult.backend, 'plugin-stt', 'Expected selected STT plugin backend marker');
    assert.equal(pluginResult.text, 'plugin transcript', 'Expected top-level transcript text for clients');
    assert.equal(pluginCalls.length, 1, 'Expected one selected plugin action');
    assert.equal(pluginCalls[0].action, 'transcribeAudio', 'Expected STT plugin action to be transcribeAudio');
    assert.equal(pluginCalls[0].payload.mimeType, 'audio/wav', 'Expected audio mime type to reach plugin');

    const unselectedCalls = [];
    const unselectedService = new SttService({
      db: createSettingsDb({}),
      runtimePaths: null,
      pluginManager: {
        getPluginsByCapability(capability, options = {}) {
          if (capability !== 'stt' || options.enabledOnly !== true) return [];
          return [{ id: 'stt-plugin', status: 'enabled' }];
        },
        async runPluginAction() {
          unselectedCalls.push(true);
          throw new Error('Unselected plugin must not run');
        }
      }
    });
    const unselectedProviders = unselectedService.listProviders({ enabledOnly: true });
    assert.ok(unselectedProviders.some(provider => provider.id === 'embedded-whisper'), 'Expected embedded STT provider to remain available');
    assert.equal(unselectedCalls.length, 0, 'Expected unselected STT plugin not to run');

    const disabledCalls = [];
    const disabledService = new SttService({
      db: createSettingsDb({ 'stt.defaultPluginId': 'stt-plugin' }),
      runtimePaths: null,
      pluginManager: {
        getPluginsByCapability(capability) {
          if (capability !== 'stt') return [];
          return [{ id: 'stt-plugin', status: 'disabled' }];
        },
        async runPluginAction() {
          disabledCalls.push(true);
          throw new Error('Disabled plugin must not run');
        }
      }
    });
    assert.equal(await disabledService._resolveSelectedPluginId(), '', 'Expected disabled selected STT plugin not to resolve');
    assert.equal(disabledCalls.length, 0, 'Expected disabled selected STT plugin not to run');
  }
};
