/**
 * Auth Service — Biometric authentication + secure token storage (Expo)
 * Uses expo-secure-store (encrypted storage) and expo-local-authentication (biometrics).
 */

import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

const CREDS_KEY = 'companion_credentials';
const DEVICE_ID_KEY = 'companion_device_id';

export interface ServerConfig {
  host: string;
  port: number;
  useTls: boolean;
}

export interface StoredCredentials {
  sessionToken: string;
  deviceId: string;
  serverConfig: ServerConfig;
}

// ── Biometric Check ──

export async function checkBiometricAvailability(): Promise<{
  available: boolean;
  biometryType: string | null;
}> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  let biometryType: string | null = null;
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) biometryType = 'Fingerprint';
  else if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) biometryType = 'Face';
  else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) biometryType = 'Iris';

  return { available: hasHardware && isEnrolled, biometryType };
}

export async function promptBiometric(reason: string = 'Unlock LocalAgent'): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
  });
  return result.success;
}

// ── Secure Storage ──

async function saveDeviceId(deviceId: string): Promise<void> {
  const normalized = String(deviceId || '').trim();
  if (!normalized) return;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, normalized, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(creds), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await saveDeviceId(creds.deviceId);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(CREDS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDS_KEY);
}

export async function hasStoredCredentials(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(CREDS_KEY);
  return raw !== null;
}

// ── Device ID ──

export function generateDeviceId(): string {
  const platform = Platform.OS;
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return `${platform}-${random}-${timestamp}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const creds = await loadCredentials();
  const credentialDeviceId = String(creds?.deviceId || '').trim();
  if (credentialDeviceId) {
    await saveDeviceId(credentialDeviceId);
    return credentialDeviceId;
  }

  const storedDeviceId = String(await SecureStore.getItemAsync(DEVICE_ID_KEY) || '').trim();
  if (storedDeviceId) return storedDeviceId;

  const nextDeviceId = generateDeviceId();
  await saveDeviceId(nextDeviceId);
  return nextDeviceId;
}
