const SttService = require('../stt-service');

function registerSttHandlers(ipcMain, runtime) {
  const service = runtime.container?.optional?.('sttService') || new SttService({
    db: runtime.db,
    runtimePaths: runtime.container?.optional?.('runtimePaths'),
    pluginManager: runtime.container?.optional?.('pluginManager')
  });

  ipcMain.handle('stt:get-contract', async () => service.getContract());

  ipcMain.handle('stt:get-settings', async () => service.getSettings());

  ipcMain.handle('stt:save-settings', async (event, settings) => {
    return service.saveSettings(settings || {});
  });

  ipcMain.handle('stt:list-providers', async (event, options = {}) => {
    return service.listProviders(options || {});
  });

  ipcMain.handle('stt:transcribe-audio', async (event, params = {}) => {
    return service.transcribeAudio(params || {});
  });
}

module.exports = { registerSttHandlers };
