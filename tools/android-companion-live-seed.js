const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = process.env.LOCALAGENT_ANDROID_SEED_OUT || 'C:/tmp/localagent-android-seed.json';

module.exports = async ({ container }) => {
  const setup = container?.optional?.('setupSuperagentService');
  const auth = container?.optional?.('companionAuth') || setup?.getCompanionAuth?.();
  if (!setup?.enableCompanion || !setup?.getCompanionStatus || !auth?.generatePairing) {
    throw new Error('Companion seed dependencies are unavailable');
  }

  await setup.enableCompanion({ host: '127.0.0.1', port: 8790 });
  const status = await setup.getCompanionStatus();
  const pairing = auth.generatePairing(status.preferredHost || status.host || '127.0.0.1', status.port || 8790);
  const payload = {
    generatedAt: new Date().toISOString(),
    status,
    pairing
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[Seed] Android companion live seed wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify(payload));
};