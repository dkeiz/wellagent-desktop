const { EventEmitter } = require('events');
const MCPServer = require('../../src/main/mcp-server');
const { getInnerBrowserService } = require('../../src/main/mcp/register-web-system-tools');

async function captureError(fn) {
  try {
    await fn();
    return '';
  } catch (error) {
    return error.message || String(error);
  }
}

function createServer() {
  const db = {
    async getSetting(key) {
      if (key === 'tool_timeout_ms') return '5000';
      return null;
    }
  };
  const capabilityManager = {
    getGroupsConfig() { return []; },
    getActiveTools() { return []; },
    isToolActive() { return true; }
  };
  return new MCPServer(db, capabilityManager);
}

class FakeHostWindow extends EventEmitter {
  constructor() {
    super();
    this.id = 'host-1';
    this.destroyed = false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}

class FakeWebRequest {
  onBeforeRequest(filter, handler) {
    this.filter = filter;
    this.handler = handler;
  }
}

class FakeSession {
  constructor() {
    this.webRequest = new FakeWebRequest();
    this.permissionRequestHandler = null;
    this.permissionCheckHandler = null;
  }

  setPermissionRequestHandler(handler) {
    this.permissionRequestHandler = handler;
  }

  setPermissionCheckHandler(handler) {
    this.permissionCheckHandler = handler;
  }
}

class FakeWebContents extends EventEmitter {
  constructor(owner) {
    super();
    this.owner = owner;
    this.session = new FakeSession();
    this.windowOpenHandler = null;
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  isLoading() {
    return false;
  }

  async executeJavaScript(script) {
    return this.owner.evaluateScript(script);
  }
}

class FakeBrowserWindow extends EventEmitter {
  static hostWindow = new FakeHostWindow();
  static instances = [];
  static nextId = 1;

  static getAllWindows() {
    return [FakeBrowserWindow.hostWindow, ...FakeBrowserWindow.instances.filter(win => !win.destroyed)];
  }

  static reset() {
    FakeBrowserWindow.hostWindow = new FakeHostWindow();
    FakeBrowserWindow.instances = [];
    FakeBrowserWindow.nextId = 1;
  }

  constructor(options) {
    super();
    this.id = `inner-${FakeBrowserWindow.nextId++}`;
    this.options = options;
    this.destroyed = false;
    this.menuBarVisible = true;
    this.webContents = new FakeWebContents(this);
    this.currentUrl = 'about:blank';
    this.currentTitle = '';
    this.readyState = 'complete';
    this.bodyText = '';
    this.outerHtml = '<html><body></body></html>';
    FakeBrowserWindow.instances.push(this);
  }

  setMenuBarVisibility(visible) {
    this.menuBarVisible = visible;
  }

  async loadURL(url) {
    this.currentUrl = String(url || 'about:blank');
    if (this.currentUrl.includes('ephemeral')) {
      this.currentTitle = 'Ephemeral Page';
      this.bodyText = 'Ephemeral body text';
      this.outerHtml = '<html><body>Ephemeral body text</body></html>';
    } else {
      this.currentTitle = 'Example Page';
      this.bodyText = 'Rendered browser body';
      this.outerHtml = '<html><body>Rendered browser body</body></html>';
    }
    this.webContents.emit('page-title-updated', {}, this.currentTitle);
    this.webContents.emit('did-navigate', {}, this.currentUrl);
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }

  evaluateScript(script) {
    const source = String(script || '');
    if (source === 'document.readyState') return this.readyState;
    if (source.includes('location.href') && source.includes('document.title')) {
      return {
        url: this.currentUrl,
        title: this.currentTitle,
        readyState: this.readyState
      };
    }
    if (source.includes('document.documentElement ? String(document.documentElement.outerHTML')) {
      return this.outerHtml;
    }
    if (source.includes("document.body ? (document.body.innerText || document.body.textContent || '')")) {
      return this.bodyText;
    }
    if (source.includes("document.body ? String(document.body.innerText || document.body.textContent || '')")) {
      return this.bodyText;
    }
    if (source.startsWith('Boolean(document.querySelector(')) {
      return false;
    }
    throw new Error(`Unhandled fake executeJavaScript script: ${source.slice(0, 120)}`);
  }
}

function createFakeElectron() {
  const app = new EventEmitter();
  return { app, BrowserWindow: FakeBrowserWindow };
}

module.exports = {
  name: 'inner-browser-tool-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    FakeBrowserWindow.reset();

    const missingRuntimeServer = createServer();
    const missingRuntimeTool = missingRuntimeServer.getTools().find(entry => entry.name === 'inner_browser');
    assert.ok(missingRuntimeTool, 'Expected inner_browser to be registered as a built-in tool');
    assert.equal(missingRuntimeTool.inputSchema.properties.action.type, 'string', 'Expected inner_browser to require an action string');
    assert.equal(missingRuntimeTool.inputSchema.properties.sessionId.type, 'string', 'Expected inner_browser to expose sessionId');

    const missingRuntimeMessage = await captureError(() => missingRuntimeServer.executeTool('inner_browser', {
      action: 'session',
      session_action: 'open',
      url: 'https://example.com'
    }));
    assert.includes(
      missingRuntimeMessage,
      'Electron main-process runtime with BrowserWindow support',
      'Expected inner_browser to fail clearly outside Electron runtime'
    );

    const server = createServer();
    const service = getInnerBrowserService(server);
    service._electron = createFakeElectron();
    server._windowManager = { hasMainWindow() { return true; } };
    server._uiMode = { noWindow: false };

    let artifact = null;
    server.setArtifactRegistry({
      registerVirtual(sessionId, payload) {
        artifact = { sessionId, payload };
      }
    });

    const openResult = await server.executeTool(
      'inner_browser',
      {
        action: 'session',
        session_action: 'open',
        sessionId: 'browser-1',
        session_name: 'Research Session',
        url: 'https://example.com/page',
        wait_until: 'none'
      },
      null,
      { context: { sessionId: 'chat-7', agentId: 'agent-9' } }
    );
    assert.equal(openResult.success, true, 'Expected inner_browser session open to succeed with fake Electron');
    assert.equal(openResult.result.sessionId, 'browser-1', 'Expected explicit browser session id to be preserved');
    assert.equal(openResult.result.sessionName, 'Research Session', 'Expected browser session name to be preserved');
    assert.equal(service.sessions.size, 1, 'Expected a persistent browser session to be tracked');

    const browserWindow = FakeBrowserWindow.instances[0];
    assert.ok(browserWindow, 'Expected hidden BrowserWindow instance to be created');
    assert.equal(browserWindow.options.show, false, 'Expected inner browser windows to stay hidden');
    assert.equal(browserWindow.options.webPreferences.nodeIntegration, false, 'Expected inner browser to disable renderer Node integration');
    assert.equal(browserWindow.options.webPreferences.contextIsolation, true, 'Expected inner browser to enable context isolation');
    assert.equal(browserWindow.options.webPreferences.sandbox, true, 'Expected inner browser to enable Electron sandboxing');
    assert.includes(String(browserWindow.options.webPreferences.partition), 'inner-browser-browser-1-', 'Expected inner browser to use an isolated session partition');
    assert.equal(browserWindow.menuBarVisible, false, 'Expected inner browser windows to hide the menu bar');
    assert.equal(typeof browserWindow.webContents.windowOpenHandler, 'function', 'Expected pop-up creation to be denied through setWindowOpenHandler');
    assert.deepEqual(browserWindow.webContents.session.webRequest.filter, { urls: ['<all_urls>'] }, 'Expected request policy hook to cover all URLs');
    assert.equal(typeof browserWindow.webContents.session.permissionRequestHandler, 'function', 'Expected permission requests to be denied explicitly');
    assert.equal(typeof browserWindow.webContents.session.permissionCheckHandler, 'function', 'Expected permission checks to be denied explicitly');

    const listResult = await server.executeTool('inner_browser', {
      action: 'session',
      session_action: 'list'
    });
    assert.equal(listResult.result.sessionCount, 1, 'Expected session list to expose the persistent session');
    assert.equal(listResult.result.sessions[0].page.url, 'https://example.com/page', 'Expected session list to report current page URL');

    const renderResult = await server.executeTool(
      'inner_browser',
      {
        action: 'render',
        sessionId: 'browser-1',
        format: 'text',
        title: 'Browser Snapshot'
      },
      null,
      { context: { sessionId: 'chat-7', agentId: 'agent-9' } }
    );
    assert.equal(renderResult.result.viewerContent.type, 'text', 'Expected render to emit viewer-ready text content');
    assert.equal(renderResult.result.viewerContent.title, 'Browser Snapshot', 'Expected render title override to be preserved');
    assert.equal(renderResult.result.viewerContent.sourceSessionId, 'chat-7', 'Expected render viewer payload to keep chat session context');
    assert.equal(renderResult.result.viewerContent.sourceAgentId, 'agent-9', 'Expected render viewer payload to keep agent context');
    assert.equal(renderResult.result.preview, 'Rendered browser body', 'Expected render preview to summarize current page text');
    assert.equal(artifact.sessionId, 'chat-7', 'Expected inner_browser render artifacts to be scoped to the active chat session');
    assert.equal(artifact.payload.source, 'inner_browser', 'Expected artifact source to identify inner_browser');
    assert.equal(artifact.payload.data.sessionId, 'browser-1', 'Expected artifact payload to include browser session id');

    server._windowManager = { hasMainWindow() { return false; } };
    server._uiMode = { noWindow: true };
    const noUiRenderResult = await server.executeTool(
      'inner_browser',
      {
        action: 'render',
        sessionId: 'browser-1',
        format: 'text',
        title: 'No UI Snapshot'
      },
      null,
      { context: { sessionId: 'chat-7', agentId: 'agent-9' } }
    );
    assert.equal(noUiRenderResult.result.uiRendered, false, 'Expected render to skip UI delivery in no_ui mode');
    assert.equal(noUiRenderResult.result.viewerContent, null, 'Expected no_ui render to omit viewerContent');
    assert.equal(noUiRenderResult.result.content.type, 'text', 'Expected no_ui render to keep structured content payload');
    assert.equal(noUiRenderResult.result.content.title, 'No UI Snapshot', 'Expected no_ui render payload to preserve the requested title');

    server._windowManager = { hasMainWindow() { return true; } };
    server._uiMode = { noWindow: false };
    const extractResult = await server.executeTool('inner_browser', {
      action: 'extract',
      url: 'https://example.com/ephemeral',
      format: 'text',
      wait_until: 'none'
    });
    assert.equal(extractResult.result.content, 'Ephemeral body text', 'Expected extract to return page text from an ephemeral browser session');
    assert.equal(service.sessions.size, 1, 'Expected ephemeral extract sessions to be cleaned up automatically');

    const closeResult = await server.executeTool('inner_browser', {
      action: 'session',
      session_action: 'close',
      sessionId: 'browser-1'
    });
    assert.equal(closeResult.result.closed, true, 'Expected persistent browser sessions to close cleanly');
    assert.equal(service.sessions.size, 0, 'Expected closing the persistent session to clear tracked sessions');
  }
};
