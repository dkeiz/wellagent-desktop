const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'companion-web-shell-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const serverSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'), 'utf8');
    const helperSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web-static.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'index.html'), 'utf8');
    const cssSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'styles.css'), 'utf8');
    const clientSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app.js'), 'utf8');
    const uiStateSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'ui-state.js'), 'utf8');
    const skinBridgeSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'skin-bridge.css'), 'utf8');
    const messageRendererSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'message-renderer.js'), 'utf8');
    const parityCssSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'companion-parity.css'), 'utf8');
    const voiceInputSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'voice-input.js'), 'utf8');
    const appInstallSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app-install.js'), 'utf8');
    const appInstallCssSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app-install.css'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-bootstrap', 'index.html'), 'utf8');

    assert.includes(serverSource, "urlPath.startsWith('/companion/web/')", 'Expected the companion server to serve web assets from the companion web directory');
    assert.includes(serverSource, 'resolveCompanionWebFile', 'Expected the companion server to resolve served files through the companion web helper');
    assert.includes(serverSource, "/\\.(?:html|js|css)$/i", 'Expected companion JS/CSS assets not to be served from stale browser cache');
    assert.includes(helperSource, 'COMPANION_WEB_ROOT', 'Expected a dedicated companion web root helper');

    assert.includes(htmlSource, 'id="left-sidebar"', 'Expected the browser companion to include a workspace sidebar');
    assert.includes(htmlSource, 'id="right-sidebar"', 'Expected the browser companion to include a controls sidebar');
    assert.includes(htmlSource, 'id="voice-btn"', 'Expected the browser companion to expose microphone controls');
    assert.includes(htmlSource, 'id="file-input"', 'Expected the browser companion to expose file upload input');
    assert.includes(htmlSource, 'id="capability-group-list"', 'Expected the browser companion to render capability groups');
    assert.includes(htmlSource, '/companion/web/assets/ui-state.js', 'Expected the browser companion to load desktop UI-state support');
    assert.includes(htmlSource, '/companion/web/assets/skin-bridge.css', 'Expected the browser companion to load skin variable bridge CSS');
    assert.includes(htmlSource, '/companion/web/assets/message-renderer.js', 'Expected the browser companion to load desktop-compatible message rendering');
    assert.includes(htmlSource, '/companion/web/assets/companion-parity.css', 'Expected the browser companion to load desktop parity overrides');
    assert.includes(htmlSource, '/companion/web/assets/app-install.css', 'Expected Android app prompt CSS to load separately from the crowded shell stylesheet');
    assert.includes(htmlSource, '/companion/web/assets/app-install.js', 'Expected Android browsers to get the non-disruptive app handoff prompt');
    assert.includes(htmlSource, 'id="companion-parity-link"', 'Expected companion parity CSS to keep a stable insertion point after runtime skin CSS');
    assert.includes(htmlSource, 'Companion page failed to start', 'Expected mobile browser boot failures to be visible on the auth screen');

    assert.includes(appSource, "this.layout === 'desktop' ? 'Desktop Web' : 'Mobile Web'", 'Expected the companion app to distinguish desktop and mobile browser layouts');
    assert.includes(appSource, 'loadUiState()', 'Expected the companion app to load desktop UI state before pairing');
    assert.includes(appSource, 'this.client.listChatSessions(20)', 'Expected the companion app to load sessions through the backend HTTP facade');
    assert.includes(appSource, 'toggleCapabilityGroup(groupId)', 'Expected the companion app to support capability-group controls');
    assert.includes(appSource, 'uploadFiles(files)', 'Expected the companion app to support artifact uploads');
    assert.includes(appSource, 'toggleVoiceInput()', 'Expected the companion app to support browser microphone capture');
    assert.includes(appSource, 'getArtifactUrl(this.activeSessionId, fileName)', 'Expected the companion app to expose artifact viewing');
    assert.includes(appSource, 'LocalAgentCompanionMessageRenderer.renderMessage', 'Expected the companion app to render messages through the desktop-compatible renderer');
    assert.includes(appSource, 'artifactUrlFor', 'Expected companion message rendering to resolve uploaded media artifacts inline');

    assert.includes(clientSource, '/companion/chat/send', 'Expected the browser client adapter to target backend chat facades');
    assert.includes(clientSource, '/companion/stt/transcribe', 'Expected the browser client adapter to target companion STT');
    assert.includes(clientSource, '/companion/media/upload', 'Expected the browser client adapter to target companion file uploads');
    assert.includes(clientSource, '/companion/ws', 'Expected the browser client adapter to use companion WebSocket transport');
    assert.includes(clientSource, '/companion/ui-state', 'Expected the browser client adapter to target companion UI state');
    assert.includes(uiStateSource, 'data-active-skin', 'Expected UI state to apply active skin attributes');
    assert.includes(uiStateSource, 'companion-active-skin-link', 'Expected UI state to load active skin stylesheets');
    assert.includes(uiStateSource, "document.getElementById('companion-parity-link')", 'Expected active skin CSS to load before companion parity overrides');
    assert.includes(uiStateSource, 'document.head.insertBefore(link, parityLink)', 'Expected runtime skin links not to override companion web parity by load order');
    assert.includes(skinBridgeSource, '--primary-color: var(--accent)', 'Expected skin bridge to map desktop skin tokens onto companion variables');
    assert.includes(messageRendererSource, 'thinking-block', 'Expected companion message renderer to preserve desktop thinking blocks');
    assert.includes(messageRendererSource, 'Image attached', 'Expected companion message renderer to detect uploaded image messages');
    assert.includes(messageRendererSource, 'chat-image', 'Expected companion message renderer to render inline image content');
    assert.includes(parityCssSource, '--companion-type-base: var(--type-base, 13px)', 'Expected companion parity CSS to follow desktop type sizing');
    assert.includes(parityCssSource, '.thinking-block', 'Expected companion parity CSS to style thinking blocks like desktop chat');
    assert.includes(voiceInputSource, 'ReactNativeWebView.postMessage', 'Expected Android app WebView mic to use the native recording bridge');
    assert.includes(voiceInputSource, 'base64ToBlob', 'Expected native app recordings to return to browser upload flow as blobs');
    assert.includes(voiceInputSource, "this.ui.composerInput.value = ''", 'Expected successful companion web STT send to clear the composer');
    assert.equal(voiceInputSource.includes('transcript ? { sendAsMessage: false } : undefined'), false, 'Expected successful companion web STT to send the voice upload instead of hiding it');
    assert.includes(appInstallSource, '/companion/app/android/status', 'Expected browser prompt to check APK availability without blocking the app');
    assert.includes(appInstallSource, 'localagent.androidAppPrompt.dismissedAt', 'Expected Android app prompt to be dismissible');
    assert.includes(appInstallCssSource, '.app-install-prompt', 'Expected Android app prompt to have isolated CSS');
    assert.includes(bootstrapSource, 'android-app-link', 'Expected bootstrap page to offer opening the Android app instead of certificate-only setup');
    assert.includes(bootstrapSource, 'android-apk-link', 'Expected bootstrap page to offer APK download only when available');
    assert.includes(serverSource, '/companion/app/android/status', 'Expected companion server to expose Android app handoff status');
    assert.includes(serverSource, '/companion/app/android/download', 'Expected companion server to serve a local APK when present');
    assert.includes(serverSource, 'localagent-companion://companion', 'Expected companion server to build Android app deep links');

    assert.includes(cssSource, '[data-companion-layout="desktop"] .app-shell', 'Expected the stylesheet to define the desktop companion layout');
    assert.includes(cssSource, '[data-companion-layout="mobile"] .sidebar', 'Expected the stylesheet to define the mobile companion layout');
    assert.includes(cssSource, 'min-height: 100dvh', 'Expected the mobile companion shell to use dynamic viewport height constraints');
    assert.includes(cssSource, 'grid-template-rows: auto auto auto minmax(0, 1fr) auto', 'Expected the companion shell to bound the message pane between header and composer');
    assert.includes(cssSource, 'padding-bottom: max(16px, env(safe-area-inset-bottom))', 'Expected mobile composer spacing to respect device safe areas');
    assert.includes(cssSource, ':root[data-theme="dark"]', 'Expected the browser companion to support desktop dark theme');
    assert.includes(cssSource, ':root[data-theme="solar"]', 'Expected the browser companion to support desktop solar theme');
    assert.includes(cssSource, '.message-list', 'Expected the stylesheet to define the chat surface');
    assert.includes(cssSource, '[hidden]', 'Expected the stylesheet to preserve HTML hidden-state semantics for auth/app shell swapping');

    const watchedFiles = [
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'index.html'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app.js'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'styles.css'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'message-renderer.js'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'companion-parity.css'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'voice-input.js'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app-install.js'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'app-install.css'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-bootstrap', 'index.html'),
      path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js')
    ];

    for (const filePath of watchedFiles) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${path.relative(rootDir, filePath)} to stay under 1000 lines`);
    }
  }
};
