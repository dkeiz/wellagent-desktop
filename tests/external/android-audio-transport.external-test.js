const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const http = require('http');
const assert = require('../helpers/assert');
const {
  invokeIpc,
  shutdownExternalApp,
  sleep,
  startExternalApp,
  waitForHealth
} = require('../helpers/external-app-control');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTROL_PORT = Number(process.env.LOCALAGENT_ANDROID_AUDIO_CONTROL_PORT || 8798);
const COMPANION_PORT = Number(process.env.LOCALAGENT_ANDROID_COMPANION_PORT || 8790);
const PACKAGE_NAME = 'com.localagent.companion';
const EXPECTED_TRANSCRIPT = '';

function sdkTool(...parts) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || 'E:\\AndroidDev\\SDK';
  return path.join(sdkRoot, ...parts);
}

function adbPath() {
  return process.env.ADB || sdkTool('platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
}

function emulatorPath() {
  return process.env.EMULATOR || sdkTool('emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
}

function defaultApkPath() {
  return path.join(ROOT, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
}

function runFile(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd || ROOT,
      timeout: options.timeoutMs || 30000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 8
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr || stdout || error.message;
        reject(new Error(`${path.basename(command)} ${args.join(' ')} failed: ${detail}`));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function quoteDeviceShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function waitForHttp(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', async () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        await sleep(500);
        tick();
      });
      req.setTimeout(2000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function startMetro(logPath) {
  if (process.env.LOCALAGENT_ANDROID_SKIP_METRO === '1') return null;
  const command = process.execPath;
  const args = [
    path.join(ROOT, 'mobile', 'node_modules', 'expo', 'bin', 'cli'),
    'start',
    '--dev-client',
    '--port',
    '8081',
    '--non-interactive'
  ];
  const child = spawn(command, args, {
    cwd: path.join(ROOT, 'mobile'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXPO_NO_TELEMETRY: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  const metroLog = fs.createWriteStream(logPath, { flags: 'a' });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stdout += text;
    metroLog.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stderr += text;
    metroLog.write(text);
  });
  child.on('exit', () => metroLog.end());
  try {
    await waitForHttp('http://127.0.0.1:8081/status', 60000);
    await sleep(1500);
    if (child.exitCode !== null) {
      throw new Error(`Metro exited with code ${child.exitCode}`);
    }
  } catch (error) {
    try { child.kill('SIGTERM'); } catch (_) {}
    throw new Error(`${error.message}; metro stdout: ${stdout.slice(-1000)}; metro stderr: ${stderr.slice(-1000)}`);
  }
  return child;
}

async function waitForChildExit(child, timeoutMs = 8000) {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopApp(app) {
  await shutdownExternalApp(app.baseUrl);
  await waitForChildExit(app.child);
  if (!app.child.killed) {
    try { app.child.kill('SIGTERM'); } catch (_) {}
  }
}

async function ensureCompanion(app) {
  const status = await invokeIpc(app.baseUrl, 'companion:status');
  if (status?.running && Number(status.port) === COMPANION_PORT) return status;
  const enabled = await invokeIpc(app.baseUrl, 'companion:enable', [{
    host: '127.0.0.1',
    port: COMPANION_PORT
  }]);
  assert.equal(enabled.success, true, 'Expected companion enable to succeed');
  return invokeIpc(app.baseUrl, 'companion:status');
}

async function hasEmulator(adb) {
  const devices = await runFile(adb, ['devices']);
  const lines = devices.stdout.split(/\r?\n/).map(line => line.trim());
  const active = lines.find(line => /^emulator-\d+\s+device$/.test(line));
  return Boolean(active);
}

async function waitForBoot(adb, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  await runFile(adb, ['wait-for-device'], { timeoutMs });
  while (Date.now() < deadline) {
    try {
      const boot = await runFile(adb, ['shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 5000 });
      if (boot.stdout.trim() === '1') return;
    } catch (_) {}
    await sleep(2000);
  }
  throw new Error('Timed out waiting for Android emulator boot');
}

async function ensureEmulator(adb) {
  if (await hasEmulator(adb)) return null;
  const avdName = String(process.env.LOCALAGENT_ANDROID_AVD || '').trim();
  if (!avdName) {
    throw new Error('No running Android emulator found. Start an AVD or set LOCALAGENT_ANDROID_AVD.');
  }
  const child = spawn(emulatorPath(), ['-avd', avdName, '-no-snapshot-load', '-gpu', 'swiftshader_indirect'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  await waitForBoot(adb);
  return child;
}

async function installApk(adb) {
  const apk = process.env.LOCALAGENT_ANDROID_APK || defaultApkPath();
  if (!fs.existsSync(apk)) {
    throw new Error(`Debug APK not found: ${apk}. Build it first with mobile/android/gradlew.bat assembleDebug.`);
  }
  await runFile(adb, ['install', '-r', apk], { timeoutMs: 120000, maxBuffer: 1024 * 1024 * 16 });
}

function startLogcat(adb, outputPath) {
  const child = spawn(adb, ['logcat'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stream = fs.createWriteStream(outputPath, { flags: 'a' });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.on('exit', () => stream.end());
  return child;
}

async function waitForProbeResult(logPath, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    if (text.includes('LOCALAGENT_AUDIO_PROBE DONE_OK')) return text;
    const failure = text.match(/LOCALAGENT_AUDIO_PROBE [A-Z_]*FAIL[^\r\n]*/);
    if (failure) throw new Error(failure[0]);
    await sleep(1000);
  }
  throw new Error('Timed out waiting for LOCALAGENT_AUDIO_PROBE DONE_OK');
}

async function waitForLogText(logPath, expectedText, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    if (text.includes(expectedText)) return text;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${expectedText}`);
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-android-audio-'));
  const logPath = path.join(userDataDir, 'android-audio-logcat.txt');
  const metroLogPath = path.join(userDataDir, 'metro.log');
  const adb = adbPath();
  let app = null;
  let logcat = null;
  let emulator = null;
  let metro = null;

  try {
    emulator = await ensureEmulator(adb);
    metro = await startMetro(metroLogPath);
    await runFile(adb, ['reverse', 'tcp:8081', 'tcp:8081'], { timeoutMs: 10000 }).catch(() => null);
    app = startExternalApp({
      rootDir: ROOT,
      port: CONTROL_PORT,
      envOverrides: {
        LOCALAGENT_USER_DATA_PATH: userDataDir,
        LOCALAGENT_COMPANION_AUDIO_MOCK: '1'
      }
    });
    await waitForHealth(app.baseUrl, 45000);
    await ensureCompanion(app);
    const pairing = await invokeIpc(app.baseUrl, 'companion:generate-pairing');
    assert.ok(pairing?.code, 'Expected pairing code');

    await installApk(adb);
    await runFile(adb, ['shell', 'pm', 'clear', PACKAGE_NAME], { timeoutMs: 30000 });
    await runFile(adb, ['logcat', '-c'], { timeoutMs: 10000 });
    logcat = startLogcat(adb, logPath);

    const url = [
      'localagent-companion://debug/audio-transport',
      `?host=${encodeURIComponent(process.env.LOCALAGENT_ANDROID_COMPANION_HOST || '10.0.2.2')}`,
      `&port=${encodeURIComponent(String(COMPANION_PORT))}`,
      `&code=${encodeURIComponent(pairing.code)}`,
      `&expectTranscript=${encodeURIComponent(EXPECTED_TRANSCRIPT)}`,
      '&text=Android%20transport%20probe'
    ].join('');
    await runFile(adb, [
      'shell',
      [
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        quoteDeviceShell(url),
        '--es',
        'localagentAudioProbeUrl',
        quoteDeviceShell(url)
      ].join(' ')
    ], { timeoutMs: 30000 });
    await waitForLogText(logPath, 'LOCALAGENT_AUDIO_PROBE APP_READY');
    const logText = await waitForProbeResult(logPath);

    for (const marker of ['PAIR_OK', 'UPLOAD_OK', 'TTS_OK', 'PLAYBACK_OK', 'DONE_OK']) {
      assert.includes(logText, `LOCALAGENT_AUDIO_PROBE ${marker}`, `Expected Android probe marker ${marker}`);
    }

    console.log('[external-test:android-audio-transport] PASS');
    console.log(`[external-test:android-audio-transport] companion_port=${COMPANION_PORT}`);
    console.log(`[external-test:android-audio-transport] log=${logPath}`);
  } finally {
    if (logcat) {
      try { logcat.kill('SIGTERM'); } catch (_) {}
    }
    if (emulator) {
      try { emulator.kill('SIGTERM'); } catch (_) {}
    }
    if (metro) {
      try { metro.kill('SIGTERM'); } catch (_) {}
    }
    if (app) await stopApp(app);
  }
}

run().catch((error) => {
  console.error('[external-test:android-audio-transport] FAIL:', error.message || String(error));
  process.exit(1);
});
