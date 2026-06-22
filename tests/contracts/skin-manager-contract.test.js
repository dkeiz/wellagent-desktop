const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function createSkinManagerTestContext(source) {
  const localStorage = createLocalStorage();
  const elements = {
    'skin-picker': {},
    'skin-picker-status': {},
    'skin-feature-enabled': { checked: false },
    'skin-theme-options': {},
    'run-skin-autotest-btn': { hidden: false },
    'run-skin-diagnostics-btn': {},
    'skin-diagnostics-output': {},
    'theme-picker': {}
  };
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener() {},
    documentElement: {
      getAttribute() {
        return null;
      },
      setAttribute() {}
    }
  };
  const context = {
    console,
    localStorage,
    document,
    window: {},
    process: { argv: ['electron', 'app'] },
    MutationObserver: class {
      observe() {}
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setTimeout,
    clearTimeout
  };

  context.window = context;
  vm.runInNewContext(source, context, { filename: 'skin-manager.js' });
  return { context, elements, localStorage };
}

module.exports = {
  name: 'skin-manager-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const filePath = path.join(rootDir, 'src', 'renderer', 'components', 'skin-manager.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const { context, elements, localStorage } = createSkinManagerTestContext(source);
    const manager = context.window.skinManager;

    manager.config.defaultSkinId = 'default';
    manager.bindElements();

    localStorage.setItem('skinSystemEnabled', 'true');
    localStorage.setItem('activeSkinId', 'design-a');
    localStorage.setItem('skinThemePreferences', JSON.stringify({ 'design-a': 'solar' }));
    manager.loadState();

    assert.equal(manager.state.enabled, true, 'Expected the saved skin enabled flag to be restored on startup');
    assert.equal(manager.state.skinId, 'design-a', 'Expected the saved active skin id to be restored on startup');
    assert.equal(manager.themePreferences['design-a'], 'solar', 'Expected saved skin theme preferences to be restored on startup');
    assert.equal(elements['skin-feature-enabled'].checked, true, 'Expected the skin enabled checkbox to reflect restored state');

    manager.syncDevControlsVisibility();
    assert.equal(elements['run-skin-autotest-btn'].hidden, true, 'Expected auto skin test button to stay hidden in normal app mode');

    localStorage.setItem('skinDevTools', 'true');
    manager.syncDevControlsVisibility();
    assert.equal(elements['run-skin-autotest-btn'].hidden, false, 'Expected explicit skin dev tools toggle to reveal auto test control');

    localStorage.removeItem('skinDevTools');
    context.process.argv = ['electron', 'app', '--skintest'];
    manager.syncDevControlsVisibility();
    assert.equal(elements['run-skin-autotest-btn'].hidden, false, 'Expected test mode to reveal auto test control');

    manager.state.enabled = true;
    manager.state.loading = true;
    manager.state.pendingApply = false;
    await manager.onThemeChanged();
    assert.equal(manager.state.pendingApply, true, 'Expected theme observer changes to queue a pending apply during active skin load');
  }
};
