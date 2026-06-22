const { getModelRuntimeConfig, saveModelRuntimeConfig, sanitizeRuntimeConfig } = require('../llm-config');

class InferenceRuntimeConfig {
  constructor({ db, aiService }) {
    this.db = db;
    this.aiService = aiService;
    this.runtimeContextCache = new Map();
    this.contextClampWarningCache = new Set();
  }

  async resolveContextWindow({ provider, model, modelSpec, runtimeConfig }) {
    if (!model) {
      const savedContext = await this.db.getSetting('context_window');
      const parsedContext = Number.parseInt(savedContext, 10);
      return Number.isFinite(parsedContext) && parsedContext > 0 ? parsedContext : 8192;
    }

    let effectiveSpec = modelSpec;
    let effectiveRuntime = runtimeConfig;
    if (!effectiveRuntime) {
      const config = await getModelRuntimeConfig(this.db, provider, model);
      effectiveSpec = config.spec;
      effectiveRuntime = config.runtime;
    }

    if (effectiveSpec && effectiveRuntime) {
      effectiveRuntime = await this.applyUiRuntimeOverrides(effectiveSpec, effectiveRuntime);
    }

    return effectiveRuntime?.contextWindow?.value || effectiveSpec?.runtime?.contextWindow?.value || 8192;
  }

  async loadModelRuntime(provider, model) {
    return getModelRuntimeConfig(this.db, provider, model);
  }

  async applyUiRuntimeOverrides(modelSpec, runtimeConfig = {}) {
    const effectiveRuntime = JSON.parse(JSON.stringify(runtimeConfig || {}));
    const savedContext = await this.db.getSetting('context_window');
    const parsedContext = Number.parseInt(savedContext, 10);
    let appliedUiContextWindow = false;
    if (Number.isFinite(parsedContext) && parsedContext > 0) {
      effectiveRuntime.contextWindow = { value: parsedContext };
      appliedUiContextWindow = true;
    }

    const sanitized = sanitizeRuntimeConfig(modelSpec, effectiveRuntime);
    if (appliedUiContextWindow) {
      const appliedContext = this.resolveUiContextWindowValue(modelSpec, parsedContext, sanitized.contextWindow?.value);
      sanitized.contextWindow = { value: appliedContext.value };
      Object.defineProperty(sanitized, '__uiContextWindowOverride', { value: true, enumerable: false });
      Object.defineProperty(sanitized, '__uiContextWindowRequested', { value: parsedContext, enumerable: false });
      Object.defineProperty(sanitized, '__uiContextWindowApplied', { value: appliedContext.value, enumerable: false });
      Object.defineProperty(sanitized, '__uiContextWindowClamped', { value: appliedContext.clamped, enumerable: false });
      if (appliedContext.clamped) {
        this.emitContextClampWarning(modelSpec, parsedContext, appliedContext.value, appliedContext.reason);
      }
    }
    return sanitized;
  }

  resolveUiContextWindowValue(modelSpec, requestedValue, sanitizedValue) {
    const requested = Number.parseInt(requestedValue, 10);
    const sanitized = Number.parseInt(sanitizedValue, 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      return {
        value: Number.isFinite(sanitized) && sanitized > 0 ? sanitized : 8192,
        clamped: false,
        reason: 'invalid'
      };
    }

    const caps = modelSpec?.capabilities?.contextWindow || {};
    const presets = Array.isArray(caps.presets)
      ? caps.presets.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const uiLimit = presets.length > 0 ? Math.max(...presets) : 262144;
    const rawMax = Number.parseInt(caps.max, 10);
    const knownModelMax = Number.isFinite(rawMax) && rawMax > 0 && rawMax < uiLimit ? rawMax : null;
    const rawMin = Number.parseInt(caps.min, 10);
    const min = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 1;
    const upperBound = knownModelMax || uiLimit;
    const value = Math.max(min, Math.min(requested, upperBound));

    return {
      value,
      clamped: value !== requested,
      reason: knownModelMax ? 'model_max' : 'ui_limit'
    };
  }

  emitContextClampWarning(modelSpec, requested, applied, reason) {
    const provider = modelSpec?.provider || 'provider';
    const model = modelSpec?.model || 'model';
    const key = `${provider}:${model}:${requested}:${applied}:${reason}`;
    if (this.contextClampWarningCache.has(key)) return;
    this.contextClampWarningCache.add(key);

    const message = reason === 'model_max'
      ? `Requested context ${requested} exceeds known model limit for ${model}; using ${applied}.`
      : `Requested context ${requested} exceeds the UI limit; using ${applied}.`;
    if (this.aiService?.windowManager?.send) {
      this.aiService.windowManager.send('llm-soft-alert', {
        provider,
        level: 'warning',
        message,
        requestedContextWindow: requested,
        appliedContextWindow: applied
      });
      return;
    }
    console.warn(`[Dispatcher] ${message}`);
  }

  async rememberWorkingRuntimeParams(provider, model, modelSpec, runtimeConfig, response) {
    if (!provider || !model || !modelSpec || response?.stopped) {
      return;
    }

    const contextCaps = modelSpec.capabilities?.contextWindow || {};
    const contextLength = runtimeConfig?.contextWindow?.value || response?.context_length;
    if (runtimeConfig?.__uiContextWindowOverride === true) {
      return;
    }
    if (contextCaps.configurable && contextLength) {
      const normalizedLength = Number(contextLength);
      if (!Number.isFinite(normalizedLength) || normalizedLength <= 0) {
        return;
      }
      const cacheKey = `${provider}:${model}`;
      const cachedLength = this.runtimeContextCache.get(cacheKey);
      if (cachedLength === normalizedLength) {
        return;
      }
      if (
        cachedLength === undefined &&
        runtimeConfig?.contextWindow?.value === normalizedLength &&
        runtimeConfig.__uiContextWindowOverride !== true
      ) {
        this.runtimeContextCache.set(cacheKey, normalizedLength);
        return;
      }
      await saveModelRuntimeConfig(this.db, provider, model, {
        contextWindow: { value: normalizedLength }
      });
      this.runtimeContextCache.set(cacheKey, normalizedLength);
    }
  }
}

module.exports = { InferenceRuntimeConfig };
