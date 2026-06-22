const fs = require('fs');
const path = require('path');

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function collectRendererFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRendererFiles(rootDir, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relativePath);
    }
  }
  return files;
}

module.exports = {
  name: 'renderer-shell-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexHtml = read(rootDir, 'src/renderer/index.html');
    const rendererFiles = collectRendererFiles(rootDir, 'src/renderer')
      .map((filePath) => ({ filePath, content: read(rootDir, filePath) }));

    assert.includes(indexHtml, 'components/renderer-shell.js', 'Renderer shell must load before feature modules');
    assert.ok(!indexHtml.includes('oninput='), 'Renderer HTML must not use inline oninput handlers');
    assert.ok(!indexHtml.includes('onchange='), 'Renderer HTML must not use inline onchange handlers');

    const forbiddenAssignments = [
      'window.mainPanel.sendMessage =',
      'window.mainPanel.addMessage =',
      'window.mainPanel.newChat =',
      'window.mainPanelTabs.saveCurrentTabMessages =',
      'window.mainPanelTabs.switchTab =',
      'window.electronAPI.sendMessage =',
      'window.electronAPI.switchChatSession ='
    ];

    for (const pattern of forbiddenAssignments) {
      const offender = rendererFiles.find((file) => file.content.includes(pattern));
      assert.ok(!offender, `Renderer monkey patch must use shell wrappers instead of direct assignment: ${pattern}`);
    }
  }
};
