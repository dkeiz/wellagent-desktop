/**
 * API Client — HTTP + WebSocket for CompanionApiServer
 */

export interface ConnectionConfig {
  host: string;
  port: number;
  useTls: boolean;
}

export interface CompanionSpeechResult {
  success: boolean;
  audioBase64?: string;
  audioPath?: string;
  audioUrl?: string;
  expiresAt?: string;
  mimeType?: string;
  durationMs?: number;
  error?: string;
}

export interface AndroidAppStatus {
  success: boolean;
  androidApp?: {
    available: boolean;
    fileName: string;
    size: number;
    versionCode: number;
    versionName: string;
    sha256: string;
    downloadUrl: string;
  };
  error?: string;
}

function baseUrl(c: ConnectionConfig): string {
  return `${c.useTls ? 'https' : 'http'}://${c.host}:${c.port}`;
}

export class CompanionClient {
  private config: ConnectionConfig;
  private accessToken: string = '';
  private wsTicket: string = '';
  private sessionToken: string = '';
  private sessionDeviceId: string = '';
  private artifactTickets: Map<string, { ticket: string; expiresAt: number }> = new Map();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect: boolean = false;
  private authRefreshPromise: Promise<boolean> | null = null;
  private _onMessage: ((msg: any) => void) | null = null;
  private _onConnection: ((connected: boolean) => void) | null = null;

  constructor(config: ConnectionConfig) { this.config = config; }

  updateConfig(config: Partial<ConnectionConfig>) { this.config = { ...this.config, ...config }; }
  setAccessToken(token: string) { this.accessToken = token; }
  isAuthenticated(): boolean { return Boolean(this.accessToken); }
  resetAuth() {
    this.accessToken = '';
    this.wsTicket = '';
    this.sessionToken = '';
    this.sessionDeviceId = '';
    this.artifactTickets.clear();
  }

  async health() {
    return this.get<any>('/companion/health', { includeAccessToken: false, allowAuthRefresh: false });
  }

  async pair(request: { pairingCode: string; deviceName: string; deviceId: string; platform?: string; appVersion?: string }) {
    const result = await this.post<any>('/companion/pair', request, { includeAccessToken: false, allowAuthRefresh: false });
    if (result.success && result.tlsEnabled) {
      this.config.useTls = true;
    }
    return result;
  }

  async authenticate(request: { sessionToken: string; deviceId: string }) {
    return this.authenticateSession(request);
  }

  private async authenticateSession(request: { sessionToken: string; deviceId: string }) {
    const sessionToken = String(request?.sessionToken || '').trim();
    const deviceId = String(request?.deviceId || '').trim();
    const result = await this.post<any>(
      '/companion/auth',
      { sessionToken, deviceId },
      { includeAccessToken: false, allowAuthRefresh: false }
    );
    if (result.success && result.accessToken) {
      this.sessionToken = sessionToken;
      this.sessionDeviceId = deviceId;
      this.accessToken = result.accessToken;
      this.wsTicket = result.wsTicket || '';
      if (result.tlsEnabled) {
        this.config.useTls = true;
      }
    }
    return result;
  }

  async getSettings(): Promise<{ success: boolean; snapshot?: any }> {
    return this.get('/companion/settings/full');
  }

  async getSttStatus(): Promise<{ success: boolean; tiers?: any[]; activeProvider?: string; error?: string }> {
    return this.get('/companion/stt/status');
  }

  async getAndroidAppStatus(): Promise<AndroidAppStatus> {
    return this.get('/companion/app/android/status');
  }

  async listChatSessions(limit = 20): Promise<{ success: boolean; result?: any[]; currentSessionId?: string; currentSession?: any; error?: string }> {
    return this.get(`/companion/chat/sessions?limit=${encodeURIComponent(String(limit))}`);
  }

  async createChatSession(): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/chat/session', {});
  }

  async switchChatSession(sessionId: string): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/chat/switch', { sessionId });
  }

  async getMessages(sessionId: string, limit = 80): Promise<{ success: boolean; result?: any[]; error?: string }> {
    const params = new URLSearchParams({ sessionId, limit: String(limit) });
    return this.get(`/companion/chat/messages?${params.toString()}`);
  }

  async sendMessage(text: string, sessionId?: string | null): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/chat/send', { text, sessionId });
  }

  async stopGeneration(): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/chat/stop', {});
  }

  async isGenerating(): Promise<{ success: boolean; generating: boolean; error?: string }> {
    return this.get('/companion/chat/generating');
  }

  async setThinkingMode(mode: 'think' | 'off'): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/llm/thinking', { mode });
  }

  async setCapabilityMain(enabled: boolean): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/capabilities/main', { enabled });
  }

  async setDaemonRunning(kind: 'memory' | 'workflow', running: boolean): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/daemon', { kind, running });
  }

  async setAgentActive(agentId: number, active: boolean): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.post('/companion/agents/active', { agentId, active });
  }

  async getWsTicket(): Promise<{ success: boolean; wsTicket?: string; expiresIn?: number; error?: string }> {
    return this.get('/companion/ws-ticket');
  }

  private artifactTicketKey(sessionId: string, fileName: string): string {
    return `${String(sessionId || '')}\n${String(fileName || '')}`;
  }

  private extractArtifactNames(messages: Array<{ content?: string }> = []): string[] {
    const names = new Set<string>();
    for (const message of messages) {
      const content = String(message?.content || '');
      const pattern = /^\[(?:Image attached|Voice message|File attached):\s*([^\]]+)\]/gim;
      let match = pattern.exec(content);
      while (match) {
        const name = String(match[1] || '').trim();
        if (name) names.add(name);
        match = pattern.exec(content);
      }
    }
    return Array.from(names);
  }

  async getArtifactTicket(sessionId: string, fileName: string): Promise<string> {
    const key = this.artifactTicketKey(sessionId, fileName);
    const existing = this.artifactTickets.get(key);
    if (existing && existing.expiresAt > Date.now() + 5000) return existing.ticket;
    const params = new URLSearchParams({ sessionId: String(sessionId || ''), fileName: String(fileName || '') });
    const payload = await this.get<{ success: boolean; ticket?: string; expiresIn?: number; expiresAt?: number }>(`/companion/artifact/ticket?${params.toString()}`);
    const ticket = String(payload.ticket || '').trim();
    if (!ticket) throw new Error('Artifact ticket was not returned');
    this.artifactTickets.set(key, {
      ticket,
      expiresAt: Number(payload.expiresAt || 0) || Date.now() + (Number(payload.expiresIn || 60) * 1000),
    });
    return ticket;
  }

  async prepareArtifactTickets(sessionId: string, messages: Array<{ content?: string }> = []): Promise<void> {
    const names = this.extractArtifactNames(messages);
    await Promise.all(names.map((fileName) => this.getArtifactTicket(sessionId, fileName).catch(() => null)));
  }

  async removeDevice(deviceId: string): Promise<{ success: boolean; error?: string }> {
    return this.requestJson(`/companion/device/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async uploadMedia(data: ArrayBuffer, contentType: string, sessionId?: string, caption?: string, options?: { sendAsMessage?: boolean }) {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (caption) params.set('caption', caption);
    if (options?.sendAsMessage === false) params.set('sendAsMessage', 'false');
    const qs = params.toString();
    return this.requestJson(`/companion/media/upload${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: data,
    });
  }

  getArtifactUrl(sessionId: string, fileName: string): string {
    const entry = this.artifactTickets.get(this.artifactTicketKey(sessionId, fileName));
    if (!entry || entry.expiresAt <= Date.now()) return '';
    return `${baseUrl(this.config)}/companion/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}?ticket=${encodeURIComponent(entry.ticket)}`;
  }

  async getArtifactUrlWithTicket(sessionId: string, fileName: string): Promise<string> {
    const ticket = await this.getArtifactTicket(sessionId, fileName);
    return `${baseUrl(this.config)}/companion/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}?ticket=${encodeURIComponent(ticket)}`;
  }

  async transcribeAudio(data: ArrayBuffer, contentType: string, options?: { sessionId?: string; sendAsMessage?: boolean; language?: string; prompt?: string }) {
    const params = new URLSearchParams();
    if (options?.sessionId) params.set('sessionId', options.sessionId);
    if (options?.sendAsMessage) params.set('sendAsMessage', 'true');
    if (options?.language) params.set('language', options.language);
    if (options?.prompt) params.set('prompt', options.prompt);
    const qs = params.toString();
    return this.requestJson<{
      success: boolean;
      transcript?: string;
      text?: string;
      detectedLanguage?: string;
      durationMs?: number;
      segmentCount?: number;
      error?: string;
    }>(`/companion/stt/transcribe${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: data,
    });
  }

  async sendVoiceMessage(data: ArrayBuffer, contentType: string, sessionId?: string | null) {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    const qs = params.toString();
    return this.requestJson<{
      success: boolean;
      transcript?: string;
      text?: string;
      backend?: string;
      providerId?: string;
      sessionId?: string;
      result?: any;
      error?: string;
    }>(`/android/voice/send${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: data,
    });
  }

  async speakText(text: string) {
    return this.post<CompanionSpeechResult>('/backend/voice/generate', {
      text
    });
  }

  resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${baseUrl(this.config)}${normalizedPath}`;
  }

  // ── WebSocket ──
  connectWebSocket(onMessage: (msg: any) => void, onConnection?: (connected: boolean) => void) {
    this._onMessage = onMessage;
    this._onConnection = onConnection || null;
    this.shouldReconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._connectWs();
  }

  disconnectWebSocket() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try { socket.close(); } catch {}
    }
  }

  private _connectWs() {
    if (!this.wsTicket) return;
    if (this.ws) {
      const staleSocket = this.ws;
      this.ws = null;
      try { staleSocket.close(); } catch {}
    }
    const proto = this.config.useTls ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${this.config.host}:${this.config.port}/companion/ws?ticket=${this.wsTicket}`);
    let disconnectedNotified = false;
    const notifyDisconnected = () => {
      if (disconnectedNotified) return;
      disconnectedNotified = true;
      this._onConnection?.(false);
    };
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket) return;
      disconnectedNotified = false;
      this._onConnection?.(true);
    };
    socket.onmessage = (e) => {
      if (this.ws !== socket) return;
      try { this._onMessage?.(JSON.parse(String(e.data))); } catch {}
    };
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
      notifyDisconnected();
      if (this.shouldReconnect) this._scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      notifyDisconnected();
    };
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || !this.accessToken) return;

      try {
        const result = await this.getWsTicket();
        if (!result.success || !result.wsTicket) {
          this._onConnection?.(false);
          if (this.shouldReconnect) this._scheduleReconnect();
          return;
        }
        this.wsTicket = result.wsTicket;
        this._connectWs();
      } catch {
        this._onConnection?.(false);
        if (this.shouldReconnect) this._scheduleReconnect();
      }
    }, 5000);
  }

  // ── HTTP Helpers ──
  private isAuthFailure(status: number, payload: any): boolean {
    if (status !== 401) return false;
    const error = String(payload?.error || '').trim().toLowerCase();
    return !error || error.includes('token') || error.includes('unauthorized');
  }

  private async reauthenticate(): Promise<boolean> {
    if (this.authRefreshPromise) return this.authRefreshPromise;
    const sessionToken = String(this.sessionToken || '').trim();
    const deviceId = String(this.sessionDeviceId || '').trim();
    if (!sessionToken || !deviceId) return false;

    this.authRefreshPromise = (async () => {
      try {
        const result = await this.authenticateSession({ sessionToken, deviceId });
        if (result.success && result.accessToken) return true;
      } catch {}
      this.accessToken = '';
      this.wsTicket = '';
      return false;
    })().finally(() => {
      this.authRefreshPromise = null;
    });

    return this.authRefreshPromise;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
    options: { includeAccessToken?: boolean; allowAuthRefresh?: boolean } = {}
  ): Promise<T> {
    const includeAccessToken = options.includeAccessToken !== false;
    const allowAuthRefresh = options.allowAuthRefresh !== false;

    const execute = async () => {
      const headers = { ...((init.headers as Record<string, string>) || {}) };
      if (includeAccessToken && this.accessToken) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      }
      const response = await fetch(`${baseUrl(this.config)}${path}`, { ...init, headers });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    };

    let attempt = await execute();
    if (allowAuthRefresh && this.isAuthFailure(attempt.response.status, attempt.payload) && await this.reauthenticate()) {
      attempt = await execute();
    }
    return attempt.payload as T;
  }

  private async get<T>(
    path: string,
    options: { includeAccessToken?: boolean; allowAuthRefresh?: boolean } = {}
  ): Promise<T> {
    return this.requestJson<T>(path, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, options);
  }

  private async post<T>(
    path: string,
    body?: object,
    options: { includeAccessToken?: boolean; allowAuthRefresh?: boolean } = {}
  ): Promise<T> {
    return this.requestJson<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, options);
  }
}
