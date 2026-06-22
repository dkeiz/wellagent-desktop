# Android Emulator Testing

Use this when testing the LocalAgent Android companion on this development machine.

## Local Android Tooling

This machine already has an Android SDK and AVD home outside the repo:

```text
ANDROID_SDK_ROOT=E:\AndroidDev\SDK
ANDROID_HOME=E:\AndroidDev\SDK
ANDROID_AVD_HOME=E:\AndroidDev\.android\avd
```

Useful binaries:

```text
E:\AndroidDev\SDK\emulator\emulator.exe
E:\AndroidDev\SDK\platform-tools\adb.exe
```

Known AVDs:

- `Android_Accelerated_x86_Oreo`
- `Nexus_5X_API_28_x86`
- `Pixel_3_API_28`
- `LocalAgent_API_28_x86`

## Important Host Mapping

This repo now has two distinct emulator cases:

1. If LocalAgent desktop binds Companion to `0.0.0.0` or `127.0.0.1`, the emulator alias is usually:

```text
http://10.0.2.2:8790/companion/web
https://10.0.2.2:8791/companion/web
```

2. If LocalAgent desktop binds Companion to a specific LAN IP only, `10.0.2.2` can time out. In that case, use the actual LAN IP shown by the desktop app.

Current known-good setup on this machine:

```text
http://192.168.31.128:8790/companion/web
https://192.168.31.128:8791/companion/web
```

Do not assume `10.0.2.2` is always correct. Check the actual companion bind host first.

## One-Time Session Setup

From the repo root:

```powershell
$env:ANDROID_SDK_ROOT="E:\AndroidDev\SDK"
$env:ANDROID_HOME="E:\AndroidDev\SDK"
$env:ANDROID_AVD_HOME="E:\AndroidDev\.android\avd"
$env:Path="E:\AndroidDev\SDK\platform-tools;E:\AndroidDev\SDK\emulator;$env:Path"
```

Confirm the AVD list:

```powershell
emulator -list-avds
```

## Start Emulator

Recommended clean emulator:

```powershell
emulator -avd LocalAgent_API_28_x86 -wipe-data -no-snapshot-load -gpu swiftshader_indirect
```

Legacy example:

```powershell
emulator -avd Pixel_3_API_28
```

Wait until `adb devices` shows the emulator:

```powershell
adb devices
```

## Build And Install The App

From the repo root:

```powershell
cd mobile\android
.\gradlew.bat installDebug
```

This builds the debug app and installs it to the running emulator.

## Verify Desktop Companion From Emulator

Before opening the Android app, verify that the emulator can reach the desktop companion.

If the desktop companion is bound to `0.0.0.0` or `127.0.0.1`:

```powershell
adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:8790/companion/web"
```

If the desktop companion is bound to the current LAN IP on this machine:

```powershell
adb shell am start -a android.intent.action.VIEW -d "http://192.168.31.128:8790/companion/web"
```

If HTTPS is configured and the certificate path is expected to work:

```powershell
adb shell am start -a android.intent.action.VIEW -d "https://192.168.31.128:8791/companion/web"
```

## App Connection Values

For HTTP when the desktop binds to localhost/all interfaces:

- Host: `10.0.2.2`
- Port: `8790`
- HTTPS: `off`

For HTTP on the current LAN-bound desktop setup:

- Host: `192.168.31.128`
- Port: `8790`
- HTTPS: `off`

For HTTPS:

- Host: `192.168.31.128`
- Port: `8791`
- HTTPS: `on`

The app also accepts a full companion URL on the connect screen.

## Current Repo Notes

- Main Android manifest now explicitly sets `android:usesCleartextTraffic="true"` so emulator and LAN HTTP testing are allowed in built APKs.
- The connect screen now parses full pasted companion URLs and infers host, port, and HTTP/HTTPS mode correctly.
- The load error screen now shows likely causes for cleartext, certificate, and connectivity failures.
- The companion shell now falls back cleanly to polling if live WebSocket transport is unavailable.

## Practical Loop

1. Start LocalAgent desktop and enable Companion.
2. Start the emulator.
3. Verify browser access from the emulator with the actual companion host for the current run.
4. Install the debug app with `installDebug`.
5. Open the app and connect to the verified host.
6. Only rebuild when native Android changes are made. Web companion/backend-only changes can often be retested without reinstalling the APK.

## Regression Method

Use this order when validating companion fixes:

1. Run the contract suite first:

```powershell
node tests/run-suite.js contracts
```

2. Restart LocalAgent desktop so companion server changes are live.
3. Confirm the emulator still reaches the browser companion URL before opening the native app.
4. Generate a fresh pairing code and test one clean first-pair flow.
5. Verify the native app reaches the main shell and that live status is either:
   - connected live, or
   - explicit polling fallback without a broken auth screen
6. Re-test a reused or expired pairing code and confirm the message is clear instead of looking like a crash.
7. If only web companion or desktop server code changed, repeat steps 2 through 6 without rebuilding the APK.

## Audio Transport Regression

Use this path to test Android app audio transport without a real microphone and without real STT/TTS engines. The APK runs in the AVD, but the desktop companion returns deterministic mock STT/TTS data.

Prerequisites:

- AVD is already running and visible in `adb devices`, or set `LOCALAGENT_ANDROID_AVD=LocalAgent_API_28_x86`.
- Debug APK exists at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- Companion port `8790` is free, or set `LOCALAGENT_ANDROID_COMPANION_PORT`.

Build the debug APK only when needed. For the emulator ABI build used by the live test, keep the native build scoped to `x86,x86_64`:

```powershell
cd mobile\android
$env:ANDROID_SDK_ROOT="E:\AndroidDev\SDK"
$env:ANDROID_HOME="E:\AndroidDev\SDK"
$env:NODE_ENV="development"
.\gradlew.bat assembleDebug "-PreactNativeArchitectures=x86,x86_64"
```

Run the live Android transport probe from the repo root:

```powershell
$env:ANDROID_SDK_ROOT="E:\AndroidDev\SDK"
$env:ANDROID_HOME="E:\AndroidDev\SDK"
$env:ANDROID_AVD_HOME="E:\AndroidDev\.android\avd"
$env:Path="E:\AndroidDev\SDK\platform-tools;E:\AndroidDev\SDK\emulator;$env:Path"
$env:LOCALAGENT_ANDROID_AVD="LocalAgent_API_28_x86"
npm run test:android-audio-transport
```

What it does:

1. Starts desktop in external/windowless mode with `LOCALAGENT_COMPANION_AUDIO_MOCK=1`.
2. Enables companion on `127.0.0.1:8790`.
3. Generates a fresh pairing code through desktop IPC.
4. Installs the debug APK to the running emulator.
5. Clears `com.localagent.companion` app state.
6. Launches the visible `Audio Transport Test` screen through the debug deep link.
7. Waits for logcat success/failure markers while the screen shows each stage result.

The device-shell command must quote the URL, otherwise `&port=...` and later params can be truncated by the Android shell:

```powershell
adb shell 'am start -a android.intent.action.VIEW -d "localagent-companion://debug/audio-transport?host=10.0.2.2&port=8790&code=PAIRING_CODE&expectTranscript=android%20audio%20probe%20transcript&text=Android%20transport%20probe" --es localagentAudioProbeUrl "localagent-companion://debug/audio-transport?host=10.0.2.2&port=8790&code=PAIRING_CODE&expectTranscript=android%20audio%20probe%20transcript&text=Android%20transport%20probe"'
```

Expected logcat markers:

```text
LOCALAGENT_AUDIO_PROBE START
LOCALAGENT_AUDIO_PROBE HEALTH_OK
LOCALAGENT_AUDIO_PROBE PAIR_OK
LOCALAGENT_AUDIO_PROBE AUTH_OK
LOCALAGENT_AUDIO_PROBE SESSION_OK
LOCALAGENT_AUDIO_PROBE STT_OK
LOCALAGENT_AUDIO_PROBE UPLOAD_OK
LOCALAGENT_AUDIO_PROBE TTS_OK
LOCALAGENT_AUDIO_PROBE PLAYBACK_OK
LOCALAGENT_AUDIO_PROBE DONE_OK
```

Failure markers are explicit: `PAIR_FAIL`, `STT_FAIL`, `UPLOAD_FAIL`, `TTS_FAIL`, `PLAYBACK_FAIL`, or `TRANSPORT_FAIL`.

To exercise failure paths, set one mock failure toggle before running the same command:

```powershell
$env:LOCALAGENT_COMPANION_AUDIO_MOCK_STT_FAIL="1"
# or
$env:LOCALAGENT_COMPANION_AUDIO_MOCK_TTS_FAIL="1"
```

Manual stage validation uses the same debug deep link against a visible desktop app. Enable Companion, generate a fresh pairing code, then launch the deep link with `host=10.0.2.2` for emulator-to-host access or the current LAN IP if the desktop is bound to LAN only. The Android app opens the `Audio Transport Test` page and shows pass/fail state for companion reachability, pairing, auth, session creation, STT upload, media upload, TTS, and playback.

The debug probe is gated by the React Native debug runtime. Release builds log `LOCALAGENT_AUDIO_PROBE DISABLED_RELEASE` and do not run the transport probe.
