import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CompanionClient } from '../api/client';
import { promptBiometric, loadCredentials, clearCredentials, checkBiometricAvailability } from '../services/auth';
import { colors, spacing, radius, typography } from '../theme';

interface Props { navigation: any; getClient: () => CompanionClient; }

export function LockScreen({ navigation, getClient }: Props) {
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const unlock = async () => {
    setUnlocking(true); setError('');
    try {
      const bio = await checkBiometricAvailability();
      if (bio.available) {
        const ok = await promptBiometric('Unlock LocalAgent Companion');
        if (!ok) { setError('Authentication cancelled'); setUnlocking(false); return; }
      }
      const creds = await loadCredentials();
      if (!creds) { navigation.replace('pair'); return; }
      const client = getClient();
      client.updateConfig(creds.serverConfig);
      const r = await client.authenticate({ sessionToken: creds.sessionToken, deviceId: creds.deviceId });
      if (r.success) { navigation.replace('chat'); }
      else { setError('Session expired. Please pair again.'); await clearCredentials(); client.resetAuth(); setTimeout(() => navigation.replace('pair'), 2000); }
    } catch (e: any) { setError(e.message || 'Connection failed. Is desktop app running?'); }
    setUnlocking(false);
  };

  useEffect(() => { const t = setTimeout(unlock, 500); return () => clearTimeout(t); }, []);

  return (
    <View style={s.container}>
      <Text style={{ fontSize: 48, marginBottom: spacing.lg }}>🔒</Text>
      <Text style={s.title}>LocalAgent</Text>
      <Text style={s.sub}>Tap to unlock</Text>
      <TouchableOpacity style={[s.btn, unlocking && { opacity: 0.5 }]} onPress={unlock} disabled={unlocking}>
        <Text style={s.btnText}>{unlocking ? 'Unlocking...' : '🔓 Unlock'}</Text>
      </TouchableOpacity>
      {error ? <Text style={s.err}>{error}</Text> : null}
      <TouchableOpacity style={{ marginTop: spacing.xxxl }} onPress={async () => { await clearCredentials(); getClient().resetAuth(); navigation.replace('pair'); }}>
        <Text style={{ color: colors.textMuted, fontSize: typography.sizes.xs }}>Reset & Pair New Device</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  title: { fontSize: typography.sizes.xxl, fontWeight: typography.weights.bold, color: colors.text },
  sub: { fontSize: typography.sizes.sm, color: colors.textSecondary, marginBottom: spacing.xxl, marginTop: spacing.xs },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md },
  btnText: { color: '#fff', fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold },
  err: { color: colors.danger, fontSize: typography.sizes.sm, textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.xl },
});
