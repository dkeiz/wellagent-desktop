const path = require('path');
const fs = require('fs');
const os = require('os');

function createContainer(extraServices = {}) {
  const services = new Map(Object.entries(extraServices));
  if (!services.has('db')) {
    services.set('db', {
      async getSetting() { return null; },
      async saveSetting() {}
    });
  }
  return {
    get(name) {
      if (!services.has(name)) throw new Error(`Missing service: ${name}`);
      return services.get(name);
    },
    optional(name) {
      return services.has(name) ? services.get(name) : null;
    }
  };
}

function createDispatch(rootDir, { permissions, extraServices = {}, route = '/companion/stt/transcribe', routeQuery = null }) {
  const { configureCompanionServer } = require(path.join(
    rootDir,
    'src',
    'main',
    'companion',
    'companion-backend-dispatch.js'
  ));
  let dispatch = null;
  configureCompanionServer({
    companionServer: {
      setDispatch(fn) { dispatch = fn; },
      disconnectDevice() {}
    },
    container: createContainer(extraServices),
    companionAuth: {
      async validateAccessToken() {
        return {
          valid: true,
          payload: {
            deviceId: 'stt-binary-contract-device',
            platform: 'android',
            permissions
          }
        };
      }
    }
  });
  return (body, headers = {}) => dispatch(
    'POST',
    route,
    body,
    headers,
    'access-token',
    {},
    new URL(`http://127.0.0.1${route}${routeQuery === null ? (route === '/android/voice/send' ? '?sessionId=session-1' : '') : routeQuery}`)
  );
}

function createChatDb(initialSessionId = 'session-1') {
  const sessions = new Map([
    ['session-1', { id: 'session-1', title: 'Voice' }],
    ['session-2', { id: 'session-2', title: 'Desktop Current' }]
  ]);
  const conversations = [];
  let currentSession = initialSessionId;
  return {
    conversations,
    createdCount: 0,
    get(sql, params = []) {
      if (String(sql).includes('FROM chat_sessions')) return sessions.get(String(params[0])) || null;
      return null;
    },
    async getSetting() { return null; },
    async saveSetting() {},
    async getCurrentSession() { return sessions.get(currentSession) || null; },
    async setCurrentSession(sessionId) { currentSession = sessionId; },
    async getChatSessions() { return Array.from(sessions.values()); },
    async getConversations() { return []; },
    async addConversation(message, sessionId) {
      conversations.push({ ...message, sessionId });
    },
    async createChatSession() {
      this.createdCount += 1;
      const id = `session-${sessions.size + 1}`;
      sessions.set(id, { id, title: 'New' });
      currentSession = id;
      return { id, title: 'New' };
    }
  };
}

module.exports = {
  name: 'companion-stt-binary-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const captured = [];
    const dispatch = createDispatch(rootDir, {
      permissions: { preset: 'standard', mediaUpload: true },
      extraServices: {
        sttService: {
          async transcribeAudio(params) {
            captured.push(params);
            return { success: true, transcript: 'hello from android' };
          }
        }
      }
    });

    const audioBase64 = Buffer.from('android-audio').toString('base64');
    const ok = await dispatch(
      { _binaryBase64: audioBase64, _binaryContentType: 'audio/mp4' },
      { 'content-type': 'audio/mp4' }
    );
    assert.equal(ok.status, 200, 'Expected binary STT upload to succeed');
    assert.equal(captured[0].audioBase64, audioBase64, 'Expected binary audio bytes to reach STT service');
    assert.equal(captured[0].mimeType, 'audio/mp4', 'Expected Android audio content type to reach STT service');

    const deniedCalls = [];
    const deniedDispatch = createDispatch(rootDir, {
      permissions: { preset: 'standard', mediaUpload: false },
      extraServices: {
        sttService: {
          async transcribeAudio() {
            deniedCalls.push(true);
            return { success: true };
          }
        }
      }
    });
    const denied = await deniedDispatch({ _binaryBase64: audioBase64, _binaryContentType: 'audio/mp4' });
    assert.equal(denied.status, 403, 'Expected mediaUpload=false to block STT');
    assert.equal(deniedCalls.length, 0, 'Expected denied STT request not to call service');

    const missing = await createDispatch(rootDir, {
      permissions: { preset: 'standard', mediaUpload: true }
    })({ _binaryBase64: audioBase64, _binaryContentType: 'audio/mp4' });
    assert.equal(missing.status, 503, 'Expected missing STT backend to return a clear unavailable response');
    assert.includes(missing.body.error, 'STT backend is unavailable', 'Expected missing backend error to be explicit');

    const chatDb = createChatDb();
    const androidCaptured = [];
    const voiceWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-voice-contract-'));
    const androidDispatch = createDispatch(rootDir, {
      route: '/android/voice/send',
      permissions: { preset: 'standard', mediaUpload: true },
      extraServices: {
        db: chatDb,
        sessionWorkspace: {
          getWorkspacePath() { return voiceWorkspaceDir; }
        },
        dispatcher: {
          async dispatch() {
            return { content: 'assistant response' };
          }
        },
        sttService: {
          async transcribeAudio(params) {
            androidCaptured.push(params);
            return {
              success: true,
              backend: 'native-stt',
              providerId: 'embedded-whisper',
              transcript: 'desktop recognized android speech'
            };
          }
        }
      }
    });
    const android = await androidDispatch(
      { _binaryBase64: audioBase64, _binaryContentType: 'audio/mp4' },
      { 'content-type': 'audio/mp4' }
    );
    fs.rmSync(voiceWorkspaceDir, { recursive: true, force: true });
    assert.equal(android.status, 200, 'Expected Android voice-send route to succeed through desktop STT');
    assert.equal(androidCaptured[0].audioBase64, audioBase64, 'Expected Android voice-send bytes to reach desktop STT service');
    assert.equal(androidCaptured[0].mimeType, 'audio/mp4', 'Expected Android voice-send content type to reach desktop STT service');
    assert.equal(android.body.backend, 'native-stt', 'Expected Android voice-send response to expose the desktop STT backend');
    assert.ok(chatDb.conversations[0].content.startsWith('[Voice message: companion_audio_'), 'Expected stored Android voice message to retain an attachment marker for playback');
    assert.includes(chatDb.conversations[0].content, 'Voice input from Android app (transcribed text):\ndesktop recognized android speech', 'Expected transcript to enter normal desktop chat as explicit Android voice text');
    assert.equal(chatDb.conversations[0].metadata.clientSource, 'mobile', 'Expected desktop chat metadata to preserve mobile source');

    const currentDb = createChatDb('session-2');
    const currentDispatch = createDispatch(rootDir, {
      route: '/android/voice/send',
      routeQuery: '',
      permissions: { preset: 'standard', mediaUpload: true },
      extraServices: {
        db: currentDb,
        dispatcher: {
          async dispatch() {
            return { content: 'assistant response' };
          }
        },
        sttService: {
          async transcribeAudio() {
            return { success: true, backend: 'native-stt', providerId: 'embedded-whisper', transcript: 'voice into desktop current' };
          }
        }
      }
    });
    const current = await currentDispatch(
      { _binaryBase64: audioBase64, _binaryContentType: 'audio/mp4' },
      { 'content-type': 'audio/mp4' }
    );
    assert.equal(current.status, 200, 'Expected Android voice-send without sessionId to use backend current session');
    assert.equal(current.body.sessionId, 'session-2', 'Expected Android voice-send to report backend current session id');
    assert.equal(currentDb.conversations[0].sessionId, 'session-2', 'Expected voice transcript to be stored in backend current session');
    assert.equal(currentDb.conversations[0].content, 'Voice input from Android app (transcribed text):\nvoice into desktop current', 'Expected Android voice-send without attachment to store explicit transcribed text');
    assert.equal(currentDb.createdCount, 0, 'Expected Android voice-send not to create a new session when backend current exists');
  }
};
