const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'core-voice-service-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const TtsService = require(path.join(rootDir, 'src', 'main', 'tts-service.js'));
    const manifest = require(path.join(rootDir, 'agentin', 'plugins', 'http-tts-bridge', 'plugin.json'));
    const serviceSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'tts-service.js'), 'utf8');

    assert.deepEqual(manifest.capabilities, ['tts'], 'Expected the bundled TTS plugin manifest to expose only the tts capability');
    assert.equal(serviceSource.includes('_normalizePluginVoice'), false, 'Expected TtsService not to contain plugin voice-route normalization');
    assert.equal(serviceSource.includes('qwen-builtin:'), false, 'Expected TtsService not to know Qwen plugin voice routes');
    assert.equal(serviceSource.includes('qwen-clone:'), false, 'Expected TtsService not to know Qwen clone routes');
    assert.equal(serviceSource.includes('getStreamPlan'), false, 'Expected TtsService not to expose plugin stream routes');
    assert.equal(serviceSource.includes('tts.provider'), false, 'Expected TtsService not to own plugin provider settings');
    assert.equal(serviceSource.includes('tts.voice'), false, 'Expected TtsService not to own plugin voice settings');
    assert.equal(serviceSource.includes('voiceDescription'), false, 'Expected TtsService not to own plugin voice style settings');
    assert.equal(serviceSource.includes('params.provider'), false, 'Expected TtsService not to accept caller provider routing');
    assert.equal(serviceSource.includes('params.voice'), false, 'Expected TtsService not to accept caller voice routing');

    const captured = [];
    const settingsStore = {
      'tts.provider': 'fast-qwen',
      'tts.voice': 'qwen-builtin:serena',
      'tts.voiceDescription': 'calm',
      'tts.speed': '1.1',
      'tts.autoSpeak': 'false',
      'tts.autoSpeakMode': 'answer'
    };
    const service = new TtsService({
      db: {
        async getSetting(key) {
          return settingsStore[key] || '';
        }
      },
      pluginManager: null,
      agentManager: null
    });

    const response = await service.speakAudio({
      text: 'Test the backend voice path',
      provider: 'fast-qwen',
      voice: 'piper:external-route',
      pluginId: 'external-plugin',
      style: 'external style'
    });
    assert.equal(response.success, false, 'Expected no plugin manager to signal browser-tts fallback');
    assert.equal(response.backend, 'browser-tts', 'Expected browser-tts fallback when no plugin system is available');
    assert.equal(response.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(captured.length, 0, 'Expected no embedded voice backend call without plugin');

    const selectedPluginCalls = [];
    const selectedPluginService = new TtsService({
      db: {
        async getSetting(key) {
          const values = {
            'tts.defaultPluginId': 'http-tts-bridge',
            'tts.provider': 'piper',
            'tts.voice': 'piper:en_US-lessac-medium',
            'tts.speed': '1'
          };
          return values[key] || '';
        }
      },
      pluginManager: {
        getPluginsByCapability(capability, options = {}) {
          if (capability !== 'tts' || options.enabledOnly !== true) return [];
          return [{ id: 'http-tts-bridge', status: 'enabled' }];
        },
        async runPluginAction(pluginId, action, payload) {
          selectedPluginCalls.push({ pluginId, action, payload });
          return {
            success: true,
            mimeType: 'audio/wav',
            audioBase64: Buffer.from('plugin').toString('base64')
          };
        }
      },
      agentManager: null
    });
    const pluginResult = await selectedPluginService.speakAudio({
      text: 'Use selected plugin',
      provider: 'fast-qwen',
      voice: 'qwen-builtin:serena',
      pluginId: 'external-plugin'
    });
    assert.equal(pluginResult.success, true, 'Expected selected enabled plugin to generate audio');
    assert.equal(pluginResult.backend, 'plugin-tts', 'Expected selected enabled plugin path');
    assert.equal(selectedPluginCalls.length, 1, 'Expected one selected plugin action');
    assert.equal(selectedPluginCalls[0].pluginId, 'http-tts-bridge', 'Expected only saved selected plugin to run');
    assert.equal(selectedPluginCalls[0].payload.provider, undefined, 'Expected plugin payload not to receive service-owned provider routing');
    assert.equal(selectedPluginCalls[0].payload.voice, undefined, 'Expected plugin payload not to receive service-owned voice routing');
    assert.equal(selectedPluginCalls[0].payload.pluginId, undefined, 'Expected plugin payload not to receive caller plugin routing');

    const unselectedPluginCalls = [];
    const embeddedWithEnabledPlugin = new TtsService({
      db: {
        async getSetting(key) {
          const values = { 'tts.speed': '1' };
          return values[key] || '';
        }
      },
      pluginManager: {
        getPluginsByCapability(capability, options = {}) {
          if (capability !== 'tts' || options.enabledOnly !== true) return [];
          return [{ id: 'http-tts-bridge', status: 'enabled' }];
        },
        async runPluginAction(pluginId, action) {
          unselectedPluginCalls.push({ pluginId, action });
          throw new Error('Unselected plugin must not run');
        }
      },
      agentManager: null
    });
    const unselectedPluginResult = await embeddedWithEnabledPlugin.speakAudio({ text: 'Do not auto-pick plugin' });
    assert.equal(unselectedPluginResult.success, false, 'Expected no default plugin to signal browser-tts fallback');
    assert.equal(unselectedPluginResult.backend, 'browser-tts', 'Expected browser-tts fallback when user has no plugin selected');
    assert.equal(unselectedPluginResult.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(unselectedPluginCalls.length, 0, 'Expected speakAudio not to auto-pick the first enabled plugin');

    const disabledPluginCalls = [];
    const selectedButDisabledPlugin = new TtsService({
      db: {
        async getSetting(key) {
          const values = {
            'tts.defaultPluginId': 'http-tts-bridge',
            'tts.speed': '1'
          };
          return values[key] || '';
        }
      },
      pluginManager: {
        getPluginsByCapability(capability) {
          if (capability !== 'tts') return [];
          return [{ id: 'http-tts-bridge', status: 'disabled' }];
        },
        async runPluginAction(pluginId, action) {
          disabledPluginCalls.push({ pluginId, action });
          throw new Error('Disabled plugin must not run');
        }
      },
      agentManager: null
    });
    const disabledPluginResult = await selectedButDisabledPlugin.speakAudio({ text: 'Do not run disabled plugin' });
    assert.equal(disabledPluginResult.success, false, 'Expected disabled selected plugin to signal browser-tts fallback');
    assert.equal(disabledPluginResult.backend, 'browser-tts', 'Expected browser-tts fallback when selected plugin is disabled');
    assert.equal(disabledPluginResult.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(disabledPluginCalls.length, 0, 'Expected speakAudio not to call a disabled plugin action');
  }
};
