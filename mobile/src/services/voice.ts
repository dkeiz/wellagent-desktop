import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system';

export type VoiceRecording = Audio.Recording;
export type VoicePlayback = Audio.Sound;

export async function startVoiceRecording(): Promise<Audio.Recording> {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Microphone permission was denied');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });

  try {
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    return recording;
  } catch (error) {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch (_) {}
    throw error;
  }
}

async function stopVoiceRecordingFile(recording: Audio.Recording): Promise<{ uri: string; contentType: string }> {
  try {
    await recording.stopAndUnloadAsync();
  } catch (err) {
    console.warn('Error stopping recording:', err);
  } finally {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch (err) {
      console.warn('Error resetting audio mode:', err);
    }
  }

  const uri = recording.getURI();
  if (!uri) {
    throw new Error('Recorded audio file is unavailable');
  }

  return { uri, contentType: 'audio/mp4' };
}

export async function stopVoiceRecording(recording: Audio.Recording): Promise<{ data: ArrayBuffer; contentType: string }> {
  const file = await stopVoiceRecordingFile(recording);
  const response = await fetch(file.uri);
  return {
    data: await response.arrayBuffer(),
    contentType: file.contentType,
  };
}

export async function stopVoiceRecordingBase64(recording: Audio.Recording): Promise<{ base64: string; contentType: string }> {
  const file = await stopVoiceRecordingFile(recording);
  return {
    base64: await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' }),
    contentType: file.contentType,
  };
}

export async function playVoiceUrl(url: string): Promise<Audio.Sound> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri: url },
    { shouldPlay: true }
  );
  return sound;
}

export async function stopVoicePlayback(sound: Audio.Sound | null): Promise<void> {
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch (_) {}
  try {
    await sound.unloadAsync();
  } catch (_) {}
}
