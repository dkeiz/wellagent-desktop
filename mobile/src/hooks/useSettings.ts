import { useState, useCallback, useEffect } from 'react';
import { CompanionClient } from '../api/client';

export function useSettings(client: CompanionClient | null) {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const r = await client.getSettings();
      if (r.success && r.snapshot) setSettings(r.snapshot);
    } catch {}
    setLoading(false);
  }, [client]);

  const setThinkingMode = useCallback(async (mode: 'think' | 'off') => {
    if (!client) return; await client.setThinkingMode(mode); await loadSettings();
  }, [client, loadSettings]);

  const setCapabilityMain = useCallback(async (enabled: boolean) => {
    if (!client) return; await client.setCapabilityMain(enabled); await loadSettings();
  }, [client, loadSettings]);

  const startMemoryDaemon = useCallback(async () => {
    if (!client) return; await client.setDaemonRunning('memory', true); await loadSettings();
  }, [client, loadSettings]);

  const stopMemoryDaemon = useCallback(async () => {
    if (!client) return; await client.setDaemonRunning('memory', false); await loadSettings();
  }, [client, loadSettings]);

  const activateAgent = useCallback(async (agentId: number) => {
    if (!client) return; await client.setAgentActive(agentId, true); await loadSettings();
  }, [client, loadSettings]);

  const handleWsMessage = useCallback((msg: any) => {
    if (['settings-change', 'capability-update', 'agent-update'].includes(msg.type)) loadSettings();
  }, [loadSettings]);

  useEffect(() => { if (client?.isAuthenticated()) loadSettings(); }, [client]);

  return { settings, loading, loadSettings, setThinkingMode, setCapabilityMain,
    startMemoryDaemon, stopMemoryDaemon, activateAgent, handleWsMessage };
}
