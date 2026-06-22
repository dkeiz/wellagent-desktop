import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Linking, LogBox, View, Text } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/theme';
import { CompanionClient } from './src/api/client';
import { PairScreen } from './src/screens/PairScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WebCompanionConnectScreen } from './src/screens/WebCompanionConnectScreen';
import { WebCompanionScreen } from './src/screens/WebCompanionScreen';
import { AudioTransportDebugScreen } from './src/screens/AudioTransportDebugScreen';
import {
  loadWebCompanionConfig,
  parseWebCompanionLaunchUrl,
  saveWebCompanionConfig,
  type WebCompanionConfig
} from './src/services/webCompanionConfig';
import { loadCredentials } from './src/services/auth';
import { isDebugAudioProbeUrl, markDebugAudioProbeAppReady } from './src/services/debugAudioProbe';

export type RootStackParamList = {
  pair: { launchConfig?: WebCompanionConfig } | undefined;
  chat: undefined;
  settings: undefined;
  webConnect: undefined;
  webCompanion: { config: WebCompanionConfig };
  debugAudioTransport: { url: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const LocalAgentDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

type AppProps = {
  initialUrl?: unknown;
  [key: string]: unknown;
};

export default function App(props: AppProps) {
  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('pair');
  const [initialDebugAudioUrl, setInitialDebugAudioUrl] = useState('');
  const clientRef = useRef<CompanionClient>(new CompanionClient({ host: '', port: 8790, useTls: false }));
  const navigationRef = useRef<any>(null);
  const nativeInitialUrl = typeof props?.initialUrl === 'string' ? props.initialUrl : '';

  useEffect(() => {
    LogBox.ignoreLogs([
      '[expo-av]: Expo AV has been deprecated and will be removed in SDK 54.'
    ]);
    markDebugAudioProbeAppReady();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Check for saved credentials (paired device)
        const creds = await loadCredentials();
        if (creds?.sessionToken && creds.serverConfig?.host) {
          clientRef.current.updateConfig(creds.serverConfig);
          try {
            const auth = await clientRef.current.authenticate({
              sessionToken: creds.sessionToken,
              deviceId: creds.deviceId
            });
            if (auth.success && mounted) {
              setInitialRoute('chat');
            }
          } catch {
            clientRef.current.resetAuth();
            // Auth failed, go to pairing
          }
        }

        // Also try deep link config
        const launchUrl = nativeInitialUrl || await Linking.getInitialURL();
        if (launchUrl) {
          console.log(`LOCALAGENT_AUDIO_PROBE INITIAL_URL ${launchUrl}`);
        } else {
          console.log('LOCALAGENT_AUDIO_PROBE INITIAL_URL_MISSING');
        }
        if (isDebugAudioProbeUrl(launchUrl)) {
          if (mounted) {
            setInitialDebugAudioUrl(String(launchUrl || ''));
            setInitialRoute('debugAudioTransport');
            setReady(true);
          }
          return;
        }
        const launchConfig = parseWebCompanionLaunchUrl(launchUrl);
        if (launchConfig) {
          clientRef.current.updateConfig({
            host: launchConfig.host,
            port: launchConfig.port,
            useTls: launchConfig.useTls
          });
          await saveWebCompanionConfig(launchConfig);
        }
      } catch {}
      if (mounted) setReady(true);
    })();
    return () => { mounted = false; };
  }, [nativeInitialUrl]);

  // Handle incoming deep links while running
  useEffect(() => {
    const sub = Linking.addEventListener('url', async (event) => {
      if (isDebugAudioProbeUrl(event.url)) {
        navigationRef.current?.navigate('debugAudioTransport', { url: event.url });
        return;
      }
      const config = parseWebCompanionLaunchUrl(event.url);
      if (!config) return;
      clientRef.current.updateConfig({
        host: config.host,
        port: config.port,
        useTls: config.useTls
      });
      saveWebCompanionConfig(config).catch(() => {});
      navigationRef.current?.navigate('pair', { launchConfig: config });
    });
    return () => sub.remove();
  }, []);

  const getClient = useCallback(() => clientRef.current, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 72, marginBottom: 16 }}>🛰</Text>
        <Text style={{ fontSize: 28, fontWeight: 'bold', color: colors.accent }}>LocalAgent</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 8 }}>Initializing companion...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={LocalAgentDarkTheme}>
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="pair">
            {(props) => <PairScreen {...props} getClient={getClient} />}
          </Stack.Screen>
          <Stack.Screen name="chat">
            {(props) => <ChatScreen {...props} getClient={getClient} />}
          </Stack.Screen>
          <Stack.Screen name="settings">
            {(props) => <SettingsScreen {...props} getClient={getClient} />}
          </Stack.Screen>
          <Stack.Screen name="webConnect">
            {(props: any) => (
              <WebCompanionConnectScreen
                {...props}
                initialConfig={null}
                onConnect={(cfg) => props.navigation.navigate('webCompanion', { config: cfg })}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="webCompanion">
            {(props: any) => (
              <WebCompanionScreen
                {...props}
                config={props.route.params.config}
                onChangeServer={() => props.navigation.navigate('webConnect')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="debugAudioTransport" initialParams={{ url: initialDebugAudioUrl }}>
            {(props: any) => <AudioTransportDebugScreen {...props} getClient={getClient} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
