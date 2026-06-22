const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'companion-qr-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const html = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'app.js'), 'utf8');
    const connectScreen = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'WebCompanionConnectScreen.tsx'), 'utf8');
    const configService = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'services', 'webCompanionConfig.ts'), 'utf8');

    assert.includes(html, 'id="companion-show-app-qr-btn"', 'Expected desktop companion settings to expose an app QR action');
    assert.includes(html, 'id="companion-show-web-qr-btn"', 'Expected desktop companion settings to expose a web QR action');
    assert.includes(html, 'id="companion-qr-modal"', 'Expected desktop companion settings to render a QR modal');
    assert.includes(appJs, 'window.electronAPI.companion.renderQr', 'Expected renderer to request QR rendering from the main process');
    assert.includes(connectScreen, 'CameraView', 'Expected Android companion connect screen to use the camera for QR scanning');
    assert.includes(connectScreen, 'Scan QR Code', 'Expected Android companion connect screen to expose a QR scan action');
    assert.includes(configService, "parsed.pathname !== '/companion/bootstrap' && parsed.pathname !== '/companion/web'", 'Expected companion launch parser to accept browser bootstrap and web URLs');
  }
};
