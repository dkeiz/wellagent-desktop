# Android Companion App

This app lives in `mobile/` and now uses the browser companion UI as its default surface. The native app only owns connection setup, Android permissions, and the WebView container. The loaded experience is:

```text
http(s)://<desktop-host>:<port>/companion/web
```

## Current App Shape

- Expo SDK 54 / React Native 0.81.
- `react-native-webview` embeds the existing web companion.
- The first screen stores the desktop companion host, port, and HTTPS mode.
- After setup, the app opens the web companion full-screen.
- Inside the Android app, the web Mic button uses a native recording bridge instead of browser `getUserMedia`.
- Android back goes back inside the WebView when possible; from the first web page it returns to server setup.
- Android mobile browsers get a small dismissible app prompt. Download appears only when a local APK exists on the desktop.
- The old native chat screens are still in the source tree, but they are no longer the default app route.

## Requirements

- Node.js and npm installed.
- Android Studio installed with Android SDK platform tools.
- JDK compatible with the Android Gradle plugin used by Expo SDK 54.
- A physical Android device or emulator.
- Desktop LocalAgent running on the same LAN.
- Companion server enabled on the desktop app.
- For browser microphone capture: Android browser HTTPS setup enabled on desktop, LocalAgent CA installed and trusted on the Android device, and the browser pointed at the HTTPS companion port.
- For app microphone capture without certificate setup: install the Android app and connect it to HTTP or HTTPS companion.

## Microphone Reality

The mobile browser still follows Chromium secure-origin rules. For browser `getUserMedia` over LAN, use HTTPS with a trusted LocalAgent CA.

The Android app avoids that browser mic path. The WebView companion sends Mic actions to native React Native code, the app records through Android `RECORD_AUDIO`, then the web companion uploads the recorded audio through its normal authenticated API flow. This means HTTP can be usable for app mic capture even when browser mic capture is blocked.

Default ports:

- HTTP companion: `8790`
- HTTPS companion: `8791`

## Cleartext Threat Model

HTTP is kept only as a LAN bootstrap and fallback mode for devices that have not installed the LocalAgent companion CA yet. The app-level connection guard only accepts cleartext hosts that look local: localhost, `.local`, private IPv4 ranges, loopback, or link-local addresses. Once HTTPS is selected, the Android WebView blocks mixed content so a secure companion page cannot silently load HTTP subresources.

Pairing, bearer authentication, artifact access, and native voice bridge messages are still authenticated at the application layer. The WebView also restricts top-level navigation and native bridge messages to the paired companion origin, and native voice commands must echo the per-WebView bridge nonce.

## Desktop Setup

1. Start LocalAgent desktop.
2. Enable Companion.
3. Run the Android browser HTTPS setup from desktop settings.
4. Open the bootstrap URL on the Android device if the CA is not installed yet.
5. Install and trust the `LocalAgent-Companion-CA.crt` certificate.
6. Open the Android app and enter the desktop LAN IP plus HTTPS port.

## Development Run

From the repo root:

```powershell
cd mobile
npm install
npx expo start --android
```

For a native debug build:

```powershell
cd mobile
npx expo run:android
```

## Production Build

Use an Expo/EAS Android build or a local prebuild flow.

```powershell
cd mobile
npx expo prebuild --platform android
npx expo run:android --variant release
```

If using EAS, configure signing first, then run:

```powershell
cd mobile
npx eas build --platform android
```

## Desktop APK Download Handoff

The desktop companion exposes a non-disruptive Android app handoff:

- `localagent-companion://companion?...` opens the app if it is installed.
- `/companion/app/android/status` reports whether a desktop-hosted APK is available.
- `/companion/app/android/download` downloads the newest APK from `releases/android/` first, then falls back to `mobile/dist/`, `dist/android/`, or `dist/`.

Place the Git-tracked release APK in `releases/android/`:

```powershell
releases\android\localagent-companion-0.2.0-beta.1.apk
releases\android\localagent-companion-0.2.0-beta.1.apk.metadata.json
```

The mobile browser prompt stays hidden for seven days after the user taps Later.

## Files Changed For Web Companion Default

- `mobile/App.tsx`
- `mobile/src/screens/WebCompanionConnectScreen.tsx`
- `mobile/src/screens/WebCompanionScreen.tsx`
- `mobile/src/services/webCompanionConfig.ts`
- `mobile/app.json`
- `mobile/package.json`
- `mobile/package-lock.json`
- `mobile/src/services/voice.ts`
- `src/main/companion/companion-web/assets/voice-input.js`
- `src/main/companion/companion-web/assets/app-install.js`
- `src/main/companion/companion-web/assets/app-install.css`
- `src/main/companion/companion-bootstrap/index.html`
- `src/main/companion/companion-api-server.js`

## Validation Checklist

- App opens the native server setup screen on first launch.
- App loads `/companion/web` after host and port are saved.
- Pairing happens inside the web companion page.
- Mobile web companion layout matches the browser companion styles.
- WebView can reload after desktop companion restart.
- HTTP loads for setup fallback.
- HTTPS loads after Android CA trust.
- Microphone button works on HTTPS with Android mic permission granted.
- Microphone button works in the Android app over HTTP through the native recording bridge.
- Android mobile browser shows the app prompt without blocking normal browser use.


