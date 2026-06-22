const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'mobile-companion-device-identity-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const authSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'services', 'auth.ts'), 'utf8');
    const pairSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'PairScreen.tsx'), 'utf8');

    assert.includes(authSource, "const DEVICE_ID_KEY = 'companion_device_id';", 'Expected native auth storage to reserve a stable device id key');
    assert.includes(authSource, 'export async function getOrCreateDeviceId(): Promise<string>', 'Expected native auth service to expose stable device id creation');
    assert.includes(authSource, 'await saveDeviceId(creds.deviceId);', 'Expected saved credentials to refresh the stable device id cache');
    assert.includes(pairSource, 'const deviceId = await getOrCreateDeviceId();', 'Expected native pairing to reuse the stable device id');
    assert.includes(pairSource, 'const persistedDeviceId = String(r.deviceId || deviceId).trim() || deviceId;', 'Expected pairing response to preserve the canonical device id');
    assert.ok(!pairSource.includes('const deviceId = generateDeviceId();'), 'Expected native pairing to stop generating a fresh device id per pairing attempt');
  }
};
