const {
  getCapabilityContract,
  normalizeTtsSpeakResult,
  normalizeTtsVoices
} = require('./plugin-capability-contracts');
const ttsTextUtils = require('../renderer/components/tts-text-utils');

class TtsService {
  constructor({ db, pluginManager, agentManager }) {
    this.db = db;
    this.pluginManager = pluginManager;
    this.agentManager = agentManager;
  }

  _trace(event, details = {}) {
    if (process.env.LOCALAGENT_TTS_TRACE !== '1') return;
    try {
      console.log(`[TtsService] ${JSON.stringify({ event, ...details })}`);
    } catch (_) {
      console.log(`[TtsService] ${event}`);
    }
  }

  _bool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }

  _number(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getSettings() {
    return {
      defaultPluginId: await this.db.getSetting('tts.defaultPluginId') || '',
      speed: this._number(await this.db.getSetting('tts.speed'), 1),
      autoSpeak: this._bool(await this.db.getSetting('tts.autoSpeak'), false),
      autoSpeakMode: await this.db.getSetting('tts.autoSpeakMode') || 'answer'
    };
  }

  _prepareText(params = {}, settings = {}) {
    const source = String(params.rawText ?? params.text ?? '').trim();
    if (!source) return '';
    if (params.prepareText !== true) return source;
    return ttsTextUtils.extractSpeakableText(
      source,
      params.mode || settings.autoSpeakMode || 'answer'
    );
  }

  async _buildSpeakPayload(params, settings, text) {
    const agent = await this._getAgentInfo(params.agentId);
    return {
      text,
      rawText: params.rawText ?? params.text ?? '',
      sessionId: params.sessionId || null,
      agentId: params.agentId || null,
      source: params.source || '',
      mode: params.mode || settings.autoSpeakMode || 'answer',
      speed: params.speed || settings.speed,
      agent,
      includeBase64: params.includeBase64 !== false
    };
  }

  async saveSettings(settings = {}) {
    const allowed = ['defaultPluginId', 'speed', 'autoSpeak', 'autoSpeakMode'];
    for (const key of allowed) {
      if (settings[key] !== undefined) {
        await this.db.saveSetting(`tts.${key}`, String(settings[key]));
      }
    }
    return this.getSettings();
  }

  getContract() {
    return getCapabilityContract('tts');
  }

  _isEnabledProvider(provider) {
    return String(provider?.status || '').trim().toLowerCase() === 'enabled';
  }

  listProviders({ enabledOnly = true } = {}) {
    if (!this.pluginManager?.getPluginsByCapability) return [];
    return this.pluginManager.getPluginsByCapability('tts', { enabledOnly })
      .filter(provider => !enabledOnly || this._isEnabledProvider(provider))
      .map(provider => ({ ...provider, contract: provider.contract || this.getContract() }));
  }

  async _resolvePluginId(requestedPluginId = '') {
    const providers = this.listProviders({ enabledOnly: true });
    if (requestedPluginId && providers.some(provider => provider.id === requestedPluginId)) {
      return requestedPluginId;
    }

    const settings = await this.getSettings();
    if (settings.defaultPluginId && providers.some(provider => provider.id === settings.defaultPluginId)) {
      return settings.defaultPluginId;
    }

    return providers[0]?.id || '';
  }

  _resolveSelectedPluginId(settings = {}) {
    const providers = this.listProviders({ enabledOnly: true });
    if (settings.defaultPluginId && providers.some(provider => provider.id === settings.defaultPluginId)) {
      return settings.defaultPluginId;
    }
    return '';
  }

  async _getAgentInfo(agentId) {
    if (!agentId || !this.agentManager?.getAgent) return null;
    const agent = await this.agentManager.getAgent(agentId);
    if (!agent) return null;
    const slug = agent.slug || (this.agentManager._getSafeFolderName
      ? this.agentManager._getSafeFolderName(agent.name)
      : String(agent.name || agentId).toLowerCase().replace(/\s+/g, '-'));
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      slug
    };
  }

  async listVoices(params = {}) {
    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: false, error: 'No enabled TTS plugin', voices: [] };
    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'listVoices', params);
      return { success: true, pluginId, contract: 'tts.v1', voices: normalizeTtsVoices(result) };
    } catch (error) {
      return { success: false, pluginId, error: error.message, voices: [] };
    }
  }

  async speak(params = {}) {
    const text = String(params.text || '').trim();
    if (!text) return { success: false, error: 'Text is required' };

    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: false, error: 'No enabled TTS plugin' };

    const settings = await this.getSettings();
    const agent = await this._getAgentInfo(params.agentId);
    const payload = {
      text,
      rawText: params.rawText ?? params.text ?? '',
      sessionId: params.sessionId || null,
      agentId: params.agentId || null,
      source: params.source || '',
      mode: params.mode || settings.autoSpeakMode || 'answer',
      speed: params.speed || settings.speed,
      agent
    };

    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'speak', payload);
      const normalized = normalizeTtsSpeakResult(result);
      return { success: normalized.ok, pluginId, result: normalized };
    } catch (error) {
      return { success: false, pluginId, error: error.message };
    }
  }

  async speakAudio(params = {}) {
    const settings = await this.getSettings();
    const text = this._prepareText(params, settings);
    if (!text) return { success: false, error: 'Text is required' };

    const pluginId = this._resolveSelectedPluginId(settings);
    if (pluginId && this.pluginManager?.runPluginAction) {
      try {
        const payload = await this._buildSpeakPayload(params, settings, text);
        this._trace('plugin.speak.begin', { pluginId, textLength: text.length });
        const result = await this.pluginManager.runPluginAction(pluginId, 'speak', payload);
        this._trace('plugin.speak.ok', { pluginId });
        const normalized = normalizeTtsSpeakResult(result);
        return { success: normalized.ok, backend: 'plugin-tts', pluginId, result: normalized };
      } catch (error) {
        this._trace('plugin.speak.error', { pluginId, error: error.message || String(error) });
        return { success: false, backend: 'plugin-tts', pluginId, error: error.message };
      }
    }

    /**
     * Embedded voice backend was removed as a fallback.
     * It previously hardcoded fast-qwen, bypassing the user's plugin selection.
     * When no plugin is enabled, the companion must generate audio via its
     * own browser speechSynthesis. Text is cleaned here — same single point
     * (ttsTextUtils.extractSpeakableText) used by both Electron and companion.
     */
    const rawText = String(params.rawText ?? params.text ?? '').trim();
    const mode = params.mode || settings.autoSpeakMode || 'answer';
    const speakText = ttsTextUtils.extractSpeakableText(rawText, mode);
    return {
      success: false,
      backend: 'browser-tts',
      fallback: 'browser-tts',
      speakText: speakText || rawText,
      error: 'No TTS plugin enabled. Use browser speechSynthesis.'
    };
  }

  async stop(params = {}) {
    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: true, stopped: true, localOnly: true };
    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'stop', params);
      return { success: true, pluginId, result };
    } catch (error) {
      return { success: true, pluginId, warning: error.message };
    }
  }
}

module.exports = TtsService;
