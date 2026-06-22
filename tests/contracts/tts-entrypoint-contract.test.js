const path = require('path');

function createSettingsDb(values = {}) {
  return {
    async getSetting(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
    }
  };
}

module.exports = {
  name: 'tts-entrypoint-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const TtsService = require(path.join(rootDir, 'src', 'main', 'tts-service.js'));
    const { createTtsHttpEntrypoint } = require(path.join(rootDir, 'src', 'main', 'tts-http-entrypoint.js'));

    const pluginCalls = [];
    const pluginService = new TtsService({
      db: createSettingsDb({
        'tts.defaultPluginId': 'http-tts-bridge',
        'tts.speed': '1.1'
      }),
      pluginManager: {
        getPluginsByCapability(capability, options = {}) {
          if (capability !== 'tts' || options.enabledOnly !== true) return [];
          return [{ id: 'http-tts-bridge', status: 'enabled', contract: 'tts.v1' }];
        },
        async runPluginAction(pluginId, action, payload) {
          pluginCalls.push({ pluginId, action, payload });
          return {
            success: true,
            mimeType: 'audio/wav',
            audioBase64: Buffer.from('plugin-audio').toString('base64'),
            durationMs: 123
          };
        }
      },
      agentManager: null
    });

    const pluginResult = await createTtsHttpEntrypoint({ ttsService: pluginService }).generateAudio({ text: 'Use enabled plugin' });
    assert.equal(pluginResult.success, true, 'Expected voice generation entrypoint to succeed through enabled TTS plugin');
    assert.equal(pluginResult.audioBase64, Buffer.from('plugin-audio').toString('base64'), 'Expected plugin audio bytes to be returned');
    assert.equal(pluginCalls.length, 1, 'Expected one plugin action call when plugin is enabled');
    assert.equal(pluginCalls[0].action, 'speak', 'Expected plugin speak action to be used');
    assert.equal(pluginCalls[0].payload.provider, undefined, 'Expected entrypoint plugin payload not to carry provider routing');
    assert.equal(pluginCalls[0].payload.voice, undefined, 'Expected entrypoint plugin payload not to carry voice routing');

    const embeddedCalls = [];
    const embeddedService = new TtsService({
      db: createSettingsDb({
        'tts.speed': '1.1'
      }),
      pluginManager: {
        getPluginsByCapability() {
          return [{ id: 'http-tts-bridge', status: 'enabled', contract: 'tts.v1' }];
        },
        async runPluginAction() {
          throw new Error('Unselected plugin must not hijack backend voice generation');
        }
      },
      agentManager: null
    });
    const embeddedResult = await createTtsHttpEntrypoint({ ttsService: embeddedService }).generateAudio({ text: 'Use embedded backend' });
    assert.equal(embeddedResult.success, false, 'Expected no default plugin to signal browser-tts fallback');
    assert.equal(embeddedResult.backend, 'browser-tts', 'Expected browser-tts fallback when user has no plugin selected');
    assert.equal(embeddedResult.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(embeddedCalls.length, 0, 'Expected no embedded backend call without plugin');

    const disabledPluginCalls = [];
    const selectedDisabledService = new TtsService({
      db: createSettingsDb({
        'tts.defaultPluginId': 'http-tts-bridge',
        'tts.speed': '1.1'
      }),
      pluginManager: {
        getPluginsByCapability(capability) {
          if (capability !== 'tts') return [];
          return [{ id: 'http-tts-bridge', status: 'disabled', contract: 'tts.v1' }];
        },
        async runPluginAction(pluginId, action) {
          disabledPluginCalls.push({ pluginId, action });
          throw new Error('Disabled plugin must not run');
        }
      },
      agentManager: null
    });
    const selectedDisabledResult = await createTtsHttpEntrypoint({ ttsService: selectedDisabledService }).generateAudio({ text: 'Use embedded when selected plugin is off' });
    assert.equal(selectedDisabledResult.success, false, 'Expected selected but disabled plugin to signal browser-tts fallback');
    assert.equal(selectedDisabledResult.backend, 'browser-tts', 'Expected browser-tts fallback when selected plugin is disabled');
    assert.equal(selectedDisabledResult.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(disabledPluginCalls.length, 0, 'Expected backend voice entrypoint not to run disabled plugin actions');

    const capturedBytes = Buffer.from('captured-url-audio').toString('base64');
    const urlOnlyEntrypoint = createTtsHttpEntrypoint({
      ttsService: {
        async speakAudio() {
          return {
            success: true,
            backend: 'embedded-voice',
            result: {
              audioUrl: `data:audio/wav;base64,${capturedBytes}`,
              mimeType: 'audio/wav',
              durationMs: 789
            }
          };
        }
      }
    });
    const urlOnlyResult = await urlOnlyEntrypoint.generateAudio({ text: 'Capture generated URL bytes' });
    assert.equal(urlOnlyResult.success, true, 'Expected generated audio URL to be captured inside the backend entrypoint');
    assert.equal(urlOnlyResult.audioBase64, capturedBytes, 'Expected captured audio URL bytes to be returned as base64');

    const missingAudioResult = await createTtsHttpEntrypoint({
      ttsService: {
        async speakAudio() {
          return {
            success: true,
            backend: 'embedded-voice',
            result: { mimeType: 'audio/wav' }
          };
        }
      }
    }).generateAudio({ text: 'No bytes' });
    assert.equal(missingAudioResult.success, false, 'Expected missing generated audio bytes to fail');
    assert.includes(missingAudioResult.error, 'no audio bytes', 'Expected missing audio failure to be explicit');
  }
};
