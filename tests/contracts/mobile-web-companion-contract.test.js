const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'mobile-web-companion-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const mobileRoot = path.join(rootDir, 'mobile');
    const appSource = fs.readFileSync(path.join(mobileRoot, 'App.tsx'), 'utf8');
    const configSource = fs.readFileSync(path.join(mobileRoot, 'src', 'services', 'webCompanionConfig.ts'), 'utf8');
    const webScreenSource = fs.readFileSync(path.join(mobileRoot, 'src', 'screens', 'WebCompanionScreen.tsx'), 'utf8');
    const connectSource = fs.readFileSync(path.join(mobileRoot, 'src', 'screens', 'WebCompanionConnectScreen.tsx'), 'utf8');
    const pairSource = fs.readFileSync(path.join(mobileRoot, 'src', 'screens', 'PairScreen.tsx'), 'utf8');
    const appJson = fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8');
    const packageJson = fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8');
    const voiceSource = fs.readFileSync(path.join(mobileRoot, 'src', 'services', 'voice.ts'), 'utf8');
    const docsSource = fs.readFileSync(path.join(rootDir, 'docs', 'companion', 'android-companion.md'), 'utf8');

    assert.includes(appSource, 'WebCompanionScreen', 'Expected mobile app entrypoint to default to the web companion screen');
    assert.includes(appSource, 'WebCompanionConnectScreen', 'Expected mobile app to keep native server setup before loading WebView');
    assert.includes(appSource, 'LogBox.ignoreLogs', 'Expected mobile app to suppress known non-actionable warning noise');
    assert.includes(configSource, '/companion/web', 'Expected Android app to load the browser companion route');
    assert.includes(configSource, '8791', 'Expected Android app to default HTTPS companion to the secure port');
    assert.includes(configSource, 'parseWebCompanionLaunchUrl', 'Expected Android app to accept companion deep links from mobile browsers');
    assert.includes(configSource, 'pairingCode', 'Expected Android app deep links to preserve browser pairing codes');
    assert.includes(configSource, 'isPrivateCompanionHost', 'Expected Android HTTP fallback to be app-limited to local/private hosts');
    assert.includes(configSource, 'assertCleartextCompanionHostAllowed(config)', 'Expected saved and loaded HTTP companion configs to pass the cleartext host guard');
    assert.includes(webScreenSource, 'react-native-webview', 'Expected Android app to embed the web companion through WebView');
    assert.includes(webScreenSource, 'const companionOrigin = useMemo', 'Expected WebView origin to be derived from the paired companion URL');
    assert.includes(webScreenSource, 'originWhitelist={[companionOrigin]}', 'Expected WebView navigation allowlist to be limited to the paired companion origin');
    assert.includes(webScreenSource, 'onShouldStartLoadWithRequest={(request) => isAllowedCompanionUrl(request.url)}', 'Expected top-level WebView navigation to be origin-checked');
    assert.includes(webScreenSource, 'mediaPlaybackRequiresUserAction={false}', 'Expected WebView media playback to allow companion voice UX');
    assert.includes(webScreenSource, 'mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"', 'Expected WebView capture prompts to be companion-origin scoped');
    assert.includes(webScreenSource, "mixedContentMode={config.useTls ? 'never' : 'compatibility'}", 'Expected WebView to block mixed content after TLS is enabled while tolerating HTTP bootstrap');
    assert.includes(webScreenSource, 'webviewDebuggingEnabled={false}', 'Expected mobile app to keep WebView debugging noise off during companion validation');
    assert.includes(webScreenSource, 'const nativeBridgeNonce = useMemo(() => createBridgeNonce()', 'Expected native bridge messages to use a per-WebView nonce');
    assert.includes(webScreenSource, 'injectedJavaScriptBeforeContentLoaded={injectedNativeBridgeNonce}', 'Expected WebView to inject the native bridge nonce before page JS runs');
    assert.includes(webScreenSource, 'BackHandler.addEventListener', 'Expected Android back to navigate WebView before returning to server setup');
    assert.includes(webScreenSource, 'if (!isAllowedCompanionUrl(sourceUrl)) return;', 'Expected native voice bridge messages to be origin-checked');
    assert.includes(webScreenSource, 'if (message.nonce !== nativeBridgeNonce) return;', 'Expected native voice bridge messages to echo the nonce');
    assert.includes(webScreenSource, 'onMessage={(event) => handleNativeVoiceMessage(event.nativeEvent.data, event.nativeEvent.url)}', 'Expected WebView to pass message source URL to native voice bridge handling');
    assert.includes(webScreenSource, 'stopVoiceRecordingBase64', 'Expected native recordings to be delivered back to companion web JS');
    const voiceInputSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'voice-input.js'), 'utf8');
    assert.includes(voiceInputSource, 'getNativeBridgeNonce()', 'Expected browser companion voice JS to read the native bridge nonce');
    assert.includes(voiceInputSource, 'JSON.stringify({ type, nonce })', 'Expected browser companion voice JS to echo the native bridge nonce');
    assert.includes(voiceInputSource, 'if (payload.nonce !== getNativeBridgeNonce()) return;', 'Expected browser companion voice JS to reject native events with a bad nonce');
    assert.includes(connectSource, 'Audio.requestPermissionsAsync()', 'Expected app-level microphone permission to be requested before opening WebView');
    assert.includes(connectSource, '!normalizedTls && !isPrivateCompanionHost(normalizedHost)', 'Expected manual HTTP setup to reject non-local cleartext hosts');
    assert.includes(appSource, 'Linking.getInitialURL()', 'Expected Android app to open directly from companion browser deep links');
    assert.includes(appSource, "navigate('pair', { launchConfig: config })", 'Expected runtime companion deep links to reopen pairing with parsed connection details');
    assert.includes(pairSource, 'loadWebCompanionConfig()', 'Expected native pairing screen to prefill saved companion launch config');
    assert.includes(pairSource, 'launchConfig.pairingCode', 'Expected native pairing screen to prefill deep-link pairing codes');
    assert.includes(appJson, '"scheme": "localagent-companion"', 'Expected Android app to register a browser handoff scheme');
    assert.includes(appJson, '"usesCleartextTraffic": true', 'Expected Android HTTP fallback to be available for companion setup');
    assert.includes(appJson, '"RECORD_AUDIO"', 'Expected Android manifest permissions to include microphone access');
    assert.includes(packageJson, '"react-native-webview"', 'Expected mobile package to declare the WebView dependency');
    assert.includes(packageJson, '"expo-file-system"', 'Expected native voice bridge to declare file-system support for base64 handoff');
    assert.includes(voiceSource, 'FileSystem.readAsStringAsync', 'Expected native recording bridge to read audio as base64 for WebView');
    assert.includes(docsSource, 'Microphone Reality', 'Expected Android app docs to explain secure-origin microphone limits');
    assert.includes(docsSource, 'Cleartext Threat Model', 'Expected Android app docs to explain the remaining cleartext LAN bootstrap model');
    assert.includes(docsSource, 'localhost, `.local`, private IPv4 ranges', 'Expected docs to mention the app-level cleartext host restriction');
    assert.includes(docsSource, 'Desktop APK Download Handoff', 'Expected Android app docs to cover non-disruptive browser-to-app handoff');

    const watchedFiles = [
      path.join(rootDir, 'docs', 'companion', 'android-companion.md'),
      path.join(mobileRoot, 'App.tsx'),
      path.join(mobileRoot, 'src', 'screens', 'WebCompanionConnectScreen.tsx'),
      path.join(mobileRoot, 'src', 'screens', 'WebCompanionScreen.tsx'),
      path.join(mobileRoot, 'src', 'services', 'webCompanionConfig.ts'),
      path.join(mobileRoot, 'src', 'services', 'voice.ts')
    ];

    for (const filePath of watchedFiles) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${path.relative(rootDir, filePath)} to stay under 1000 lines`);
    }
  }
};
