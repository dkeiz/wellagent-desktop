/**
 * LocalAgent Mobile Companion — Shared Type Definitions
 *
 * These types are the single source of truth for the Companion API contract.
 * - Desktop .js files reference them via JSDoc: @typedef {import('../../shared/companion-types').X}
 * - Mobile .ts files import them directly: import type { X } from '@shared/companion-types'
 */

// ─── Pairing & Authentication ────────────────────────────────────────────────

export interface PairRequest {
  pairingCode: string;
  deviceName: string;
  deviceId: string;
  platform?: string;
  appVersion?: string;
}

export interface PairResponse {
  success: boolean;
  sessionToken?: string;
  expiresAt?: string;
  deviceId?: string;
  error?: string;
}

export interface AuthRequest {
  sessionToken: string;
  deviceId: string;
}

export interface AuthResponse {
  success: boolean;
  accessToken?: string;
  wsTicket?: string;
  expiresIn?: number;
  serverVersion?: string;
  error?: string;
}

export interface AuthRefreshRequest {
  accessToken: string;
}

export interface PairingInfo {
  code: string;
  token: string;
  host: string;
  port: number;
  expiresAt: string;
  tlsFingerprint?: string;
}

// ─── Device Management ───────────────────────────────────────────────────────

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  platform: string;
  pairedAt: string;
  lastSeenAt: string;
  sessionTokenHash: string;
  permissions: CompanionPermissionScope;
  active: boolean;
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export type CompanionPermissionPreset = 'full' | 'standard' | 'chat-only' | 'read-only';

export interface CompanionPermissionScope {
  preset: CompanionPermissionPreset;
  /** IPC channels explicitly allowed (if not using preset) */
  allowedChannels?: string[];
  /** IPC channels explicitly blocked (overrides preset) */
  blockedChannels?: string[];
  /** Whether media uploads are allowed */
  mediaUpload: boolean;
  /** Whether settings changes are allowed */
  settingsWrite: boolean;
  /** Whether agent management is allowed */
  agentManagement: boolean;
  /** Whether daemon control is allowed */
  daemonControl: boolean;
}

// ─── IPC Proxy ───────────────────────────────────────────────────────────────

export interface IpcProxyRequest {
  channel: string;
  args?: any[];
}

export interface IpcProxyResponse {
  success: boolean;
  result?: any;
  error?: string;
  channel?: string;
}

// ─── Media Upload ────────────────────────────────────────────────────────────

export interface MediaUploadResult {
  success: boolean;
  fileName?: string;
  kind?: 'image' | 'audio' | 'video' | 'text' | 'binary';
  size?: number;
  sessionId?: string;
  messageId?: string;
  transcription?: string;
  error?: string;
}

// ─── WebSocket Messages ──────────────────────────────────────────────────────

export type WSMessageType =
  | 'conversation-update'
  | 'settings-change'
  | 'background-event'
  | 'background-notification'
  | 'tool-preview-update'
  | 'generation-status'
  | 'tts-audio'
  | 'capability-update'
  | 'agent-update'
  | 'heartbeat'
  | 'error'
  | 'device-kicked';

export interface WSMessage {
  type: WSMessageType;
  payload?: any;
  timestamp?: string;
}

export interface WSConversationUpdate extends WSMessage {
  type: 'conversation-update';
  payload: {
    sessionId?: string;
  };
}

export interface WSSettingsChange extends WSMessage {
  type: 'settings-change';
  payload: {
    scope: string;
    data: any;
  };
}

export interface WSBackgroundEvent extends WSMessage {
  type: 'background-event';
  payload: {
    eventType: string;
    category: string;
    data: any;
  };
}

export interface WSHeartbeat extends WSMessage {
  type: 'heartbeat';
  payload: {
    uptime: number;
    connectedDevices: number;
  };
}

// ─── Settings Snapshot ───────────────────────────────────────────────────────

export interface SettingsSnapshot {
  llm: {
    provider: string;
    model: string;
    providerLabel?: string;
    thinkingMode: string;
    showThinking: boolean;
    thinkingVisibility?: 'show' | 'hide' | 'collapse' | string;
    contextWindow?: number;
    concurrencyEnabled: boolean;
  };
  capabilities: {
    mainEnabled: boolean;
    groups: Record<string, boolean | string>;
    activeToolCount: number;
  };
  agents: Array<{
    id: number;
    name: string;
    type: string;
    active: boolean;
  }>;
  daemons: {
    memoryRunning: boolean;
    workflowRunning: boolean;
  };
  companion: {
    permissions: CompanionPermissionScope;
    connectedDevices: number;
  };
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  ok: boolean;
  kind: 'companion';
  version: string;
  host: string;
  port: number;
  uptime: number;
  pairedDevices: number;
  connectedDevices: number;
}

// ─── Server Configuration ────────────────────────────────────────────────────

export interface CompanionServerConfig {
  enabled: boolean;
  host: string;
  port: number;
  tlsEnabled: boolean;
  exposeExternal: boolean;
  maxDevices: number;
  accessTokenTtlSeconds: number;
  wsHeartbeatIntervalMs: number;
  rateLimitPerMinute: number;
}
