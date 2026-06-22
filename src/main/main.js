const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { bootstrapApplication } = require('./bootstrap');
// Lazy-loaded: tools/ may not exist in Docker images (excluded by .dockerignore)
function runCheckSkins() { return require('../../tools/check-skins').runCheckSkins(); }
function runApplySimulation() { return require('../../tools/test-skin-apply').runApplySimulation(); }
const { createExternalTestControl } = require('./external-test-control');

function wrapConsoleMethod(name) {
  const original = console[name];
  if (typeof original !== 'function') return;
  console[name] = (...args) => {
    try {
      return original.apply(console, args);
    } catch (error) {
      if (error?.code === 'EPIPE') return;
      throw error;
    }
  };
}

function ignoreBrokenPipeErrors(stream) {
  if (!stream?.on) return;
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') return;
    throw error;
  });
}

wrapConsoleMethod('log');
wrapConsoleMethod('info');
wrapConsoleMethod('warn');
wrapConsoleMethod('error');
ignoreBrokenPipeErrors(process.stdout);
ignoreBrokenPipeErrors(process.stderr);
process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE') return;
  throw error;
});

let runtime = null;
let externalTestControl = null;
let shutdownPromise = null;
let allowImmediateQuit = false;

const args = process.argv.slice(1);
// App-level launch modes:
// - --skintest runs the skin-only headless checks and exits.
// - --cli/--noui/-noui/--nowindow/--windowless all mean "boot backend without opening the main window".
// Keep these aliases aligned with bootstrap.js and package.json.
const isSkinTestMode = args.includes('--skintest');
const isDevMode = args.includes('--dev');
const isCliMode = args.includes('--cli');
const isCompanionQrMode = args.includes('--companion-qr');
const isNoWindowMode = args.includes('--nowindow')
  || isCliMode
  || isCompanionQrMode
  || args.includes('--noui')
  || args.includes('-noui');
const isTestClientMode = args.includes('--testclient');
const isExternalTestMode = args.includes('--external-test');
const isWindowlessMode = args.includes('--windowless')
  || args.includes('-windowless')
  || isNoWindowMode;
const externalPortArgIdx = args.indexOf('--external-port');
const externalPort = externalPortArgIdx !== -1 && args[externalPortArgIdx + 1]
  ? Number(args[externalPortArgIdx + 1])
  : 8788;
const userDataArgIdx = args.indexOf('--user-data-dir');
const userDataOverride = process.env.LOCALAGENT_USER_DATA_PATH
  || (userDataArgIdx !== -1 && args[userDataArgIdx + 1]
    ? path.resolve(args[userDataArgIdx + 1])
    : null);

if (userDataOverride && app?.setPath) {
  app.setPath('userData', userDataOverride);
}

process.env.LOCALAGENT_ELECTRON_APP_RUNTIME = '1';

class IpcBridge {
  constructor(realIpcMain) {
    this.realIpcMain = realIpcMain;
    this.handlers = new Map();
  }

  handle(channel, fn) {
    this.handlers.set(channel, fn);
    this.realIpcMain.handle(channel, fn);
  }

  async invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return handler({}, ...args);
  }
}

const ipcBridge = new IpcBridge(ipcMain);

if (!app || typeof app.whenReady !== 'function') {
  if (isSkinTestMode && isNoWindowMode) {
    console.log('[SkinTest] Running in Node fallback mode...');
    const started = Date.now();
    const skinCheck = runCheckSkins();
    const skinApplySimulation = runApplySimulation();
    const durationMs = Date.now() - started;
    const report = {
      mode: 'skintest-nowindow-node-fallback',
      durationMs,
      checks: {
        skins: skinCheck,
        skinApplySimulation
      }
    };
    console.log('[SkinTest] Report:');
    console.log(JSON.stringify(report, null, 2));
    process.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
  } else {
    throw new Error('Electron app context is unavailable. Run this entrypoint with Electron for normal app mode.');
  }
}

async function runHeadlessSkinChecks() {
  console.log('[SkinTest] Starting --skintest --nowindow checks...');
  const started = Date.now();
  const skinCheck = runCheckSkins();
  const skinApplySimulation = runApplySimulation();
  const durationMs = Date.now() - started;
  const report = {
    mode: 'skintest-nowindow',
    durationMs,
    checks: {
      skins: skinCheck,
      skinApplySimulation
    }
  };
  console.log('[SkinTest] Report:');
  console.log(JSON.stringify(report, null, 2));
  app.exit(skinCheck.ok && skinApplySimulation.ok ? 0 : 1);
}

async function runSeedScript(container) {
  const seedIdx = process.argv.indexOf('--seed');
  if (seedIdx === -1 || !process.argv[seedIdx + 1]) {
    return;
  }

  const seedPath = path.resolve(process.argv[seedIdx + 1]);
  console.log(`[Seed] Running seed script: ${seedPath}`);
  try {
    const seedFn = require(seedPath);
    if (typeof seedFn === 'function') {
      await seedFn({
        container,
        db: container.get('db'),
        workflowManager: container.get('workflowManager'),
        mcpServer: container.get('mcpServer')
      });
      console.log('[Seed] Seed script completed successfully');
    } else {
      console.error('[Seed] Seed script must export a function: module.exports = async ({ db, workflowManager }) => { ... }');
    }
  } catch (error) {
    console.error('[Seed] Seed script failed:', error);
  }
}

async function runCompanionQrOutput() {
  const status = await ipcBridge.invoke('companion:status');
  const host = String(status?.host || '0.0.0.0').trim() || '0.0.0.0';
  const port = Number(status?.port) || 8790;

  let ensuredStatus = status;
  if (!status?.running) {
    ensuredStatus = await ipcBridge.invoke('companion:enable', { host, port });
    if (ensuredStatus?.success === false) {
      throw new Error(ensuredStatus.error || 'Failed to start companion server');
    }
  }

  const pairing = await ipcBridge.invoke('companion:generate-pairing');
  if (!pairing?.success) {
    throw new Error(pairing?.error || 'Failed to generate companion pairing code');
  }
  if (!pairing.nativeAppUrl || !pairing.preferredBrowserUrl) {
    throw new Error('Companion pairing payload is missing QR targets');
  }

  const appQr = await ipcBridge.invoke('companion:render-qr', pairing.nativeAppUrl);
  const webQr = await ipcBridge.invoke('companion:render-qr', pairing.preferredBrowserUrl);
  if (!appQr?.success || !webQr?.success) {
    throw new Error(appQr?.error || webQr?.error || 'Failed to render companion QR codes');
  }

  console.log('[CompanionQR] Pairing code:', pairing.code);
  console.log('[CompanionQR] Expires:', pairing.expiresAt);
  console.log('[CompanionQR] App URL:', pairing.nativeAppUrl);
  console.log('[CompanionQR] Web URL:', pairing.preferredBrowserUrl);
  console.log('[CompanionQR] Access mode:', ensuredStatus?.accessMode || 'unknown');
  console.log('');
  console.log('[CompanionQR] Android App QR');
  console.log(appQr.terminal);
  console.log('');
  console.log('[CompanionQR] Web Companion QR');
  console.log(webQr.terminal);
}

app.whenReady().then(async () => {
  try {
    // Hide native app menu in normal mode; keep it visible when explicitly running with --dev.
    if (!isDevMode && Menu && typeof Menu.setApplicationMenu === 'function') {
      Menu.setApplicationMenu(null);
    }

    // Skin test is intentionally a separate fast path, not the general backend runtime.
    if (isSkinTestMode && isNoWindowMode) {
      await runHeadlessSkinChecks();
      return;
    }

    runtime = await bootstrapApplication({
      app,
      BrowserWindow,
      ipcMain: ipcBridge,
      args,
      isTestClientMode,
      // Normal app startup must respect the no-window aliases above.
      createInitialWindow: !isWindowlessMode,
      autoStartDaemons: !isExternalTestMode
    });

    if (isExternalTestMode) {
      externalTestControl = createExternalTestControl({
        invokeIpc: (channel, ...invokeArgs) => ipcBridge.invoke(channel, ...invokeArgs),
        shutdownRuntime: async () => {
          if (runtime) {
            await runtime.shutdown();
          }
          app.exit(0);
        },
        getWindowCount: () => {
          try {
            return BrowserWindow.getAllWindows().length;
          } catch (_) {
            return -1;
          }
        },
        port: Number.isFinite(externalPort) ? externalPort : 8788,
        host: '127.0.0.1'
      });
      await externalTestControl.start();
    }

    if (isTestClientMode) {
      console.log('[TestClient] Enabled transient chat mode (--testclient)');
    }

    await runSeedScript(runtime.container);

    if (isCompanionQrMode) {
      await runCompanionQrOutput();
      await runShutdownSequence();
      allowImmediateQuit = true;
      app.exit(0);
      return;
    }

    app.on('activate', () => {
      runtime?.handleActivate();
    });
  } catch (error) {
    console.error('Error during app initialization:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (isWindowlessMode) return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function runShutdownSequence() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    if (externalTestControl) {
      try {
        await externalTestControl.stop();
      } finally {
        externalTestControl = null;
      }
    }

    if (runtime) {
      await runtime.shutdown();
      runtime = null;
    }
  })();

  return shutdownPromise;
}

app.on('before-quit', (event) => {
  if (allowImmediateQuit) {
    return;
  }

  event.preventDefault();
  runShutdownSequence()
    .catch(error => {
      console.error('[Main] Shutdown sequence failed:', error);
    })
    .finally(() => {
      allowImmediateQuit = true;
      app.quit();
    });
});
