import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Audio } from 'expo-av';
import { colors, radius, spacing, typography } from '../theme';
import { buildCompanionWebUrl, clearWebCompanionConfig, type WebCompanionConfig } from '../services/webCompanionConfig';
import { startVoiceRecording, stopVoiceRecordingBase64, type VoiceRecording } from '../services/voice';

interface Props {
  config: WebCompanionConfig;
  onChangeServer: () => void;
}

function buildTroubleshootingHints(config: WebCompanionConfig, uri: string, loadError: string): string[] {
  const normalizedError = String(loadError || '').toLowerCase();
  const hints = [
    `Check that LocalAgent desktop is running and Companion is enabled for ${config.host}:${config.port}.`
  ];

  if (config.useTls) {
    hints.push('If this is HTTPS, verify Android trusted the LocalAgent companion CA and the desktop HTTPS listener is running on port 8791.');
  } else {
    hints.push('If this is HTTP over LAN, the desktop companion should usually bind to 0.0.0.0, not 127.0.0.1.');
  }

  if (normalizedError.includes('cleartext')) {
    hints.push('Android rejected a cleartext request. Switch this connection to HTTPS or use a local/private LAN host.');
  } else if (normalizedError.includes('ssl') || normalizedError.includes('certificate')) {
    hints.push('The TLS certificate was rejected. Re-run Android browser HTTPS setup on desktop, then reinstall the LocalAgent CA on the device.');
  } else if (normalizedError.includes('connection') || normalizedError.includes('network') || normalizedError.includes('host lookup')) {
    hints.push(`The device could not reach ${uri}. Recheck the desktop LAN IP, port, Wi-Fi network, and firewall.`);
  }

  return hints;
}

function createBridgeNonce(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function WebCompanionScreen({ config, onChangeServer }: Props) {
  const webViewRef = useRef<WebView>(null);
  const lastAllowedUrlRef = useRef('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState('');
  const recordingRef = useRef<VoiceRecording | null>(null);
  const uri = buildCompanionWebUrl(config);
  const nativeBridgeNonce = useMemo(() => createBridgeNonce(), [reloadKey, uri]);
  const injectedNativeBridgeNonce = useMemo(() => (
    `window.__LOCALAGENT_NATIVE_BRIDGE_NONCE__=${JSON.stringify(nativeBridgeNonce)};true;`
  ), [nativeBridgeNonce]);
  const companionOrigin = useMemo(() => {
    try {
      return new URL(uri).origin;
    } catch {
      return '';
    }
  }, [uri]);
  const troubleshootingHints = useMemo(
    () => buildTroubleshootingHints(config, uri, loadError),
    [config, loadError, uri]
  );

  useEffect(() => {
    lastAllowedUrlRef.current = uri;
  }, [uri]);

  useEffect(() => {
    Audio.requestPermissionsAsync().catch(() => {});
  }, []);

  const changeServer = useCallback(async () => {
    await clearWebCompanionConfig();
    onChangeServer();
  }, [onChangeServer]);

  const sendNativeVoiceEvent = useCallback((payload: object) => {
    const script = `window.LocalAgentCompanionNativeVoice&&window.LocalAgentCompanionNativeVoice.handleNativeEvent(${JSON.stringify({ ...payload, nonce: nativeBridgeNonce })});true;`;
    webViewRef.current?.injectJavaScript(script);
  }, [nativeBridgeNonce]);

  const isAllowedCompanionUrl = useCallback((targetUrl: string | undefined) => {
    if (!targetUrl) return false;
    if (targetUrl === 'about:blank') return true;
    try {
      return new URL(targetUrl).origin === companionOrigin;
    } catch {
      return false;
    }
  }, [companionOrigin]);

  const handleNativeVoiceMessage = useCallback(async (rawData: string, sourceUrl?: string) => {
    sourceUrl = sourceUrl || lastAllowedUrlRef.current || uri;
    if (!isAllowedCompanionUrl(sourceUrl)) return;
    let message: { type?: string; nonce?: string } = {};
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }
    if (message.nonce !== nativeBridgeNonce) return;
    if (message.type === 'localagent.voice.start') {
      try {
        if (recordingRef.current) return;
        recordingRef.current = await startVoiceRecording();
        sendNativeVoiceEvent({ type: 'recording-started' });
      } catch (error) {
        recordingRef.current = null;
        sendNativeVoiceEvent({ type: 'error', error: error instanceof Error ? error.message : 'microphone unavailable' });
      }
      return;
    }
    if (message.type === 'localagent.voice.stop') {
      try {
        if (!recordingRef.current) return;
        const recording = recordingRef.current;
        recordingRef.current = null;
        const audio = await stopVoiceRecordingBase64(recording);
        sendNativeVoiceEvent({ type: 'recording-ready', ...audio });
      } catch (error) {
        recordingRef.current = null;
        sendNativeVoiceEvent({ type: 'error', error: error instanceof Error ? error.message : 'recording failed' });
      }
    }
  }, [isAllowedCompanionUrl, sendNativeVoiceEvent, nativeBridgeNonce, uri]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      onChangeServer();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, onChangeServer]);

  if (loadError) {
    return (
      <View style={st.errorRoot}>
        <View style={st.errorCard}>
          <Text style={st.errorTitle}>Companion did not load</Text>
          <Text style={st.errorText}>{loadError}</Text>
          <Text style={st.errorUrl}>{uri}</Text>
          <View style={st.errorHints}>
            {troubleshootingHints.map((hint) => (
              <Text key={hint} style={st.errorHint}>{hint}</Text>
            ))}
          </View>
          <View style={st.errorActions}>
            <TouchableOpacity onPress={() => { setLoadError(''); setReloadKey(k => k + 1); }} style={st.secondary}>
              <Text style={st.secondaryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={changeServer} style={st.primary}>
              <Text style={st.primaryText}>Server</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={st.root}>
      <WebView
        key={reloadKey}
        ref={webViewRef}
        source={{ uri }}
        style={st.webview}
        originWhitelist={[companionOrigin]}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={injectedNativeBridgeNonce}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        mixedContentMode={config.useTls ? 'never' : 'compatibility'}
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
        webviewDebuggingEnabled={false}
        onShouldStartLoadWithRequest={(request) => isAllowedCompanionUrl(request.url)}
        onNavigationStateChange={(event) => {
          setCanGoBack(event.canGoBack);
          if (isAllowedCompanionUrl(event.url)) {
            lastAllowedUrlRef.current = event.url;
          }
          setLoadError('');
        }}
        onError={(event) => {
          setLoadError(event.nativeEvent.description || 'Network or certificate error.');
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            setLoadError(`HTTP ${event.nativeEvent.statusCode}`);
          }
        }}
        onMessage={(event) => handleNativeVoiceMessage(event.nativeEvent.data, event.nativeEvent.url)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1, backgroundColor: colors.bg },
  errorRoot: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  errorCard: {
    padding: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  errorTitle: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold },
  errorText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: typography.sizes.sm, lineHeight: 20 },
  errorUrl: { marginTop: spacing.lg, color: colors.textMuted, fontSize: typography.sizes.xs },
  errorHints: { marginTop: spacing.lg, gap: spacing.sm },
  errorHint: { color: colors.textSecondary, fontSize: typography.sizes.sm, lineHeight: 20 },
  errorActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  primary: { flex: 1, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent },
  primaryText: { color: '#fff', fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  secondary: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface2
  },
  secondaryText: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }
});
