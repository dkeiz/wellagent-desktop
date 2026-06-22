import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanionClient } from '../api/client';
import { useSettings } from '../hooks/useSettings';
import { clearCredentials, loadCredentials } from '../services/auth';
import { clearWebCompanionConfig } from '../services/webCompanionConfig';
import { colors, spacing, radius, typography } from '../theme';

interface Props { navigation: any; getClient: () => CompanionClient; }

export function SettingsScreen({ navigation, getClient }: Props) {
  const insets = useSafeAreaInsets();
  const client = getClient();
  const { settings: s, loadSettings, setThinkingMode, setCapabilityMain, startMemoryDaemon, stopMemoryDaemon, activateAgent } = useSettings(client);

  const handleUnpair = async () => {
    try {
      const creds = await loadCredentials();
      if (creds?.deviceId) {
        await client.removeDevice(creds.deviceId);
      }
    } catch {}
    await clearCredentials();
    await clearWebCompanionConfig();
    client.resetAuth();
    client.disconnectWebSocket();
    navigation.replace('pair');
  };

  useEffect(() => { loadSettings(); }, []);

  return (
    <ScrollView style={st.container} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
      <View style={[st.header, { paddingTop: insets.top + spacing.md }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={{ color: colors.accentLight, fontSize: typography.sizes.md }}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={st.card}>
        <Text style={st.cardLabel}>ACTIVE MODEL</Text>
        <Text style={st.cardValue}>{s?.llm?.providerLabel || s?.llm?.provider || '—'}</Text>
        <Text style={st.cardSub}>{s?.llm?.model || 'No model'}</Text>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>INTELLIGENCE</Text>
        <View style={st.row}>
          <Text style={st.rowLabel}>Thinking Mode</Text>
          <Switch value={s?.llm?.thinkingMode === 'think'} onValueChange={(v) => setThinkingMode(v ? 'think' : 'off')} trackColor={{ false: colors.border, true: colors.accent }} thumbColor="#fff" />
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>CAPABILITIES</Text>
        <View style={st.row}>
          <Text style={st.rowLabel}>Tools Enabled</Text>
          <Switch value={s?.capabilities?.mainEnabled} onValueChange={setCapabilityMain} trackColor={{ false: colors.border, true: colors.accent }} thumbColor="#fff" />
        </View>
        <View style={st.row}>
          <Text style={st.rowLabel}>Active Tools</Text>
          <Text style={st.rowVal}>{s?.capabilities?.activeToolCount ?? '—'}</Text>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>VOICE / SPEECH TO TEXT</Text>
        <View style={st.row}>
          <Text style={st.rowLabel}>Active Provider</Text>
          <Text style={st.rowVal}>{s?.stt?.activeProvider || 'embedded-whisper'}</Text>
        </View>
        {(s?.stt?.tiers || []).map((t: any) => (
          <View key={t.id} style={st.row}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={[st.rowLabel, { fontSize: typography.sizes.md }]}>{t.name}</Text>
              <Text style={{ fontSize: typography.sizes.xs, color: colors.textSecondary, marginTop: 2 }}>{t.description}</Text>
            </View>
            <Text style={[st.badge, t.status === 'enabled' ? st.badgeOn : st.badgeOff]}>
              {t.status === 'enabled' ? 'Available' : 'Unavailable'}
            </Text>
          </View>
        ))}
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>BACKGROUND SERVICES</Text>
        <View style={st.row}>
          <Text style={st.rowLabel}>Memory Daemon</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={[st.badge, s?.daemons?.memoryRunning ? st.badgeOn : st.badgeOff]}>{s?.daemons?.memoryRunning ? 'Running' : 'Stopped'}</Text>
            <TouchableOpacity style={st.smallBtn} onPress={s?.daemons?.memoryRunning ? stopMemoryDaemon : startMemoryDaemon}>
              <Text style={{ fontSize: typography.sizes.xs, color: colors.textSecondary }}>{s?.daemons?.memoryRunning ? 'Stop' : 'Start'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={st.row}>
          <Text style={st.rowLabel}>Workflow Scheduler</Text>
          <Text style={[st.badge, s?.daemons?.workflowRunning ? st.badgeOn : st.badgeOff]}>{s?.daemons?.workflowRunning ? 'Running' : 'Stopped'}</Text>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>AGENTS ({s?.agents?.length ?? 0})</Text>
        {(s?.agents || []).map((a: any) => (
          <TouchableOpacity key={a.id} style={st.row} onPress={() => activateAgent(a.id)}>
            <Text style={st.rowLabel}>{a.active ? '● ' : '○ '}{a.name}</Text>
            <Text style={st.rowVal}>{a.type}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={st.logout} onPress={handleUnpair}>
        <Text style={{ color: colors.danger, fontSize: typography.sizes.md, fontWeight: typography.weights.medium }}>Unpair & Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold, color: colors.text },
  backBtn: { width: 60 },
  card: { margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  cardLabel: { fontSize: typography.sizes.xs, color: colors.accentLight, letterSpacing: 1, fontWeight: typography.weights.semibold },
  cardValue: { fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold, color: colors.text, marginTop: 2 },
  cardSub: { fontSize: typography.sizes.sm, color: colors.textSecondary, marginTop: 2 },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  sectionTitle: { fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold, color: colors.textSecondary, padding: spacing.md, paddingBottom: spacing.xs, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: typography.sizes.md, color: colors.text, flex: 1 },
  rowVal: { fontSize: typography.sizes.sm, color: colors.textSecondary },
  badge: { fontSize: typography.sizes.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' },
  badgeOn: { backgroundColor: 'rgba(81,207,102,0.15)', color: colors.success },
  badgeOff: { backgroundColor: 'rgba(85,85,112,0.15)', color: colors.textMuted },
  smallBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  logout: { margin: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(255,107,107,0.1)', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,107,107,0.3)' },
});
