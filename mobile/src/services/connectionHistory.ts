import * as SecureStore from 'expo-secure-store';

const HISTORY_KEY = 'localagent_companion_connection_history';

export interface ConnectionHistoryEntry {
  host: string;
  port: number;
  useTls: boolean;
  timestamp: number;
}

export async function getConnectionHistory(): Promise<ConnectionHistoryEntry[]> {
  try {
    const raw = await SecureStore.getItemAsync(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => b.timestamp - a.timestamp);
    }
  } catch (err) {
    console.warn('Failed to get connection history:', err);
  }
  return [];
}

export async function addConnectionToHistory(host: string, port: number, useTls: boolean): Promise<void> {
  try {
    const history = await getConnectionHistory();
    // Filter out duplicates
    const filtered = history.filter(h => h.host !== host || h.port !== port);
    
    // Add new entry
    const newEntry: ConnectionHistoryEntry = {
      host,
      port,
      useTls,
      timestamp: Date.now()
    };
    
    const updated = [newEntry, ...filtered].slice(0, 3);
    await SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to add connection to history:', err);
  }
}

export async function clearConnectionHistory(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(HISTORY_KEY);
  } catch (err) {
    console.warn('Failed to clear connection history:', err);
  }
}
