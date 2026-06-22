const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'mobile-voice-flow-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const chatSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'ChatScreen.tsx'), 'utf8');
    const clientSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'api', 'client.ts'), 'utf8');
    const hookSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'hooks', 'useChat.ts'), 'utf8');
    const voiceSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'services', 'voice.ts'), 'utf8');
    const appJsonSource = fs.readFileSync(path.join(rootDir, 'mobile', 'app.json'), 'utf8');

    assert.includes(chatSource, 'const ensureVoiceReady = useCallback', 'Expected Android voice flow to centralize readiness checks');
    assert.includes(chatSource, 'if (!client.isAuthenticated())', 'Expected voice recording to require an authenticated client');
    assert.includes(chatSource, 'const result = await client.getSettings()', 'Expected voice recording to validate desktop reachability and permissions');
    assert.includes(chatSource, 'permissions.mediaUpload === false', 'Expected voice recording to respect mediaUpload permission');
    assert.includes(chatSource, 'voice service unavailable:', 'Expected unreachable settings/STT readiness to produce a clear status');
    assert.equal(chatSource.includes('recordingSessionIdRef'), false, 'Expected Android voice not to freeze a local session at recording start');
    assert.equal(chatSource.includes('client.createChatSession()'), false, 'Expected Android voice not to create sessions client-side');
    assert.includes(chatSource, 'client.sendVoiceMessage(audio.data, audio.contentType)', 'Expected Android voice flow to use the backend-current desktop voice-send route');
    assert.equal(chatSource.includes('disabled={transcribing || !activeSessionId}'), false, 'Expected Android mic not to be blocked by stale local session state');
    assert.includes(chatSource, "throw new Error(result?.error || 'voice send failed')", 'Expected unsuccessful desktop voice-send JSON to be treated as failure');
    assert.equal(chatSource.includes('NativeWhisperSttBackend'), false, 'Expected Android UI not to know about the desktop STT engine');
    assert.equal(chatSource.includes('pluginManager'), false, 'Expected Android UI not to know about desktop plugin routing');
    assert.includes(chatSource, "setInput('')", 'Expected successful Android voice send to clear the compose field');
    assert.equal(chatSource.includes('onContentSizeChange={() => listRef.current?.scrollToEnd()}'), false, 'Expected Android chat not to force-scroll on every content-size change');
    assert.equal(chatSource.includes('Desktop ${connectionState.detail}'), false, 'Expected Android chat tab not to show desktop offline status text');
    assert.equal(chatSource.includes('!connectionState.connected'), false, 'Expected Android chat tab not to reserve a main-chat offline banner');
    assert.includes(chatSource, "behavior={Platform.OS === 'ios' ? 'padding' : 'height'}", 'Expected Android keyboard to resize the chat layout instead of covering the input');
    assert.includes(appJsonSource, '"softwareKeyboardLayoutMode": "resize"', 'Expected Android manifest generation to preserve resize behavior for the soft keyboard');
    assert.includes(chatSource, 'shouldStickToBottomRef', 'Expected Android chat to track whether the user is already at the bottom');
    assert.includes(chatSource, 'STICKY_BOTTOM_THRESHOLD', 'Expected Android chat to allow a small bottom threshold for sticky scroll');
    assert.includes(chatSource, 'onScroll={handleMessagesScroll}', 'Expected Android chat to update sticky-bottom state from user scrolling');
    assert.includes(chatSource, 'onContentSizeChange={handleMessagesContentSizeChange}', 'Expected Android chat to scroll only when the user was already at the bottom');
    assert.includes(chatSource, 'keyboardShouldPersistTaps="handled"', 'Expected Android chat taps to work while keyboard is open');
    assert.includes(chatSource, 'setRecording(false);', 'Expected recording UI state to reset on failure paths');
    assert.includes(chatSource, 'setTranscribing(false);', 'Expected transcribing UI state to reset on failure paths');

    assert.includes(hookSource, 'currentSessionId', 'Expected Android session state to mirror backend currentSessionId');
    assert.includes(hookSource, 'syncActiveSession', 'Expected Android to separate backend-current sync from explicit switches');
    assert.includes(hookSource, 'client.sendMessage(text, null)', 'Expected Android text sends to use backend current session by default');
    assert.equal(hookSource.includes('await client.switchChatSession(nextId).catch'), false, 'Expected Android not to switch backend to the first listed session');
    assert.equal(hookSource.includes('const nextId = list[0].id'), false, 'Expected Android not to infer backend current session from list ordering');

    assert.includes(voiceSource, "throw new Error('Microphone permission was denied')", 'Expected Android mic permission denial to be surfaced');
    assert.includes(clientSource, "fetch(`${baseUrl(this.config)}/android/voice/send", 'Expected Android client to post voice messages to the desktop voice-send endpoint');
    assert.includes(clientSource, "if (sessionId) params.set('sessionId', sessionId)", 'Expected Android voice session id to be optional and explicit only');
    assert.includes(clientSource, "headers: { 'Content-Type': contentType, ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}) }", 'Expected voice upload to include content type and auth header');
    assert.includes(clientSource, 'body: data', 'Expected voice upload to send raw binary audio body');
  }
};
