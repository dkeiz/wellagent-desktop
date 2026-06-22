const TtsService = require('../tts-service');

function registerTtsHandlers(ipcMain, runtime) {
  const service = runtime.container?.optional?.('ttsService') || new TtsService({
    db: runtime.db,
    pluginManager: runtime.pluginManager,
    agentManager: runtime.agentManager,
  });

  ipcMain.handle('tts:get-settings', async () => service.getSettings());

  ipcMain.handle('tts:get-contract', async () => service.getContract());

  ipcMain.handle('tts:save-settings', async (event, settings) => {
    try {
      return { success: true, settings: await service.saveSettings(settings || {}) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tts:list-providers', async (event, options = {}) => {
    return service.listProviders(options || {});
  });

  ipcMain.handle('tts:list-voices', async (event, params = {}) => {
    return service.listVoices(params || {});
  });

  ipcMain.handle('tts:speak', async (event, params = {}) => {
    return service.speak(params || {});
  });

  ipcMain.handle('tts:speak-audio', async (event, params = {}) => {
    return service.speakAudio(params || {});
  });

  ipcMain.handle('tts:stop', async (event, params = {}) => {
    return service.stop(params || {});
  });
}

module.exports = { registerTtsHandlers };
