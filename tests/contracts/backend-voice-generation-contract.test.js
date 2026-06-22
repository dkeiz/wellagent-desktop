const fs = require('fs');
const path = require('path');

function createSettingsDb(values = {}) {
  return {
    async getSetting(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    async saveSetting(key, value) {
      values[key] = String(value);
    }
  };
}

function createContainer(db, ttsHttpEntrypoint) {
  const services = new Map([
    ['db', db],
    ['ttsHttpEntrypoint', ttsHttpEntrypoint]
  ]);
  return {
    get(name) {
      if (!services.has(name)) throw new Error(`Missing service: ${name}`);
      return services.get(name);
    },
    optional(name) {
      return services.has(name) ? services.get(name) : null;
    },
    replace(name, value) {
      services.set(name, value);
      return this;
    }
  };
}

module.exports = {
  name: 'backend-voice-generation-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const dispatchPath = path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js');
    const browserClientPath = path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js');
    const browserVoicePath = path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'voice.js');
    const dispatchSource = fs.readFileSync(dispatchPath, 'utf8');
    const browserClientSource = fs.readFileSync(browserClientPath, 'utf8');
    const browserVoiceSource = fs.readFileSync(browserVoicePath, 'utf8');
    const ttsHttpEntrypointPath = path.join(rootDir, 'src', 'main', 'tts-http-entrypoint.js');
    const ttsHttpEntrypointSource = fs.readFileSync(ttsHttpEntrypointPath, 'utf8');

    const CompanionPermissions = require(path.join(rootDir, 'src', 'main', 'companion-permissions.js'));
    const TtsService = require(path.join(rootDir, 'src', 'main', 'tts-service.js'));
    const { createTtsHttpEntrypoint } = require(path.join(rootDir, 'src', 'main', 'tts-http-entrypoint.js'));
    const { configureCompanionServer } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'));

    assert.includes(dispatchSource, "urlPath === '/backend/voice/generate'", 'Expected HTTP dispatch to expose the backend voice generation route');
    assert.includes(dispatchSource, 'ttsHttpEntrypoint.generateAudio({', 'Expected HTTP voice generation to call the backend voice entrypoint');
    assert.equal(dispatchSource.includes('ttsHttpEntrypoint.createPlaybackSession'), false, 'Expected HTTP voice generation not to use the stream-plan entrypoint');
    assert.equal(dispatchSource.includes("urlPath === '/companion/tts/speak'"), false, 'Expected deprecated companion TTS route to be removed');
    assert.equal(dispatchSource.includes('/companion/tts/stream/'), false, 'Expected deprecated companion TTS stream route to be removed');
    assert.equal(ttsHttpEntrypointSource.includes('createPlaybackSession'), false, 'Expected backend voice entrypoint not to expose stream session creation');
    assert.equal(ttsHttpEntrypointSource.includes('openStream'), false, 'Expected backend voice entrypoint not to expose a stream proxy');
    assert.includes(browserClientSource, "this.request('POST', '/backend/voice/generate'", 'Expected browser web client to call the backend voice generation endpoint');
    assert.includes(browserVoiceSource, 'audioBase64', 'Expected browser playback to support direct base64 audio responses');
    assert.equal(browserVoiceSource.includes('response?.streamPath'), false, 'Expected browser playback not to make a second stream request for TTS');
    assert.equal(browserVoiceSource.includes('playBackendStream'), false, 'Expected browser playback not to expose a backend stream player');
    assert.includes(browserVoiceSource, 'prepareSpeechPlayback', 'Expected browser speech playback to unlock audio before backend generation');
    assert.ok(
      browserVoiceSource.indexOf('await this.prepareSpeechPlayback();') < browserVoiceSource.indexOf('await this.client.speakText(rawText)'),
      'Expected browser audio unlock to happen before the backend voice request'
    );
    assert.includes(browserVoiceSource, "response?.mode === 'companion-browser-tts'", 'Expected browser playback to recognize companion browser TTS mode');
    assert.includes(browserVoiceSource, 'speakWithBrowserTts(speakText)', 'Expected browser playback to speak backend-cleaned companion text');
    assert.ok(!browserVoiceSource.includes("response?.fallback === 'browser-tts'"), 'Expected internal browser TTS fallback name not to drive companion behavior');
    assert.includes(browserVoiceSource, 'playBase64Speech(audio.audioBase64, audio.mimeType)', 'Expected browser playback to play inline backend audio directly');

    const permissions = new CompanionPermissions();
    assert.equal(permissions.isCompanionEndpointAllowed(permissions.getDefaultScope('standard'), 'backend:voice:generate'), true, 'Expected standard web devices to request backend voice generation');
    assert.equal(permissions.isCompanionEndpointAllowed(permissions.getDefaultScope('chat-only'), 'backend:voice:generate'), true, 'Expected chat-only web devices to request backend voice generation');
    assert.equal(permissions.isCompanionEndpointAllowed(permissions.getDefaultScope('read-only'), 'backend:voice:generate'), false, 'Expected read-only web devices to remain blocked from backend voice generation');

    const generatedAudio = Buffer.from('direct-entrypoint-audio').toString('base64');
    const entrypointCalls = [];
    const ttsHttpEntrypoint = {
      async generateAudio(params) {
        entrypointCalls.push(params);
        return {
          success: true,
          status: 200,
          mimeType: 'audio/wav',
          audioBase64: generatedAudio,
          backend: 'embedded-voice',
          pluginId: '',
          provider: 'fast-qwen',
          voice: 'qwen-builtin:serena',
          durationMs: 123
        };
      }
    };
    let dispatch = null;
    const companionServer = {
      setDispatch(fn) {
        dispatch = fn;
      },
      disconnectDevice() {}
    };
    const db = createSettingsDb();
    const auth = {
      async validateAccessToken() {
        return {
          valid: true,
          payload: {
            deviceId: 'voice-contract-device',
            platform: 'web',
            permissions: { preset: 'standard' }
          }
        };
      }
    };
    configureCompanionServer({
      companionServer,
      container: createContainer(db, ttsHttpEntrypoint),
      db,
      companionAuth: auth
    });

    const response = await dispatch(
      'POST',
      '/backend/voice/generate',
      { text: 'hello from web companion', sessionId: 'voice-session', agentId: 'agent-1' },
      {},
      'access-token',
      {},
      new URL('http://127.0.0.1/backend/voice/generate')
    );
    assert.equal(response.status, 200, 'Expected backend voice route to return generated audio');
    assert.equal(response.body.audioBase64, generatedAudio, 'Expected direct audio bytes from the backend entrypoint');
    assert.equal(response.body.backend, undefined, 'Expected backend routing metadata not to be public');
    assert.equal(response.body.pluginId, undefined, 'Expected plugin routing metadata not to be public');
    assert.equal(response.body.provider, undefined, 'Expected provider routing metadata not to be public');
    assert.equal(response.body.voice, undefined, 'Expected selected voice metadata not to be public');
    assert.equal(response.body.streamPath, undefined, 'Expected backend voice route not to return stream paths');
    assert.equal(entrypointCalls.length, 1, 'Expected exactly one backend entrypoint call');
    assert.equal(entrypointCalls[0].rawText, 'hello from web companion', 'Expected submitted text to reach the entrypoint unchanged');
    assert.equal(entrypointCalls[0].includeBase64, true, 'Expected backend voice route to request inline audio');
    assert.equal(entrypointCalls[0].prepareText, false, 'Expected backend voice route not to add a separate text-preparation path');
    assert.equal(entrypointCalls[0].provider, undefined, 'Expected public voice route not to forward provider routing');
    assert.equal(entrypointCalls[0].voice, undefined, 'Expected public voice route not to forward voice routing');

    const rejectedRouting = await dispatch(
      'POST',
      '/backend/voice/generate',
      { text: 'hijack route', provider: 'fast-qwen' },
      {},
      'access-token',
      {},
      new URL('http://127.0.0.1/backend/voice/generate')
    );
    assert.equal(rejectedRouting.status, 403, 'Expected public voice route to reject caller-owned provider routing');
    assert.equal(rejectedRouting._closeConnection, true, 'Expected voice routing protocol violations to close the connection');

    const fallbackEntrypoint = {
      async generateAudio() {
        return {
          success: false,
          status: 200,
          backend: 'browser-tts',
          fallback: 'browser-tts',
          speakText: 'clean answer text',
          error: 'No TTS plugin enabled. Use browser speechSynthesis.'
        };
      }
    };
    let fallbackDispatch = null;
    configureCompanionServer({
      companionServer: {
        setDispatch(fn) {
          fallbackDispatch = fn;
        },
        disconnectDevice() {}
      },
      container: createContainer(db, fallbackEntrypoint),
      db,
      companionAuth: auth
    });
    const fallbackResponse = await fallbackDispatch(
      'POST',
      '/backend/voice/generate',
      { text: '<think>hidden</think>clean answer text' },
      {},
      'access-token',
      {},
      new URL('http://127.0.0.1/backend/voice/generate')
    );
    assert.equal(fallbackResponse.status, 200, 'Expected browser TTS fallback to be a successful companion response');
    assert.equal(fallbackResponse.body.success, true, 'Expected browser TTS fallback not to throw in the web client');
    assert.equal(fallbackResponse.body.fallback, undefined, 'Expected internal browser TTS fallback name not to leak to companion');
    assert.equal(fallbackResponse.body.mode, 'companion-browser-tts', 'Expected explicit companion browser TTS mode');
    assert.equal(fallbackResponse.body.speakText, 'clean answer text', 'Expected cleaned fallback text to reach the companion');

    const pluginActionCalls = [];
    const pluginTtsService = new TtsService({
      db: createSettingsDb({
        'tts.defaultPluginId': 'mock-plugin',
        'tts.speed': '1'
      }),
      pluginManager: {
        getPluginsByCapability(capability, options) {
          assert.equal(capability, 'tts', 'Expected TTS provider lookup');
          assert.equal(options.enabledOnly, true, 'Expected enabled-only plugin lookup');
          return [{ id: 'mock-plugin', status: 'enabled' }];
        },
        async runPluginAction(pluginId, action, payload) {
          pluginActionCalls.push({ pluginId, action, payload });
          return {
            ok: true,
            audioBase64: Buffer.from('plugin-audio').toString('base64'),
            mimeType: 'audio/wav',
            durationMs: 456
          };
        }
      },
      agentManager: null
    });
    const pluginAudio = await createTtsHttpEntrypoint({ ttsService: pluginTtsService }).generateAudio({
      text: 'plugin path',
      includeBase64: true
    });
    assert.equal(pluginAudio.success, true, 'Expected plugin-backed entrypoint generation to succeed');
    assert.equal(pluginAudio.backend, 'plugin-tts', 'Expected plugin settings to select plugin TTS');
    assert.equal(pluginAudio.pluginId, 'mock-plugin', 'Expected selected plugin id to be reported');
    assert.equal(pluginActionCalls.length, 1, 'Expected plugin path to call one plugin action');
    assert.equal(pluginActionCalls[0].action, 'speak', 'Expected plugin path to use the speak action');
    assert.equal(pluginActionCalls[0].payload.provider, undefined, 'Expected service not to pass provider routing into plugin action');
    assert.equal(pluginActionCalls[0].payload.voice, undefined, 'Expected service not to pass voice routing into plugin action');

    const embeddedCalls = [];
    const embeddedTtsService = new TtsService({
      db: createSettingsDb({
        'tts.speed': '1'
      }),
      pluginManager: {
        getPluginsByCapability() {
          return [{ id: 'mock-plugin', status: 'enabled' }];
        },
        async runPluginAction() {
          throw new Error('Unselected plugin must not hijack backend voice generation');
        }
      },
      agentManager: null
    });
    const embeddedAudio = await createTtsHttpEntrypoint({ ttsService: embeddedTtsService }).generateAudio({
      text: 'embedded path',
      includeBase64: true
    });
    assert.equal(embeddedAudio.success, false, 'Expected no selected plugin to signal browser-tts fallback');
    assert.equal(embeddedAudio.backend, 'browser-tts', 'Expected browser-tts fallback when no plugin is selected by user');
    assert.equal(embeddedAudio.fallback, 'browser-tts', 'Expected explicit fallback signal');
    assert.equal(embeddedCalls.length, 0, 'Expected embedded voice backend never to be called without user selection');

    for (const filePath of [dispatchPath, browserClientPath, browserVoicePath]) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${path.relative(rootDir, filePath)} to stay under 1000 lines`);
    }
  }
};
