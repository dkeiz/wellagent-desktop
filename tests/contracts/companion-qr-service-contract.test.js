const path = require('path');

module.exports = {
  name: 'companion-qr-service-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const { renderQrPayload } = require(path.join(rootDir, 'src', 'main', 'qr-code.js'));
    const sample = 'localagent-companion://companion?host=192.168.1.20&port=8791&tls=1&code=123456';
    const result = renderQrPayload(sample);

    assert.ok(result.version >= 1, 'Expected QR generator to resolve a version');
    assert.ok(result.size >= 21, 'Expected QR generator to produce a QR matrix');
    assert.includes(result.svg, '<svg', 'Expected QR generator to return SVG markup');
    assert.ok(String(result.terminal || '').trim().length > 0, 'Expected QR generator to return terminal-friendly QR text');
  }
};
