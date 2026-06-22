const fs = require('fs');
const path = require('path');
const assert = require('../tests/helpers/assert');
const SttService = require('../src/main/stt-service');

const ROOT = path.resolve(__dirname, '..');
const fixturePath = process.env.LOCALAGENT_STT_FIXTURE
  ? path.resolve(process.env.LOCALAGENT_STT_FIXTURE)
  : path.join(ROOT, 'tests', 'fixtures', 'audio', 'stt-speech-probe.wav');
const expected = String(process.env.LOCALAGENT_STT_EXPECT || 'speech recognition proof').trim().toLowerCase();

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  return 'application/octet-stream';
}

function createDb() {
  const settings = new Map();
  return {
    async getSetting(key) {
      return settings.get(key) || '';
    },
    async saveSetting(key, value) {
      settings.set(key, String(value ?? ''));
    }
  };
}

async function run() {
  assert.ok(fs.existsSync(fixturePath), `Missing STT fixture: ${fixturePath}`);
  const audioBase64 = fs.readFileSync(fixturePath).toString('base64');
  const service = new SttService({ db: createDb(), runtimePaths: null, pluginManager: null });
  const result = await service.transcribeAudio({
    audioBase64,
    mimeType: process.env.LOCALAGENT_STT_MIME || mimeFromPath(fixturePath),
    language: 'english',
    timeoutMs: 45000
  });

  console.log(JSON.stringify({
    success: result.success,
    backend: result.backend,
    providerId: result.providerId,
    text: result.text,
    durationMs: result.durationMs,
    segmentCount: result.segmentCount,
    error: result.error
  }, null, 2));

  assert.equal(result.success, true, 'Expected native STT fixture transcription to succeed');
  assert.equal(result.backend, 'native-stt', 'Expected built-in native STT backend');
  assert.includes(String(result.text || '').toLowerCase(), expected, 'Expected fixture transcript text');
  console.log(`[prove-native-stt-fixture] PASS fixture=${fixturePath}`);
}

run().catch((error) => {
  console.error('[prove-native-stt-fixture] FAIL:', error.message || String(error));
  process.exit(1);
});
