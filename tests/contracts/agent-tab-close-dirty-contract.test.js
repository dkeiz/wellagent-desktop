const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'agent-tab-close-dirty-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const tabs = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tabs.js'), 'utf8');
    const continuity = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'chat-continuity.js'), 'utf8');
    const commands = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'command-handler.js'), 'utf8');

    assert.includes(
      tabs,
      'hasChanges: false',
      'Expected tab state to include hasChanges flag with clean default'
    );
    assert.includes(
      tabs,
      'if (!closingTab?.hasChanges) {',
      'Expected close-time deactivate to skip when no changes were made'
    );
    assert.includes(
      continuity,
      'tab.hasChanges = true;',
      'Expected continuity layer to mark tabs as changed on sends/updates'
    );
    assert.includes(
      continuity,
      'activeTab.needsReload = false;',
      'Expected local send completion to clear active reload instead of reloading and jumping scroll'
    );
    assert.includes(
      commands,
      "this.commands.set('/continue'",
      'Expected /continue command registration'
    );
    assert.includes(
      commands,
      "this.commands.set('/resume'",
      'Expected /resume alias registration'
    );
  }
};
