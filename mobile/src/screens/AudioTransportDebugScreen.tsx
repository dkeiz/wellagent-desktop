import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanionClient } from '../api/client';
import { parseDebugAudioProbeUrl, runDebugAudioProbeUrl } from '../services/debugAudioProbe';
import { colors, radius, spacing, typography } from '../theme';

type Props = {
  route: { params?: { url?: string } };
  navigation: any;
  getClient: () => CompanionClient;
};

type StageState = 'pending' | 'running' | 'ok' | 'fail';

type Stage = {
  key: string;
  label: string;
  marker: string;
  state: StageState;
  detail: string;
};

const BASE_STAGES: Stage[] = [
  { key: 'health', label: 'Companion Reachable', marker: 'HEALTH_OK', state: 'pending', detail: '' },
  { key: 'pair', label: 'Pair Device', marker: 'PAIR_OK', state: 'pending', detail: '' },
  { key: 'auth', label: 'Authenticate', marker: 'AUTH_OK', state: 'pending', detail: '' },
  { key: 'session', label: 'Create Chat Session', marker: 'SESSION_OK', state: 'pending', detail: '' },
  { key: 'stt', label: 'Send WAV To STT', marker: 'STT_OK', state: 'pending', detail: '' },
  { key: 'upload', label: 'Upload Audio Artifact', marker: 'UPLOAD_OK', state: 'pending', detail: '' },
  { key: 'tts', label: 'Request TTS Audio', marker: 'TTS_OK', state: 'pending', detail: '' },
  { key: 'playback', label: 'Play Returned Audio', marker: 'PLAYBACK_OK', state: 'pending', detail: '' }
];

function stageForMarker(marker: string): string | null {
  if (marker.startsWith('PAIR_')) return 'pair';
  if (marker.startsWith('STT_')) return 'stt';
  if (marker.startsWith('UPLOAD_')) return 'upload';
  if (marker.startsWith('TTS_')) return 'tts';
  if (marker.startsWith('PLAYBACK_')) return 'playback';
  if (marker === 'AUTH_OK') return 'auth';
  if (marker === 'SESSION_OK') return 'session';
  if (marker === 'HEALTH_OK' || marker === 'TRANSPORT_FAIL') return 'health';
  return null;
}

function detailText(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '';
  if (typeof details.error === 'string') return details.error;
  if (typeof details.transcript === 'string') return details.transcript;
  if (typeof details.fileName === 'string') return details.fileName;
  if (typeof details.mimeType === 'string') return details.mimeType;
  return JSON.stringify(details);
}

function nextRunning(stages: Stage[], doneKey: string): Stage[] {
  const index = stages.findIndex(stage => stage.key === doneKey);
  if (index < 0) return stages;
  const next = stages.find((stage, stageIndex) => stageIndex > index && stage.state === 'pending');
  if (!next) return stages;
  return stages.map(stage => stage.key === next.key ? { ...stage, state: 'running' } : stage);
}

export function AudioTransportDebugScreen({ route, navigation, getClient }: Props) {
  const insets = useSafeAreaInsets();
  const url = String(route.params?.url || '');
  const params = useMemo(() => parseDebugAudioProbeUrl(url), [url]);
  const [stages, setStages] = useState<Stage[]>(() => BASE_STAGES.map((stage, index) => ({
    ...stage,
    state: index === 0 ? 'running' : 'pending'
  })));
  const [status, setStatus] = useState<'running' | 'ok' | 'fail'>('running');
  const [summary, setSummary] = useState('Starting audio transport probe');

  useEffect(() => {
    let mounted = true;
    if (!params) {
      setStatus('fail');
      setSummary('Invalid debug audio transport link');
      return;
    }

    runDebugAudioProbeUrl(url, getClient(), (marker, details) => {
      if (!mounted) return;
      if (marker === 'START') {
        setSummary(`Sending audio via ${params.host}:${params.port}`);
        return;
      }
      if (marker === 'DONE_OK') {
        setStatus('ok');
        setSummary('Audio transport complete');
        return;
      }
      const key = stageForMarker(marker);
      if (!key) return;
      const failed = marker.endsWith('_FAIL') || marker === 'TRANSPORT_FAIL';
      const detail = detailText(details);
      setStages(current => {
        const nextState: StageState = failed ? 'fail' : 'ok';
        const updated = current.map(stage => stage.key === key ? {
          ...stage,
          state: nextState,
          detail
        } : stage);
        return failed ? updated : nextRunning(updated, key);
      });
      if (failed) {
        setStatus('fail');
        setSummary(detail || `${marker} failed`);
      }
    }).catch((error) => {
      if (!mounted) return;
      setStatus('fail');
      setSummary(error instanceof Error ? error.message : String(error));
    });

    return () => { mounted = false; };
  }, [getClient, params, url]);

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.replace('pair')} style={s.backBtn}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Audio Transport Test</Text>
      </View>

      <View style={[s.summary, status === 'ok' && s.summaryOk, status === 'fail' && s.summaryFail]}>
        <Text style={s.summaryLabel}>{status === 'ok' ? 'PASS' : status === 'fail' ? 'FAIL' : 'RUNNING'}</Text>
        <Text style={s.summaryText}>{summary}</Text>
        {params ? <Text style={s.target}>{params.host}:{params.port}</Text> : null}
      </View>

      <View style={s.stageList}>
        {stages.map(stage => (
          <View key={stage.key} style={s.stageRow}>
            <View style={[s.dot, stage.state === 'ok' && s.dotOk, stage.state === 'fail' && s.dotFail, stage.state === 'running' && s.dotRunning]} />
            <View style={s.stageBody}>
              <Text style={s.stageLabel}>{stage.label}</Text>
              <Text style={s.stageMarker}>{stage.marker}</Text>
              {stage.detail ? <Text style={s.stageDetail}>{stage.detail}</Text> : null}
            </View>
            <Text style={[s.stageState, stage.state === 'ok' && s.stateOk, stage.state === 'fail' && s.stateFail]}>{stage.state.toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  title: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold },
  summary: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, marginBottom: spacing.lg },
  summaryOk: { borderColor: 'rgba(81,207,102,0.45)' },
  summaryFail: { borderColor: 'rgba(255,107,107,0.45)' },
  summaryLabel: { color: colors.accentLight, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, letterSpacing: 0.8 },
  summaryText: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold, marginTop: spacing.xs },
  target: { color: colors.textMuted, fontSize: typography.sizes.sm, marginTop: spacing.xs },
  stageList: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  stageRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border, marginRight: spacing.md },
  dotRunning: { backgroundColor: colors.accent },
  dotOk: { backgroundColor: colors.success },
  dotFail: { backgroundColor: colors.danger },
  stageBody: { flex: 1, minWidth: 0 },
  stageLabel: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  stageMarker: { color: colors.textMuted, fontSize: typography.sizes.xs, marginTop: 2 },
  stageDetail: { color: colors.textSecondary, fontSize: typography.sizes.xs, marginTop: spacing.xs },
  stageState: { color: colors.textMuted, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, marginLeft: spacing.sm },
  stateOk: { color: colors.success },
  stateFail: { color: colors.danger }
});
