const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'backend-voice-generation-entrypoint-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const dispatchSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'), 'utf8');
    const webClientSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const webVoiceSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'voice.js'), 'utf8');
    const mobileClientSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'api', 'client.ts'), 'utf8');
    const ttsHttpEntrypointSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'tts-http-entrypoint.js'), 'utf8');
    const duplicatePaths = [
      path.join(rootDir, 'src', 'main', 'companion-api-server.js'),
      path.join(rootDir, 'src', 'main', 'companion-web-static.js'),
      path.join(rootDir, 'src', 'main', 'companion-web')
    ];

    assert.includes(dispatchSource, "urlPath === '/backend/voice/generate'", 'Expected exactly one public backend voice generation route');
    assert.includes(dispatchSource, 'ttsHttpEntrypoint.generateAudio({', 'Expected public voice route to call the backend voice generation entrypoint');
    assert.ok(!dispatchSource.includes("urlPath === '/companion/tts/speak'"), 'Expected deprecated companion TTS route to be removed');
    assert.ok(!dispatchSource.includes('/companion/tts/stream/'), 'Expected deprecated companion TTS stream route to be removed');
    assert.ok(!dispatchSource.includes("ipcMain") && !dispatchSource.includes(".invoke('tts:"), 'Expected backend voice generation route not to use IPC');
    assert.ok(!ttsHttpEntrypointSource.includes('createPlaybackSession'), 'Expected backend voice entrypoint not to expose stream session creation');
    assert.ok(!ttsHttpEntrypointSource.includes('openStream'), 'Expected backend voice entrypoint not to expose a stream proxy');

    assert.includes(webClientSource, "this.request('POST', '/backend/voice/generate'", 'Expected web client voice generation to use backend route');
    assert.includes(mobileClientSource, "this.post<CompanionSpeechResult>('/backend/voice/generate'", 'Expected mobile client voice generation to use backend route');
    assert.ok(!webClientSource.includes('/companion/tts/speak'), 'Expected web client not to call deprecated companion TTS route');
    assert.ok(!mobileClientSource.includes('/companion/tts/speak'), 'Expected mobile client not to call deprecated companion TTS route');
    assert.ok(!webVoiceSource.includes('playBackendStream'), 'Expected canonical web voice playback not to use a second stream request');
    for (const duplicatePath of duplicatePaths) {
      assert.equal(fs.existsSync(duplicatePath), false, `Expected stale duplicate to be removed: ${path.relative(rootDir, duplicatePath)}`);
    }
  }
};
