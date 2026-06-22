const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = {
  name: 'companion-android-https-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const serverSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-api-server.js'), 'utf8');
    const handlersSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-agent-system-handlers.js'), 'utf8');
    const tlsManagerSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion-tls-manager.js'), 'utf8');
    const tlsScriptSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'scripts', 'generate-companion-tls.ps1'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion-bootstrap', 'index.html'), 'utf8');
    const clientSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const rendererHtml = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const rendererApp = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'app.js'), 'utf8');

    assert.includes(serverSource, "https.createServer", 'Expected companion server to start a dedicated HTTPS listener when TLS is ready');
    assert.includes(serverSource, "/companion/bootstrap/status", 'Expected companion server to expose an HTTP bootstrap status endpoint');
    assert.includes(serverSource, "/companion/bootstrap/ca.cer", 'Expected companion server to expose a legacy CA download route');
    assert.includes(serverSource, "/companion/bootstrap/ca.crt", 'Expected companion server to expose an Android-friendly CRT download route');
    assert.includes(serverSource, 'resolveCompanionBootstrapFile', 'Expected companion server to serve a dedicated bootstrap page');

    assert.includes(handlersSource, "companion:set-android-browser-https", 'Expected desktop IPC to expose an Android browser HTTPS toggle');
    assert.includes(handlersSource, "companion:setup-android-browser-https", 'Expected desktop IPC to expose Android browser HTTPS setup');
    assert.includes(handlersSource, "pathname: '/companion/bootstrap'", 'Expected TLS pairing links to hand phones through the bootstrap page first');
    assert.includes(handlersSource, "scheme: 'https'", 'Expected TLS pairing links to build a secure companion URL for the second step');
    assert.includes(handlersSource, 'preferredBrowserUrl: network.preferredBrowserUrl', 'Expected copied pairing links to prefer HTTP bootstrap, not direct HTTPS');
    assert.includes(handlersSource, 'secureUrl: secureNetwork?.preferredBrowserUrl', 'Expected secure companion URL to remain a second-step handoff');
    assert.ok(!handlersSource.includes('preferredBrowserUrl: secureNetwork?.preferredBrowserUrl || network.preferredBrowserUrl'), 'Expected pairing link not to bypass certificate bootstrap');

    assert.includes(tlsManagerSource, 'powershell.exe', 'Expected local CA generation to be owned by the backend through Windows tooling');
    assert.includes(tlsManagerSource, 'buildDefaultSecurePort', 'Expected Android browser HTTPS to derive a separate secure port without bloating settings');
    assert.includes(tlsManagerSource, "'-HostNamesJson',\n          JSON.stringify(hosts)", 'Expected TLS setup to pass hosts through one JSON argument');
    assert.ok(!tlsManagerSource.includes("hosts.flatMap(host => ['-HostName', host])"), 'Expected TLS setup not to repeat the HostName parameter');
    assert.includes(tlsScriptSource, 'HostNamesJson', 'Expected TLS script to support JSON host input');
    assert.includes(tlsScriptSource, 'ConvertFrom-Json', 'Expected TLS script to parse JSON host input');
    assert.includes(tlsScriptSource, 'IPAddress=', 'Expected generated certificates to carry LAN IPs as IP SAN entries');
    assert.includes(tlsScriptSource, '-ChainOption BuildChain', 'Expected the server PFX export to include the certificate chain');
    assert.includes(handlersSource, 'serverFingerprint', 'Expected desktop status to pass generated server certificate metadata');
    assert.includes(handlersSource, 'certificateHosts', 'Expected desktop status to pass certificate host coverage');
    assert.includes(bootstrapSource, 'Open Secure Companion', 'Expected the bootstrap page to hand off users into the secure companion page');
    assert.includes(bootstrapSource, 'Download CA', 'Expected the bootstrap page to offer the CA download directly');
    assert.includes(bootstrapSource, 'LocalAgent-Companion-CA.crt', 'Expected bootstrap to download Android-friendly CRT certificate filename');
    assert.includes(bootstrapSource, 'Open Android Security Settings', 'Expected Android bootstrap to offer a settings shortcut');
    assert.includes(bootstrapSource, 'android.settings.SECURITY_SETTINGS', 'Expected Android settings shortcut to use the Security settings intent');
    assert.includes(bootstrapSource, 'Install a certificate', 'Expected Android bootstrap to give certificate install navigation');
    assert.includes(clientSource, 'buildPlatformToken()', 'Expected browser pairing to preserve a richer surface identity than plain web');
    assert.includes(clientSource, "global.location.protocol === 'https:' ? 'wss:' : 'ws:'", 'Expected browser WebSocket routing to follow the page security context');
    assert.includes(rendererHtml, 'companion-android-https-enabled', 'Expected desktop settings to expose a compact Android browser HTTPS toggle');
    assert.includes(rendererHtml, 'companion-android-https-setup-btn', 'Expected desktop settings to expose a compact HTTPS setup action');
    assert.ok(!rendererHtml.includes('companion-mobile-mic-panel'), 'Expected desktop settings to omit the old mobile microphone setup panel');
    assert.includes(rendererApp, 'setupAndroidBrowserHttps()', 'Expected desktop settings UI to call the HTTPS setup IPC');
    assert.includes(rendererApp, 'withTimeout(', 'Expected desktop settings UI not to leave HTTPS setup spinning forever');
    assert.includes(rendererApp, 'setAndroidBrowserHttps(', 'Expected desktop settings UI to call the HTTPS toggle IPC');
    assert.includes(handlersSource, 'ensureSetup(host, port, { force: false })', 'Expected normal mobile mic setup to reuse existing certificates');
    assert.includes(handlersSource, 'const restart = await startCompanionServer({ host, port })', 'Expected setup to start the companion server after certificate setup');
    assert.includes(handlersSource, 'restart?.androidBrowserHttps?.running !== true', 'Expected setup to verify the HTTPS listener is running');
    assert.includes(handlersSource, 'Companion HTTPS listener failed to start', 'Expected setup to fail visibly when secure listener restart fails');
    assert.ok(!handlersSource.includes('ensureSetup(host, port, { force: true })'), 'Expected normal setup not to regenerate certificates on every click');

    const {
      buildCompanionUrl,
      describeCompanionReachability
    } = require(path.join(rootDir, 'src', 'main', 'companion-network-utils.js'));
    const { resolveCompanionBootstrapFile } = require(path.join(rootDir, 'src', 'main', 'companion', 'companion-web-static.js'));
    const { CompanionTlsManager } = require(path.join(rootDir, 'src', 'main', 'companion-tls-manager.js'));

    assert.equal(
      buildCompanionUrl('192.168.1.10', 8791, {
        scheme: 'https',
        pathname: '/companion/web',
        pairingCode: '123456'
      }),
      'https://192.168.1.10:8791/companion/web?code=123456',
      'Expected companion URL builder to support secure pairing handoff URLs'
    );

    const bootstrapReachability = describeCompanionReachability('0.0.0.0', 8790, {
      pathname: '/companion/bootstrap',
      pairingCode: '123456'
    });
    assert.ok(
      bootstrapReachability.browserUrls.every(url => url.includes('/companion/bootstrap')),
      'Expected bootstrap reachability URLs to point at the onboarding page'
    );

    const bootstrapFile = resolveCompanionBootstrapFile('/companion/bootstrap');
    assert.equal(Boolean(bootstrapFile?.absolutePath), true, 'Expected bootstrap static helper to resolve the onboarding page');

    const tempBase = path.join(rootDir, 'tests', '.tmp');
    fs.mkdirSync(tempBase, { recursive: true });
    const tempRoot = fs.mkdtempSync(path.join(tempBase, 'companion-tls-contract-'));
    const settings = new Map();
    const db = {
      async getSetting(key) {
        return settings.has(key) ? settings.get(key) : null;
      },
      async saveSetting(key, value) {
        settings.set(key, value);
      }
    };
    const tlsManager = new CompanionTlsManager(db, { userDataPath: tempRoot, agentinRoot: tempRoot }, {
      scriptPath: path.join(tempRoot, 'missing-generate-companion-tls.ps1')
    });

    const initialStatus = await tlsManager.getStatus({ bindHost: '0.0.0.0', httpPort: 8790 });
    assert.equal(initialStatus.supported, false, 'Expected TLS manager status to report unsupported when the Windows setup script is unavailable');
    assert.equal(initialStatus.securePort, 8791, 'Expected TLS manager to derive the secure port from the HTTP companion port');

    await tlsManager.setEnabled(true);
    const enabledStatus = await tlsManager.getStatus({ bindHost: '0.0.0.0', httpPort: 8790 });
    assert.equal(enabledStatus.enabled, true, 'Expected TLS manager to persist the Android browser HTTPS enabled state');
    assert.equal(enabledStatus.ready, false, 'Expected TLS manager to report not-ready before certificate generation runs');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
