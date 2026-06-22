const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function createDocumentStub() {
  const styleValues = new Map();
  const attrs = new Map();
  return {
    body: { style: {} },
    documentElement: {
      style: {
        setProperty(name, value) { styleValues.set(name, String(value)); },
        getPropertyValue(name) { return styleValues.get(name) || ''; }
      },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.get(name) || ''; }
    },
    createElement(tagName) {
      return { tagName, value: '', textContent: '' };
    },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}

module.exports = {
  name: 'ui-typefaces-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const listPath = path.join(rootDir, 'agentin', 'ui', 'typefaces.json');
    const listPayload = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    const ids = listPayload.typefaces.map(entry => entry.id);
    assert.ok(ids.includes('current'), 'Expected editable type list to include current UI font');
    assert.ok(ids.includes('terminal'), 'Expected editable type list to include terminal font');

    const {
      DEFAULT_TYPEFACES,
      normalizeTypefaceList,
      readTypefaceList
    } = require(path.join(rootDir, 'src', 'main', 'ui-typefaces.js'));
    const fromFile = readTypefaceList({ typefacesFile: listPath });
    assert.equal(fromFile.source, 'file', 'Expected typefaces to load from exposed JSON');
    assert.equal(
      fromFile.typefaces.find(entry => entry.id === 'terminal').family,
      '"Consolas", "Monaco", "Courier New", monospace',
      'Expected terminal option to expose the existing terminal font stack'
    );

    const missing = readTypefaceList({ typefacesFile: path.join(rootDir, 'agentin', 'ui', 'missing-typefaces.json') });
    assert.equal(missing.source, 'fallback', 'Expected missing type list to fall back');
    assert.equal(missing.typefaces.length, DEFAULT_TYPEFACES.length, 'Expected fallback defaults when list is missing');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-typefaces-'));
    const invalidPath = path.join(tempDir, 'typefaces.json');
    fs.writeFileSync(invalidPath, '{ invalid json', 'utf8');
    const invalid = readTypefaceList({ typefacesFile: invalidPath });
    fs.rmSync(tempDir, { recursive: true, force: true });
    assert.equal(invalid.source, 'fallback', 'Expected invalid JSON to fall back');

    const keyed = normalizeTypefaceList({
      current: DEFAULT_TYPEFACES[0].family,
      custom: { label: 'Custom', family: 'Custom Mono; color: red' }
    });
    assert.equal(keyed.find(entry => entry.id === 'custom').family.includes(';'), false, 'Expected typeface families to be sanitized');

    const html = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    assert.ok(
      /class="type-setting-row type-size-setting"[\s\S]*<label for="type-size-slider">Type Size<\/label>[\s\S]*<input type="range" id="type-size-slider"[\s\S]*<span id="type-size-display">13px<\/span>/.test(html),
      'Expected type size label, slider, and value to share one row'
    );
    assert.includes(html, 'id="type-picker"', 'Expected settings to expose a type picker');

    const buttonsCss = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'buttons.css'), 'utf8');
    assert.includes(buttonsCss, '.type-setting-row', 'Expected shared type setting row CSS');
    assert.includes(buttonsCss, 'grid-template-columns: max-content minmax(160px, 340px) max-content;', 'Expected type size row to stay inline');

    const themeCss = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    assert.includes(themeCss, '--ui-type-family', 'Expected theme to define UI typeface variable');
    assert.includes(themeCss, 'font-family: var(--ui-type-family);', 'Expected body to use selected UI typeface variable');

    const commandsCss = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'commands.css'), 'utf8');
    assert.includes(
      commandsCss,
      "font-family: 'Consolas', 'Monaco', 'Courier New', monospace !important;",
      'Expected terminal output font to remain unchanged'
    );

    const preloadSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    assert.includes(preloadSource, 'appearance:', 'Expected renderer bridge to expose appearance API');
    assert.includes(preloadSource, "ipcRenderer.invoke('ui:get-typefaces')", 'Expected renderer bridge to request typefaces over IPC');

    const appControlSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-app-control-handlers.js'), 'utf8');
    assert.includes(appControlSource, "ipcMain.handle('ui:get-typefaces'", 'Expected main process to register typeface IPC');

    const packageSource = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    assert.includes(packageSource, '"ui/**/*"', 'Expected packaged agentin files to include editable UI type list');

    const appSource = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'app.js'), 'utf8');
    const documentStub = createDocumentStub();
    const context = {
      console,
      MainPanel: function MainPanel() {},
      window: {},
      document: documentStub,
      localStorage: { getItem() { return null; }, setItem() {} }
    };
    context.window = context;
    vm.runInNewContext(`${appSource}\nthis.__CapturedApp = App;`, context, { filename: 'app.js' });
    const AppClass = context.__CapturedApp;
    const app = Object.create(AppClass.prototype);
    const select = {
      value: '',
      children: [],
      replaceChildren(...children) { this.children = children; }
    };
    const selected = app.renderTypePicker(select, fromFile.typefaces, 'terminal');
    assert.equal(selected.id, 'terminal', 'Expected picker to select typeface from exposed list');
    assert.equal(select.children.length, fromFile.typefaces.length, 'Expected picker options to come from exposed list');
    app.applyTypeface(selected);
    assert.equal(
      documentStub.documentElement.style.getPropertyValue('--ui-type-family'),
      '"Consolas", "Monaco", "Courier New", monospace',
      'Expected selected typeface to update CSS variable'
    );
    assert.equal(documentStub.body.style.fontFamily, 'var(--ui-type-family)', 'Expected body inline font to protect selection from skins');
  }
};
