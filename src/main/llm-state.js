function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function normalizeModel(model) {
  return String(model || '').trim();
}

function parseJsonObject(rawValue) {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function appendUnique(target, value, seen) {
  const normalized = normalizeModel(value);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(normalized);
}

function isOllamaCloudModel(model) {
  const normalized = normalizeModel(model).toLowerCase();
  return normalized.includes('-cloud') || normalized.includes(':cloud');
}

async function getTestedModelMap(db) {
  const rawValue = await db.getSetting('llm.testedModels');
  const parsed = parseJsonObject(rawValue);
  const output = {};

  for (const [provider, models] of Object.entries(parsed)) {
    if (!Array.isArray(models)) continue;
    output[normalizeProvider(provider)] = models
      .map(model => normalizeModel(model))
      .filter(Boolean);
  }

  return output;
}

async function saveTestedModelMap(db, testedModels) {
  await db.saveSetting('llm.testedModels', JSON.stringify(testedModels));
}

async function rememberTestedModel(db, provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModel(model);
  if (!normalizedProvider || !normalizedModel) return [];

  const testedModels = await getTestedModelMap(db);
  const providerModels = Array.isArray(testedModels[normalizedProvider]) ? testedModels[normalizedProvider] : [];
  const nextModels = [];
  const seen = new Set();

  providerModels.forEach(entry => appendUnique(nextModels, entry, seen));
  appendUnique(nextModels, normalizedModel, seen);

  testedModels[normalizedProvider] = nextModels;
  await saveTestedModelMap(db, testedModels);
  return nextModels;
}

async function rememberLastWorkingModel(db, provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModel(model);
  if (!normalizedProvider || !normalizedModel) return null;

  await db.saveSetting('llm.lastWorkingProvider', normalizedProvider);
  await db.saveSetting('llm.lastWorkingModel', normalizedModel);
  return { provider: normalizedProvider, model: normalizedModel };
}

async function getLastWorkingSelection(db) {
  const provider = normalizeProvider(await db.getSetting('llm.lastWorkingProvider'));
  const model = normalizeModel(await db.getSetting('llm.lastWorkingModel'));
  if (!provider && !model) {
    return null;
  }

  return {
    provider: provider || null,
    model: model || null
  };
}

async function getEffectiveLlmSelection(db) {
  const lastWorking = await getLastWorkingSelection(db);
  const configuredProvider = normalizeProvider(
    await db.getSetting('llm.provider') || await db.getSetting('ai_provider')
  );
  const configuredModel = normalizeModel(await db.getSetting('llm.model'));

  if (configuredProvider || configuredModel) {
    const provider = configuredProvider || lastWorking?.provider || 'ollama';
    const model = configuredProvider
      ? (configuredModel || null)
      : ((lastWorking?.provider || '') === provider ? (lastWorking?.model || null) : null);
    return {
      provider,
      model,
      source: 'configured'
    };
  }

  if (lastWorking && (lastWorking.provider || lastWorking.model)) {
    return {
      provider: lastWorking.provider || 'ollama',
      model: lastWorking.model || null,
      source: 'last-working'
    };
  }

  return {
    provider: 'ollama',
    model: null,
    source: 'default'
  };
}

async function saveActiveSelection(db, provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModel(model);
  if (!normalizedProvider) return null;

  await db.saveSetting('llm.provider', normalizedProvider);
  if (normalizedModel) {
    await db.saveSetting('llm.model', normalizedModel);
    if (normalizedProvider === 'ollama') {
      const isCloudModel = isOllamaCloudModel(normalizedModel);
      await db.saveSetting('llm.modelType', isCloudModel ? 'cloud' : 'local');
    }
    await db.saveSetting('llm.lastWorkingModel', normalizedModel);
  } else {
    await db.saveSetting('llm.model', '');
    // Prevent stale cross-provider fallback from pinning an old model.
    await db.saveSetting('llm.lastWorkingModel', '');
  }
  // Explicit UI/provider selection should become effective immediately.
  await db.saveSetting('llm.lastWorkingProvider', normalizedProvider);

  return {
    provider: normalizedProvider,
    model: normalizedModel || null
  };
}

async function getKnownModelsForProvider(db, provider, discoveredModels = []) {
  const normalizedProvider = normalizeProvider(provider);
  const knownModels = [];
  const seen = new Set();
  const testedModels = await getTestedModelMap(db);
  const effective = await getEffectiveLlmSelection(db);
  const configuredProvider = normalizeProvider(await db.getSetting('llm.provider'));
  const configuredModel = normalizeModel(await db.getSetting('llm.model'));

  discoveredModels.forEach(model => appendUnique(knownModels, model, seen));
  (testedModels[normalizedProvider] || []).forEach(model => appendUnique(knownModels, model, seen));

  if (effective.provider === normalizedProvider) {
    appendUnique(knownModels, effective.model, seen);
  }

  if (configuredProvider === normalizedProvider) {
    appendUnique(knownModels, configuredModel, seen);
  }

  return knownModels;
}

module.exports = {
  getEffectiveLlmSelection,
  getKnownModelsForProvider,
  getLastWorkingSelection,
  getTestedModelMap,
  rememberLastWorkingModel,
  rememberTestedModel,
  saveActiveSelection
};
