const fs = require('fs');
const path = require('path');

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function collectRendererFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRendererFiles(rootDir, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'electron-api.js') {
      files.push(relativePath);
    }
  }
  return files;
}

module.exports = {
  name: 'electron-bridge-hardening-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const electronApi = read(rootDir, 'src/renderer/electron-api.js');
    const electronApiFacade = read(rootDir, 'src/renderer/electron-api-facade.js');
    const indexHtml = read(rootDir, 'src/renderer/index.html');
    const windowManager = read(rootDir, 'src/main/window-manager.js');
    const toolsHandlers = read(rootDir, 'src/main/ipc/register-tools-capability-handlers.js');
    const rendererFiles = collectRendererFiles(rootDir, 'src/renderer')
      .map(filePath => read(rootDir, filePath))
      .join('\n');

    assert.ok(!electronApi.includes('Object.assign(ipcRenderer'), 'Renderer bridge must not expose raw ipcRenderer');
    assert.ok(!electronApi.includes('window.electronAPI ='), 'Preload bridge must not assign APIs directly into the page world');
    assert.includes(electronApi, "contextBridge.exposeInMainWorld('electronBridge'", 'Expected Electron API to be exposed through contextBridge');
    assert.includes(electronApiFacade, 'global.electronAPI = cloneBridge(bridge)', 'Expected renderer page to get a mutable facade over the isolated bridge');
    assert.ok(!indexHtml.includes('src="electron-api.js'), 'Renderer must not load the preload file as a normal script');
    assert.includes(indexHtml, 'src="electron-api-facade.js', 'Renderer must load the page-world bridge facade first');
    assert.includes(windowManager, 'nodeIntegration: false', 'Production BrowserWindow must disable Node in the renderer');
    assert.includes(windowManager, 'contextIsolation: true', 'Production BrowserWindow must enable context isolation');
    assert.includes(windowManager, 'const AUX_WINDOW_OPTIONS = {', 'Expected auxiliary windows to use explicit hardened defaults');
    assert.ok(!windowManager.includes('sandbox: true') || windowManager.includes("preload: path.join(__dirname, '../renderer/electron-api.js')"), 'Any sandboxed renderer path must continue to use the isolated preload bridge');
    assert.includes(windowManager, "preload: path.join(__dirname, '../renderer/electron-api.js')", 'Production BrowserWindow must load the isolated preload bridge');
    assert.ok(!electronApi.includes('on: subscribeAllowed'), 'Renderer bridge must use named event wrappers, not generic on(channel)');
    assert.ok(!rendererFiles.includes('window.electronAPI.on('), 'Renderer code must not use generic electronAPI.on(channel)');
    assert.ok(!rendererFiles.includes('window.electronAPI.invoke('), 'Renderer code must not use generic electronAPI.invoke(channel)');
    assert.ok(!rendererFiles.includes('ipcRenderer.invoke('), 'Renderer code must not call ipcRenderer.invoke directly');
    assert.ok(!rendererFiles.includes('ipcRenderer.on('), 'Renderer code must not call ipcRenderer.on directly');
    assert.ok(!rendererFiles.includes("require('electron')"), 'Renderer components must not import Electron directly');
    assert.includes(electronApi, 'LOCALAGENT_RENDERER_DEBUG', 'Raw debug invoke must stay behind explicit local debug mode');
    assert.ok(!toolsHandlers.includes('bypassPermissions: true'), 'Renderer-triggered tool execution must not bypass permissions');
  }
};
