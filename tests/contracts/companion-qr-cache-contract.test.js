const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'companion-qr-cache-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const appSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'app.js'), 'utf8');

    assert.includes(appSource, 'this._companionQrCache = new Map()', 'Expected companion QR cache to be initialized per App instance');
    assert.includes(appSource, 'async renderCompanionQrPayload(value)', 'Expected QR rendering to be centralized for caching and fallback');
    assert.includes(appSource, 'this._companionQrCache.has(payload)', 'Expected repeated payloads to use cached QR results');
    assert.includes(appSource, 'window.LocalAgentQrCodeRenderer.renderQrPayload(payload)', 'Expected renderer-local QR generation to remain the fast path');
    assert.includes(appSource, 'Renderer QR failed, falling back to main process', 'Expected renderer QR failures to fall back instead of breaking the modal');
    assert.includes(appSource, 'window.electronAPI.companion.renderQr(payload)', 'Expected main-process QR fallback to remain available');
    assert.includes(appSource, 'this._companionQrCache.size > 16', 'Expected QR cache to stay bounded');
    assert.includes(appSource, 'const result = await this.renderCompanionQrPayload(value)', 'Expected QR modal to reuse cached renderer');
  }
};
