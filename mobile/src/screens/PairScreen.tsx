import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { CompanionClient } from '../api/client';
import { saveCredentials, getOrCreateDeviceId, loadCredentials } from '../services/auth';
import { getConnectionHistory, addConnectionToHistory, ConnectionHistoryEntry } from '../services/connectionHistory';
import {
  loadWebCompanionConfig,
  parseWebCompanionLaunchUrl,
  saveWebCompanionConfig,
  isPrivateCompanionHost,
  defaultPort
} from '../services/webCompanionConfig';
import { colors, spacing, radius, typography } from '../theme';

interface Props {
  navigation: any;
  route?: { params?: { launchConfig?: { host?: string; port?: number; pairingCode?: string } } };
  getClient: () => CompanionClient;
}

export function PairScreen({ navigation, route, getClient }: Props) {
  const insets = useSafeAreaInsets();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8790');
  const [code, setCode] = useState('');
  const [name, setName] = useState('Android Companion');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [history, setHistory] = useState<ConnectionHistoryEntry[]>([]);

  useEffect(() => {
    async function init() {
      try {
        const creds = await loadCredentials();
        if (creds?.serverConfig) {
          setHost(creds.serverConfig.host || '');
          setPort(String(creds.serverConfig.port || '8790'));
        }
        const savedConfig = await loadWebCompanionConfig();
        if (savedConfig?.host) {
          setHost(savedConfig.host);
          setPort(String(savedConfig.port || '8790'));
          if (savedConfig.pairingCode) setCode(savedConfig.pairingCode);
        }
        const hist = await getConnectionHistory();
        setHistory(hist);
      } catch (err) {
        console.warn('Failed to load initial settings:', err);
      }
    }
    init();
  }, []);

  useEffect(() => {
    const launchConfig = route?.params?.launchConfig;
    if (!launchConfig?.host) return;
    setHost(String(launchConfig.host));
    setPort(String(launchConfig.port || '8790'));
    if (launchConfig.pairingCode) setCode(String(launchConfig.pairingCode));
  }, [route?.params?.launchConfig]);

  const handlePair = async () => {
    if (!host || !code) { setError('Enter server IP and pairing code'); return; }
    setLoading(true); setError('');
    try {
      const client = getClient();
      const normalizedPort = Number(port) || 8790;
      client.updateConfig({ host, port: normalizedPort, useTls: false });

      const health = await client.health();
      if (!health.ok) throw new Error('Server not responding');

      // Request mic permissions upfront since we're a native app
      await Audio.requestPermissionsAsync();

      const deviceId = await getOrCreateDeviceId();
      const r = await client.pair({
        pairingCode: code,
        deviceName: name,
        deviceId,
        platform: 'android',
        appVersion: '0.2.0-beta.1'
      });
      if (!r.success) throw new Error(r.error || 'Pairing failed');

      const persistedDeviceId = String(r.deviceId || deviceId).trim() || deviceId;
      await saveCredentials({
        sessionToken: r.sessionToken!,
        deviceId: persistedDeviceId,
        serverConfig: { host, port: normalizedPort, useTls: false }
      });

      // Save to connection history
      await addConnectionToHistory(host, normalizedPort, false).catch(() => {});

      // Also save as WebCompanion config for consistency
      await saveWebCompanionConfig({ host, port: normalizedPort, useTls: false });

      const auth = await client.authenticate({ sessionToken: r.sessionToken!, deviceId: persistedDeviceId });
      if (auth.success) {
        navigation.replace('chat');
      } else {
        setError('Authentication failed after pairing');
      }
    } catch (e: any) { setError(e.message || 'Connection failed'); }
    setLoading(false);
  };

  const handleOpenScanner = async () => {
    setError('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is required to scan QR codes.');
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const handleScanned = async ({ data }: { data?: string }) => {
    if (scanLocked) return;
    setScanLocked(true);
    try {
      const url = String(data || '').trim();
      const parsed = parseWebCompanionLaunchUrl(url);
      if (parsed) {
        setHost(parsed.host);
        setPort(String(parsed.port));
        if (parsed.pairingCode) setCode(parsed.pairingCode);
        setScannerOpen(false);
        return;
      }
      // Try parsing as plain host:port
      const match = url.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?$/);
      if (match) {
        setHost(match[1]);
        if (match[2]) setPort(match[2]);
        setScannerOpen(false);
        return;
      }
      throw new Error('Unsupported QR code. Scan a LocalAgent companion QR from the desktop app.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read QR code.');
      setScanLocked(false);
    }
  };

  if (scannerOpen) {
    return (
      <View style={s.scannerRoot}>
        <CameraView
          style={s.scannerView}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanLocked ? undefined : handleScanned}
        />
        <View style={[s.scannerOverlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
          <View>
            <Text style={s.scannerTitle}>Scan LocalAgent QR</Text>
            <Text style={s.scannerCopy}>Point at the QR code from your desktop app's companion settings, terminal, or pairing dialog.</Text>
          </View>
          <View style={s.scannerFrame} />
          <TouchableOpacity onPress={() => setScannerOpen(false)} style={s.scannerCancel}>
            <Text style={s.scannerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.container, { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={s.card}>
          <Text style={s.logo}>🛰</Text>
          <Text style={s.title}>LocalAgent</Text>
          <Text style={s.sub}>Connect to your desktop</Text>

          {history.length > 0 && (
            <View style={s.historyContainer}>
              <Text style={s.historyTitle}>Recent Servers</Text>
              <View style={s.historyList}>
                {history.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={s.chip}
                    onPress={() => {
                      setHost(item.host);
                      setPort(String(item.port));
                    }}
                  >
                    <Text style={s.chipText}>{item.host}:{item.port}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <TextInput style={s.input} placeholder="Server IP (e.g. 192.168.1.100)" placeholderTextColor={colors.textMuted} value={host} onChangeText={setHost} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <TextInput style={s.input} placeholder="Port (default: 8790)" placeholderTextColor={colors.textMuted} value={port} onChangeText={setPort} keyboardType="number-pad" />
          <TextInput style={s.input} placeholder="6-digit pairing code" placeholderTextColor={colors.textMuted} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
          <TextInput style={s.input} placeholder="Device name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />

          <TouchableOpacity style={[s.btn, loading && { opacity: 0.5 }]} onPress={handlePair} disabled={loading}>
            <Text style={s.btnText}>{loading ? 'Connecting...' : 'Pair & Connect'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.scanBtn} onPress={handleOpenScanner}>
            <Text style={s.scanBtnText}>📷 Scan QR Code</Text>
          </TouchableOpacity>

          {error ? <Text style={s.err}>{error}</Text> : null}

          <Text style={s.hint}>Desktop: Settings → Companion → Generate Pairing Code</Text>
          <Text style={s.hint}>Mic permissions are granted natively — no HTTPS needed.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border },
  logo: { fontSize: 40, textAlign: 'center', marginBottom: spacing.xs },
  title: { fontSize: typography.sizes.xxl, fontWeight: typography.weights.bold, color: colors.accent, textAlign: 'center' },
  sub: { fontSize: typography.sizes.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.text, fontSize: typography.sizes.md, marginBottom: spacing.md },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  btnText: { color: '#fff', fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  scanBtn: { borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface2 },
  scanBtnText: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  err: { color: colors.danger, fontSize: typography.sizes.xs, textAlign: 'center', marginTop: spacing.sm },
  hint: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', marginTop: spacing.md, lineHeight: 17 },
  scannerRoot: { flex: 1, backgroundColor: '#000' },
  scannerView: { flex: 1 },
  scannerOverlay: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    padding: spacing.xl,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.36)'
  },
  scannerTitle: { color: '#fff', fontSize: typography.sizes.xl, fontWeight: typography.weights.bold, textAlign: 'center' },
  scannerCopy: { marginTop: spacing.sm, color: 'rgba(255,255,255,0.86)', fontSize: typography.sizes.sm, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
  scannerFrame: { width: 240, height: 240, borderWidth: 2, borderColor: '#fff', borderRadius: radius.lg },
  scannerCancel: { alignSelf: 'center', minWidth: 180, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(0,0,0,0.3)' },
  scannerCancelText: { color: '#fff', fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  historyContainer: { marginBottom: spacing.md, width: '100%' },
  historyTitle: { fontSize: typography.sizes.xs, color: colors.textSecondary, fontWeight: typography.weights.semibold, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  historyList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipText: { color: colors.text, fontSize: typography.sizes.sm }
});
