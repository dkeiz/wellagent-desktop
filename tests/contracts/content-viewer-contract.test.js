const fs = require('fs');
const path = require('path');
const vm = require('vm');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
    this.value = '';
    this._innerHTML = '';
    this._textContent = '';
    this.className = '';
    this.classList = {
      add: (...names) => {
        const next = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach(name => next.add(name));
        this.className = [...next].join(' ');
      },
      remove: (...names) => {
        const remove = new Set(names);
        this.className = this.className.split(/\s+/).filter(name => name && !remove.has(name)).join(' ');
      },
      toggle: (name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        const shouldAdd = force === undefined ? !has : Boolean(force);
        if (shouldAdd) this.classList.add(name);
        else this.classList.remove(name);
        return shouldAdd;
      }
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this._innerHTML = escapeHtml(value);
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, callback) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(callback);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  closest() {
    return null;
  }
}

function createDocumentStub(elements) {
  const listeners = {};
  return {
    readyState: 'complete',
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return new FakeElement('', tagName);
    },
    addEventListener(type, callback) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(callback);
    },
    dispatch(type, detail) {
      for (const callback of listeners[type] || []) {
        callback({ detail });
      }
    }
  };
}

function loadContentViewer(rootDir) {
  const elements = {
    'content-viewer-panel': new FakeElement('content-viewer-panel'),
    'content-viewer-tabs': new FakeElement('content-viewer-tabs'),
    'content-viewer-body': new FakeElement('content-viewer-body'),
    'content-viewer-mode': new FakeElement('content-viewer-mode', 'select'),
    'content-viewer-chat-toggle': new FakeElement('content-viewer-chat-toggle', 'button')
  };
  const document = createDocumentStub(elements);
  const storage = new Map();
  const readCalls = [];
  let toolUpdateCallback = null;
  const context = {
    window: {
      electronAPI: {
        readFileContent(filePath) {
          readCalls.push(filePath);
          return Promise.resolve('const loaded = true;');
        },
        onToolUpdate(callback) {
          toolUpdateCallback = callback;
        }
      }
    },
    document,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    URL,
    console
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.localStorage = context.localStorage;
  vm.createContext(context);
  const source = fs.readFileSync(
    path.join(rootDir, 'src', 'renderer', 'components', 'content-viewer.js'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'content-viewer.js' });
  return {
    body: elements['content-viewer-body'],
    readCalls,
    toolUpdate(payload) {
      toolUpdateCallback?.({}, payload);
    },
    viewer: context.window.contentViewer
  };
}

module.exports = {
  name: 'content-viewer-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const { body, readCalls, toolUpdate, viewer } = loadContentViewer(rootDir);

    viewer.openContent({ type: 'markdown', title: 'Report', content: '# Report\n- ok' });
    assert.includes(body.innerHTML, '<h1>Report</h1>', 'Expected display_content markdown payloads to render content');
    assert.includes(body.innerHTML, '- ok', 'Expected markdown body content to render');

    viewer.openContent({ type: 'html', title: 'Unsafe HTML', content: '<script>alert(1)</script><h1>Hi</h1>' });
    assert.includes(body.innerHTML, 'sandbox=""', 'Expected raw HTML to render in a sandboxed frame');
    assert.includes(body.innerHTML, 'srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;&lt;h1&gt;Hi&lt;/h1&gt;"', 'Expected raw HTML to be escaped into srcdoc');
    assert.equal(body.innerHTML.includes('<script>alert(1)</script>'), false, 'Raw HTML must not be injected directly into the app DOM');

    viewer.openUrl('file:///C:/tmp/demo.js');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(readCalls[0], 'C:/tmp/demo.js', 'Expected file URLs to be normalized before IPC file reads');
    assert.includes(body.innerHTML, 'const loaded = true;', 'Expected loaded file content to render');

    toolUpdate({
      toolName: 'display_content',
      success: true,
      result: { type: 'text', title: 'Tool Result', content: 'tool body' }
    });
    assert.includes(body.innerHTML, 'tool body', 'Expected display_content tool updates to open in the viewer');

    toolUpdate({
      toolName: 'inner_browser',
      success: true,
      result: { viewerContent: { type: 'text', title: 'Browser Result', content: 'browser body' } }
    });
    assert.includes(body.innerHTML, 'browser body', 'Expected inner_browser render payloads to open in the viewer');
  }
};
