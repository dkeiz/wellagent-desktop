const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRendererQr(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'qr-code-renderer.js'), 'utf8');
  const sandbox = {
    console,
    TextEncoder,
    window: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'qr-code-renderer.js' });
  return sandbox.window.LocalAgentQrCodeRenderer;
}

module.exports = {
  name: 'companion-qr-renderer-parity-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const rendererQr = loadRendererQr(rootDir);
    const { renderQrPayload } = require(path.join(rootDir, 'src', 'main', 'qr-code.js'));
    const payloads = [
      'localagent-companion://companion?host=192.168.1.20&port=8791&tls=1&code=123456',
      'http://192.168.1.20:8790/companion/web?code=123456',
      'http://192.168.1.20:8790/companion/app/android/download',
      'LocalAgent unicode Привет こんにちは',
      'A'.repeat(213)
    ];

    for (const payload of payloads) {
      const main = renderQrPayload(payload);
      const renderer = rendererQr.renderQrPayload(payload);
      assert.equal(renderer.success, true, `Expected renderer QR success for ${payload.slice(0, 24)}`);
      assert.equal(renderer.version, main.version, 'Expected renderer QR version to match main implementation');
      assert.equal(renderer.size, main.size, 'Expected renderer QR size to match main implementation');
      assert.deepEqual(renderer.modules, main.modules, 'Expected renderer QR modules to match main implementation');
      assert.includes(renderer.svg, '<svg', 'Expected renderer QR to return SVG markup');
    }
  }
};
