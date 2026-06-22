const {
  getCapabilityContract,
  normalizeSttTranscriptionResult
} = require('./plugin-capability-contracts');
const { NativeWhisperSttBackend } = require('./native-whisper-stt-backend');

class SttService {
  constructor({ db, runtimePaths, pluginManager }) {
    this.db = db;
    this.runtimePaths = runtimePaths || null;
    this.pluginManager = pluginManager || null;
    this.backend = null;
    this.backendError = '';
  }

  _ensureBackend() {
    if (this.backend) return this.backend;
    try {
      this.backend = new NativeWhisperSttBackend();
      this.backendError = '';
    } catch (error) {
      this.backend = null;
      this.backendError = error?.message || 'Native STT backend is unavailable';
    }
    return this.backend;
  }

  getContract() {
    return getCapabilityContract('stt');
  }

  async getSettings() {
    return {
      defaultPluginId: await this.db.getSetting('stt.defaultPluginId') || ''
    };
  }

  async saveSettings(settings = {}) {
    if (settings.defaultPluginId !== undefined) {
      await this.db.saveSetting('stt.defaultPluginId', String(settings.defaultPluginId || ''));
    }
    return this.getSettings();
  }

  _isEnabledProvider(provider) {
    return String(provider?.status || '').trim().toLowerCase() === 'enabled';
  }

  _pluginProviders({ enabledOnly = true } = {}) {
    if (!this.pluginManager?.getPluginsByCapability) return [];
    return this.pluginManager.getPluginsByCapability('stt', { enabledOnly })
      .filter(provider => !enabledOnly || this._isEnabledProvider(provider))
      .map(provider => ({ ...provider, contract: provider.contract || this.getContract() }));
  }

  _builtinProvider() {
    const backend = this._ensureBackend();
    const availability = backend?.getAvailability ? backend.getAvailability() : null;
    const ready = backend && availability?.ready !== false;
    return {
      id: 'embedded-whisper',
      name: 'Native Whisper (ONNX)',
      description: 'Built-in local STT backend',
      status: ready ? 'enabled' : 'unavailable',
      capabilities: ['stt'],
      contract: this.getContract(),
      error: ready ? '' : (availability?.error || this.backendError),
      source: 'core',
      isDefault: true
    };
  }

  listProviders(options = {}) {
    const plugins = this._pluginProviders(options);
    return [...plugins, this._builtinProvider()];
  }

  async _resolveSelectedPluginId() {
    const settings = await this.getSettings();
    const providers = this._pluginProviders({ enabledOnly: true });
    if (settings.defaultPluginId && providers.some(provider => provider.id === settings.defaultPluginId)) {
      return settings.defaultPluginId;
    }
    return '';
  }

  async getStatusSnapshot() {
    const tiers = this.listProviders({ enabledOnly: false });
    return {
      tiers,
      activeProvider: await this._resolveSelectedPluginId() || 'embedded-whisper'
    };
  }

  _buildSuccess(providerId, raw, backend = 'embedded-stt') {
    const normalized = normalizeSttTranscriptionResult(raw);
    const error = String(raw?.error || raw?.message || '').trim();
    const success = normalized.ok && Boolean(normalized.text);
    return {
      success,
      backend,
      providerId,
      result: normalized,
      text: normalized.text,
      transcript: normalized.text,
      error: success ? '' : (error || (normalized.text ? 'STT provider returned an unsuccessful result' : 'STT returned an empty transcript')),
      detectedLanguage: normalized.detectedLanguage,
      durationMs: normalized.durationMs,
      segmentCount: normalized.segmentCount
    };
  }

  async _transcribeWithPlugin(pluginId, params = {}) {
    if (!this.pluginManager?.runPluginAction) return null;
    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'transcribeAudio', {
        audioBase64: String(params.audioBase64 || params.audio_base64 || '').trim(),
        mimeType: String(params.mimeType || params.mime_type || '').trim() || 'audio/webm',
        language: String(params.language || '').trim() || null,
        prompt: String(params.prompt || '').trim() || null
      });
      return this._buildSuccess(pluginId, result, 'plugin-stt');
    } catch (error) {
      return { success: false, backend: 'plugin-stt', providerId: pluginId, error: error.message };
    }
  }

  async _transcribeWithBuiltin(params = {}) {
    const backend = this._ensureBackend();
    if (!backend) {
      return {
        success: false,
        backend: 'native-stt',
        providerId: 'embedded-whisper',
        error: this.backendError || 'Built-in native STT is unavailable'
      };
    }
    try {
      const result = await backend.transcribeAudio(params);
      if (!result) {
        return {
          success: false,
          backend: 'native-stt',
          providerId: 'embedded-whisper',
          error: 'Built-in native STT returned no result'
        };
      }
      return this._buildSuccess('embedded-whisper', result, 'native-stt');
    } catch (error) {
      return {
        success: false,
        backend: 'native-stt',
        providerId: 'embedded-whisper',
        error: error.message
      };
    }
  }

  async transcribeAudio(params = {}) {
    const audioBase64 = String(params.audioBase64 || params.audio_base64 || '').trim();
    if (!audioBase64) {
      return { success: false, error: 'Audio data is required' };
    }

    const errors = [];

    const pluginId = await this._resolveSelectedPluginId();
    if (pluginId) {
      const result = await this._transcribeWithPlugin(pluginId, params);
      if (result && result.success) {
        return result;
      }
      errors.push(`Selected STT plugin (${pluginId}) failed: ${result?.error || 'Unknown error'}`);
    }

    const builtinResult = await this._transcribeWithBuiltin(params);
    if (builtinResult.success) {
      return builtinResult;
    }
    errors.push(`Built-in native STT failed: ${builtinResult.error || 'Unknown error'}`);

    return {
      success: false,
      error: `STT failed:\n${errors.join('\n')}`
    };
  }
}

module.exports = SttService;
