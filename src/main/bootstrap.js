const path = require('path');
const ServiceContainer = require('./service-container');
const CompanionApiServer = require('./companion/companion-api-server');
const { configureCompanionServer, attachCompanionRelays } = require('./companion/companion-backend-dispatch');

const { resolveEasyConnectHost } = require('./companion-network-utils');
const setupIpcHandlers = require('./ipc-handlers');
const { WindowManager } = require('./window-manager');
const { buildRuntimePaths, ensureMutableAgentinRoot } = require('./runtime-paths');
const { createStartupProfiler } = require('./startup-profiler');
const { RuntimePolicy } = require('./runtime-policy');
const { createDeferredRuntimeStartup, scheduleNamedStartup } = require('./bootstrap-lifecycle');
const {
  setupCoreInfrastructure,
  setupInferenceAndWorkflow,
  setupSessionRuntime,
  setupAgentAndPluginRuntime,
  setupBackgroundAndKnowledgeRuntime
} = require('./bootstrap-phases');

function resolveWindowManager(paths, options = {}) {
  if (options.windowManager) {
    return options.windowManager;
  }

  return new WindowManager({
    BrowserWindow: options.BrowserWindow || null,
    rendererPath: paths.rendererPath,
    createWindow: options.createWindow || null
  });
}

async function getRemoteGatewaySecret(db) {
  return await db.getCredential?.('remoteGateway.secret')
    || await db.getCredential?.('setting.remoteGateway.secret')
    || await db.getSetting('remoteGateway.secret')
    || '';
}

async function bootstrapApplication(options = {}) {
  const container = options.container || new ServiceContainer();
  const args = options.args || process.argv.slice(1);
  const startupProfiler = options.startupProfiler || createStartupProfiler({
    enabled: options.startupTrace === true || args.includes('--startup-trace'),
    logger: options.startupLogger || console
  });
  const isTestClientMode = options.isTestClientMode === true || args.includes('--testclient');
  const isExternalTestMode = args.includes('--external-test');
  const isSkinTestMode = args.includes('--skintest');
  const privateModeDefault = args.includes('--private');
  // These flags are app-level aliases for "do not create the main Electron window".
  // Do not narrow this list in one file without updating src/main/main.js too.
  const isNoWindowMode = args.includes('--nowindow')
    || args.includes('--cli')
    || args.includes('--companion-qr')
    || args.includes('--noui')
    || args.includes('-noui')
    || args.includes('--windowless')
    || args.includes('-windowless');
  const ipcMain = options.ipcMain || null;
  const autoStartDaemons = options.autoStartDaemons !== false;
  const createInitialWindow = options.createInitialWindow !== false;
  startupProfiler.mark('bootstrap.begin', {
    test: isSkinTestMode || isTestClientMode || isExternalTestMode,
    windowless: isNoWindowMode,
    createInitialWindow
  });
  const paths = startupProfiler.timeSync('runtime.paths', () => buildRuntimePaths(options));
  startupProfiler.timeSync('runtime.seedAgentin', () => ensureMutableAgentinRoot(paths));
  const windowManager = resolveWindowManager(paths, options);
  const runtimePolicy = options.runtimePolicy || container.optional?.('runtimePolicy') || new RuntimePolicy();
  const ctx = {
    container,
    options,
    startupProfiler,
    paths,
    windowManager,
    runtimePolicy,
    isTestClientMode,
    isExternalTestMode,
    isSkinTestMode,
    isNoWindowMode,
    privateModeDefault
  };

  await setupCoreInfrastructure(ctx);
  // Phase contract markers remain here for runtime-path coverage:
  // workflowsDir: paths.workflowBasePath
  // paths.subtaskBasePath
  // paths.researchBasePath
  // new TaskQueueService
  await setupInferenceAndWorkflow(ctx);
  await setupSessionRuntime(ctx);
  await setupAgentAndPluginRuntime(ctx);
  await setupBackgroundAndKnowledgeRuntime(ctx);

  if (ipcMain) {
    startupProfiler.timeSync('ipc.register', () => setupIpcHandlers(ipcMain, container));
  }

  if (createInitialWindow) {
    startupProfiler.timeSync('window.createMain', () => windowManager.createMainWindow());
  }

  ctx.eventBus.init({ windowManager, dispatcher: ctx.dispatcher, db: ctx.db });
  startupProfiler.mark('bootstrap.ready');

  scheduleNamedStartup('plugin.enablePersisted', startupProfiler, () => ctx.pluginManager.enablePersistedPlugins());

  // ── Companion HTTP server (thin transport, calls backend services directly) ──
  container.register('companionServer', null);
  const startCompanionServerFromSettings = async () => {
    let companionServer = null;
    try {
      await startupProfiler.time('companion.start', async () => {
        // Startup still normalizes persisted host settings via: resolveEasyConnectHost(await db.getSetting('companion.host') || '0.0.0.0')
        const host = resolveEasyConnectHost(await ctx.db.getSetting('companion.host') || '0.0.0.0');
        await ctx.db.saveSetting('companion.host', host);
        companionServer = new CompanionApiServer({
          host,
          port: Number(await ctx.db.getSetting('companion.port')) || 8790,
          tlsManager: container.get('companionTlsManager')
        });
        companionServer.setRemoteGatewayManager(ctx.remoteGatewayManager);
        configureCompanionServer({ companionServer, container, db: ctx.db });
        attachCompanionRelays({
          companionServer,
          eventBus: ctx.eventBus,
          windowManager,
          getCompanionServer: () => container.optional('companionServer') || companionServer
        });

        await companionServer.start();
        container.replace('companionServer', companionServer);
      });
      return companionServer;
    } catch (e) {
      console.error('[Bootstrap] Companion server start failed:', e);
      if (companionServer) {
        try { await companionServer.stop(); } catch (_) {}
      }
      container.replace('companionServer', null);
      return null;
    }
  };
  const deferredStartup = createDeferredRuntimeStartup({
    db: ctx.db,
    startupProfiler,
    memoryDaemon: ctx.memoryDaemon,
    workflowScheduler: ctx.workflowScheduler,
    isTestClientMode,
    isExternalTestMode,
    isSkinTestMode,
    isNoWindowMode,
    startCompanionServerFromSettings,
    remoteGatewayManager: ctx.remoteGatewayManager,
    getRemoteGatewaySecret
  });
  await deferredStartup.schedule({ autoStartBackground: autoStartDaemons });

  return {
    container,
    windowManager,
    handleActivate() {
      if (!windowManager.hasMainWindow()) {
        return windowManager.createMainWindow();
      }
      return windowManager.getMainWindow();
    },
    async shutdown() {
      await deferredStartup.shutdown({ container });
    }
  };
}

module.exports = {
  bootstrapApplication
};
