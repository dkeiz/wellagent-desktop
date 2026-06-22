const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'windowless-main-lifetime-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const mainSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'main.js'), 'utf8');
    assert.includes(
      mainSource,
      "app.on('window-all-closed', () => {\n  if (isWindowlessMode) return;",
      'Expected windowless mode to skip quitting when transient hidden browser windows close'
    );
  }
};
