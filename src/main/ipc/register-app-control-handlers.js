let app, BrowserWindow, shell;
try { ({ app, BrowserWindow, shell } = require('electron')); } catch (_) { app = null; BrowserWindow = null; shell = null; }
const { readTypefaceList } = require('../ui-typefaces');

function resolveOwnerWindow(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender) || null;
  } catch (_) {
    return null;
  }
}

function registerAppControlHandlers(ipcMain, runtime = {}) {
  function normalizeLocalPath(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (!value.startsWith('file://')) return value;

    try {
      const parsed = new URL(value);
      const decodedPath = decodeURIComponent(parsed.pathname || '');
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        return `\\\\${parsed.hostname}${decodedPath.replace(/\//g, '\\')}`;
      }
      return decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
    } catch (_) {
      return value.replace(/^file:\/+/, '');
    }
  }

  ipcMain.handle('app:refresh-window', async (event) => {
    const ownerWindow = resolveOwnerWindow(event);
    if (!ownerWindow?.webContents?.reloadIgnoringCache) {
      return { success: false, error: 'No active window to refresh' };
    }

    setTimeout(() => {
      try {
        ownerWindow.webContents.reloadIgnoringCache();
      } catch (error) {
        console.error('[IPC] app:refresh-window reload failed:', error);
      }
    }, 25);

    return { success: true };
  });

  ipcMain.handle('app:restart', async () => {
    setTimeout(() => {
      try {
        app.relaunch();
        app.quit();
      } catch (error) {
        console.error('[IPC] app:restart relaunch failed:', error);
      }
    }, 25);

    return { success: true };
  });

  ipcMain.handle('ui:get-typefaces', async () => readTypefaceList(runtime.runtimePaths || {}));

  ipcMain.handle('shell:open-external', async (event, rawUrl) => {
    if (!shell?.openExternal) {
      return { success: false, error: 'Shell integration is unavailable' };
    }
    let target = null;
    try {
      target = new URL(String(rawUrl || '').trim());
    } catch (_) {
      return { success: false, error: 'Invalid external URL' };
    }
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      return { success: false, error: 'External URL protocol is not allowed' };
    }
    await shell.openExternal(target.toString());
    return { success: true };
  });

  ipcMain.handle('shell:open-path', async (event, rawPath) => {
    if (!shell?.openPath) {
      return { success: false, error: 'Shell integration is unavailable' };
    }
    const targetPath = normalizeLocalPath(rawPath);
    if (!targetPath) {
      return { success: false, error: 'Invalid local path' };
    }
    const result = await shell.openPath(targetPath);
    return result
      ? { success: false, error: result }
      : { success: true, path: targetPath };
  });

  ipcMain.handle('shell:show-item-in-folder', async (event, rawPath) => {
    if (!shell?.showItemInFolder) {
      return { success: false, error: 'Shell integration is unavailable' };
    }
    const targetPath = normalizeLocalPath(rawPath);
    if (!targetPath) {
      return { success: false, error: 'Invalid local path' };
    }
    shell.showItemInFolder(targetPath);
    return { success: true, path: targetPath };
  });
}

module.exports = { registerAppControlHandlers };
