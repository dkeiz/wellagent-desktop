const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
}

function createDocumentStub() {
  const elements = new Map();
  const headNodes = [];
  const body = { appendChild() {} };

  function makeLink() {
    const listeners = new Map([['load', new Set()], ['error', new Set()]]);
    const link = {
      rel: '',
      dataset: {},
      sheet: null,
      _id: '',
      _href: '',
      addEventListener(name, handler) { if (listeners.has(name)) listeners.get(name).add(handler); },
      removeEventListener(name, handler) { if (listeners.has(name)) listeners.get(name).delete(handler); },
      getAttribute(name) { return name === 'href' ? this._href : null; },
      remove() {
        const idx = headNodes.indexOf(this);
        if (idx >= 0) headNodes.splice(idx, 1);
        if (this._id) elements.delete(this._id);
      },
      emit(name) {
        const set = listeners.get(name);
        if (!set) return;
        [...set].forEach((handler) => handler({ target: this }));
      }
    };
    Object.defineProperty(link, 'id', {
      get() { return this._id; },
      set(value) {
        if (this._id) elements.delete(this._id);
        this._id = String(value || '');
        if (this._id) elements.set(this._id, this);
      }
    });
    Object.defineProperty(link, 'href', {
      get() { return this._href; },
      set(value) { this._href = String(value || ''); }
    });
    return link;
  }

  const document = {
    head: { appendChild(node) { headNodes.push(node); return node; } },
    body,
    documentElement: { setAttribute() {}, getAttribute() { return null; }, style: { setProperty() {} } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return tag === 'link' ? makeLink() : { style: {}, setAttribute() {} }; },
    addEventListener() {}
  };

  return { document, headNodes };
}

function createSkinManagerContext(source) {
  const localStorage = createLocalStorage();
  const { document, headNodes } = createDocumentStub();
  const context = {
    console,
    document,
    localStorage,
    window: {},
    process: { argv: ['electron', 'app'] },
    MutationObserver: class { observe() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'skin-manager.js' });
  return { manager: context.window.skinManager, document, headNodes };
}

module.exports = {
  name: 'skin-stylesheet-loader-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const filePath = path.join(rootDir, 'src', 'renderer', 'components', 'skin-manager.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const { manager, document, headNodes } = createSkinManagerContext(source);

    const firstPromise = manager.loadStylesheet('active-skin-theme-link', 'skins/design-a/themes/dark.css');
    const firstLink = headNodes[headNodes.length - 1];
    const dedupedPromise = manager.loadStylesheet('active-skin-theme-link', 'skins/design-a/themes/dark.css');
    assert.equal(firstPromise, dedupedPromise, 'Expected in-flight same-href stylesheet loads to dedupe');
    firstLink.sheet = {};
    firstLink.emit('load');
    await firstPromise;
    const committed = document.getElementById('active-skin-theme-link');
    assert.ok(committed, 'Expected resolved stylesheet link to be committed by id');
    const committedHref = committed.getAttribute('href');
    assert.ok(/^skins\/design-a\/themes\/dark\.css\?v=\d+$/.test(committedHref), 'Expected committed stylesheet href to include a cache-busting token');

    const repeatPromise = manager.loadStylesheet('active-skin-theme-link', 'skins/design-a/themes/dark.css');
    const repeatLink = headNodes[headNodes.length - 1];
    assert.notEqual(repeatLink, committed, 'Expected repeated same-href stylesheet loads to allocate a fresh transaction');
    repeatLink.sheet = {};
    repeatLink.emit('load');
    await repeatPromise;
    const refreshed = document.getElementById('active-skin-theme-link');
    assert.ok(refreshed, 'Expected repeated same-href stylesheet request to recommit the link');
    assert.notEqual(refreshed.getAttribute('href'), committedHref, 'Expected repeated same-href stylesheet load to refresh the cache-busting token');

    const oldPromise = manager.loadStylesheet('active-skin-link', 'skins/design-a/skin.css');
    const oldLink = headNodes[headNodes.length - 1];
    const newPromise = manager.loadStylesheet('active-skin-link', 'skins/design-b/skin.css');
    const newLink = headNodes[headNodes.length - 1];
    assert.notEqual(oldLink, newLink, 'Expected href replacement to allocate a fresh link transaction');
    oldLink.sheet = {};
    oldLink.emit('load');
    await oldPromise;
    assert.equal(document.getElementById('active-skin-link'), null, 'Expected stale stylesheet completion to avoid committing outdated link id');
    newLink.sheet = {};
    newLink.emit('load');
    await newPromise;
    const finalLink = document.getElementById('active-skin-link');
    assert.ok(finalLink, 'Expected latest stylesheet request to commit');
    assert.ok(/^skins\/design-b\/skin\.css\?v=\d+$/.test(finalLink.getAttribute('href')), 'Expected latest stylesheet href to win after supersede with cache busting');
  }
};
