const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'terminal-permission-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const permissionDialog = fs.readFileSync(
      path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-permissions.js'),
      'utf8'
    );
    const capabilityPanel = fs.readFileSync(
      path.join(rootDir, 'src', 'renderer', 'components', 'capability-panel.js'),
      'utf8'
    );
    const electronApi = fs.readFileSync(
      path.join(rootDir, 'src', 'renderer', 'electron-api.js'),
      'utf8'
    );
    const capabilityStyles = fs.readFileSync(
      path.join(rootDir, 'src', 'renderer', 'styles', 'capability-panel.css'),
      'utf8'
    );
    const terminalTools = fs.readFileSync(
      path.join(rootDir, 'src', 'main', 'mcp', 'register-terminal-tools.js'),
      'utf8'
    );
    const dispatcher = fs.readFileSync(
      path.join(rootDir, 'src', 'main', 'inference-dispatcher.js'),
      'utf8'
    );
    const promptBuilder = fs.readFileSync(
      path.join(rootDir, 'src', 'main', 'inference', 'inference-prompt-builder.js'),
      'utf8'
    );
    const runtimePromptSource = `${dispatcher}\n${promptBuilder}`;

    assert.includes(permissionDialog, "permissionType === 'terminal_scope'", 'Expected terminal scope dialog branch');
    assert.includes(permissionDialog, 'Enable System Terminal', 'Expected system terminal permission action');
    assert.includes(permissionDialog, 'allowOutsideExecutionRootOnce', 'Expected allow-once outside-root option');
    assert.includes(capabilityPanel, 'cycleTerminalMode', 'Expected terminal mode cycling in capability panel');
    assert.includes(electronApi, 'capability:set-terminal-mode', 'Expected renderer API for terminal mode');
    assert.includes(capabilityStyles, '[data-group="terminal"] .mode-indicator', 'Expected terminal pad mode dots');
    assert.includes(capabilityStyles, '[data-group="terminal"][data-mode="system"] .mode-dot', 'Expected terminal system dot state');
    assert.includes(terminalTools, 'Terminal permission has modes', 'Expected run_command tool description to explain terminal modes');
    assert.includes(terminalTools, 'Timeout in seconds', 'Expected run_command timeout schema to use seconds');
    assert.includes(runtimePromptSource, 'call run_command with that outside cwd', 'Expected runtime prompt to explain requesting system terminal access');
    assert.includes(runtimePromptSource, 'timeout is in seconds', 'Expected runtime prompt to explain run_command timeout units');
  }
};
