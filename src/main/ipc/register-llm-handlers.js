const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const {
  SPEC_FILE,
  getProviderCatalogModels,
  getProviderConnectionConfig,
  getProviderProfiles,
  getProviderSpec,
  getModelRuntimeConfig,
  saveProviderConnectionConfig,
  saveModelRuntimeConfig
} = require('../llm-config');
const {
  getEffectiveLlmSelection,
  getKnownModelsForProvider,
  rememberLastWorkingModel,
  rememberTestedModel,
  saveActiveSelection
} = require('../llm-state');
const { getGenericSettingValue } = require('../settings-security');
const { providerRequest } = require('../providers/provider-http');

function registerLlmHandlers(ipcMain, runtime) {
  const {
    db,
    aiService,
    promptFileManager
  } = runtime;

  function broadcastCompanionLlmSettingsChange(reason = 'llm-settings') {
    const companionServer = runtime.container?.optional?.('companionServer');
    companionServer?.broadcastStateChanged?.('llm', { reason });
  }

  async function syncResolvedRuntime(provider, model, runtimeConfig = null) {
    let resolvedRuntime = null;
    if (!provider || !model) {
      return resolvedRuntime;
    }

    if (runtimeConfig) {
      const savedRuntime = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
      resolvedRuntime = savedRuntime.runtime;
    } else {
      const currentRuntime = await getModelRuntimeConfig(db, provider, model);
      resolvedRuntime = currentRuntime.runtime;
    }

    if (resolvedRuntime) {
      await db.saveSetting('llm.thinkingMode', resolvedRuntime.reasoning?.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', resolvedRuntime.reasoning?.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', resolvedRuntime.reasoning?.visibility || 'show');
      broadcastCompanionLlmSettingsChange('runtime-sync');
    }

    return resolvedRuntime;
  }

  const DISCOVERED_MODELS_SETTING = 'llm.discoveredModels';

  function normalizeProviderId(provider) {
    return String(provider || '').trim().toLowerCase();
  }

  function normalizeModelList(models = []) {
    const seen = new Set();
    const output = [];
    for (const model of Array.isArray(models) ? models : []) {
      const value = String(model || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }

  async function getDiscoveredModelStore() {
    const raw = await db.getSetting(DISCOVERED_MODELS_SETTING);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  async function saveDiscoveredModelStore(store) {
    await db.saveSetting(DISCOVERED_MODELS_SETTING, JSON.stringify(store || {}));
  }

  async function rememberDiscoveredModels(provider, models = []) {
    const providerId = normalizeProviderId(provider);
    const normalized = normalizeModelList(models);
    if (!providerId || normalized.length === 0) return normalized;

    const store = await getDiscoveredModelStore();
    store[providerId] = {
      models: normalized,
      updatedAt: new Date().toISOString()
    };
    await saveDiscoveredModelStore(store);
    return normalized;
  }

  async function getCachedDiscoveredModels(provider) {
    const providerId = normalizeProviderId(provider);
    if (!providerId) return [];
    const store = await getDiscoveredModelStore();
    return normalizeModelList(store[providerId]?.models || []);
  }

  async function upsertDiscoveredModel(provider, model) {
    const providerId = normalizeProviderId(provider);
    const normalizedModel = String(model || '').trim();
    if (!providerId || !normalizedModel) return;
    const cached = await getCachedDiscoveredModels(providerId);
    const merged = normalizeModelList([...cached, normalizedModel]);
    await rememberDiscoveredModels(providerId, merged);
  }

  function shouldDisableFlashAttention(provider, model) {
    const providerId = normalizeProviderId(provider);
    const modelId = String(model || '').trim().toLowerCase();
    if (providerId !== 'lmstudio' || !modelId) return false;

    // Local LM Studio issue pattern: Qwen 3.5/3.6 30B+ A3B variants can fail with Flash Attention on some GPUs.
    const qwenMatch = /qwen[\s\-_/]*3(\.5|\.6)?/.test(modelId);
    const a3bMatch = /\ba3b\b/.test(modelId);
    const largeFamilyMatch = /\b(30b|32b|35b|70b)\b/.test(modelId);
    return qwenMatch && a3bMatch && largeFamilyMatch;
  }

  function withLmstudioLoadOverride(config = {}) {
    const next = { ...(config || {}) };
    const runtimeConfig = { ...(next.runtimeConfig || {}) };
    const lmstudio = { ...(runtimeConfig.lmstudio || {}) };
    const loadConfig = { ...(lmstudio.loadConfig || {}) };
    // Required stable config for qwen/qwen3.6-35b-a3b based on known-good LM Studio run.
    if (!Object.prototype.hasOwnProperty.call(loadConfig, 'flash_attention')) loadConfig.flash_attention = false;
    if (!Object.prototype.hasOwnProperty.call(loadConfig, 'context_length')) loadConfig.context_length = 32768;
    if (!Object.prototype.hasOwnProperty.call(loadConfig, 'eval_batch_size')) loadConfig.eval_batch_size = 256;
    if (!Object.prototype.hasOwnProperty.call(loadConfig, 'num_experts')) loadConfig.num_experts = 8;
    if (!Object.prototype.hasOwnProperty.call(loadConfig, 'offload_kv_cache_to_gpu')) loadConfig.offload_kv_cache_to_gpu = true;
    lmstudio.loadConfig = loadConfig;
    runtimeConfig.lmstudio = lmstudio;
    if (!runtimeConfig.contextWindow?.value) {
      runtimeConfig.contextWindow = { ...(runtimeConfig.contextWindow || {}), value: 32768 };
    }
    if (!runtimeConfig.reasoning || typeof runtimeConfig.reasoning !== 'object') {
      runtimeConfig.reasoning = { enabled: false, visibility: 'show', effort: null, maxTokens: null };
    } else if (runtimeConfig.reasoning.enabled === undefined || runtimeConfig.reasoning.enabled === null) {
      runtimeConfig.reasoning = { ...runtimeConfig.reasoning, enabled: false };
    }
    next.runtimeConfig = runtimeConfig;
    return next;
  }

  function mergeLmstudioLoadedConfigIntoRuntime(runtimeConfig = {}, loadedConfig = {}) {
    const nextRuntime = { ...(runtimeConfig || {}) };
    const lmstudio = { ...(nextRuntime.lmstudio || {}) };
    const loadConfig = { ...(lmstudio.loadConfig || {}) };

    if (Number.isFinite(Number(loadedConfig.context_length))) {
      const contextLength = Number(loadedConfig.context_length);
      loadConfig.context_length = contextLength;
      nextRuntime.contextWindow = { ...(nextRuntime.contextWindow || {}), value: contextLength };
    }
    if (Number.isFinite(Number(loadedConfig.eval_batch_size))) loadConfig.eval_batch_size = Number(loadedConfig.eval_batch_size);
    if (Number.isFinite(Number(loadedConfig.num_experts))) loadConfig.num_experts = Number(loadedConfig.num_experts);
    if (typeof loadedConfig.flash_attention === 'boolean') loadConfig.flash_attention = loadedConfig.flash_attention;
    if (typeof loadedConfig.offload_kv_cache_to_gpu === 'boolean') loadConfig.offload_kv_cache_to_gpu = loadedConfig.offload_kv_cache_to_gpu;

    lmstudio.loadConfig = loadConfig;
    nextRuntime.lmstudio = lmstudio;
    return nextRuntime;
  }

  async function getCatalogAwareModels(provider, discovered = []) {
    const providerId = normalizeProviderId(provider);
    const providerSpec = getProviderSpec(providerId);
    const normalizedDiscovered = normalizeModelList(discovered);
    const openAITransport = providerId === 'openai'
      ? await db.getSetting('llm.openai.transport') || 'codex-cli'
      : '';
    if (providerId === 'openai' && openAITransport !== 'api-key') {
      return normalizedDiscovered.length > 0 ? normalizedDiscovered : ['gpt-5.2-codex'];
    }

    if (normalizedDiscovered.length > 0) {
      await rememberDiscoveredModels(providerId, normalizedDiscovered);
    }

    const cachedDiscovered = await getCachedDiscoveredModels(providerId);
    // Ollama should reflect the real local/runtime setup only.
    // Do not seed it with static catalog entries that may not exist on the endpoint.
    if (providerId === 'ollama') {
      return getKnownModelsForProvider(db, providerId, [
        ...normalizedDiscovered,
        ...cachedDiscovered
      ]);
    }

    const shouldUseCatalogFallback = providerId !== 'openrouter';
    const seededModels = [
      ...(shouldUseCatalogFallback ? getProviderCatalogModels(providerId) : []),
      ...normalizedDiscovered,
      ...cachedDiscovered
    ];

    let models = [];
    try {
      models = await getKnownModelsForProvider(db, providerId, seededModels);
    } catch (error) {
      console.error(`[LLM] Failed to merge known models for ${providerId}:`, error?.message || error);
      return normalizeModelList(seededModels);
    }

    // If discovery-capable provider has no models, still allow fallback catalog except OpenRouter
    // where stale static IDs are often misleading.
    if (models.length === 0 && shouldUseCatalogFallback && providerSpec?.settings?.supportsModelDiscovery) {
      return getKnownModelsForProvider(db, providerId, getProviderCatalogModels(providerId));
    }

    return models;
  }

  function normalizeConnectionPayload(config = {}) {
    const connection = { ...(config.connection || {}) };
    const normalizeArgs = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    if (config.apiKey !== undefined) {
      connection.apiKey = config.apiKey;
    }
    if (config.url !== undefined) {
      connection.url = config.url;
    }
    if (connection.modelParams !== undefined) {
      connection.modelParams = normalizeArgs(connection.modelParams);
    }
    if (connection.serverParams !== undefined) {
      connection.serverParams = normalizeArgs(connection.serverParams);
    }

    return connection;
  }

  function buildLmstudioEndpoint(baseUrl, endpointPath) {
    const rawBase = String(baseUrl || '').trim() || 'http://localhost:1234';
    const rawPath = String(endpointPath || '').trim();
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    try {
      const parsed = new URL(rawBase);
      if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1';
      }
      const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      const hasV1 = pathname === '/v1' || pathname.endsWith('/v1');
      const basePath = hasV1 ? pathname : `${pathname === '/' ? '' : pathname}/v1`;
      parsed.pathname = `${basePath}${normalizedPath}`;
      return parsed.toString();
    } catch (_) {
      const fallback = rawBase.replace(/\/+$/, '');
      return `${fallback}/v1${normalizedPath}`;
    }
  }

  async function getLmstudioApiKey() {
    const stored = await db.getAPIKey?.('lmstudio');
    if (stored) return stored;
    const legacy = await db.getSetting('llm.lmstudio.apiKey');
    if (legacy && db.setAPIKey) {
      await db.setAPIKey('lmstudio', legacy);
    }
    return legacy;
  }

  async function discoverLmstudioModelsDirect() {
    const urlSetting = await db.getSetting('llm.lmstudio.url');
    const apiKey = await getLmstudioApiKey();
    const endpoint = buildLmstudioEndpoint(urlSetting || 'http://localhost:1234', '/models');
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await providerRequest(axios, {
      method: 'get',
      url: endpoint,
      headers
    }, { timeoutMs: 12000, label: 'LM Studio direct model discovery' });
    const payload = response.data || {};
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload?.models) ? payload.models : []);
    return normalizeModelList(rawModels.map(model => {
      if (typeof model === 'string') return model;
      return model?.id || model?.name || '';
    }));
  }

  async function getLmstudioLoadedInstanceConfig(modelKey) {
    const key = String(modelKey || '').trim().toLowerCase();
    if (!key) return null;
    const urlSetting = await db.getSetting('llm.lmstudio.url');
    const apiKey = await getLmstudioApiKey();
    const base = String(urlSetting || 'http://localhost:1234').trim() || 'http://localhost:1234';
    let nativeEndpoint = '';
    try {
      const parsed = new URL(base);
      if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1';
      const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      const rootPath = pathname.endsWith('/v1') ? pathname.slice(0, -3) || '/' : pathname;
      const trimmedRoot = rootPath.replace(/\/+$/, '');
      parsed.pathname = `${trimmedRoot === '' || trimmedRoot === '/' ? '' : trimmedRoot}/api/v1/models`;
      nativeEndpoint = parsed.toString();
    } catch (_) {
      nativeEndpoint = `${base.replace(/\/+$/, '')}/api/v1/models`;
    }
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await providerRequest(axios, {
      method: 'get',
      url: nativeEndpoint,
      headers
    }, { timeoutMs: 12000, label: 'LM Studio loaded model config' });
    const models = Array.isArray(response?.data?.models) ? response.data.models : [];
    const match = models.find(entry => String(entry?.key || '').trim().toLowerCase() === key);
    const loaded = Array.isArray(match?.loaded_instances) ? match.loaded_instances : [];
    if (loaded.length === 0) return null;
    return loaded[0]?.config || null;
  }

  function buildLmstudioNativeModelsEndpoint(baseUrl) {
    const base = String(baseUrl || 'http://localhost:1234').trim() || 'http://localhost:1234';
    try {
      const parsed = new URL(base);
      if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1';
      const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      const rootPath = pathname.endsWith('/v1') ? pathname.slice(0, -3) || '/' : pathname;
      const trimmedRoot = rootPath.replace(/\/+$/, '');
      parsed.pathname = `${trimmedRoot === '' || trimmedRoot === '/' ? '' : trimmedRoot}/api/v1/models`;
      return parsed.toString();
    } catch (_) {
      return `${base.replace(/\/+$/, '')}/api/v1/models`;
    }
  }

  async function enforceLmstudioLoadedConfig(model, runtimeConfig = {}) {
    const modelId = String(model || '').trim();
    if (!modelId) return null;

    const urlSetting = await db.getSetting('llm.lmstudio.url');
    const apiKey = await getLmstudioApiKey();
    const nativeModelsEndpoint = buildLmstudioNativeModelsEndpoint(urlSetting || 'http://localhost:1234');
    const nativeLoadEndpoint = nativeModelsEndpoint.replace(/\/models(\?.*)?$/i, '/models/load$1');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const requested = runtimeConfig?.lmstudio?.loadConfig || {};
    const desired = {};
    if (typeof requested.flash_attention === 'boolean') desired.flash_attention = requested.flash_attention;
    if (Number.isFinite(Number(requested.context_length))) desired.context_length = Number(requested.context_length);
    if (Number.isFinite(Number(requested.eval_batch_size))) desired.eval_batch_size = Number(requested.eval_batch_size);
    if (Number.isFinite(Number(requested.num_experts))) desired.num_experts = Number(requested.num_experts);
    if (typeof requested.offload_kv_cache_to_gpu === 'boolean') desired.offload_kv_cache_to_gpu = requested.offload_kv_cache_to_gpu;
    if (Object.keys(desired).length === 0) return null;

    const modelsResponse = await providerRequest(axios, {
      method: 'get',
      url: nativeModelsEndpoint,
      headers
    }, { timeoutMs: 12000, label: 'LM Studio native model list' });
    const models = Array.isArray(modelsResponse?.data?.models) ? modelsResponse.data.models : [];
    const entry = models.find(item => String(item?.key || '').trim().toLowerCase() === modelId.toLowerCase());
    const current = Array.isArray(entry?.loaded_instances) && entry.loaded_instances[0]?.config
      ? entry.loaded_instances[0].config
      : null;

    const keys = Object.keys(desired);
    const mismatch = !current || keys.some(key => current[key] !== desired[key]);
    if (!mismatch) return current;

    const attempts = [
      { ...desired },
      (() => {
        const reduced = {};
        if (typeof desired.flash_attention === 'boolean') reduced.flash_attention = desired.flash_attention;
        if (Number.isFinite(Number(desired.context_length))) reduced.context_length = Number(desired.context_length);
        return reduced;
      })(),
      (() => {
        const minimal = {};
        if (typeof desired.flash_attention === 'boolean') minimal.flash_attention = desired.flash_attention;
        return minimal;
      })()
    ].filter(payload => Object.keys(payload).length > 0);

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const loadPayload = { model: modelId, ...attempt, echo_load_config: true };
        const loadResponse = await providerRequest(axios, {
          method: 'post',
          url: nativeLoadEndpoint,
          data: loadPayload,
          headers
        }, { timeoutMs: 30000, label: 'LM Studio model load' });
        return loadResponse?.data?.load_config || null;
      } catch (error) {
        lastError = error;
      }
    }

    // Some LM Studio builds can keep prior runtime knobs while model is already loaded.
    // Force a clean reload as a final fallback.
    try {
      const unloadEndpoint = nativeModelsEndpoint.replace(/\/models(\?.*)?$/i, '/models/unload$1');
      await providerRequest(axios, {
        method: 'post',
        url: unloadEndpoint,
        data: { model: modelId },
        headers
      }, { timeoutMs: 20000, label: 'LM Studio model unload' });
      const fallbackAttempt = attempts[0] || {};
      const loadPayload = { model: modelId, ...fallbackAttempt, echo_load_config: true };
      const loadResponse = await providerRequest(axios, {
        method: 'post',
        url: nativeLoadEndpoint,
        data: loadPayload,
        headers
      }, { timeoutMs: 45000, label: 'LM Studio model reload' });
      return loadResponse?.data?.load_config || null;
    } catch (error) {
      lastError = error;
    }

    if (lastError) {
      const sourceError = lastError?.cause || lastError;
      const detail = sourceError?.response?.data
        ? ` ${JSON.stringify(sourceError.response.data).slice(0, 600)}`
        : '';
      throw new Error(`${sourceError.message}${detail}`);
    }
    return null;
  }

  ipcMain.handle('getProviderModels', async (event, provider) => {
    try {
      const discovered = await aiService.getModels(provider);
      const models = await getCatalogAwareModels(provider, discovered);
      return { status: 'success', models };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('checkProviderStatus', async (event, provider) => {
    try {
      const models = await aiService.getModels(provider);
      return { connected: models.length > 0 };
    } catch (error) {
      return { connected: false };
    }
  });

  ipcMain.handle('setActiveModel', async (event, provider, model) => {
    await db.setActiveModel(provider, model);
    return { success: true };
  });

  ipcMain.handle('llm:get-models', async (event, provider, forceRefresh = false) => {
    let discovered = [];
    try {
      const providerId = normalizeProviderId(provider);
      discovered = await aiService.getModels(providerId, forceRefresh);
      if (providerId === 'lmstudio') {
        const direct = await discoverLmstudioModelsDirect();
        if (direct.length > 0) {
          await rememberDiscoveredModels(providerId, direct);
          console.log(`[LMStudio] Using direct discovered model list (${direct.length})`);
          return direct;
        }
      }
      const models = await getCatalogAwareModels(providerId, discovered);
      return models;
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      const fallback = normalizeModelList(discovered);
      if (fallback.length > 0) {
        console.warn(`[LLM] Returning discovered model fallback for ${provider}: ${fallback.length} model(s)`);
        return fallback;
      }
      return [];
    }
  });

  ipcMain.handle('llm:save-config', async (event, config) => {
    try {
      let nextConfig = { ...(config || {}) };
      if (normalizeProviderId(nextConfig.provider) === 'lmstudio' && nextConfig.model) {
        try {
          const loadedConfig = await getLmstudioLoadedInstanceConfig(nextConfig.model);
          if (loadedConfig && typeof loadedConfig === 'object') {
            nextConfig.runtimeConfig = mergeLmstudioLoadedConfigIntoRuntime(nextConfig.runtimeConfig || {}, loadedConfig);
          }
        } catch (error) {
          console.warn(`[LMStudio] Could not import loaded model config for ${nextConfig.model}: ${error.message}`);
        }
      }
      if (shouldDisableFlashAttention(nextConfig.provider, nextConfig.model)) {
        nextConfig = withLmstudioLoadOverride(nextConfig);
      }
      if (normalizeProviderId(nextConfig.provider) === 'lmstudio' && nextConfig.model) {
        try {
          const appliedConfig = await enforceLmstudioLoadedConfig(nextConfig.model, nextConfig.runtimeConfig || {});
          if (appliedConfig && typeof appliedConfig === 'object') {
            nextConfig.runtimeConfig = mergeLmstudioLoadedConfigIntoRuntime(nextConfig.runtimeConfig || {}, appliedConfig);
          }
        } catch (error) {
          console.warn(`[LMStudio] Failed to enforce model load config for ${nextConfig.model}: ${error.message}`);
        }
      }

      if (nextConfig.concurrencyEnabled !== undefined) {
        await db.saveSetting('llm.concurrency.enabled', nextConfig.concurrencyEnabled ? 'true' : 'false');
      }
      await saveActiveSelection(db, nextConfig.provider, nextConfig.model);

      const providerSpec = getProviderSpec(nextConfig.provider);
      const connection = normalizeConnectionPayload(nextConfig);
      if (providerSpec?.settings?.connectionFields?.length) {
        await saveProviderConnectionConfig(db, nextConfig.provider, connection);
      }
      if (nextConfig.apiKey !== undefined && !providerSpec?.settings?.connectionFields?.some(field => field.id === 'apiKey')) {
        if (nextConfig.apiKey) {
          await db.setAPIKey(nextConfig.provider, nextConfig.apiKey);
        }
      }
      if (nextConfig.url !== undefined && !providerSpec?.settings?.connectionFields?.some(field => field.id === 'url')) {
        await db.saveSetting(`llm.${nextConfig.provider}.url`, nextConfig.url);
      }

      if (nextConfig.provider === 'qwen') {
        const existingMode = await db.getSetting('llm.qwen.mode');
        const existingUseOAuth = (await db.getSetting('llm.qwen.useOAuth')) === 'true';
        const mode = nextConfig.mode || existingMode || 'cli';
        const useOAuth = nextConfig.useOAuth !== undefined
          ? nextConfig.useOAuth === true
          : (mode === 'oauth' || existingUseOAuth);
        await db.saveSetting('llm.qwen.mode', mode);
        await db.saveSetting('llm.qwen.useOAuth', useOAuth ? 'true' : 'false');
      } else if (nextConfig.provider === 'openai') {
        const transport = nextConfig.transport === 'api-key' ? 'api-key' : 'codex-cli';
        await db.saveSetting('llm.openai.transport', transport);
        if (nextConfig.codexSandbox) {
          await db.saveSetting('llm.openai.codexSandbox', nextConfig.codexSandbox);
        }
        if (nextConfig.codexSearch !== undefined) {
          await db.saveSetting('llm.openai.codexSearch', nextConfig.codexSearch ? 'true' : 'false');
        }
      } else if (nextConfig.useOAuth) {
        await db.saveSetting(`llm.${nextConfig.provider}.useOAuth`, 'true');
      }

      await aiService.setProvider(nextConfig.provider);

      let resolvedRuntime = null;
      if (nextConfig.model) {
        await rememberTestedModel(db, nextConfig.provider, nextConfig.model);
        await upsertDiscoveredModel(nextConfig.provider, nextConfig.model);
        resolvedRuntime = await syncResolvedRuntime(nextConfig.provider, nextConfig.model, nextConfig.runtimeConfig || null);
      }

      aiService.getModels(nextConfig.provider)
        .then(async models => {
          await getCatalogAwareModels(nextConfig.provider, models);
          console.log(`Refreshed ${models.length} models for ${nextConfig.provider}`);
        })
        .catch(err => {
          console.error(`Background model refresh failed for ${nextConfig.provider}:`, err);
        });

      return { success: true, runtimeConfig: resolvedRuntime };
    } catch (error) {
      console.error('Failed to save LLM config:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:fetch-qwen-oauth', async () => {
    try {
      const oauthPath = path.join(os.homedir(), '.qwen', 'oauth_creds.json');
      if (fs.existsSync(oauthPath)) {
        const oauthData = fs.readFileSync(oauthPath, 'utf-8');
        const creds = JSON.parse(oauthData);
        if (db.setCredential) {
          await db.setCredential('llm.qwen.oauthCreds', JSON.stringify(creds));
          await db.saveSetting('llm.qwen.oauthCreds', '');
        } else {
          await db.saveSetting('llm.qwen.oauthCreds', JSON.stringify(creds));
        }
        await db.saveSetting('llm.qwen.useOAuth', 'true');
        return creds;
      }
      throw new Error('Qwen OAuth credentials not found at ~/.qwen/oauth_creds.json');
    } catch (error) {
      console.error('Failed to fetch Qwen OAuth:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:get-config', async () => {
    try {
      const { provider, model, source } = await getEffectiveLlmSelection(db);
      const config = { provider, model };
      config.selectionSource = source;
      config.concurrencyEnabled = (await db.getSetting('llm.concurrency.enabled')) === 'true';

      if (provider) {
        config.providerLabel = getProviderSpec(provider)?.label || provider;
        const connection = await getProviderConnectionConfig(db, provider);
        const keyInfo = typeof db.getAPIKeyInfo === 'function'
          ? await db.getAPIKeyInfo(provider)
          : { configured: Boolean(await db.getAPIKey(provider)) };
        const url = await db.getSetting(`llm.${provider}.url`);
        const mode = await db.getSetting(`llm.${provider}.mode`);
        const useOAuth = await db.getSetting(`llm.${provider}.useOAuth`);
        config.connection = connection;
        config.apiKeyConfigured = Boolean(connection.apiKeyConfigured || keyInfo.configured);
        config.apiKeyEncrypted = Boolean(connection.apiKeyEncrypted || keyInfo.encrypted);
        if (connection.url || url) config.url = connection.url || url;
        if (mode) config.mode = mode;
        if (useOAuth === 'true') config.useOAuth = true;
        if (provider === 'openai') {
          config.transport = await db.getSetting('llm.openai.transport') || 'codex-cli';
          config.codexSandbox = await db.getSetting('llm.openai.codexSandbox') || 'read-only';
          config.codexSearch = (await db.getSetting('llm.openai.codexSearch')) === 'true';
        }
      }

      if (provider && model) {
        const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
        config.runtimeConfig = runtime;
        config.modelSpec = spec;
      }

      return config;
    } catch (error) {
      console.error('Failed to get LLM config:', error);
      return {};
    }
  });

  ipcMain.handle('llm:get-provider-connection-config', async (event, provider) => {
    if (!provider) return {};
    return getProviderConnectionConfig(db, provider);
  });

  ipcMain.handle('llm:get-provider-profiles', async () => {
    return {
      specFile: SPEC_FILE,
      providers: getProviderProfiles()
    };
  });

  ipcMain.handle('llm:codex-status', async () => {
    const adapter = aiService.adapters.openai;
    if (!adapter?.getCodexStatus) {
      return { installed: false, loggedIn: false, error: 'OpenAI Codex bridge unavailable' };
    }
    return adapter.getCodexStatus();
  });

  ipcMain.handle('llm:codex-login', async () => {
    const adapter = aiService.adapters.openai;
    if (!adapter?.launchCodexLogin) {
      return { launched: false, error: 'OpenAI Codex bridge unavailable' };
    }
    return adapter.launchCodexLogin();
  });

  ipcMain.handle('llm:get-model-profile', async (event, provider, model) => {
    if (!provider || !model) return null;
    const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
    return {
      specFile: SPEC_FILE,
      spec,
      runtimeConfig: runtime
    };
  });

  ipcMain.handle('llm:save-model-runtime', async (event, { provider, model, runtimeConfig }) => {
    if (!provider || !model) {
      throw new Error('Provider and model are required');
    }

    const saved = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
    const active = await getEffectiveLlmSelection(db);
    if (active.provider === provider && active.model === model) {
      await syncResolvedRuntime(provider, model, saved.runtime);
    }

    return {
      success: true,
      specFile: SPEC_FILE,
      spec: saved.spec,
      runtimeConfig: saved.runtime
    };
  });

  ipcMain.handle('stop-generation', async () => {
    const stopped = aiService.stopGeneration();
    if (runtime.chainController && runtime.chainController.stopChain) {
      runtime.chainController.stopChain();
    }
    return { stopped };
  });

  ipcMain.handle('is-generating', async () => ({ generating: aiService.isGenerating }));
  ipcMain.handle('get-ai-providers', async () => aiService.getProviders());
  ipcMain.handle('get-providers', async () => aiService.getProviders());
  ipcMain.handle('get-models', async (event, provider) => getCatalogAwareModels(provider, await aiService.getModels(provider)));

  ipcMain.handle('qwen:refresh-models', async () => {
    try {
      const models = await aiService.getModels('qwen');
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('llm:test-model', async (event, { provider, model }) => {
    try {
      const adapter = aiService.adapters[provider];
      if (!adapter) return { success: false, error: `Unknown provider: ${provider}` };
      const result = await adapter.call(
        [{ role: 'user', content: 'hello' }],
        { model, max_tokens: 10 }
      );
      await rememberTestedModel(db, provider, model);
      await upsertDiscoveredModel(provider, model);
      await rememberLastWorkingModel(db, provider, model);
      await saveActiveSelection(db, provider, model);
      await aiService.setProvider(provider);
      const runtimeConfig = await syncResolvedRuntime(provider, model);
      return {
        success: true,
        model: result.model,
        content: result.content,
        remembered: true,
        runtimeConfig
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('llm:set-thinking-mode', async (event, mode) => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const saved = await saveModelRuntimeConfig(db, provider, model, {
        reasoning: {
          ...profile.runtime.reasoning,
          enabled: mode === 'think'
        }
      });
      await db.saveSetting('llm.thinkingMode', saved.runtime.reasoning.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.thinkingMode', mode);
    }

    broadcastCompanionLlmSettingsChange('thinking-mode');
    return { success: true, mode };
  });

  ipcMain.handle('llm:get-thinking-mode', async () => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(db, provider, model);
      return {
        mode: runtime.reasoning.enabled ? 'think' : 'off',
        showThinking: runtime.reasoning.visibility !== 'hide',
        visibility: runtime.reasoning.visibility
      };
    }

    const mode = await db.getSetting('llm.thinkingMode') || 'off';
    const show = await db.getSetting('llm.showThinking');
    return { mode, showThinking: show !== 'false', visibility: await db.getSetting('llm.thinkingVisibility') || 'show' };
  });

  ipcMain.handle('llm:set-show-thinking', async (event, show) => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const saved = await saveModelRuntimeConfig(db, provider, model, {
        reasoning: {
          ...profile.runtime.reasoning,
          visibility: show ? 'show' : 'hide'
        }
      });
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.showThinking', show ? 'true' : 'false');
    }
    broadcastCompanionLlmSettingsChange('thinking-visibility');
    return { success: true };
  });

  ipcMain.handle('verify-qwen-key', async (event, apiKey) => {
    if (!apiKey || apiKey.trim() === '') {
      return { success: false, error: 'API key cannot be empty' };
    }
    try {
      const response = await providerRequest(axios, {
        method: 'get',
        url: 'https://dashscope.aliyuncs.com/api/v1/models',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }, { timeoutMs: 10000, label: 'Qwen API key verification' });
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        return { success: true, modelCount: response.data.data.length };
      }
      return { success: false, error: 'Invalid API response format' };
    } catch (error) {
      let errorMessage = 'API key verification failed';
      const sourceError = error.cause || error;
      if (sourceError.response) {
        if (sourceError.response.status === 401) {
          errorMessage = 'Invalid API key: Unauthorized';
        } else if (sourceError.response.data && sourceError.response.data.error) {
          errorMessage = `API error: ${sourceError.response.data.error.message || sourceError.response.data.error}`;
        } else {
          errorMessage = `API returned status ${sourceError.response.status}`;
        }
      } else if (sourceError.request) {
        errorMessage = 'No response from Qwen API server';
      } else {
        errorMessage = `Request setup error: ${sourceError.message}`;
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('set-ai-provider', async (event, provider) => {
    await aiService.setProvider(provider);
    return { success: true, provider };
  });

  ipcMain.handle('set-ai-model', async (event, model) => {
    await db.saveSetting('llm.model', model);
    return { success: true };
  });

  ipcMain.handle('set-system-prompt', async (event, prompt) => {
    await aiService.setSystemPrompt(prompt);
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(prompt, false);
    }
    return { success: true };
  });

  ipcMain.handle('get-system-prompt', async () => {
    try {
      const prompt = await db.getSetting('system_prompt');
      return prompt || 'You are a helpful AI assistant.';
    } catch (error) {
      console.error('Error getting system prompt:', error);
      return 'You are a helpful AI assistant.';
    }
  });

  ipcMain.handle('get-context-setting', async () => {
    try {
      return await db.getSetting('context_window') || '8192';
    } catch (error) {
      console.error('Error getting context setting:', error);
      return '8192';
    }
  });

  ipcMain.handle('set-context-setting', async (_, value) => {
    try {
      const numValue = parseInt(value);
      if (isNaN(numValue)) throw new Error('Invalid number');
      if (numValue < 2048 || numValue > 262144) {
        throw new Error('Value must be between 2048 and 262144');
      }
      await db.setSetting('context_window', numValue.toString());
      console.log('Context saved:', numValue);
      return { success: true };
    } catch (error) {
      console.error('Context save error:', error.message);
      throw error;
    }
  });

  ipcMain.handle('get-setting-value', async (_, key) => {
    try {
      return await getGenericSettingValue(db, key);
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return null;
    }
  });

  ipcMain.handle('prompt:get-paths', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    return promptFileManager.getPaths();
  });

  ipcMain.handle('prompt:sync-from-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncFromFiles();
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);
    return { success: true };
  });

  ipcMain.handle('prompt:sync-to-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncToFiles();
    return { success: true };
  });

  ipcMain.handle('prompt:get-system', async () => {
    if (!promptFileManager) return aiService.getSystemPrompt();
    return promptFileManager.loadSystemPrompt();
  });

  ipcMain.handle('prompt:set-system', async (event, content) => {
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(content, true);
    }
    await aiService.setSystemPrompt(content);
    return { success: true };
  });

  ipcMain.handle('prompt:get-rules-from-files', async () => {
    if (!promptFileManager) return [];
    return promptFileManager.loadRulesFromFiles();
  });
}

module.exports = { registerLlmHandlers };
