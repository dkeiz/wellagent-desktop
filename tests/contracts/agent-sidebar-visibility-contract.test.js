const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'agent-sidebar-visibility-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const superagentSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'superagent-manager-tab.js'), 'utf8');
    const pickerSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'agent-picker.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    const dbSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'database-migrations.js'), 'utf8');

    assert.includes(dbSource, 'visible_in_sidebar INTEGER NOT NULL DEFAULT 1', 'Agents should default to sidebar-visible');
    assert.includes(apiSource, 'set-agent-sidebar-visible', 'Renderer API should expose agent sidebar visibility updates');
    assert.includes(superagentSource, 'superagent-manager-visibility', 'Superagent manager should render a Show visibility button');
    assert.includes(superagentSource, 'agents.setSidebarVisible(agent.id, !visible)', 'Show button should toggle agent sidebar visibility');
    assert.includes(pickerSource, 'agent.visibleInSidebar !== false', 'Sidebar picker should filter hidden agents');
  }
};
