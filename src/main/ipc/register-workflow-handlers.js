const { redactSettingsForRenderer, saveGenericSetting } = require('../settings-security');

function registerWorkflowHandlers(ipcMain, runtime) {
  const {
    db,
    aiService,
    workflowManager,
    windowManager
  } = runtime;

  ipcMain.handle('get-workflows', async () => {
    try {
      if (workflowManager) {
        return await workflowManager.getWorkflows();
      }
      return await db.getWorkflows();
    } catch (error) {
      console.error('[IPC] get-workflows error:', error);
      return [];
    }
  });

  ipcMain.handle('save-workflow', async (event, workflow) => {
    try {
      const result = await workflowManager.captureWorkflow(
        workflow.name || 'unnamed',
        (workflow.tool_chain || []).map(s => {
          if (String(s.type || '').toLowerCase() === 'agent' || !s.tool) {
            return {
              type: 'agent',
              id: s.id,
              agent: s.agent,
              name: s.name,
              goal: s.goal,
              input: s.input,
              required_output: s.required_output,
              output_schema: s.output_schema,
              final: s.final === true,
              prompt: s.prompt,
              llm: s.llm,
              provider: s.provider,
              model: s.model,
              on_model_error: s.on_model_error
            };
          }
          return {
            type: 'tool',
            id: s.id,
            tool: s.tool,
            params: s.params || {},
            params_from: s.params_from
          };
        }),
        workflow.name
      );
      windowManager.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] save-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-workflow', async (event, workflowId) => {
    try {
      await workflowManager.deleteWorkflow(workflowId);
      windowManager.send('workflow-update');
      return { success: true };
    } catch (error) {
      console.error('[IPC] delete-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('run-workflow', async (event, workflowId) => {
    try {
      const result = await workflowManager.executeWorkflow(workflowId);
      windowManager.send('workflow-update');
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] run-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('execute-workflow', async (event, workflowId, paramOverrides = {}) => {
    try {
      const result = await workflowManager.executeWorkflow(workflowId, paramOverrides);
      windowManager.send('workflow-update');
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] execute-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('run-workflow-advanced', async (event, workflowId, options = {}) => {
    try {
      const result = await workflowManager.runWorkflow(workflowId, {
        mode: options.mode || 'auto',
        paramOverrides: options.paramOverrides || {},
        requestedBySessionId: options.sessionId || null
      });
      windowManager.send('workflow-update');
      return { success: true, ...result };
    } catch (error) {
      console.error('[IPC] run-workflow-advanced error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-workflow-run', async (event, runId) => {
    try {
      return await workflowManager.getWorkflowRun(runId);
    } catch (error) {
      console.error('[IPC] get-workflow-run error:', error);
      return null;
    }
  });

  ipcMain.handle('list-workflow-runs', async (event, filters = {}) => {
    try {
      return await workflowManager.listWorkflowRuns(filters || {});
    } catch (error) {
      console.error('[IPC] list-workflow-runs error:', error);
      return [];
    }
  });

  ipcMain.handle('capture-workflow', async (event, trigger, toolChain, name = null) => {
    try {
      const result = await workflowManager.captureWorkflow(trigger, toolChain, name);
      windowManager.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] capture-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('search-workflows', async (event, query) => {
    try {
      return await workflowManager.findMatchingWorkflows(query);
    } catch (error) {
      console.error('[IPC] search-workflows error:', error);
      return [];
    }
  });

  ipcMain.handle('copy-workflow', async (event, workflowId, newName = null) => {
    try {
      const result = await workflowManager.copyWorkflow(workflowId, newName);
      windowManager.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] copy-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update-workflow', async (event, workflowId, data) => {
    try {
      const result = await workflowManager.updateWorkflow(workflowId, data);
      windowManager.send('workflow-update');
      return { success: true, workflow: result };
    } catch (error) {
      console.error('[IPC] update-workflow error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-settings', async () => {
    const settings = redactSettingsForRenderer(await db.getAllSettings());
    const apiKeys = {};
    for (const provider of aiService.getProviders()) {
      const info = typeof db.getAPIKeyInfo === 'function'
        ? await db.getAPIKeyInfo(provider)
        : { configured: Boolean(await db.getAPIKey(provider)) };
      apiKeys[provider] = info.configured ? 'configured' : '';
    }
    return { ...settings, apiKeys };
  });

  ipcMain.handle('update-settings', async (event, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      await saveGenericSetting(db, key, value);
    }
    return { success: true };
  });

  ipcMain.handle('open-new-window', async () => {
    if (!windowManager?.openAuxWindow) {
      return { success: false, error: 'Window manager not initialized' };
    }
    windowManager.openAuxWindow();
    return { success: true };
  });

  ipcMain.handle('set-api-key', async (event, provider, key) => {
    await db.setAPIKey(provider, key);
    return { success: true };
  });
}

module.exports = { registerWorkflowHandlers };
