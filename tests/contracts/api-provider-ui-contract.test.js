const fs = require('fs');
const path = require('path');

function extractArray(source, marker) {
  const match = source.match(new RegExp(`${marker}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!match) {
    throw new Error(`Failed to locate ${marker}`);
  }

  return match[1]
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.replace(/^['"]|['"]$/g, ''));
}

module.exports = {
  name: 'api-provider-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const htmlPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const apiProviderPath = path.join(rootDir, 'src', 'renderer', 'components', 'api-provider-settings.js');
    const apiProviderHelpersPath = path.join(rootDir, 'src', 'renderer', 'components', 'api-provider-settings-helpers.js');
    const mainPanelPath = path.join(rootDir, 'src', 'renderer', 'components', 'main-panel.js');
    const apiStylesPath = path.join(rootDir, 'src', 'renderer', 'styles', 'api-provider-settings.css');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const apiProviderSource = [
      fs.readFileSync(apiProviderPath, 'utf8'),
      fs.readFileSync(apiProviderHelpersPath, 'utf8')
    ].join('\n');
    const mainPanelSource = fs.readFileSync(mainPanelPath, 'utf8');
    const apiStyles = fs.readFileSync(apiStylesPath, 'utf8');

    assert.includes(html, 'id="llm-config-save-button" class="primary-btn"', 'Expected API save button to use shared button styling');
    assert.includes(html, 'id="test-custom-model-btn" type="button" class="secondary-btn"', 'Expected custom model test button to use shared button styling');
    assert.includes(html, 'id="refresh-provider-models-btn" type="button" class="secondary-btn"', 'Expected model discovery button to use shared button styling');
    assert.equal(html.includes('Context Window Size'), false, 'Expected standalone context section heading to be removed');
    assert.equal(
      html.includes('Context length determines how much of your conversation local LLMs can remember and use to generate responses.'),
      false,
      'Expected standalone context description to be removed'
    );
    assert.ok(
      html.indexOf('<h3>Connection</h3>') < html.indexOf('id="context-slider"'),
      'Expected context slider to live inside the Connection card'
    );
    assert.includes(html, 'id="context-window-readonly"', 'Expected read-only context state container for provider-managed context windows');

    const sliderMaxMatch = html.match(/id="context-slider"[^>]*max="(\d+)"/);
    assert.ok(sliderMaxMatch, 'Expected API context slider max attribute to exist');

    const scaleBlockMatch = html.match(/<div class="context-scale"[\s\S]*?<\/div>/);
    assert.ok(scaleBlockMatch, 'Expected context scale block to exist');

    const scaleLabels = [...scaleBlockMatch[0].matchAll(/<span>([^<]+)<\/span>/g)]
      .map(([, label]) => label.trim().toUpperCase());
    const presetValues = extractArray(mainPanelSource, 'static CONTEXT_PRESETS').map(Number);
    const presetLabels = extractArray(mainPanelSource, 'static CONTEXT_LABELS').map(label => label.toUpperCase());

    assert.equal(Number(sliderMaxMatch[1]), presetValues.length - 1, 'Expected slider max to match visible preset count');
    assert.deepEqual(scaleLabels, presetLabels, 'Expected visible slider labels to match context preset labels');
    assert.includes(apiStyles, '#api-tab.tab-content.active', 'Expected API layout styles to target the active tab only');
    assert.includes(apiStyles, '#api-tab #context-slider {', 'Expected API-specific slider styling block');
    assert.includes(apiStyles, 'appearance: none;', 'Expected API slider to disable generic input chrome');
    assert.includes(apiStyles, 'background: transparent;', 'Expected API slider to render without boxed input background');
    assert.includes(apiStyles, 'width: calc(100% - 18px);', 'Expected context labels to use thumb-aware width');
    assert.includes(apiStyles, 'span:nth-child(9) { left: 88.8889%; }', 'Expected context labels to map to fixed slider stop positions');
    assert.includes(apiProviderSource, 'class="api-pill-picker"', 'Expected thinking visibility to use compact pill picker UI');
    assert.includes(apiProviderSource, 'Request overrides (JSON)', 'Expected request override editor for compatible providers');
    assert.equal(apiProviderSource.includes('Remember text streaming preference'), false, 'Expected text streaming remember checkbox to be removed');
    assert.equal(apiProviderSource.includes('Remember thinking streaming preference'), false, 'Expected thinking streaming remember checkbox to be removed');
    assert.deepEqual(
      presetValues,
      [4096, 8192, 16384, 32768, 49152, 65536, 98304, 131072, 196608, 262144],
      'Unexpected API context preset values'
    );
  }
};
