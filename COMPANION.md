# Companion Guide

This document describes the current companion system in LocalAgent: what it is, how to use it, how it is wired, and what limitations still exist.

## What The Companion Is

The companion is a small LAN-facing server started by the desktop app. It lets a phone connect to the same LocalAgent instance in two ways:

- A browser client served directly by the desktop app
- A React Native / Expo mobile client in `mobile/`

The intended use is:

- quick connectivity testing from mobile Chrome or Safari without installing anything
- Android development without blocking on app packaging
- rough iPhone / iPad support through the browser client
- one backend with two frontends instead of separate mobile-specific logic

## Current Status

The companion is usable now for:

- pairing devices from desktop settings
- browser access from a phone on the same network
- native Expo client access
- chat and session switching
- settings snapshot viewing
- device list and device removal
- voice input by sending recorded audio to the desktop app for STT
- assistant speech playback by asking the backend for a playable audio clip

It is still alpha. Expect protocol and UI changes.

## Main Pieces

### Desktop server

The desktop app starts an HTTP + WebSocket companion server from the Electron main process.

Main backend pieces:

- `src/main/companion-api-server.js`
- `src/main/companion-auth.js`
- `src/main/companion-permissions.js`
- `src/main/companion-network-utils.js`

### Desktop settings UI

The desktop renderer exposes companion controls in Settings.

Main UI pieces:

- `src/renderer/index.html`
- `src/renderer/app.js`
- `src/renderer/electron-api.js`

### Browser client

The browser client is served by the desktop app itself at `/companion/web`.

It now has two responsive modes on the same codebase:

- compact mobile web mode for phone browsers
- desktop web mode for wiring checks from a normal desktop browser

Main browser pieces:

- `src/main/companion-web/index.html`
- `src/main/companion-web/assets/client.js`
- `src/main/companion-web/assets/app.js`
- `src/main/companion-web/assets/styles.css`
- `src/main/companion-web-static.js`

### Native mobile client

The native companion app lives in:

- `mobile/`

Main mobile pieces:

- `mobile/App.tsx`
- `mobile/src/api/client.ts`
- `mobile/src/screens/ChatScreen.tsx`
- `mobile/src/services/voice.ts`

### Shared contract

Shared request / response / WebSocket types live in:

- `shared/companion-types.d.ts`

## How To Enable It

In the desktop app:

1. Open `Settings`
2. Find `Companion Access`
3. Turn on `Enable browser/mobile companion server`
4. Set host and port if needed
5. Click `Apply Network Settings`

Recommended defaults:

- Host: `0.0.0.0`
- Port: `8790`

Why `0.0.0.0`:

- `0.0.0.0` allows phones on your LAN to connect
- `127.0.0.1` or `localhost` means local-only access from the desktop machine

If the server is bound to loopback only, phone access will not work.

## How Pairing Works

Pairing is explicit. A phone cannot just browse in and take control.

Flow:

1. Desktop generates a one-time pairing code
2. The code is valid for 5 minutes
3. Browser or mobile app submits the pairing code plus device identity
4. Desktop registers the device and returns a session token
5. Client exchanges that session token for a short-lived access token
6. WebSocket connection uses a one-time WS ticket

Current token model:

- Pairing code: short-lived, one-time
- Session token: long-lived per paired device
- Access token: short-lived JWT
- WS ticket: single-use, short-lived

## Browser Access

There are two useful URLs in desktop settings:

- `Browser URL`
- `Phone Pairing Link`

Use cases:

- `Browser URL`: open the browser client manually on a phone
- `Phone Pairing Link`: open a ready-to-pair URL that already contains the current pairing code

The browser client is the fastest path for mobile testing because it avoids app install and gives rough iOS support immediately.

It is also the best desktop-side wiring test surface now:

- desktop browser width renders the fuller companion shell
- narrow/mobile width renders the compact phone layout
- both run on the same companion backend contract as the native app

## Native Mobile Access

The Expo app uses the same companion backend. Pairing still starts from the desktop app.

High-level flow:

1. Start the companion server on desktop
2. Generate a pairing code
3. Enter host / port in the mobile app
4. Pair using the same code
5. Authenticate and connect over WebSocket

The browser and native clients are intended to stay aligned on the same API surface.

## Voice Support

### STT

Companion STT works by sending recorded audio to the desktop app. Desktop UI voice input and Android/mobile companion voice input should both route through the same main-process `SttService`.

Flow:

1. Desktop UI records audio with `MediaRecorder` and calls IPC `stt:transcribe-audio`, or Android/mobile uploads audio to `POST /companion/stt/transcribe`.
2. Main process routes the request through `src/main/stt-service.js`.
3. If `stt.defaultPluginId` names an enabled STT plugin, `SttService` calls that plugin's `transcribeAudio` action.
4. If no enabled STT plugin is selected, `SttService` falls back to the embedded backend.
5. Transcript is returned at top-level `text` / `transcript` fields plus normalized `result.text`.

Important distinction:

- Android does not choose or know the STT engine.
- Desktop UI does not use browser `SpeechRecognition` for the main mic path.
- STT provider override is owned by plugin selection, not by caller-supplied routing fields.
- mobile web tries in-page `getUserMedia` / `MediaRecorder` first so Chrome can ask for permission or report its secure-context block
- tap-to-talk audio file capture is kept as a possible fallback path, but it is not the default Mic button behavior

Core STT pieces:

- `src/main/stt-service.js`
- `src/main/ipc/register-stt-handlers.js`
- `src/main/embedded-voice-backend.js`
- `agentin/plugins/http-tts-bridge/main.js`

Regression tests:

- `npm run test:stt-ipc-routing`
  - windowless Electron external-test suite
  - sends a fixed WAV fixture through desktop IPC
  - pairs with Companion and sends the same fixture through `/companion/stt/transcribe`
  - default mode uses a deterministic plugin STT mock to prove routing without loading a model
  - live mode: set `LOCALAGENT_STT_IPC_LIVE=1`, `LOCALAGENT_STT_IPC_FIXTURE`, and `LOCALAGENT_STT_IPC_EXPECT_TRANSCRIPT`

### TTS

Companion TTS is a backend-owned path. The companion client only asks for speech audio and plays the returned clip.

Flow:

1. Browser companion strips thinking/code/attachment noise from the assistant message
2. Browser or mobile requests `POST /backend/voice/generate`
3. Backend TTS decides whether a core audio engine is available
4. Companion server stores the generated clip temporarily
5. Browser or mobile plays the returned short-lived audio URL

Important boundary:

- companion clients should not know whether plugins exist
- plugin TTS is only used by plugin-owned actions and capability surfaces

## Companion Boundary Rules

These rules are mandatory for every companion surface (`mobile/` and `src/main/companion-web/`):

- Companion clients must not implement backend decision logic.
- Companion clients must not choose providers/models/routes on their own.
- Companion clients may only:
  - mirror user picks already made in Electron UI and send them to backend, or
  - apply platform-specific UI/playback behavior (for example audio playback APIs).
- If a choice belongs to backend policy (provider, model, routing, availability), backend must decide it.
- If backend cannot satisfy a request, companion should surface the backend error, not replace backend behavior with client-side fallback logic.

## Browser Layout Modes

The browser companion is one frontend with two render targets:

- `Desktop Web`: wider layout with left workspace sidebar, main chat surface, and right controls/artifacts sidebar
- `Mobile Web`: off-canvas sidebars, compact controls, and touch-first composer flow

These are not separate protocols. They intentionally share:

- the same pairing flow
- the same `/companion/ipc` bridge
- the same `/companion/ws` event stream
- the same STT, TTS, artifact, and upload endpoints

That means browser testing on desktop is useful for validating the hardest companion wiring before checking phone browsers and the native mobile app.

## Permission Presets

Paired devices use permission scopes. Current presets:

- `full`
- `standard`
- `chat-only`
- `read-only`

Typical intent:

- `standard`: normal companion use
- `chat-only`: minimal interactive chat access
- `read-only`: inspect state without mutating things
- `full`: trusted device

Permissions are enforced against allowlisted IPC channels plus a few companion-specific HTTP actions.

## Main Companion Endpoints

Public endpoints:

- `GET /companion/health`
- `GET /companion/web`
- `POST /companion/pair`
- `POST /companion/auth`

Authenticated endpoints:

- `GET /companion/ws-ticket`
- `POST /companion/ipc`
- `GET /companion/settings/full`
- `POST /companion/stt/transcribe`
- `POST /backend/voice/generate`
- `POST /companion/media/upload`
- `GET /companion/artifact/...`
- `GET /companion/devices`
- `DELETE /companion/device/:deviceId`

Realtime:

- `GET /companion/ws`

## Recommended Development Flow

For companion work, the simplest loop is:

1. Enable companion on desktop
2. Bind to `0.0.0.0`
3. Generate a pairing code
4. Open the pairing link on a phone browser
5. Verify chat, WS updates, STT, and TTS
6. Then verify the same flow in the Expo app

That keeps browser and native clients synchronized on one backend contract.

## Practical Testing Checklist

Desktop:

- enable server
- verify host / port
- generate and cancel pairing codes
- remove an old device
- change a device permission preset

Browser:

- open `Browser URL`
- pair using `Phone Pairing Link`
- send a chat message
- switch sessions
- record a short voice input
- play assistant audio
- refresh and verify re-auth still works

Mobile:

- pair from the Expo app
- send a chat message
- verify WebSocket reconnect after a disconnect
- record a short voice input
- play assistant audio
- unpair from mobile settings

## Current Limitations

- Companion is LAN-first and HTTP by default. There is no finished production TLS story yet.
- Browser compatibility for recording still depends on browser media support.
- Real-device voice roundtrip testing is still required on actual Android and iPhone browsers.
- Browser companion is useful, but it is still not a full replacement for a native app if later features need deeper platform integration.
- The contract is still alpha and may change as mobile and browser clients are tightened up.

## Related Files

- `src/main/companion-api-server.js`
- `src/main/companion-auth.js`
- `src/main/companion-permissions.js`
- `src/main/companion-network-utils.js`
- `src/main/companion-web-static.js`
- `src/main/companion-web/index.html`
- `src/main/companion-web/assets/client.js`
- `src/main/companion-web/assets/app.js`
- `src/main/companion-web/assets/styles.css`
- `src/main/stt-service.js`
- `src/main/tts-service.js`
- `mobile/src/api/client.ts`
- `mobile/src/services/voice.ts`
- `mobile/src/screens/ChatScreen.tsx`
- `shared/companion-types.d.ts`
