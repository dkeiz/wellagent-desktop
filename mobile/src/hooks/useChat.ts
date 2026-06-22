import { useState, useCallback, useEffect, useRef } from 'react';
import { CompanionClient } from '../api/client';

export interface ChatMessage { id?: number; role: 'user' | 'assistant' | 'system'; content: string; }
export interface ChatSession { id: string; title?: string; first_message?: string; }

export function useChat(client: CompanionClient | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const syncActiveSession = useCallback((sessionId?: string | null) => {
    const nextId = String(sessionId || '').trim();
    if (!nextId || nextId === activeSessionIdRef.current) return;
    activeSessionIdRef.current = nextId;
    setActiveSessionId(nextId);
  }, []);

  const loadSessions = useCallback(async () => {
    if (!client) return { sessions: [], currentSessionId: null as string | null };
    const r = await client.listChatSessions(20);
    const list = r.result || [];
    const currentSessionId = String(r.currentSessionId || r.currentSession?.id || '').trim() || null;
    setSessions(list);
    if (currentSessionId) syncActiveSession(currentSessionId);
    return { sessions: list, currentSessionId };
  }, [client, syncActiveSession]);

  const loadMessages = useCallback(async (sessionId?: string | null) => {
    const targetSessionId = sessionId ?? activeSessionIdRef.current;
    if (!client || !targetSessionId) return;
    try {
      const [msgResult, genResult] = await Promise.all([
        client.getMessages(targetSessionId, 50),
        client.isGenerating().catch(() => ({ success: true, generating: false }))
      ]);
      // Race condition guard: ensure active session hasn't changed while request was in-flight
      if (targetSessionId !== activeSessionIdRef.current) return;

      const nextMessages = msgResult.result || [];
      await client.prepareArtifactTickets(targetSessionId, nextMessages);
      setMessages(nextMessages);
      if (genResult?.success) {
        setGenerating(genResult.generating);
      }
    } catch (e) {
      console.warn('Error loading messages or generating state:', e);
    }
  }, [client]);

  const sendMessage = useCallback(async (text: string) => {
    if (!client || !text.trim() || generating) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setGenerating(true);
    let targetId = activeSessionId;
    try {
      const r = await client.sendMessage(text, null);
      if (r.result?.sessionId) {
        targetId = r.result.sessionId;
        syncActiveSession(r.result.sessionId);
        await loadSessions();
      }
      await loadMessages(targetId);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'system', content: `Error: ${e.message}` }]);
      setGenerating(false);
    }
  }, [client, activeSessionId, generating, loadMessages, loadSessions, syncActiveSession]);

  const stopGeneration = useCallback(async () => {
    if (!client) return;
    await client.stopGeneration();
    setGenerating(false);
  }, [client]);

  const createSession = useCallback(async () => {
    if (!client) return;
    const r = await client.createChatSession();
    if (r.result?.id) {
      syncActiveSession(r.result.id);
      setMessages([]);
      await loadSessions();
    }
  }, [client, loadSessions, syncActiveSession]);

  const switchSession = useCallback(async (id: string) => {
    const result = client ? await client.switchChatSession(id) : null;
    syncActiveSession(result?.result?.sessionId || id);
  }, [client, syncActiveSession]);

  const handleWsMessage = useCallback((msg: any) => {
    if (msg?.type !== 'conversation-update') return;
    const sessionId = String(msg?.payload?.sessionId || '').trim();
    const currentSessionId = String(msg?.payload?.currentSessionId || '').trim();
    if (currentSessionId) {
      syncActiveSession(currentSessionId);
      loadSessions().catch(() => null);
      loadMessages(currentSessionId);
      return;
    }
    loadSessions().then((state) => {
      const targetId = state.currentSessionId || activeSessionIdRef.current;
      if (sessionId && targetId && sessionId !== String(targetId)) return;
      loadMessages(targetId);
    }).catch(() => null);
  }, [loadMessages, loadSessions, syncActiveSession]);

  useEffect(() => { if (activeSessionId) loadMessages(activeSessionId); }, [activeSessionId, loadMessages]);

  return { sessions, activeSessionId, messages, generating, loadSessions, loadMessages,
    sendMessage, stopGeneration, createSession, switchSession, syncActiveSession, handleWsMessage };
}
