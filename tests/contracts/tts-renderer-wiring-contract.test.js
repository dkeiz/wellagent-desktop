const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'tts-renderer-wiring-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexHtml = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const mainPanel = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel.js'), 'utf8');
    const mainPanelVoice = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-voice.js'), 'utf8');
    const pluginStudio = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'plugin-studio-panel.js'), 'utf8');
    const ttsWiringSource = `${mainPanel}\n${mainPanelVoice}`;

    assert.includes(indexHtml, 'components/tts-text-utils.js', 'Expected renderer to load TTS text utils');
    assert.includes(indexHtml, 'components/tts-controller.js', 'Expected renderer to load TTS controller');
    assert.includes(indexHtml, 'components/plugin-studio-tts-panel.js', 'Expected renderer to load plugin studio TTS helper');

    assert.includes(ttsWiringSource, 'LocalAgentTtsController', 'Expected main panel voice path to delegate playback to the TTS controller');
    assert.includes(pluginStudio, 'LocalAgentPluginTtsStudio', 'Expected plugin studio to delegate custom TTS UI');

    const watchedFiles = [
      path.join(rootDir, 'src', 'renderer', 'components', 'main-panel.js'),
      path.join(rootDir, 'src', 'renderer', 'components', 'tts-controller.js'),
      path.join(rootDir, 'src', 'renderer', 'components', 'plugin-studio-tts-panel.js'),
      path.join(rootDir, 'agentin', 'plugins', 'http-tts-bridge', 'main.js')
    ];

    for (const filePath of watchedFiles) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${path.relative(rootDir, filePath)} to stay under 1000 lines`);
    }
  }
};
