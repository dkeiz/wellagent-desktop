const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.children = [];
    this.style = { display: '' };
    this.listeners = new Map();
    this.dataset = {};
    this._innerHTML = '';
    this.options = [];
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    this.options = [];
    this.value = '';
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      await handler({ target: this, ...event });
    }
  }

  appendChild(child) {
    this.children.push(child);
    if (child.tagName === 'OPTION') {
      this.options.push(child);
      if (child.selected) {
        this.value = child.value;
      }
    }
    return child;
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  closest() {
    return null;
  }
}

function createOptionElement() {
  const option = new FakeElement('', 'option');
  option.selected = false;
  return option;
}

function createProviderSelectionContext(source) {
  const saveConfigCalls = [];
  const testModelCalls = [];
  let currentConfig = {};
  const providerModels = new Map([
    ['ollama', ['llama3', 'qwen3:latest']]
  ]);

  const elements = new Map([
    ['llm-provider-select', new FakeElement('llm-provider-select', 'select')],
    ['llm-model-select', new FakeElement('llm-model-select', 'select')],
    ['refresh-provider-models-btn', new FakeElement('refresh-provider-models-btn', 'button')],
    ['provider-discovery-status', new FakeElement('provider-discovery-status')],
    ['provider-settings-container', new FakeElement('provider-settings-container')],
    ['llm-config-save-button', new FakeElement('llm-config-save-button', 'button')],
    ['llm-model-settings-section', new FakeElement('llm-model-settings-section')],
    ['llm-model-capabilities', new FakeElement('llm-model-capabilities')],
    ['llm-model-config-container', new FakeElement('llm-model-config-container')],
    ['current-config-display', new FakeElement('current-config-display')],
    ['current-config-text', new FakeElement('current-config-text')],
    ['chat-provider-select', new FakeElement('chat-provider-select', 'select')],
    ['chat-model-select', new FakeElement('chat-model-select', 'select')],
    ['custom-model-section', new FakeElement('custom-model-section')],
    ['test-custom-model-btn', new FakeElement('test-custom-model-btn', 'button')],
    ['custom-model-input', new FakeElement('custom-model-input', 'input')],
    ['custom-model-status', new FakeElement('custom-model-status')]
  ]);

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      if (tagName === 'option') {
        return createOptionElement();
      }
      return new FakeElement('', tagName);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {}
  }

  const context = {
    console,
    window: {},
    document,
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  };

  context.window = context;
  context.window.electronAPI = {
    llm: {
      async getProviderProfiles() {
        return {
          providers: [{
            id: 'ollama',
            label: 'Ollama',
            settings: {
              supportsCustomModel: true,
              supportsModelDiscovery: true,
              connectionFields: [],
              customModelLabel: 'Custom Model',
              customModelPlaceholder: 'Type model name...'
            }
          }]
        };
      },
      async getProviderConnectionConfig() {
        return {};
      },
      async getConfig() {
        return currentConfig;
      },
      async getModels(provider) {
        return providerModels.get(provider) || [];
      },
      async getModelProfile(provider, model) {
        return {
          spec: { model, provider },
          runtimeConfig: {
            reasoning: { enabled: false, visibility: 'show' },
            streaming: { text: false, reasoning: false },
            providerRouting: { requireParameters: false }
          }
        };
      },
      async saveConfig(config) {
        saveConfigCalls.push(config);
        currentConfig = { ...currentConfig, ...config };
        return { success: true };
      },
      async testModel(provider, model) {
        testModelCalls.push({ provider, model });
        const models = providerModels.get(provider) || [];
        if (!models.includes(model)) {
          models.push(model);
          providerModels.set(provider, models);
        }
        currentConfig = {
          ...currentConfig,
          provider,
          model,
          selectionSource: 'last-working',
          runtimeConfig: {
            reasoning: { enabled: false, visibility: 'show' },
            streaming: { text: false, reasoning: false },
            providerRouting: { requireParameters: false }
          }
        };
        return { success: true, model: `${provider}:${model}` };
      }
    },
    async getProviders() {
      return ['ollama'];
    }
  };

  const helpersPath = path.join(process.cwd(), 'src', 'renderer', 'components', 'api-provider-settings-helpers.js');
  const helperSource = fs.readFileSync(helpersPath, 'utf8');
  vm.runInNewContext(helperSource, context, { filename: 'api-provider-settings-helpers.js' });
  vm.runInNewContext(source, context, { filename: 'api-provider-settings.js' });
  return { context, elements, saveConfigCalls, testModelCalls };
}

module.exports = {
  name: 'provider-selection-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const filePath = path.join(rootDir, 'src', 'renderer', 'components', 'api-provider-settings.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const { context, elements, saveConfigCalls, testModelCalls } = createProviderSelectionContext(source);
    const notifications = [];
    const mainPanel = {
      _thinkingVisibility: 'show',
      showNotification(message, type) {
        notifications.push({ message, type });
      }
    };

    await context.window.initializeApiProviderSettings(mainPanel);

    const llmProviderSelect = elements.get('llm-provider-select');
    const llmModelSelect = elements.get('llm-model-select');
    const testModelBtn = elements.get('test-custom-model-btn');
    const customModelInput = elements.get('custom-model-input');
    const statusDiv = elements.get('custom-model-status');

    llmProviderSelect.value = 'ollama';
    await llmProviderSelect.emit('change');

    llmModelSelect.value = 'llama3';
    await llmModelSelect.emit('change');

    assert.ok(
      saveConfigCalls.some(config => config.provider === 'ollama' && config.model === 'llama3'),
      'Expected LLM provider/model selection to persist the current working model'
    );

    customModelInput.value = 'custom-ollama-model';
    await testModelBtn.emit('click');

    assert.equal(testModelCalls.length, 1, 'Expected custom model flow to call llm.testModel exactly once');
    assert.equal(testModelCalls[0].model, 'custom-ollama-model', 'Expected tested Ollama model to be passed to the backend test handler');
    assert.includes(statusDiv.textContent, 'remembered as workable', 'Expected tested-model status to mention workable persistence');
    assert.ok(
      notifications.some(entry => entry.message === 'Remembered workable model custom-ollama-model'),
      'Expected workable tested model to notify the user'
    );
  }
};
