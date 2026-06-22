const fs = require('fs');
const path = require('path');

function collectScriptSources(html) {
  const sources = [];
  const pattern = /<script\s+src="([^"]+)"/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    sources.push(match[1]);
  }

  return sources;
}

module.exports = {
  name: 'renderer-script-wiring-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const capabilityPanel = fs.readFileSync(
      path.join(rootDir, 'src', 'renderer', 'components', 'capability-panel.js'),
      'utf8'
    );
    const scripts = collectScriptSources(html);
    const required = [
      'components/chart-renderer.js',
      'components/main-panel-tabs.js',
      'components/main-panel-permissions.js',
      'components/message-formatter.js',
      'components/api-provider-settings.js',
      'components/main-panel.js',
      'components/main-panel-content-viewer-links.js',
      'components/split-pane.js',
      'components/content-viewer.js',
      'components/app-layout-mode.js',
      'app.js'
    ];

    const positions = required.map(scriptPrefix => {
      const index = scripts.findIndex(src => src.startsWith(scriptPrefix));
      return { scriptPrefix, index };
    });

    const missing = positions
      .filter(entry => entry.index === -1)
      .map(entry => entry.scriptPrefix);

    assert.equal(
      missing.length,
      0,
      `Missing renderer helper scripts in index.html:\n${missing.join('\n')}`
    );

    for (let i = 1; i < positions.length; i++) {
      const previous = positions[i - 1];
      const current = positions[i];
      assert.ok(
        previous.index < current.index,
        `Expected ${previous.scriptPrefix} to load before ${current.scriptPrefix}`
      );
    }

    assert.equal(
      capabilityPanel.includes('capability-context-badge'),
      false,
      'Expected compact tools UI not to create a visible resolved-context badge'
    );
    assert.equal(
      /textContent\s*=\s*[`'"]Resolved Context/.test(capabilityPanel),
      false,
      'Expected compact tools UI not to render resolved context labels'
    );
  }
};
