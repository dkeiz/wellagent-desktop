const {
  buildLlmRuntime,
  buildAppControlRuntime,
  buildToolsRuntime,
  buildWorkflowRuntime
} = require('../../src/main/ipc/runtime-dependencies');

module.exports = {
  name: 'ipc-runtime-builder-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const shared = {
      container: { optional() { return null; } },
      db: { get() { return null; } },
      aiService: { getProviders() { return []; } },
      promptFileManager: { syncToFiles() {} },
      workflowManager: { getWorkflows() { return []; } },
      windowManager: { send() {} },
      mcpServer: { getTools() { return []; } },
      capabilityManager: { getState() { return {}; } },
      toolPermissionService: { resolveContext() { return {}; } },
      chainController: { executeWithChaining() {} },
      dispatcher: { dispatch() {} },
      runtimePolicy: {},
      executionDirectory: {},
      agentManager: {},
      sessionWorkspace: {},
      eventBus: {},
      runtimePaths: { typefacesFile: 'C:\\typefaces.json' }
    };

    const llmRuntime = buildLlmRuntime(shared);
    assert.equal(llmRuntime.container, shared.container, 'Expected llm runtime to expose the service container');
    assert.equal(llmRuntime.promptFileManager, shared.promptFileManager, 'Expected llm runtime to expose prompt file manager');
    assert.equal(llmRuntime.chainController, shared.chainController, 'Expected llm runtime to expose chain controller');

    const workflowRuntime = buildWorkflowRuntime(shared);
    assert.equal(workflowRuntime.db, shared.db, 'Expected workflow runtime to expose db');
    assert.equal(workflowRuntime.aiService, shared.aiService, 'Expected workflow runtime to expose aiService');
    assert.equal(workflowRuntime.windowManager, shared.windowManager, 'Expected workflow runtime to expose windowManager');

    const toolsRuntime = buildToolsRuntime(shared);
    assert.equal(toolsRuntime.db, shared.db, 'Expected tools runtime to expose db');
    assert.equal(toolsRuntime.windowManager, shared.windowManager, 'Expected tools runtime to expose windowManager');
    assert.equal(toolsRuntime.mcpServer, shared.mcpServer, 'Expected tools runtime to expose mcpServer');

    const appRuntime = buildAppControlRuntime(shared);
    assert.equal(appRuntime.runtimePaths, shared.runtimePaths, 'Expected app-control runtime to expose runtimePaths');
    assert.equal(appRuntime.windowManager, shared.windowManager, 'Expected app-control runtime to expose windowManager');
  }
};
