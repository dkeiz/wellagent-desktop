import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, radius, spacing, typography } from '../theme';
import {
  defaultPort,
  isPrivateCompanionHost,
  parseWebCompanionLaunchUrl,
  saveWebCompanionConfig,
  type WebCompanionConfig
} from '../services/webCompanionConfig';

interface Props {
  initialConfig: WebCompanionConfig | null;
  onConnect: (config: WebCompanionConfig) => void;
}

function normalizeCompanionTarget(hostInput: string, portInput: string, useTls: boolean) {
  const trimmed = String(hostInput || '').trim();
  let normalizedHost = trimmed;
  let normalizedPort = Number(portInput);
  let normalizedTls = useTls;

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    normalizedHost = parsed.hostname;
    normalizedTls = parsed.protocol === 'https:';
    if (parsed.port) normalizedPort = Number(parsed.port);
  } else {
    const candidate = trimmed.replace(/\/.*$/, '');
    try {
      const parsed = new URL(`http://${candidate}`);
      if (parsed.hostname) normalizedHost = parsed.hostname;
      if (parsed.port) normalizedPort = Number(parsed.port);
    } catch {
      normalizedHost = candidate;
    }
  }

  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    normalizedPort = defaultPort(normalizedTls);
  }

  return { host: normalizedHost, port: normalizedPort, useTls: normalizedTls };
}

export function WebCompanionConnectScreen({ initialConfig, onConnect }: Props) {
  const [host, setHost] = useState(initialConfig?.host || '');
  const [useTls, setUseTls] = useState(initialConfig?.useTls ?? true);
  const [port, setPort] = useState(String(initialConfig?.port || defaultPort(initialConfig?.useTls ?? true)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const setTlsMode = (enabled: boolean) => {
    setUseTls(enabled);
    const oldDefault = defaultPort(!enabled);
    if (!port.trim() || Number(port) === oldDefault) {
      setPort(String(defaultPort(enabled)));
    }
  };

  const handleOpen = async () => {
    const normalized = normalizeCompanionTarget(host, port, useTls);
    const normalizedHost = normalized.host;
    const normalizedPort = normalized.port;
    const normalizedTls = normalized.useTls;
    if (!normalizedHost) {
      setError('Enter the desktop companion host or LAN IP.');
      return;
    }
    if (!normalizedTls && !isPrivateCompanionHost(normalizedHost)) {
      setError('HTTP setup is limited to localhost, .local, or private LAN addresses.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await Audio.requestPermissionsAsync();
      const config = { host: normalizedHost, port: normalizedPort, useTls: normalizedTls };
      setHost(normalizedHost);
      setPort(String(normalizedPort));
      setUseTls(normalizedTls);
      await saveWebCompanionConfig(config);
      onConnect(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save companion settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenScanner = async () => {
    setError('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is required to scan companion QR codes.');
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
      const parsed = parseWebCompanionLaunchUrl(String(data || '').trim());
      if (!parsed) {
        throw new Error('Unsupported QR code. Scan a LocalAgent companion app or web companion QR.');
      }
      await saveWebCompanionConfig(parsed);
      setHost(parsed.host);
      setPort(String(parsed.port));
      setUseTls(parsed.useTls);
      setScannerOpen(false);
      onConnect(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import QR code.');
      setScanLocked(false);
    }
  };

  if (scannerOpen) {
    return (
      <View style={st.scannerRoot}>
        <CameraView
          style={st.scannerView}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanLocked ? undefined : handleScanned}
        />
        <View style={st.scannerOverlay}>
          <Text style={st.scannerTitle}>Scan LocalAgent QR</Text>
          <Text style={st.scannerCopy}>Point the camera at the desktop app QR or the CLI QR in your terminal.</Text>
          <View style={st.scannerFrame} />
          <TouchableOpacity onPress={() => setScannerOpen(false)} style={st.secondary}>
            <Text style={st.secondaryText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.root}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.content}>
        <View style={st.card}>
          <Text style={st.kicker}>Android Web Companion</Text>
          <Text style={st.title}>Open the desktop companion UI</Text>
          <Text style={st.copy}>
            Use the same companion web app as mobile browser testing. You can paste a full browser companion URL here.
          </Text>

          <Text style={st.label}>Desktop host</Text>
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="192.168.1.100"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={st.input}
          />

          <View style={st.section}>
            <View style={st.row}>
              <View style={st.rowCopy}>
                <Text style={st.label}>Use HTTPS</Text>
                <Text style={st.hint}>Required for reliable web microphone access.</Text>
              </View>
              <Switch
                value={useTls}
                onValueChange={setTlsMode}
                trackColor={{ false: colors.borderLight, true: colors.accent }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <View style={st.section}>
            <View style={{ flex: 1 }}>
              <Text style={st.label}>Port</Text>
            </View>
            <TextInput
              value={port}
              onChangeText={setPort}
              placeholder={String(defaultPort(useTls))}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              style={st.input}
            />
          </View>

          <View style={st.actions}>
            <TouchableOpacity disabled={saving} onPress={handleOpen} style={[st.primary, saving && st.disabled]}>
              <Text style={st.primaryText}>{saving ? 'Opening...' : 'Open Companion'}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleOpenScanner} style={st.secondaryAction}>
              <Text style={st.secondaryActionText}>Scan QR Code</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={st.error}>{error}</Text> : null}

          <Text style={st.footnote}>
            Desktop setup: enable Companion, run Android browser HTTPS setup, then install the LocalAgent CA on this device.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xxxl, paddingBottom: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  kicker: { color: colors.accentLight, fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold, letterSpacing: 1 },
  title: { marginTop: spacing.sm, color: colors.text, fontSize: typography.sizes.xxl, fontWeight: typography.weights.bold },
  copy: { marginTop: spacing.sm, marginBottom: spacing.lg, color: colors.textSecondary, fontSize: typography.sizes.sm, lineHeight: 20 },
  label: { marginBottom: spacing.xs, color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  hint: { color: colors.textMuted, fontSize: typography.sizes.xs },
  section: { marginBottom: spacing.md },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontSize: typography.sizes.md
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowCopy: { flex: 1, paddingRight: spacing.sm },
  actions: { marginTop: spacing.sm, gap: spacing.sm },
  primary: { alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent },
  disabled: { opacity: 0.6 },
  primaryText: { color: '#fff', fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  secondaryAction: {
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface2
  },
  secondaryActionText: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  error: { marginTop: spacing.md, color: colors.danger, fontSize: typography.sizes.sm, textAlign: 'center' },
  footnote: { marginTop: spacing.lg, color: colors.textMuted, fontSize: typography.sizes.xs, lineHeight: 17 },
  scannerRoot: { flex: 1, backgroundColor: '#000' },
  scannerView: { flex: 1 },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.xl,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.36)'
  },
  scannerTitle: {
    marginTop: spacing.xxl,
    color: '#fff',
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    textAlign: 'center'
  },
  scannerCopy: {
    marginTop: spacing.sm,
    color: 'rgba(255,255,255,0.86)',
    fontSize: typography.sizes.sm,
    textAlign: 'center'
  },
  scannerFrame: {
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: radius.lg
  },
  secondary: {
    alignSelf: 'center',
    minWidth: 180,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(0,0,0,0.3)'
  },
  secondaryText: { color: '#fff', fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }
});
