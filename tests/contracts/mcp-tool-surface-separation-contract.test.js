const fs = require('fs');
const path = require('path');

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

module.exports = {
  name: 'mcp-tool-surface-separation-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const toolsIpc = read(rootDir, 'src/main/ipc/register-tools-capability-handlers.js');
    const bridge = read(rootDir, 'src/renderer/electron-api.js');
    const sidebar = read(rootDir, 'src/renderer/components/sidebar.js');
    const agentPicker = read(rootDir, 'src/renderer/components/agent-picker.js');
    const indexHtml = read(rootDir, 'src/renderer/index.html');

    assert.includes(
      toolsIpc,
      "ipcMain.handle('get-mcp-tool-inventory'",
      'Expected tools IPC to expose a dedicated full-registry handler'
    );
    assert.includes(
      toolsIpc,
      'mcpServer.getToolsForContext(context || {})',
      'Expected tools IPC to use context-filtered visibility by default'
    );

    assert.includes(
      bridge,
      'getMCPToolInventory',
      'Expected renderer bridge to expose full tool inventory separately from visible tools'
    );
    assert.includes(
      bridge,
      "getMCPTools: (context = {}) => ipcRenderer.invoke('get-mcp-tools', context)",
      'Expected renderer bridge to pass context for visible-tool queries'
    );

    assert.includes(
      sidebar,
      'window.electronAPI.getMCPTools(permissionContext)',
      'Expected MCP tab to load only tools visible in the current context'
    );
    assert.includes(
      sidebar,
      'window.electronAPI.getMCPTools?.(this.getPermissionContext())',
      'Expected workflow tool picker to use the same context-filtered tool list'
    );
    assert.includes(
      sidebar,
      'No tools are visible in this chat context.',
      'Expected MCP tab to explain empty visible-tool contexts'
    );

    assert.includes(
      agentPicker,
      'window.electronAPI.getMCPToolInventory()',
      'Expected agent permission editor to load the full registry for opt-in control'
    );
    assert.includes(
      agentPicker,
      'window.electronAPI.getMCPTools({ agentId })',
      'Expected agent permission editor to separately load default-visible tools'
    );
    assert.includes(
      agentPicker,
      'Visible by default',
      'Expected agent permission editor to distinguish default-visible tools'
    );
    assert.includes(
      agentPicker,
      'Other registered tools',
      'Expected agent permission editor to expose additional registry tools for manual opt-in'
    );

    assert.includes(
      indexHtml,
      'Shows only tools visible to the current chat or agent.',
      'Expected MCP tab copy to describe visible-tool semantics'
    );
  }
};
