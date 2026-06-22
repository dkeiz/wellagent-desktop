const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRegisterLlmHandlers(rootDir, dependencyMap) {
  const filePath = path.join(rootDir, 'src', 'main', 'ipc', 'register-llm-handlers.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(request) {
      if (Object.prototype.hasOwnProperty.call(dependencyMap, request)) {
        return dependencyMap[request];
      }
      return require(request);
    },
    __dirname: path.dirname(filePath),
    __filename: filePath,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context, { filename: filePath });
  return context.module.exports;
}

module.exports = {
  name: 'ollama-discovery-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const savedSettings = new Map();
    const captured = {
      knownModelsCalls: []
    };

    const { registerLlmHandlers } = loadRegisterLlmHandlers(rootDir, {
      axios: {},
      fs,
      os: require('os'),
      path,
      '../llm-config': {
        SPEC_FILE: 'unused',
        getProviderCatalogModels(provider) {
          return provider === 'ollama' ? ['fake-catalog-model'] : [];
        },
        getProviderConnectionConfig() {
          return {};
        },
        getProviderProfiles() {
          return { providers: [] };
        },
        getProviderSpec() {
          return { settings: { supportsModelDiscovery: true } };
        },
        getModelRuntimeConfig() {
          return { runtime: null };
        },
        saveProviderConnectionConfig() {
          return {};
        },
        saveModelRuntimeConfig() {
          return { runtime: null };
        }
      },
      '../llm-state': {
        async getEffectiveLlmSelection() {
          return { provider: 'ollama', model: 'real-local-model' };
        },
        async getKnownModelsForProvider(_db, provider, discoveredModels) {
          captured.knownModelsCalls.push({ provider, discoveredModels: [...discoveredModels] });
          return [...new Set(discoveredModels)];
        },
        async rememberLastWorkingModel() {},
        async rememberTestedModel() {},
        async saveActiveSelection() {}
      },
      '../settings-security': {
        async getGenericSettingValue() {
          return null;
        }
      },
      '../providers/provider-http': {
        async providerRequest() {
          throw new Error('not expected');
        }
      }
    });

    const handlers = new Map();
    const ipcMain = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    };
    const runtime = {
      db: {
        async getSetting(key) {
          return savedSettings.has(key) ? savedSettings.get(key) : null;
        },
        async saveSetting(key, value) {
          savedSettings.set(key, value);
        }
      },
      aiService: {
        async getModels(provider) {
          assert.equal(provider, 'ollama', 'Expected Ollama get-models handler to query the Ollama provider');
          return ['real-local-model'];
        }
      },
      promptFileManager: null,
      container: { optional() { return null; } }
    };

    registerLlmHandlers(ipcMain, runtime);
    const getModelsHandler = handlers.get('get-models');
    assert.ok(getModelsHandler, 'Expected get-models IPC handler to be registered');

    const models = await getModelsHandler({}, 'ollama');
    assert.deepEqual(
      models,
      ['real-local-model'],
      'Expected Ollama discovery to expose only real discovered/local models'
    );
    assert.equal(captured.knownModelsCalls.length > 0, true, 'Expected model merge path to be exercised');
    assert.equal(
      captured.knownModelsCalls[0].discoveredModels.includes('fake-catalog-model'),
      false,
      'Expected Ollama merge path not to seed fake catalog fallback models'
    );
  }
};
