import { CompanionClient } from '../api/client';
import { playVoiceUrl, stopVoicePlayback } from './voice';

declare const __DEV__: boolean;

const PREFIX = 'LOCALAGENT_AUDIO_PROBE';
const DEFAULT_TEXT = 'Android audio transport probe';

type ProbeParams = {
  host: string;
  port: number;
  useTls: boolean;
  pairingCode: string;
  deviceName: string;
  deviceId: string;
  text: string;
  expectedTranscript: string;
};

export type DebugAudioProbeProgress = (name: string, details?: Record<string, unknown>) => void;

function isDebugRuntime(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function marker(name: string, details: Record<string, unknown> = {}) {
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`${PREFIX} ${name}${suffix}`);
}

function emit(progress: DebugAudioProbeProgress | undefined, name: string, details: Record<string, unknown> = {}) {
  marker(name, details);
  progress?.(name, details);
}

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawKey, ...rawValue] = part.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    const value = decodeURIComponent(rawValue.join('=') || '');
    if (key) params.set(key, value);
  }
  return params;
}

function queryValue(params: Map<string, string>, key: string): string | null {
  return params.has(key) ? String(params.get(key) || '') : null;
}

export function parseDebugAudioProbeUrl(url: string | null): ProbeParams | null {
  if (!url) return null;
  try {
    const [rawRoute, rawQuery = ''] = String(url).split('?');
    const route = rawRoute.replace(/\/+$/, '');
    const isProbe = route === 'localagent-companion://debug/audio-transport'
      || route === 'localagent-companion:/debug/audio-transport'
      || route === 'localagent-companion:///debug/audio-transport';
    if (!isProbe) return null;

    const searchParams = parseQuery(rawQuery);
    const host = String(queryValue(searchParams, 'host') || '').trim();
    const useTls = parseBool(queryValue(searchParams, 'tls'));
    const port = Number(queryValue(searchParams, 'port')) || (useTls ? 8791 : 8790);
    const pairingCode = String(queryValue(searchParams, 'code') || queryValue(searchParams, 'pairingCode') || '').trim();
    if (!host || !pairingCode) return null;

    return {
      host,
      port,
      useTls,
      pairingCode,
      deviceName: String(queryValue(searchParams, 'deviceName') || 'Android Audio Probe').trim(),
      deviceId: String(queryValue(searchParams, 'deviceId') || `android-audio-probe-${Date.now()}`).trim(),
      text: String(queryValue(searchParams, 'text') || DEFAULT_TEXT).trim(),
      expectedTranscript: searchParams.has('expectTranscript')
        ? String(queryValue(searchParams, 'expectTranscript') || '').trim()
        : ''
    };
  } catch {
    return null;
  }
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function buildProbeWav(): ArrayBuffer {
  const sampleRate = 16000;
  const seconds = 1;
  const samples = sampleRate * seconds;
  const bytesPerSample = 2;
  const dataBytes = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.sin(Math.PI * i / samples);
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * envelope;
    view.setInt16(44 + i * bytesPerSample, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  return buffer;
}

async function runProbe(client: CompanionClient, params: ProbeParams, progress?: DebugAudioProbeProgress): Promise<void> {
  client.updateConfig({ host: params.host, port: params.port, useTls: params.useTls });

  const health = await client.health();
  if (!health?.ok) throw new Error('Companion health check failed');
  emit(progress, 'HEALTH_OK');

  const pair = await client.pair({
    pairingCode: params.pairingCode,
    deviceName: params.deviceName,
    deviceId: params.deviceId,
    platform: 'android',
    appVersion: 'debug-audio-probe'
  });
  if (!pair?.success || !pair.sessionToken) throw new Error(pair?.error || 'Pairing failed');
  emit(progress, 'PAIR_OK', { deviceId: params.deviceId });

  const auth = await client.authenticate({ sessionToken: pair.sessionToken, deviceId: params.deviceId });
  if (!auth?.success) throw new Error(auth?.error || 'Authentication failed');
  emit(progress, 'AUTH_OK');

  const session = await client.createChatSession();
  const sessionId = String(session?.result?.id || '').trim();
  if (!session?.success || !sessionId) throw new Error(session?.error || 'Session creation failed');
  emit(progress, 'SESSION_OK', { sessionId });

  const audio = buildProbeWav();
  let transcript = '';
  let sttError = '';
  try {
    const stt = await client.transcribeAudio(audio, 'audio/wav', { sessionId }) as any;
    if (!stt?.success) throw new Error(stt?.error || 'Transcription failed');
    transcript = String(stt.transcript || stt.text || stt.result?.text || '').trim();
    if (params.expectedTranscript && !transcript.includes(params.expectedTranscript)) {
      throw new Error(`Unexpected transcript: ${transcript}`);
    }
    emit(progress, 'STT_OK', { transcript });
  } catch (error) {
    sttError = error instanceof Error ? error.message : String(error);
    emit(progress, 'STT_FAIL', { error: sttError });
  }

  const upload = await client.uploadMedia(audio, 'audio/wav', sessionId, transcript, { sendAsMessage: false });
  if (!upload?.success) throw new Error(upload?.error || 'Voice upload failed');
  emit(progress, 'UPLOAD_OK', { fileName: upload.fileName || '' });
  if (sttError && params.expectedTranscript) throw new Error(`STT failed after upload: ${sttError}`);

  const speech = await client.speakText(params.text);
  if (!speech?.success || (!speech.audioBase64 && !speech.audioPath && !speech.audioUrl)) {
    throw new Error(speech?.error || 'Speech generation failed');
  }
  emit(progress, 'TTS_OK', { mimeType: speech.mimeType || 'audio/wav' });

  const voiceUrl = speech.audioBase64
    ? `data:${speech.mimeType || 'audio/wav'};base64,${speech.audioBase64}`
    : client.resolveUrl(speech.audioPath || speech.audioUrl || '');
  let sound = null;
  try {
    sound = await playVoiceUrl(voiceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Playback failed: ${message}`);
  }
  emit(progress, 'PLAYBACK_OK');
  setTimeout(() => {
    stopVoicePlayback(sound).catch(() => {});
  }, 300);
}

export function isDebugAudioProbeUrl(url: string | null): boolean {
  return parseDebugAudioProbeUrl(url) !== null;
}

export function markDebugAudioProbeAppReady() {
  if (isDebugRuntime()) marker('APP_READY');
}

export async function runDebugAudioProbeUrl(url: string | null, client: CompanionClient, progress?: DebugAudioProbeProgress): Promise<boolean> {
  const params = parseDebugAudioProbeUrl(url);
  if (!params) return false;
  if (!isDebugRuntime()) {
    emit(progress, 'DISABLED_RELEASE');
    return true;
  }

  emit(progress, 'START', { host: params.host, port: params.port, tls: params.useTls });
  try {
    await runProbe(client, params, progress);
    emit(progress, 'DONE_OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const upper = message.toUpperCase();
    if (upper.includes('PAIR')) emit(progress, 'PAIR_FAIL', { error: message });
    else if (upper.includes('TRANSCRIPT')) emit(progress, 'STT_FAIL', { error: message });
    else if (upper.includes('UPLOAD')) emit(progress, 'UPLOAD_FAIL', { error: message });
    else if (upper.includes('SPEECH')) emit(progress, 'TTS_FAIL', { error: message });
    else if (upper.includes('PLAY')) emit(progress, 'PLAYBACK_FAIL', { error: message });
    else emit(progress, 'TRANSPORT_FAIL', { error: message });
  }
  return true;
}

export async function handleDebugAudioProbeUrl(url: string | null, client: CompanionClient): Promise<boolean> {
  return runDebugAudioProbeUrl(url, client);
}
