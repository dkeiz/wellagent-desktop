import * as SecureStore from 'expo-secure-store';
import { loadCredentials } from './auth';

const CONFIG_KEY = 'web_companion_config';

export interface WebCompanionConfig {
  host: string;
  port: number;
  useTls: boolean;
  pairingCode?: string;
}

export function defaultPort(useTls: boolean): number {
  return useTls ? 8791 : 8790;
}

export function isPrivateCompanionHost(host: string): boolean {
  const normalized = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (normalized.endsWith('.local')) return true;
  if (normalized.startsWith('fe80:')) return true;

  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

export function assertCleartextCompanionHostAllowed(config: WebCompanionConfig): void {
  if (config.useTls || isPrivateCompanionHost(config.host)) return;
  throw new Error('HTTP companion setup is limited to localhost, .local, or private LAN addresses.');
}

export function buildCompanionWebUrl(config: WebCompanionConfig): string {
  assertCleartextCompanionHostAllowed(config);
  const scheme = config.useTls ? 'https' : 'http';
  const code = String(config.pairingCode || '').trim();
  return `${scheme}://${config.host}:${config.port}/companion/web${code ? `?code=${encodeURIComponent(code)}` : ''}`;
}

export function parseWebCompanionLaunchUrl(url: string | null): WebCompanionConfig | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'localagent-companion:') {
      const host = String(parsed.searchParams.get('host') || '').trim();
      const useTls = parsed.searchParams.get('tls') === '1' || parsed.searchParams.get('tls') === 'true';
      const port = Number(parsed.searchParams.get('port')) || defaultPort(useTls);
      if (!host) return null;
      const pairingCode = String(parsed.searchParams.get('code') || parsed.searchParams.get('pairingCode') || '').trim();
      if (!useTls && !isPrivateCompanionHost(host)) return null;
      return { host, port, useTls, pairingCode };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.pathname !== '/companion/bootstrap' && parsed.pathname !== '/companion/web') return null;

    const useTls = parsed.protocol === 'https:';
    const host = String(parsed.hostname || '').trim();
    const port = Number(parsed.port) || defaultPort(useTls);
    const pairingCode = String(parsed.searchParams.get('code') || parsed.searchParams.get('pairingCode') || '').trim();
    if (!host) return null;
    if (!useTls && !isPrivateCompanionHost(host)) return null;
    return { host, port, useTls, pairingCode };
  } catch {
    return null;
  }
}

export async function loadWebCompanionConfig(): Promise<WebCompanionConfig | null> {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<WebCompanionConfig>;
      if (parsed.host && parsed.port) {
        const config = {
          host: String(parsed.host),
          port: Number(parsed.port) || defaultPort(Boolean(parsed.useTls)),
          useTls: Boolean(parsed.useTls),
          pairingCode: String(parsed.pairingCode || '').trim()
        };
        assertCleartextCompanionHostAllowed(config);
        return config;
      }
    } catch {}
  }

  const legacy = await loadCredentials();
  if (!legacy?.serverConfig?.host) return null;
  const useTls = Boolean(legacy.serverConfig.useTls);
  const config = {
    host: legacy.serverConfig.host,
    port: Number(legacy.serverConfig.port) || defaultPort(useTls),
    useTls,
    pairingCode: ''
  };
  try {
    assertCleartextCompanionHostAllowed(config);
    return config;
  } catch {
    return null;
  }
}

export async function saveWebCompanionConfig(config: WebCompanionConfig): Promise<void> {
  assertCleartextCompanionHostAllowed(config);
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

export async function clearWebCompanionConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(CONFIG_KEY);
}
