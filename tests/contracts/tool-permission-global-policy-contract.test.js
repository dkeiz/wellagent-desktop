const ToolPermissionService = require('../../src/main/tool-permission-service');

function createCapabilityManager({ mainEnabled = true, unsafeEnabled = false, filesMode = 'read' } = {}) {
  const customToolSafety = new Map([['custom_unsafe', false]]);
  const filesModes = {
    off: [],
    read: ['read_file', 'list_directory', 'file_exists'],
    full: ['read_file', 'write_file', 'delete_file', 'list_directory', 'file_exists']
  };
  return {
    customToolSafety,
    config: { safeTools: { tools: ['read_file'] } },
    isMainEnabled() {
      return mainEnabled;
    },
    isCustomToolSafe(toolName) {
      return customToolSafety.get(toolName) === true;
    },
    getGroupsConfig() {
      return [
        {
          id: 'files',
          enabled: filesMode !== 'off',
          mode: filesMode,
          modes: filesModes,
          tools: filesModes[filesMode],
          allTools: Object.values(filesModes).flat()
        },
        {
          id: 'unsafe',
          enabled: unsafeEnabled,
          tools: unsafeEnabled ? ['custom_unsafe'] : [],
          allTools: ['custom_unsafe']
        }
      ];
    },
    isToolActive(toolName) {
      if (toolName === 'custom_unsafe') return unsafeEnabled;
      return filesModes[filesMode].includes(toolName);
    },
    getGroupForTool(toolName) {
      if (Object.values(filesModes).flat().includes(toolName)) return 'files';
      if (toolName === 'custom_unsafe') return 'unsafe';
      return null;
    }
  };
}

function createService(capabilityManager) {
  return new ToolPermissionService({
    db: {},
    agentManager: null,
    capabilityManager,
    mcpServer: {
      getTools() {
        return [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'custom_unsafe' }
        ];
      },
      async getToolActiveState() {
        return true;
      }
    },
    store: {}
  });
}

module.exports = {
  name: 'tool-permission-global-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const readOnly = await createService(createCapabilityManager()).resolveContext({});
    assert.equal(readOnly.toolStates.read_file, true, 'Expected read file tool to be active in files read mode');
    assert.equal(readOnly.toolStates.write_file, false, 'Expected write file tool to be inactive in files read mode');
    assert.equal(readOnly.toolStates.custom_unsafe, false, 'Expected unsafe custom tool to be inactive when unsafe group is off');
    const readOnlyActive = new Set(readOnly.activeToolNames);
    assert.equal(readOnlyActive.has('read_file'), true, 'Expected readable file tool in global active tool list');
    assert.equal(readOnlyActive.has('write_file'), false, 'Expected file-write tool to stay out of global active tool list');
    assert.equal(readOnlyActive.has('custom_unsafe'), false, 'Expected unsafe custom tool to stay out of global active tool list');

    const unsafeOn = await createService(createCapabilityManager({ unsafeEnabled: true, filesMode: 'full' })).resolveContext({});
    assert.equal(unsafeOn.toolStates.write_file, true, 'Expected write file tool to be active in files full mode');
    assert.equal(unsafeOn.toolStates.custom_unsafe, true, 'Expected unsafe custom tool to be active only when unsafe group is on');

    const mainOff = await createService(createCapabilityManager({ mainEnabled: false, unsafeEnabled: true, filesMode: 'full' })).resolveContext({});
    assert.equal(mainOff.toolStates.read_file, false, 'Expected main switch to disable read file tool');
    assert.equal(mainOff.toolStates.write_file, false, 'Expected main switch to disable write file tool');
    assert.equal(mainOff.toolStates.custom_unsafe, false, 'Expected main switch to disable unsafe custom tool');
  }
};
