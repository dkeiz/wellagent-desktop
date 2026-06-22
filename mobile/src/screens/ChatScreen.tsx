import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ActivityIndicator, Alert, Linking, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Image, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { CompanionClient } from '../api/client';
import { useChat, type ChatMessage } from '../hooks/useChat';
import { playVoiceUrl, startVoiceRecording, stopVoicePlayback, stopVoiceRecording, type VoicePlayback, type VoiceRecording } from '../services/voice';
import { colors, spacing, radius, typography } from '../theme';

interface Props { navigation: any; getClient: () => CompanionClient; }

function companionPalette(theme: string) {
  if (theme === 'light') {
    return { bg: '#edf1f7', surface: '#ffffff', surface2: '#f3f6fc', surface3: '#e8edf5', border: '#d5dce8', text: '#172238', textSecondary: '#65748b', accent: '#216fce' };
  }
  if (theme === 'solar') {
    return { bg: '#f2ead6', surface: '#fffaf0', surface2: '#faf1dd', surface3: '#eadcbf', border: '#d8c69f', text: '#342817', textSecondary: '#755f39', accent: '#9b621f' };
  }
  return { bg: colors.bg, surface: colors.surface, surface2: colors.surface2, surface3: colors.surface3, border: colors.border, text: colors.text, textSecondary: colors.textSecondary, accent: colors.accent };
}

type CompanionPalette = ReturnType<typeof companionPalette>;
type ThinkingVisibility = 'show' | 'hide' | 'collapse';
const CURRENT_ANDROID_VERSION_CODE = 2;
const STICKY_BOTTOM_THRESHOLD = 80;

function ThinkingBlock({ content, defaultOpen, palette }: { content: string; defaultOpen: boolean; palette: CompanionPalette }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [content, defaultOpen]);

  return (
    <View style={[st.thinkingBlock, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setOpen(prev => !prev)}
        style={[st.thinkingToggle, { backgroundColor: palette.surface3, borderBottomColor: open ? palette.border : 'transparent' }]}
      >
        <Text style={[st.thinkingChevron, { color: palette.textSecondary }]}>{open ? '▾' : '▸'}</Text>
        <Text style={[st.thinkingTitle, { color: palette.textSecondary }]}>Thinking</Text>
      </TouchableOpacity>
      {open ? <Text style={[st.thinkingText, { color: palette.textSecondary }]}>{content}</Text> : null}
    </View>
  );
}

function CameraGlyph({ color }: { color: string }) {
  return (
    <View style={st.cameraGlyph}>
      <View style={[st.cameraGlyphTop, { backgroundColor: color }]} />
      <View style={[st.cameraGlyphBody, { borderColor: color }]}>
        <View style={[st.cameraGlyphLensOuter, { borderColor: color }]}>
          <View style={[st.cameraGlyphLensInner, { backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={st.micGlyph}>
      <View style={[st.micGlyphHead, { borderColor: color }]} />
      <View style={[st.micGlyphStem, { backgroundColor: color }]} />
      <View style={[st.micGlyphBase, { backgroundColor: color }]} />
    </View>
  );
}

function StopGlyph({ color }: { color: string }) {
  return <View style={[st.stopGlyph, { backgroundColor: color }]} />;
}

export function ChatScreen({ navigation, getClient }: Props) {
  const insets = useSafeAreaInsets();
  const client = getClient();
  const { sessions, activeSessionId, messages, generating, loadSessions, loadMessages, sendMessage, stopGeneration, createSession, switchSession, syncActiveSession, handleWsMessage } = useChat(client);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);
  const shouldStickToBottomRef = useRef(true);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const playbackRef = useRef<VoicePlayback | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState('dark');
  const [thinkingVisibility, setThinkingVisibility] = useState<ThinkingVisibility>('show');
  const [wsConnected, setWsConnected] = useState(false);
  const wsMessageHandlerRef = useRef<(msg: any) => void>(() => {});
  const pollInFlightRef = useRef(false);
  const sidebarAnim = useRef(new Animated.Value(0)).current;
  const palette = companionPalette(uiTheme);

  const showVoiceFailure = useCallback((message: string) => {
    Alert.alert('Voice message failed', message || 'Voice message was not sent.');
  }, []);

  const animateSidebar = useCallback((open: boolean) => {
    Animated.timing(sidebarAnim, {
      toValue: open ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
    setSidebarOpen(open);
  }, [sidebarAnim]);

  const refreshCompanionSnapshot = useCallback(async () => {
    try {
      const result = await client.getSettings();
      const skinEnabled = result.snapshot?.ui?.skin?.enabled !== false && result.snapshot?.ui?.skin?.id !== 'default';
      const theme = String(
        skinEnabled
          ? (result.snapshot?.ui?.skin?.theme || result.snapshot?.ui?.theme || 'dark')
          : (result.snapshot?.ui?.theme || result.snapshot?.ui?.skin?.theme || 'dark')
      ).trim() || 'dark';
      const visibility = String(result.snapshot?.llm?.thinkingVisibility || (result.snapshot?.llm?.showThinking === false ? 'hide' : 'show')).trim();
      setUiTheme(theme);
      setThinkingVisibility(visibility === 'hide' ? 'hide' : visibility === 'collapse' ? 'collapse' : 'show');
    } catch (_) {}
  }, [client]);

  useEffect(() => {
    wsMessageHandlerRef.current = (msg: any) => {
      handleWsMessage(msg);
      if (msg?.type !== 'settings-change') return;
      const scope = String(msg?.payload?.scope || '').trim();
      if (!scope || scope === 'ui' || scope === 'llm') refreshCompanionSnapshot();
    };
  }, [handleWsMessage, refreshCompanionSnapshot]);

  const handleSocketMessage = useCallback((msg: any) => {
    wsMessageHandlerRef.current(msg);
  }, []);

  const scrollToMessageEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const handleMessagesScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent || {};
    if (!contentOffset || !contentSize || !layoutMeasurement) return;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    shouldStickToBottomRef.current = distanceFromBottom <= STICKY_BOTTOM_THRESHOLD;
  }, []);

  const handleMessagesContentSizeChange = useCallback(() => {
    if (shouldStickToBottomRef.current) scrollToMessageEnd();
  }, [scrollToMessageEnd]);
  const refreshConversationFallback = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const state = await loadSessions();
      const targetId = state.currentSessionId || activeSessionId;
      if (targetId) await loadMessages(targetId);
    } catch (_) {
    } finally {
      pollInFlightRef.current = false;
    }
  }, [activeSessionId, loadMessages, loadSessions]);
  const updatePromptShownRef = useRef(false);
  const checkAndroidUpdate = useCallback(async () => {
    if (updatePromptShownRef.current) return;
    try {
      const status = await client.getAndroidAppStatus();
      const app = status?.androidApp;
      if (!status?.success || !app?.available || !app.downloadUrl) return;
      if (Number(app.versionCode || 0) <= CURRENT_ANDROID_VERSION_CODE) return;
      updatePromptShownRef.current = true;
      Alert.alert(
        'Update available',
        `Version ${app.versionName || app.versionCode} is available.`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Download', onPress: () => Linking.openURL(client.resolveUrl(app.downloadUrl)).catch(() => {}) }
        ]
      );
    } catch (_) {}
  }, [client]);

  useEffect(() => {
    loadSessions();
    refreshCompanionSnapshot();
    checkAndroidUpdate();
    client.connectWebSocket(handleSocketMessage, (c) => {
      const next = Boolean(c);
      setWsConnected((previous) => {
        if (previous !== next) console.log('[WS]', next ? 'Connected' : 'Disconnected');
        return next;
      });
    });
    return () => {
      client.disconnectWebSocket();
      stopVoicePlayback(playbackRef.current);
      playbackRef.current = null;
      setSpeakingIndex(null);
      setWsConnected(false);
    };
  }, [checkAndroidUpdate, client, handleSocketMessage, loadSessions, refreshCompanionSnapshot]);

  useEffect(() => {
    if (wsConnected) return undefined;
    refreshConversationFallback().catch(() => null);
    const fallbackTimer = setInterval(() => {
      refreshConversationFallback().catch(() => null);
    }, 5000);
    return () => clearInterval(fallbackTimer);
  }, [refreshConversationFallback, wsConnected]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      if (cmd === 'new') { await createSession(); return; }
      if (cmd === 'stop') { await stopGeneration(); return; }
      if (cmd === 'settings') { navigation.navigate('settings'); return; }
      if (cmd === 'sessions') { animateSidebar(true); return; }
      if (cmd === 'think') { await client.setThinkingMode(args[0] === 'off' ? 'off' : 'think'); return; }
      return;
    }
    shouldStickToBottomRef.current = true;
    sendMessage(text);
  };

  const ensureVoiceReady = useCallback(async () => {
    if (!client.isAuthenticated()) {
      throw new Error('pair with desktop before recording voice');
    }
    const result = await client.getSettings();
    if (!result?.success) {
      throw new Error(`voice service unavailable: ${String((result as any)?.error || 'desktop settings unavailable')}`);
    }
    const permissions = result.snapshot?.companion?.permissions || {};
    if (permissions.mediaUpload === false) {
      throw new Error('voice upload is not permitted for this device');
    }
  }, [client]);

  const handleVoice = async () => {
    if (transcribing) return;

    if (!recordingRef.current) {
      try {
        await ensureVoiceReady();
        recordingRef.current = await startVoiceRecording();
        setRecording(true);
      } catch (error: unknown) {
        recordingRef.current = null;
        setRecording(false);
        const message = error instanceof Error ? error.message : 'recording failed';
        console.warn('[voice] recording failed', message);
        showVoiceFailure(message);
      }
      return;
    }

    setRecording(false);
    setTranscribing(true);
    try {
      const audio = await stopVoiceRecording(recordingRef.current);
      recordingRef.current = null;

      const result = await client.sendVoiceMessage(audio.data, audio.contentType);
      if (!result?.success) {
        throw new Error(result?.error || 'voice send failed');
      }
      const transcript = String(result.transcript || result.text || '').trim();
      if (!transcript) {
        throw new Error('desktop returned empty transcript');
      }
      shouldStickToBottomRef.current = true;
      setInput('');
      const resultSessionId = String(result.sessionId || '').trim();
      if (resultSessionId) syncActiveSession(resultSessionId);
      await Promise.all([resultSessionId ? loadMessages(resultSessionId) : loadMessages(), loadSessions()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'voice send failed';
      console.warn('[voice] send failed', message);
      showVoiceFailure(message);
    } finally {
      recordingRef.current = null;
      setRecording(false);
      setTranscribing(false);
    }
  };

  const handleImageUpload = async () => {
    if (!activeSessionId) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setInput('Image error: media library permission was denied');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      const asset = picked.assets[0];
      const response = await fetch(asset.uri);
      await client.uploadMedia(
        await response.arrayBuffer(),
        asset.mimeType || 'image/jpeg',
        activeSessionId
      );
      await loadMessages();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'image upload failed';
      setInput(`Image error: ${message}`);
    }
  };

  const handleSpeakMessage = async (index: number, text: string) => {
    if (!String(text || '').trim()) return;

    if (speakingIndex === index) {
      await stopVoicePlayback(playbackRef.current);
      playbackRef.current = null;
      setSpeakingIndex(null);
      return;
    }

    setSpeakingIndex(index);
    try {
      await stopVoicePlayback(playbackRef.current);
      playbackRef.current = null;
      const result = await client.speakText(text);
      if (!result.success || (!result.audioBase64 && !result.audioUrl && !result.audioPath)) {
        throw new Error(result.error || 'speech playback failed');
      }
      const voiceUrl = result.audioBase64
        ? `data:${result.mimeType || 'audio/wav'};base64,${result.audioBase64}`
        : client.resolveUrl(result.audioPath || result.audioUrl || '');
      const sound = await playVoiceUrl(voiceUrl);
      playbackRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          setSpeakingIndex(null);
          return;
        }
        if (status.didJustFinish) {
          stopVoicePlayback(playbackRef.current);
          playbackRef.current = null;
          setSpeakingIndex(null);
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'speech playback failed';
      console.warn('[voice] playback failed', message);
      await stopVoicePlayback(playbackRef.current);
      playbackRef.current = null;
      setSpeakingIndex(null);
    }
  };

  const playAttachment = async (fileName: string) => {
    if (!activeSessionId) return;
    await stopVoicePlayback(playbackRef.current);
    playbackRef.current = await playVoiceUrl(await client.getArtifactUrlWithTicket(activeSessionId, fileName));
  };

  const renderMessageContent = (item: ChatMessage) => {
    const rawContent = String(item.content || '');
    const attachmentMatch = rawContent.match(/^\[(Image attached|Voice message|File attached):\s*([^\]]+)\]\s*/i);
    const displayContent = attachmentMatch ? rawContent.slice(attachmentMatch[0].length) : rawContent;
    const parts = displayContent.split(/<think>([\s\S]*?)<\/think>/i);
    const textStyle = item.role === 'user' ? { color: '#fff' } : item.role === 'system' ? st.sysText : { color: palette.text };
    return (
      <View>
        {attachmentMatch && activeSessionId && attachmentMatch[1] === 'Image attached' ? (
          <Image source={{ uri: client.getArtifactUrl(activeSessionId, attachmentMatch[2]) }} style={st.msgImage} resizeMode="contain" />
        ) : null}
        {attachmentMatch && activeSessionId && attachmentMatch[1] === 'Voice message' ? (
          <TouchableOpacity style={st.voiceAttachment} onPress={() => playAttachment(attachmentMatch[2])}>
            <Text style={st.voiceAttachmentText}>▶ Play voice message</Text>
          </TouchableOpacity>
        ) : null}
        {parts.map((part, partIndex) => {
          if (!part) return null;
          const isThinking = partIndex % 2 === 1;
          if (isThinking) {
            if (thinkingVisibility === 'hide') return null;
            const trimmedPart = part.trim();
            if (!trimmedPart) return null;
            return <ThinkingBlock key={partIndex} content={trimmedPart} defaultOpen={thinkingVisibility === 'show'} palette={palette} />;
          }
          return <Text key={partIndex} style={[st.msgText, textStyle]}>{part}</Text>;
        })}
      </View>
    );
  };

  const renderMsg = ({ item, index }: { item: ChatMessage; index: number }) => (
    <View style={[st.bubble, item.role === 'user' ? [st.bubbleUser, { backgroundColor: palette.accent }] : item.role === 'system' ? st.bubbleSys : [st.bubbleBot, { backgroundColor: palette.surface2, borderColor: palette.border }]]}>
      {renderMessageContent(item)}
      {item.role === 'assistant' && item.content.trim() ? (
        <View style={st.bubbleActions}>
          <TouchableOpacity style={[st.bubbleActionBtn, speakingIndex === index && st.bubbleActionBtnActive]} onPress={() => handleSpeakMessage(index, item.content)}>
            <Text style={st.bubbleActionText}>{speakingIndex === index ? '■' : '▶'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  const sidebarTranslateX = sidebarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-300, 0],
  });

  const scrimOpacity = sidebarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  const renderEmptyState = () => (
    <View style={st.emptyContainer}>
      <Text style={st.emptyEmoji}>🛰</Text>
      <Text style={[st.emptyTitle, { color: palette.text }]}>Start a new conversation</Text>
      <Text style={[st.emptySub, { color: palette.textSecondary }]}>Send a message, record voice, or pick an image to begin.</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[st.container, { backgroundColor: palette.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={[st.header, { backgroundColor: palette.surface, borderBottomColor: palette.border, paddingTop: insets.top + spacing.xs }]}>
        <TouchableOpacity onPress={() => animateSidebar(true)} style={st.headerBtn}>
          <Text style={st.headerAction}>☰</Text>
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={[st.headerTitle, { color: palette.text }]}>LocalAgent</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('settings')} style={st.headerBtn}>
          <Text style={[st.headerAction, st.headerActionSecondary, { color: palette.textSecondary }]}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Session Tabs */}
      <ScrollView horizontal style={[st.tabs, { backgroundColor: palette.surface, borderBottomColor: palette.border }]} showsHorizontalScrollIndicator={false}>
        {sessions.slice(0, 10).map((s) => (
          <TouchableOpacity key={s.id} style={[st.tab, s.id === activeSessionId && { backgroundColor: palette.accent }]} onPress={() => switchSession(s.id)}>
            <Text style={[st.tabText, { color: palette.textSecondary }, s.id === activeSessionId && { color: '#fff' }]}>{(s.first_message || s.title || 'Chat').slice(0, 20)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[st.tabAdd, { borderColor: palette.border }]} onPress={createSession}>
          <Text style={[st.tabAddText, { color: palette.textSecondary }]}>+</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        renderItem={renderMsg}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
        ListEmptyComponent={renderEmptyState}
        keyboardShouldPersistTaps="handled"
        onScroll={handleMessagesScroll}
        scrollEventThrottle={80}
        onContentSizeChange={handleMessagesContentSizeChange}
        onLayout={handleMessagesContentSizeChange}
      />

      {/* Status indicators */}
      {generating && (
        <View style={st.statusBar}>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
            Generating...
          </Text>
        </View>
      )}

      {/* Input Bar */}
      <View style={[st.inputBar, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={[st.input, { backgroundColor: palette.surface2, borderColor: palette.border, color: palette.text }]}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline={false}
        />
        <TouchableOpacity style={[st.actionBtn, { backgroundColor: palette.surface2, borderColor: palette.border }]} onPress={handleImageUpload} disabled={!activeSessionId}>
          <CameraGlyph color={palette.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.actionBtn, { backgroundColor: palette.surface2, borderColor: palette.border }, recording && st.micActive, transcribing && st.micBusy]}
          onPress={handleVoice}
          disabled={transcribing}
        >
          {transcribing ? <ActivityIndicator size="small" color={palette.textSecondary} /> : recording ? <StopGlyph color="#fff" /> : <MicGlyph color={palette.textSecondary} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.sendBtn, { backgroundColor: palette.accent }, generating && { backgroundColor: colors.danger }]}
          onPress={generating ? stopGeneration : handleSend}
        >
          <Text style={st.sendBtnText}>{generating ? '⏹' : '→'}</Text>
        </TouchableOpacity>
      </View>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <View style={st.sidebarOverlay}>
          <Animated.View style={[st.sidebarScrim, { opacity: scrimOpacity }]}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => animateSidebar(false)} />
          </Animated.View>
          <Animated.View style={[st.sidebarPanel, { backgroundColor: palette.surface, borderRightColor: palette.border, paddingTop: insets.top + spacing.lg, transform: [{ translateX: sidebarTranslateX }] }]}>
            <View style={st.sidebarHead}>
              <Text style={[st.sidebarTitle, { color: palette.text }]}>Workspace</Text>
              <TouchableOpacity onPress={() => animateSidebar(false)}>
                <Text style={st.headerAction}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[st.sidebarPrimary, { backgroundColor: palette.accent }]} onPress={async () => { await createSession(); animateSidebar(false); }}>
              <Text style={st.sidebarPrimaryText}>+ New Chat</Text>
            </TouchableOpacity>
            <Text style={[st.sidebarSection, { color: palette.textSecondary }]}>RECENT CHATS</Text>
            <ScrollView style={st.sidebarList}>
              {sessions.slice(0, 20).map((s) => (
                <TouchableOpacity key={s.id} style={[st.sidebarItem, { backgroundColor: palette.surface2, borderColor: palette.border }, s.id === activeSessionId && { backgroundColor: palette.accent, borderColor: palette.accent }]} onPress={() => { switchSession(s.id); animateSidebar(false); }}>
                  <Text style={[st.sidebarItemText, { color: palette.text }, s.id === activeSessionId && { color: '#fff' }]} numberOfLines={1}>{(s.first_message || s.title || 'Chat').slice(0, 42)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[st.sidebarSettings, { backgroundColor: palette.surface2, borderColor: palette.border }]} onPress={() => { animateSidebar(false); navigation.navigate('settings'); }}>
              <Text style={[st.sidebarItemText, { color: palette.text }]}>⚙ Settings</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerAction: { color: colors.accentLight, fontSize: 22, lineHeight: 22, fontWeight: typography.weights.semibold, textAlign: 'center', includeFontPadding: false },
  headerActionSecondary: { fontSize: 20, lineHeight: 20 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerTitle: { fontSize: typography.sizes.lg, fontWeight: typography.weights.bold, color: colors.text },
  sidebarOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, flexDirection: 'row' },
  sidebarScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  sidebarPanel: { width: 300, maxWidth: '82%', backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, padding: spacing.lg, zIndex: 2 },
  sidebarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  sidebarTitle: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold },
  sidebarPrimary: { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  sidebarPrimaryText: { color: '#fff', fontWeight: typography.weights.bold, fontSize: typography.sizes.md },
  sidebarSection: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, marginBottom: spacing.sm, letterSpacing: 1 },
  sidebarList: { flex: 1 },
  sidebarItem: { padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, backgroundColor: colors.surface2 },
  sidebarItemText: { color: colors.text, fontSize: typography.sizes.sm },
  sidebarSettings: { padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, marginTop: spacing.md },
  tabs: { flexGrow: 0, maxHeight: 44, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, marginRight: spacing.xs, justifyContent: 'center' },
  tabText: { fontSize: typography.sizes.xs, color: colors.textSecondary },
  tabAdd: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  tabAddText: { fontSize: 16, lineHeight: 16, textAlign: 'center', includeFontPadding: false },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.sm },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: spacing.xs },
  bubbleBot: { alignSelf: 'flex-start', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: spacing.xs },
  bubbleSys: { alignSelf: 'center' },
  msgText: { fontSize: typography.sizes.md, lineHeight: 22 },
  msgImage: { width: 240, height: 180, borderRadius: radius.sm, marginBottom: spacing.sm, backgroundColor: colors.surface },
  voiceAttachment: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm },
  voiceAttachmentText: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  thinkingBlock: { marginVertical: spacing.sm, borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden' },
  thinkingToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1 },
  thinkingChevron: { width: 12, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  thinkingTitle: { fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  thinkingText: { padding: spacing.sm, fontSize: typography.sizes.sm, lineHeight: 18 },
  bubbleActions: { marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'flex-end' },
  bubbleActionBtn: { minWidth: 36, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  bubbleActionBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleActionText: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  sysText: { color: colors.textSecondary, fontStyle: 'italic', fontSize: typography.sizes.sm },
  statusBar: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xs },
  inputBar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: typography.sizes.md, maxHeight: 80 },
  actionBtn: { borderRadius: radius.md, width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  micActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  micBusy: { opacity: 0.65 },
  actionBtnText: { fontSize: 18, lineHeight: 20, textAlign: 'center', includeFontPadding: false },
  cameraGlyph: { width: 20, height: 16, alignItems: 'center', justifyContent: 'flex-start' },
  cameraGlyphTop: { width: 8, height: 3, borderRadius: 2, marginBottom: 1 },
  cameraGlyphBody: { width: 18, height: 12, borderRadius: 3, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  cameraGlyphLensOuter: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.4, alignItems: 'center', justifyContent: 'center' },
  cameraGlyphLensInner: { width: 2.5, height: 2.5, borderRadius: 2 },
  micGlyph: { width: 16, height: 18, alignItems: 'center', justifyContent: 'center' },
  micGlyphHead: { width: 8, height: 10, borderRadius: 4, borderWidth: 1.6 },
  micGlyphStem: { width: 2, height: 4, borderRadius: 1, marginTop: 1 },
  micGlyphBase: { width: 10, height: 2, borderRadius: 1, marginTop: 1 },
  stopGlyph: { width: 12, height: 12, borderRadius: 2 },
  sendBtn: { backgroundColor: colors.accent, borderRadius: radius.md, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  sendBtnText: { color: '#fff', fontSize: 18, lineHeight: 18, fontWeight: typography.weights.bold, textAlign: 'center', includeFontPadding: false },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 300, padding: spacing.xxl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold, textAlign: 'center', marginBottom: spacing.xs },
  emptySub: { fontSize: typography.sizes.sm, textAlign: 'center', lineHeight: 20 }
});
