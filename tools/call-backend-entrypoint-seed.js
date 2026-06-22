'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TEXT = 'Electron application backend entrypoint audio generation.';

function outputPath() {
  return path.resolve(process.env.VOICE_AUDIO_OUTPUT || path.join(process.cwd(), 'tests', '.tmp', 'app-backend-entrypoint.wav'));
}

module.exports = async ({ container }) => {
  const entrypoint = container?.optional?.('ttsHttpEntrypoint');
  if (!entrypoint?.generateAudio) {
    throw new Error('ttsHttpEntrypoint.generateAudio is unavailable');
  }

  const result = await entrypoint.generateAudio({
    text: process.env.VOICE_TEXT || DEFAULT_TEXT,
    includeBase64: true,
    prepareText: false
  });
  if (!result?.success || !result.audioBase64) {
    throw new Error(result?.error || 'Backend entrypoint did not return audioBase64');
  }

  const target = outputPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(result.audioBase64, 'base64'));
  console.log(`[Seed] Backend entrypoint audio saved: ${target}`);
  console.log(JSON.stringify({
    success: true,
    backend: result.backend || '',
    pluginId: result.pluginId || '',
    provider: result.provider || '',
    voice: result.voice || '',
    durationMs: result.durationMs || 0,
    mimeType: result.mimeType || 'audio/wav',
    outputPath: target,
    bytes: fs.statSync(target).size
  }));

  setTimeout(() => process.exit(0), 100);
};
