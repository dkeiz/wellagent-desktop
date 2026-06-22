const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'android-audio-transport-probe-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const appSource = fs.readFileSync(path.join(rootDir, 'mobile', 'App.tsx'), 'utf8');
    const screenSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'AudioTransportDebugScreen.tsx'), 'utf8');
    const probePath = path.join(rootDir, 'mobile', 'src', 'services', 'debugAudioProbe.ts');
    const probeSource = fs.readFileSync(probePath, 'utf8');
    const mockSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-audio-mock.js'), 'utf8');
    const dispatchSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-backend-dispatch.js'), 'utf8');
    const externalSource = fs.readFileSync(path.join(rootDir, 'tests', 'external', 'android-audio-transport.external-test.js'), 'utf8');
    const docsSource = fs.readFileSync(path.join(rootDir, 'docs', 'android-emulator-testing.md'), 'utf8');
    const packageJson = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    const companionDocs = fs.readFileSync(path.join(rootDir, 'COMPANION.md'), 'utf8');

    assert.includes(appSource, "import { isDebugAudioProbeUrl, markDebugAudioProbeAppReady }", 'Expected app entrypoint to import the debug audio probe guard');
    assert.includes(appSource, "setInitialRoute('debugAudioTransport')", 'Expected initial deep link to open the audio transport screen');
    assert.includes(appSource, "navigate('debugAudioTransport'", 'Expected runtime deep links to open the audio transport screen');
    assert.includes(appSource, 'AudioTransportDebugScreen', 'Expected app stack to include the audio transport debug screen');

    assert.includes(probeSource, "localagent-companion://debug/audio-transport", 'Expected probe URL host/path form to be debug audio transport');
    assert.includes(probeSource, "localagent-companion:/debug/audio-transport", 'Expected probe to accept Android-normalized single-slash deep links');
    assert.includes(probeSource, 'typeof __DEV__', 'Expected probe to be gated to debug builds');
    assert.includes(probeSource, "'DISABLED_RELEASE'", 'Expected release builds to log an inert marker');
    for (const marker of ['PAIR_OK', 'STT_OK', 'UPLOAD_OK', 'TTS_OK', 'PLAYBACK_OK', 'DONE_OK']) {
      assert.includes(probeSource, `'${marker}'`, `Expected probe marker ${marker}`);
    }
    assert.includes(probeSource, "marker('APP_READY')", 'Expected app readiness marker for live Android probe launch');
    assert.includes(probeSource, 'runDebugAudioProbeUrl', 'Expected reusable probe runner for the screen and automation');
    assert.includes(probeSource, "client.transcribeAudio(audio, 'audio/wav'", 'Expected probe to send generated WAV to STT through the mobile client');
    assert.includes(probeSource, "client.uploadMedia(audio, 'audio/wav'", 'Expected probe to upload the same generated audio');
    assert.ok(
      probeSource.indexOf("marker('STT_FAIL'") < probeSource.indexOf("client.uploadMedia(audio, 'audio/wav'"),
      'Expected probe to preserve media upload after an STT failure'
    );
    assert.includes(probeSource, 'client.speakText(params.text)', 'Expected probe to use the real mobile TTS transport method');
    assert.includes(probeSource, 'playVoiceUrl(voiceUrl)', 'Expected probe to play returned TTS audio through app playback');

    assert.includes(screenSource, 'Audio Transport Test', 'Expected a visible debug audio transport test page');
    assert.includes(screenSource, 'runDebugAudioProbeUrl', 'Expected the screen to execute the real probe runner');
    assert.includes(screenSource, 'Send WAV To STT', 'Expected the screen to show STT stage status');
    assert.includes(screenSource, 'Play Returned Audio', 'Expected the screen to show playback stage status');

    assert.includes(mockSource, 'createCompanionAudioMock', 'Expected desktop mock audio module');
    assert.includes(mockSource, "mimeType: 'audio/wav'", 'Expected mock TTS to return WAV audio');
    assert.includes(mockSource, 'LOCALAGENT_COMPANION_AUDIO_MOCK_TTS_FAIL', 'Expected mock TTS failure toggle');
    assert.includes(dispatchSource, "process.env.LOCALAGENT_COMPANION_AUDIO_MOCK === '1'", 'Expected mock audio mode to be env-gated');
    assert.ok(!dispatchSource.includes("container?.replace?.('sttService'"), 'Expected companion audio mock not to replace real STT');
    assert.includes(dispatchSource, "container?.replace?.('ttsHttpEntrypoint'", 'Expected mock TTS entrypoint to replace normal TTS only in mock mode');

    assert.includes(externalSource, 'LOCALAGENT_COMPANION_AUDIO_MOCK', 'Expected live Android test to enable desktop mock audio');
    assert.ok(!externalSource.includes('LOCALAGENT_COMPANION_AUDIO_MOCK_TRANSCRIPT'), 'Expected live Android transport test not to fake STT transcripts');
    assert.includes(externalSource, 'localagent-companion://debug/audio-transport', 'Expected live Android test to launch the debug probe deep link');
    assert.includes(externalSource, '10.0.2.2', 'Expected emulator host mapping to be the default');
    assert.includes(externalSource, 'LOCALAGENT_AUDIO_PROBE DONE_OK', 'Expected live Android test to wait for the success marker');
    assert.includes(externalSource, 'LOCALAGENT_AUDIO_PROBE APP_READY', 'Expected live Android test to wait for JS readiness before launching probe');
    assert.includes(packageJson, '"test:android-audio-transport"', 'Expected package script for the explicit live Android test');

    assert.includes(docsSource, 'Audio Transport Regression', 'Expected emulator docs to include the audio transport regression flow');
    assert.includes(docsSource, 'LOCALAGENT_AUDIO_PROBE DONE_OK', 'Expected emulator docs to list expected probe marker');
    assert.includes(companionDocs, '`POST /backend/voice/generate`', 'Expected companion docs to use the current TTS endpoint');
    assert.ok(!companionDocs.includes('/companion/tts/speak'), 'Expected deprecated companion TTS endpoint to be removed from docs');

    for (const filePath of [probePath, path.join(rootDir, 'mobile', 'src', 'screens', 'AudioTransportDebugScreen.tsx'), path.join(rootDir, 'src', 'main', 'companion', 'companion-audio-mock.js'), path.join(rootDir, 'tests', 'external', 'android-audio-transport.external-test.js')]) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${path.relative(rootDir, filePath)} to stay under 1000 lines`);
    }
  }
};
