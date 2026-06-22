const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'chat-title-lightbox-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const tabs = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tabs.js'), 'utf8');
    const tabRestore = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tab-restore.js'), 'utf8');
    const panel = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel.js'), 'utf8');
    const titleMatches = [
      ...(tabs.match(/title: nextRegularChatTitle\(panel\)/g) || []),
      ...(tabRestore.match(/title: nextRegularChatTitle\(panel\)/g) || [])
    ];

    assert.includes(tabs, 'function nextRegularChatTitle(panel)', 'Expected helper for unique regular chat titles');
    assert.equal(titleMatches.length, 2, 'Expected both new and restored regular chats to use generated unique titles');
    assert.includes(panel, 'this._closeLightbox?.();', 'Expected opening a new lightbox to clean up any existing lightbox state');
    assert.includes(panel, "event.key === 'Escape'", 'Expected Escape to close the image lightbox');
    assert.includes(panel, "document.removeEventListener('keydown', onKeyDown);", 'Expected Escape handler cleanup when closing the lightbox');
  }
};
