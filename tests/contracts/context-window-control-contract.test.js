const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScript(filePath, context) {
  const source = fs.readFileSync(filePath, 'utf8');
  vm.runInNewContext(source, context, { filename: filePath });
}

function createEventTarget() {
  return {
    listeners: new Map(),
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    },
    async emit(type, event = {}) {
      const handlers = this.listeners.get(type) || [];
      for (const handler of handlers) {
        await handler(event);
      }
    }
  };
}

module.exports = {
  name: 'context-window-control-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const elements = {
      'context-slider': {
        ...createEventTarget(),
        classList: { toggle() {} }
      },
      'context-custom-input': {
        ...createEventTarget(),
        value: '24k',
        blur() {}
      },
      'context-display-label': createEventTarget(),
      'context-display': {
        ...createEventTarget(),
        textContent: ''
      },
      'context-window-configurable': {
        style: { display: 'block' }
      }
    };
    const document = {
      readyState: 'complete',
      getElementById(id) {
        return elements[id] || null;
      },
      addEventListener() {}
    };

    let savedContext = null;
    const context = {
      console,
      document,
      setTimeout(fn) { fn(); return 1; },
      window: null
    };
    context.window = context;
    context.window.document = document;
    context.window.electronAPI = {
      async setContextSetting(value) {
        savedContext = value;
      }
    };

    const shellPath = path.join(rootDir, 'src', 'renderer', 'components', 'renderer-shell.js');
    const controlPath = path.join(rootDir, 'src', 'renderer', 'components', 'context-window-control.js');
    loadScript(shellPath, context);

    const panel = {
      _selectedContextSetting: null,
      applyContextProfile(profile) {
        this.lastProfile = profile;
        return profile;
      },
      updateContextDisplay(index) {
        this.lastDisplayIndex = index;
        elements['context-display'].textContent = `preset:${index}`;
      }
    };
    context.window.mainPanel = panel;
    context.window.localAgentRendererShell.initializeMainPanel(panel);

    loadScript(controlPath, context);

    await elements['context-custom-input'].emit('blur');
    assert.equal(savedContext, 24000, 'Expected custom context blur commit to persist parsed token value');
    assert.equal(panel._selectedContextSetting, 24000, 'Expected custom context commit to update main panel selected value');

    panel.updateContextDisplay(3);
    assert.equal(
      panel.lastDisplayIndex,
      undefined,
      'Expected wrapped updateContextDisplay to suppress preset display updates while custom mode is active'
    );

    panel.applyContextProfile({ runtimeConfig: { contextWindow: { value: 32000 } } });
    assert.includes(
      elements['context-display'].textContent,
      '24K',
      'Expected wrapped applyContextProfile to preserve custom context display when provider profile reapplies'
    );
  }
};
