const fs = require('fs');
const path = require('path');
const { tokenizePath } = require('../path-tokens');
const { isPrivateSessionId } = require('../private-session-store');
const {
  buildCompanionUrl,
  buildNativeCompanionUrl,
  describeCompanionReachability,
  resolveEasyConnectHost
} = require('../companion-network-utils');
const { configureCompanionServer, attachCompanionRelays } = require('../companion/companion-backend-dispatch');
const CompanionAuth = require('../companion-auth');
const CompanionPermissions = require('../companion-permissions');
const CompanionApiServer = require('../companion/companion-api-server');
const { RemoteGatewayManager } = require('../companion/remote-gateway-manager');

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Requested path is outside the agent folder');
  }
  return target;
}

function listFilesRecursive(baseDir, relativeDir = '', depth = 0, maxDepth = 4) {
  const dirPath = assertInside(baseDir, path.join(baseDir, relativeDir));
  if (!fs.existsSync(dirPath) || depth > maxDepth) return [];

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map(entry => {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
      const fullPath = path.join(baseDir, relativePath);
      const stat = fs.statSync(fullPath);
      const item = {
        name: entry.name,
        relativePath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
      if (entry.isDirectory()) {
        item.children = listFilesRecursive(baseDir, relativePath, depth + 1, maxDepth);
      }
      return item;
    });
}

async function getAgentUiInfo(agentManager, agentId) {
  const agent = await agentManager.getAgent(agentId);
  if (!agent) return null;
  const folderPath = await agentManager.resolveAgentFolder(agentId);
  const slug = agentManager._getSafeFolderName(agent.name);
  return { ...agent, slug, folderPath };
}

async function toPortableAgentPath(agentManager, agentId, absolutePath) {
  return tokenizePath(absolutePath, {
    agentManager,
    sessionWorkspace: agentManager?.sessionWorkspace || null,
    context: { agentId }
  });
}

function parseCompanionDevices(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function fallbackTlsStatus() {
  return {
    enabled: false,
    supported: false,
    ready: false,
    securePort: null,
    setupRequired: false,
    caFingerprint: '',
    warning: '',
    error: ''
  };
}

function buildAndroidBrowserHttpsPayload(network, tlsStatus, port, secureNetwork, bootstrapNetwork, companionServer) {
  const effectiveWarning = tlsStatus.warning
    || tlsStatus.error
    || ((tlsStatus.enabled && !companionServer?.secureServer) ? companionServer?.lastTlsError || '' : '');
  if (!tlsStatus.enabled) {
    return {
      enabled: false,
      supported: tlsStatus.supported,
      ready: false,
      running: false,
      securePort: tlsStatus.securePort,
      setupRequired: false,
      caFingerprint: '',
      preferredBootstrapUrl: '',
      preferredSecureUrl: '',
      caDownloadUrl: '',
      warning: effectiveWarning
    };
  }

  const preferredHost = bootstrapNetwork?.preferredHost || network.preferredHost || '';
  return {
    enabled: true,
    supported: tlsStatus.supported,
    ready: tlsStatus.ready,
    running: Boolean(companionServer?.secureServer),
    securePort: tlsStatus.securePort,
    setupRequired: tlsStatus.setupRequired === true,
    caFingerprint: tlsStatus.caFingerprint || '',
    serverFingerprint: tlsStatus.serverFingerprint || '',
    certificateHosts: tlsStatus.certificateHosts || [],
    missingHosts: tlsStatus.missingHosts || [],
    preferredBootstrapUrl: bootstrapNetwork?.preferredBrowserUrl || '',
    preferredSecureUrl: secureNetwork?.preferredBrowserUrl || '',
    caDownloadUrl: preferredHost
      ? buildCompanionUrl(preferredHost, port, { pathname: '/companion/bootstrap/ca.crt' })
      : '',
    warning: effectiveWarning
  };
}

async function getCompanionStatusPayload(db, companionServer, companionTlsManager) {
  const enabled = await db.getSetting('companion.enabled') === 'true';
  const host = await db.getSetting('companion.host') || '0.0.0.0';
  const port = Number(await db.getSetting('companion.port')) || 8790;
  const storedDevices = parseCompanionDevices(await db.getSetting('companion.devices'));
  const network = describeCompanionReachability(host, port);
  let tlsStatus = fallbackTlsStatus();

  if (companionTlsManager?.getStatus) {
    try {
      tlsStatus = await companionTlsManager.getStatus({ bindHost: host, httpPort: port });
    } catch (error) {
      tlsStatus = { ...fallbackTlsStatus(), error: error.message, warning: error.message };
    }
  }

  const bootstrapNetwork = tlsStatus.enabled
    ? describeCompanionReachability(host, port, { pathname: '/companion/bootstrap' })
    : null;
  const secureNetwork = tlsStatus.enabled && tlsStatus.securePort
    ? describeCompanionReachability(host, tlsStatus.securePort, {
      scheme: 'https',
      pathname: '/companion/web'
    })
    : null;
  const androidBrowserHttps = buildAndroidBrowserHttpsPayload(
    network,
    tlsStatus,
    port,
    secureNetwork,
    bootstrapNetwork,
    companionServer
  );
  const warning = [network.warning, androidBrowserHttps.warning].filter(Boolean).join(' ');

  return {
    enabled,
    running: Boolean(companionServer?.server),
    host,
    port,
    pairedDevices: storedDevices.length,
    connectedDevices: (companionServer?._wsClients?.size || 0) + (companionServer?._remoteWsClients?.size || 0),
    preferredBrowserUrl: androidBrowserHttps.enabled
      ? androidBrowserHttps.preferredBootstrapUrl
      : network.preferredBrowserUrl,
    nativeAppUrl: network.preferredHost
      ? buildNativeCompanionUrl(
        network.preferredHost,
        androidBrowserHttps.running && androidBrowserHttps.securePort ? androidBrowserHttps.securePort : port,
        { useTls: androidBrowserHttps.running === true }
      )
      : '',
    browserUrls: androidBrowserHttps.enabled
      ? (bootstrapNetwork?.browserUrls || network.browserUrls)
      : network.browserUrls,
    reachableHosts: network.reachableHosts,
    preferredHost: network.preferredHost,
    accessMode: network.accessMode,
    warning,
    androidBrowserHttps
  };
}

function registerAgentSystemHandlers(ipcMain, runtime, helpers) {
  const {
    mcpServer,
    windowManager,
    aiService,
    portListenerManager,
    agentMemory,
    agentLoop,
    connectorRuntime,
    a2aManager,
    agentManager,
    pluginManager,
    eventBus,
    chainController,
    memoryDaemon,
    workflowScheduler,
    sessionInitManager,
    db,
    testClientMode,
    toolPermissionService
  } = runtime;
  const { syncDaemonEnabledSetting } = helpers;

  ipcMain.handle('port-listener:register', async (event, config, options = {}) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.register(config);
      windowManager.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:unregister', async (event, port, options = {}) => {
    if (!portListenerManager) return { error: 'PortListenerManager not initialized' };
    try {
      const result = await portListenerManager.unregister(port);
      windowManager.send('port-listener-update', portListenerManager.getListeners());
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('port-listener:list', async () => {
    if (!portListenerManager) return [];
    return portListenerManager.getListeners();
  });

  ipcMain.handle('agent-memory:append', async (event, type, content, filename, options = {}) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.append(type, content, filename);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent-memory:read', async (event, type, filename) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.read(type, filename);
    } catch (error) {
      return { exists: false, error: error.message };
    }
  });

  ipcMain.handle('agent-memory:list', async (event, type) => {
    if (!agentMemory) return [];
    try {
      return await agentMemory.list(type);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('agent-memory:stats', async () => {
    if (!agentMemory) return {};
    return agentMemory.getStats();
  });

  ipcMain.handle('agent-memory:save-image', async (event, imageBuffer, name, options = {}) => {
    if (!agentMemory) return { error: 'AgentMemory not initialized' };
    try {
      return await agentMemory.saveImage(Buffer.from(imageBuffer), name);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  mcpServer.on('calendar-update', () => {
    windowManager.send('calendar-update');
  });

  mcpServer.on('todo-update', () => {
    windowManager.send('todo-update');
  });

  mcpServer.on('tool-executed', (eventData) => {
    windowManager.send('tool-update', eventData);
  });

  mcpServer.on('execution-context-updated', (context) => {
    windowManager.send('execution-context-updated', context);
  });

  ipcMain.handle('agent-loop:memory-start', async (event, sessionId) => {
    if (!agentLoop) return null;
    if (isPrivateSessionId(sessionId)) return null;
    return agentLoop.loadMemoryContext(sessionId);
  });

  ipcMain.handle('agent-loop:get-state', async (event, sessionId) => {
    if (!agentLoop) return { autoMemory: false };
    const session = agentLoop.getSession(sessionId);
    return { autoMemory: session.autoMemory, idleSeconds: session.idleSeconds };
  });

  ipcMain.handle('connectors:list', async () => {
    if (!connectorRuntime) return [];
    return connectorRuntime.listConnectors();
  });

  ipcMain.handle('connectors:start', async (event, name, options = {}) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return connectorRuntime.startConnector(name);
  });

  ipcMain.handle('connectors:stop', async (event, name, options = {}) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    return connectorRuntime.stopConnector(name);
  });

  ipcMain.handle('connectors:logs', async (event, name, limit) => {
    if (!connectorRuntime) return [];
    return connectorRuntime.getLogs(name, limit);
  });

  ipcMain.handle('connectors:delete', async (event, name, options = {}) => {
    if (!connectorRuntime) return { error: 'Connector runtime not initialized' };
    try { await connectorRuntime.stopConnector(name); } catch (e) {}
    const filePath = path.join(connectorRuntime.connectorsDir, `${name}.js`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true, name };
  });

  ipcMain.handle('a2a:get-status', async () => {
    if (!a2aManager) return { error: 'A2AManager not initialized' };
    return a2aManager.getExposureStatus();
  });

  ipcMain.handle('a2a:set-exposure', async (event, enabled, options = {}) => {
    if (!a2aManager) return { error: 'A2AManager not initialized' };
    return a2aManager.setExposureEnabled(enabled === true);
  });

  ipcMain.handle('a2a:list-targets', async () => {
    if (!a2aManager) return [];
    return a2aManager.listTargets();
  });

  ipcMain.handle('a2a:describe-target', async (event, targetId) => {
    if (!a2aManager) return { error: 'A2AManager not initialized' };
    try {
      return await a2aManager.describeTarget(targetId);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('get-agents', async (event, type = null) => {
    if (!agentManager) return [];
    return agentManager.getAgents(type);
  });

  ipcMain.handle('get-agent', async (event, id) => {
    if (!agentManager) return null;
    return agentManager.getAgent(id);
  });

  ipcMain.handle('create-agent', async (event, data, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.createAgent(data);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('update-agent', async (event, id, data, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.updateAgent(id, data);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('set-agent-sidebar-visible', async (event, id, visible, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.setAgentSidebarVisible(id, visible === true);
    windowManager.send('agent-update');
    return { success: true, ...result };
  });

  ipcMain.handle('delete-agent', async (event, id, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.deleteAgent(id);
    if (toolPermissionService?.deleteAgentProfile) {
      await toolPermissionService.deleteAgentProfile(id);
    }
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('activate-agent', async (event, id, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const result = await agentManager.activateAgent(id);
    windowManager.send('agent-update');
    return result;
  });

  ipcMain.handle('deactivate-agent', async (event, id, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.deactivateAgent(id);
    windowManager.send('agent-update');
    return { success: true };
  });

  ipcMain.handle('compact-agent', async (event, id, options = {}) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    await agentManager.compactAgent(id);
    return { success: true };
  });

  ipcMain.handle('list-agent-files', async (event, agentId) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const folderPath = await agentManager.resolveAgentFolder(agentId);
    if (!folderPath) return { success: false, error: 'Agent folder not found', files: [] };
    return {
      success: true,
      root: await toPortableAgentPath(agentManager, agentId, folderPath),
      files: listFilesRecursive(folderPath)
    };
  });

  ipcMain.handle('read-agent-file', async (event, agentId, relativePath) => {
    if (!agentManager) throw new Error('AgentManager not initialized');
    const folderPath = await agentManager.resolveAgentFolder(agentId);
    if (!folderPath) return { success: false, error: 'Agent folder not found' };
    try {
      const filePath = assertInside(folderPath, path.join(folderPath, String(relativePath || '')));
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: 'Requested path is not a file' };
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        success: true,
        relativePath: String(relativePath || ''),
        path: await toPortableAgentPath(agentManager, agentId, filePath),
        content,
        size: content.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-agent-chat-ui', async (event, agentId, uiContext = {}) => {
    if (!agentManager || !pluginManager?.getAgentChatUI) return null;
    const agentInfo = await getAgentUiInfo(agentManager, agentId);
    if (!agentInfo) return null;
    return pluginManager.getAgentChatUI(agentInfo, uiContext);
  });

  ipcMain.handle('run-agent-chat-ui-action', async (event, agentId, action, payload = {}, uiContext = {}) => {
    if (!agentManager || !pluginManager?.runAgentChatUIAction) {
      return { success: false, error: 'Agent chat UI actions are unavailable' };
    }
    const agentInfo = await getAgentUiInfo(agentManager, agentId);
    if (!agentInfo) return { success: false, error: 'Agent not found' };
    try {
      return await pluginManager.runAgentChatUIAction(agentInfo, action, payload, uiContext);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent-chat-ui-event', async (event, agentId, eventName, payload = {}, uiContext = {}) => {
    if (!agentManager || !pluginManager?.handleAgentChatUIEvent) {
      return { success: false, error: 'Agent chat UI events are unavailable' };
    }
    const agentInfo = await getAgentUiInfo(agentManager, agentId);
    if (!agentInfo) return { success: false, error: 'Agent not found' };
    try {
      return await pluginManager.handleAgentChatUIEvent(agentInfo, eventName, payload, uiContext);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('subagents:list-runs', async (event, filters = {}) => {
    if (!agentManager || typeof agentManager.listSubagentRuns !== 'function') {
      return [];
    }

    try {
      return await agentManager.listSubagentRuns({
        limit: Math.max(1, Number(filters?.limit) || 50),
        status: filters?.status || null,
        parentSessionId: filters?.parentSessionId ?? null,
        subagentId: filters?.subagentId ?? null
      });
    } catch (error) {
      console.error('[IPC] Failed to list subagent runs:', error.message);
      return [];
    }
  });

  ipcMain.handle('subagents:stop-run', async (event, runId, options = {}) => {
    if (!agentManager || typeof agentManager.cancelSubagentRun !== 'function') {
      return { success: false, error: 'Subagent cancellation is unavailable' };
    }

    try {
      const cancelled = await agentManager.cancelSubagentRun(runId, 'Stopped from UI');
      // Resolve the provider the subagent was actually using so we abort the correct adapter.
      const runProvider = cancelled?.run?.provider || cancelled?.run?.queue_provider || null;
      const stopped = aiService?.stopGeneration ? aiService.stopGeneration(runProvider) : false;
      if (chainController?.stopChain) {
        chainController.stopChain(runId);
      }
      console.log(`[IPC] subagents:stop-run ${runId} — cancelled=${cancelled?.success}, stopped=${stopped}, provider=${runProvider || 'default'}`);
      return { ...cancelled, stopped };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('subagents:clear-runs', async (event, filters = {}) => {
    if (!agentManager || typeof agentManager.clearSubagentRuns !== 'function') {
      return { success: false, removed: 0, kept: 0, failed: 0, error: 'Subagent cleanup is unavailable' };
    }

    try {
      return await agentManager.clearSubagentRuns({
        parentSessionId: filters?.parentSessionId ?? null,
        subagentId: filters?.subagentId ?? null,
        status: filters?.status ?? null,
        onlyFinished: filters?.onlyFinished !== false,
        includeRunning: filters?.includeRunning === true,
        matchText: filters?.matchText ? String(filters.matchText) : '',
        runIds: Array.isArray(filters?.runIds) ? filters.runIds : null
      });
    } catch (error) {
      return { success: false, removed: 0, kept: 0, failed: 1, error: error.message };
    }
  });

  ipcMain.handle('subagents:close-run', async (event, runId, options = {}) => {
    if (!agentManager || typeof agentManager.closeSubagentRun !== 'function') {
      return { success: false, removed: 0, error: 'Subagent close is unavailable' };
    }

    try {
      return await agentManager.closeSubagentRun(runId);
    } catch (error) {
      return { success: false, removed: 0, error: error.message };
    }
  });

  ipcMain.handle('subagents:get-run', async (event, runId) => {
    if (!agentManager || typeof agentManager.getSubagentRun !== 'function') {
      return null;
    }
    try {
      return await agentManager.getSubagentRun(runId);
    } catch (error) {
      console.error('[IPC] Failed to fetch subagent run:', error.message);
      return null;
    }
  });
  ipcMain.handle('daemon:memory-start', async (event, options = {}) => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
    if (!memoryDaemon) return { error: 'Memory daemon not initialized' };
    await memoryDaemon.start();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:memory-stop', async (event, options = {}) => {
    if (!memoryDaemon) return { error: 'Memory daemon not initialized' };
    memoryDaemon.stop();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:memory-status', async () => {
    if (!memoryDaemon) return { running: false };
    return memoryDaemon.getStatus();
  });

  ipcMain.handle('daemon:memory-run-now', async (event, options = {}) => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
    if (!memoryDaemon) return { error: 'Memory daemon not initialized' };
    return memoryDaemon.runNow();
  });

  ipcMain.handle('daemon:workflow-start', async (event, options = {}) => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    await workflowScheduler.start();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:workflow-stop', async (event, options = {}) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    workflowScheduler.stop();
    await syncDaemonEnabledSetting();
    return { success: true };
  });

  ipcMain.handle('daemon:workflow-status', async () => {
    if (!workflowScheduler) return { running: false };
    return workflowScheduler.getStatus();
  });

  ipcMain.handle('daemon:add-schedule', async (event, workflowId, intervalMinutes, name, options = {}) => {
    if (testClientMode) return { error: 'Disabled in --testclient mode' };
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.addSchedule(workflowId, intervalMinutes, name);
  });

  ipcMain.handle('daemon:remove-schedule', async (event, scheduleId, options = {}) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.removeSchedule(scheduleId);
  });

  ipcMain.handle('daemon:toggle-schedule', async (event, scheduleId, enabled, options = {}) => {
    if (!workflowScheduler) return { error: 'Workflow scheduler not initialized' };
    return workflowScheduler.toggleSchedule(scheduleId, enabled);
  });

  ipcMain.handle('daemon:get-schedules', async () => {
    if (!workflowScheduler) return [];
    return workflowScheduler._getAllSchedules();
  });

  ipcMain.handle('session-init:detect', async () => {
    if (!sessionInitManager) return { isColdStart: false };
    const daemonRunning = memoryDaemon ? memoryDaemon.running : false;
    return sessionInitManager.detectStartType(daemonRunning);
  });

  ipcMain.handle('session-init:cold-start-prompt', async (event, hoursInactive) => {
    if (!sessionInitManager) return null;
    return sessionInitManager.buildColdStartPrompt(hoursInactive);
  });

  ipcMain.handle('baseinit:check', async () => {
    const completed = await db.getSetting('baseinit.completed');
    return { completed: completed === 'true' };
  });

  ipcMain.handle('baseinit:run', async (event, options = {}) => {
    if (!sessionInitManager) return { error: 'SessionInitManager not initialized' };

    try {
      const report = await sessionInitManager.buildBaseInitReport();
      if (memoryDaemon && !memoryDaemon.running) {
        await memoryDaemon.start();
      }
      if (workflowScheduler && !workflowScheduler.running) {
        await workflowScheduler.start();
      }
      await db.saveSetting('baseinit.completed', 'true');
      await db.saveSetting('baseinit.timestamp', new Date().toISOString());
      await db.saveSetting('baseinit.daemonEnabled', 'true');

      if (eventBus) {
        eventBus.publish('init:baseinit-complete', { report });
      }
      return { success: true, report };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('eventbus:get-log', async (event, category, limit) => {
    if (!eventBus) return [];
    return eventBus.getLog(category, limit);
  });

  // ── Companion Management ───────────────────────────────────────────────

  // Desktop owns companion lifecycle because the renderer settings UI talks to
  // Electron IPC. The HTTP companion server itself stays a transport object and
  // does not construct app services.
  function getCompanionTlsManager() {
    return runtime.companionTlsManager || runtime.container?.optional?.('companionTlsManager') || null;
  }

  function getCompanionServer() {
    return runtime.container?.optional?.('companionServer');
  }

  function getRemoteGatewayManager() {
    let manager = runtime.container?.optional?.('remoteGatewayManager');
    if (!manager) {
      manager = new RemoteGatewayManager({
        db,
        getCompanionServer
      });
      runtime.container?.register?.('remoteGatewayManager', manager);
    }
    const server = getCompanionServer();
    if (server?.setRemoteGatewayManager) server.setRemoteGatewayManager(manager);
    return manager;
  }

  function getCompanionAuth() {
    // CompanionAuth may be used by desktop IPC and HTTP dispatch at different
    // times, so persisted settings are the shared state, not object identity.
    const existing = runtime.container?.optional?.('companionAuth');
    if (existing) return existing;
    const auth = new CompanionAuth(db);
    runtime.container?.replace?.('companionAuth', auth);
    return auth;
  }

  async function getRemoteGatewaySecret() {
    return await db.getCredential?.('remoteGateway.secret')
      || await db.getCredential?.('setting.remoteGateway.secret')
      || await db.getSetting('remoteGateway.secret')
      || '';
  }

  async function saveRemoteGatewaySecret(secret) {
    const value = String(secret || '').trim();
    if (db.setCredential) {
      await db.setCredential('remoteGateway.secret', value);
      await db.deleteSetting?.('remoteGateway.secret').catch(() => {});
      await db.deleteCredential?.('setting.remoteGateway.secret').catch(() => {});
      return;
    }
  }

function buildPairingPayload(pairing, status) {
  if (!pairing) return null;
  const androidHttps = status?.androidBrowserHttps || {};
  const hasLiveSecureCompanion = androidHttps.running === true && Boolean(androidHttps.securePort);
  const useBootstrap = androidHttps.enabled === true;
    // HTTPS pairing intentionally starts on the HTTP bootstrap page so phones
    // can install the local CA before opening the secure companion UI.
    const network = describeCompanionReachability(
      status?.host || pairing.host || '0.0.0.0',
      useBootstrap ? status.port : (status?.port || pairing.port || 8790),
      {
        scheme: 'http',
        pathname: useBootstrap ? '/companion/bootstrap' : '/companion/web',
        pairingCode: pairing.code
      }
    );
    const secureNetwork = androidHttps.enabled && androidHttps.securePort
      ? describeCompanionReachability(status?.host || pairing.host || '0.0.0.0', androidHttps.securePort, {
        scheme: 'https',
        pathname: '/companion/web',
        pairingCode: pairing.code
      })
      : null;
    return {
      success: true,
      ...pairing,
      preferredBrowserUrl: network.preferredBrowserUrl,
      nativeAppUrl: buildNativeCompanionUrl(
        network.preferredHost || status?.preferredHost || pairing.host || '127.0.0.1',
        hasLiveSecureCompanion ? (androidHttps.securePort || status?.port || pairing.port || 8790) : (status?.port || pairing.port || 8790),
        {
          useTls: hasLiveSecureCompanion,
          pairingCode: pairing.code
        }
      ),
      browserUrls: network.browserUrls,
      bootstrapUrl: network.preferredBrowserUrl,
      secureUrl: secureNetwork?.preferredBrowserUrl || '',
      warning: status?.warning || ''
    };
  }

  async function startCompanionServer(options = {}) {
    // Enablement is transactional from the user's point of view: bind first,
    // then persist enabled=true. A failed bind leaves the setting disabled.
    const host = resolveEasyConnectHost(options.host || '0.0.0.0');
    const port = Number(options.port) || 8790;
    const existing = getCompanionServer();
    if (existing?.server) await existing.stop();

    const companionServer = new CompanionApiServer({
      host,
      port,
      tlsManager: getCompanionTlsManager()
    });
    companionServer.setRemoteGatewayManager(getRemoteGatewayManager());
    configureCompanionServer({
      companionServer,
      container: runtime.container,
      db,
      companionAuth: getCompanionAuth()
    });
    attachCompanionRelays({
      companionServer,
      eventBus,
      windowManager,
      getCompanionServer
    });
    try {
      await companionServer.start();
      runtime.container.replace('companionServer', companionServer);
      await db.saveSetting('companion.host', host);
      await db.saveSetting('companion.port', String(port));
      await db.saveSetting('companion.enabled', 'true');
      return { success: true, ...(await getCompanionStatusPayload(db, companionServer, getCompanionTlsManager())) };
    } catch (error) {
      runtime.container.replace('companionServer', null);
      await db.saveSetting('companion.enabled', 'false');
      return { success: false, error: error.message, ...(await getCompanionStatusPayload(db, null, getCompanionTlsManager())) };
    }
  }

  ipcMain.handle('companion:status', async () => {
    const companionServer = getCompanionServer();
    return getCompanionStatusPayload(db, companionServer, getCompanionTlsManager());
  });

  ipcMain.handle('companion:enable', async (event, options = {}) => {
    return startCompanionServer(options || {});
  });

  ipcMain.handle('companion:disable', async () => {
    await db.saveSetting('companion.enabled', 'false');
    const companionServer = getCompanionServer();
    if (companionServer) {
      await companionServer.stop();
    }
    return {
      success: true,
      ...(await getCompanionStatusPayload(db, companionServer, getCompanionTlsManager()))
    };
  });

  ipcMain.handle('companion:set-android-browser-https', async (event, enabled) => {
    const tlsManager = getCompanionTlsManager();
    if (!tlsManager?.setEnabled) return { success: false, error: 'Companion TLS manager is unavailable' };
    await tlsManager.setEnabled(enabled === true);
    if (getCompanionServer()?.server) {
      await startCompanionServer({
        host: await db.getSetting('companion.host') || '0.0.0.0',
        port: Number(await db.getSetting('companion.port')) || 8790
      });
    }
    return { success: true, ...(await getCompanionStatusPayload(db, getCompanionServer(), tlsManager)) };
  });

  ipcMain.handle('companion:setup-android-browser-https', async () => {
    const tlsManager = getCompanionTlsManager();
    if (!tlsManager?.ensureSetup) return { success: false, error: 'Companion TLS manager is unavailable' };
    const host = await db.getSetting('companion.host') || '0.0.0.0';
    const port = Number(await db.getSetting('companion.port')) || 8790;
    await tlsManager.setEnabled(true);
    await tlsManager.ensureSetup(host, port, { force: false });
    const restart = await startCompanionServer({ host, port });
    if (!restart?.success || restart?.androidBrowserHttps?.running !== true) {
      throw new Error(restart?.error || restart?.androidBrowserHttps?.warning || 'Companion HTTPS listener failed to start');
    }
    return { success: true, ...(await getCompanionStatusPayload(db, getCompanionServer(), tlsManager)) };
  });

  ipcMain.handle('companion:generate-pairing', async () => {
    const status = await getCompanionStatusPayload(db, getCompanionServer(), getCompanionTlsManager());
    if (!status.running) return { success: false, error: 'Companion server is not running' };
    const auth = getCompanionAuth();
    const pairing = auth.generatePairing(status.preferredHost || status.host || '0.0.0.0', status.port || 8790);
    return buildPairingPayload(pairing, status);
  });

  ipcMain.handle('companion:get-pairing', async () => {
    const auth = getCompanionAuth();
    const pairing = await auth.getActivePairingAsync();
    if (!pairing) return null;
    const status = await getCompanionStatusPayload(db, getCompanionServer(), getCompanionTlsManager());
    return buildPairingPayload(pairing, status);
  });

  ipcMain.handle('companion:render-qr', async (event, payload) => {
    const { renderQrPayload } = require('../qr-code');
    return {
      success: true,
      ...renderQrPayload(payload)
    };
  });

  ipcMain.handle('companion:cancel-pairing', async () => {
    getCompanionAuth().cancelPairing();
    return { success: true };
  });

  ipcMain.handle('companion:list-devices', async () => {
    const server = getCompanionServer();
    return (await getCompanionAuth().listDevices()).map(device => ({
      ...device,
      connected: Boolean(server?._wsClients?.has(device.deviceId))
    }));
  });

  ipcMain.handle('companion:remove-device', async (event, deviceId) => {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId) return { success: false, error: 'deviceId is required' };
    getCompanionServer()?.disconnectDevice?.(normalizedDeviceId, 'device-removed');
    return getCompanionAuth().removeDevice(normalizedDeviceId);
  });

  ipcMain.handle('companion:update-device-permissions', async (event, deviceId, permissions = {}) => {
    const result = await getCompanionAuth().updateDevicePermissions(String(deviceId || '').trim(), permissions || {});
    if (result?.success) {
      getCompanionServer()?._wsBroadcast?.({ type: 'permissions-update', payload: { deviceId } });
    }
    return result;
  });

  ipcMain.handle('companion:notify-state-changed', async (event, scope, payload = {}) => {
    const type = scope === 'ui' ? 'settings-change' : String(scope || 'settings-change');
    getCompanionServer()?._wsBroadcast?.({ type, payload: payload || {} });
    return { success: true };
  });

  ipcMain.handle('companion:get-permission-presets', async () => {
    const perms = new CompanionPermissions();
    return perms.listPresets().map((preset) => ({
      ...preset,
      scope: perms.getDefaultScope(preset.id)
    }));
  });

  ipcMain.handle('remote-gateway:status', async () => {
    const manager = getRemoteGatewayManager();
    return {
      ...manager.getStatus(),
      enabled: await db.getSetting('remoteGateway.enabled') === 'true',
      savedUrl: await db.getSetting('remoteGateway.url') || ''
    };
  });

  ipcMain.handle('remote-gateway:connect', async (event, options = {}) => {
    const manager = getRemoteGatewayManager();
    const url = String(options.url || await db.getSetting('remoteGateway.url') || '').trim();
    const secret = String(options.secret || await getRemoteGatewaySecret()).trim();
    return manager.connect(url, secret);
  });

  ipcMain.handle('remote-gateway:disconnect', async () => {
    return getRemoteGatewayManager().disconnectAndPersist();
  });

  ipcMain.handle('remote-gateway:generate-secret', async () => {
    const secret = getRemoteGatewayManager().generateSecret();
    await saveRemoteGatewaySecret(secret);
    return { success: true, secret };
  });

  ipcMain.handle('remote-gateway:deploy', async (event, sshConfig = {}) => {
    return getRemoteGatewayManager().uploadGateway(sshConfig || {});
  });

  ipcMain.handle('remote-gateway:setup', async (event, options = {}) => {
    return getRemoteGatewayManager().setupGateway(options || {});
  });
}

module.exports = { registerAgentSystemHandlers };
