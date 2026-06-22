(function (root, factory) {
    const api = factory(root.LocalAgentTtsTextUtils || null);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.LocalAgentTtsController = api.LocalAgentTtsController;
})(typeof window !== 'undefined' ? window : globalThis, function (utils) {
    function parseSseEvent(block) {
        const lines = String(block || '').split(/\r?\n/);
        let eventName = 'message';
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith('event:')) {
                eventName = line.slice('event:'.length).trim() || 'message';
                continue;
            }
            if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trim());
            }
        }
        return {
            event: eventName,
            data: dataLines.join('\n')
        };
    }

    function extractEmotionDirective(text) {
        const source = String(text || '');
        const re = /<!--\s*(?:emotion|mood)\s*(?::|=)\s*["']?([a-z][a-z0-9_-]*)["']?\s*-->/gi;
        const valid = new Set(['neutral', 'happy', 'sad', 'surprised', 'thinking', 'angry', 'excited', 'sleepy', 'staring']);
        let match;
        let latest = null;
        while ((match = re.exec(source)) !== null) {
            const emotion = String(match[1] || '').toLowerCase();
            if (valid.has(emotion)) latest = emotion;
        }
        return latest;
    }

    class LocalAgentTtsController {
        constructor(options = {}) {
            this.panel = options.panel || null;
            this.button = options.button || null;
            this.synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null;
            this.audioContext = null;
            this.currentAbortController = null;
            this.currentSources = [];
            this.activeSpeakKey = '';
            this.activeSpeakToken = null;
            this.isSpeaking = false;
            this.settings = {
                defaultPluginId: '',
                speed: 1,
                autoSpeak: false,
                autoSpeakMode: 'answer'
            };
            this.initPromise = this.refreshSettings();
        }

        notify(message, type) {
            if (this.panel && typeof this.panel.showNotification === 'function') {
                this.panel.showNotification(message, type);
            }
        }

        syncButton() {
            if (!this.button) return;
            this.button.style.opacity = this.settings.autoSpeak ? '1' : '0.6';
            this.button.title = this.settings.autoSpeak ? 'Auto-speak ON' : 'Auto-speak OFF';
        }

        async refreshSettings() {
            try {
                const latest = await window.electronAPI.tts.getSettings();
                this.settings = {
                    ...this.settings,
                    ...(latest || {})
                };
                if (this.panel) {
                    this.panel.autoSpeak = Boolean(this.settings.autoSpeak);
                }
                this.syncButton();
            } catch (error) {
                console.error('Failed to load TTS settings:', error);
            }
            return this.settings;
        }

        async saveSettings(patch) {
            const response = await window.electronAPI.tts.saveSettings(patch || {});
            if (response?.success && response.settings) {
                this.settings = {
                    ...this.settings,
                    ...response.settings
                };
                if (this.panel) {
                    this.panel.autoSpeak = Boolean(this.settings.autoSpeak);
                }
                this.syncButton();
            }
            return response;
        }

        async toggleAutoSpeak() {
            await this.initPromise;
            const nextValue = !this.settings.autoSpeak;
            await this.saveSettings({ autoSpeak: nextValue });
            this.notify(`Auto-speak ${nextValue ? 'enabled' : 'disabled'}`);
            return nextValue;
        }

        async stop() {
            if (this.currentAbortController) {
                try {
                    this.currentAbortController.abort();
                } catch (_) {}
                this.currentAbortController = null;
            }
            for (const source of this.currentSources) {
                try {
                    source.stop(0);
                } catch (_) {}
            }
            this.currentSources = [];
            if (this.synthesis) {
                this.synthesis.cancel();
            }
            this.activeSpeakKey = '';
            this.activeSpeakToken = null;
            this.isSpeaking = false;
        }

        shouldUseBrowser() {
            return !this.settings.defaultPluginId;
        }

        speakBrowser(text, token) {
            return new Promise((resolve) => {
                if (!this.synthesis) {
                    resolve({ ok: false, error: 'Built-in speech synthesis is unavailable' });
                    return;
                }
                this.synthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = Number(this.settings.speed || 1);
                utterance.onend = () => resolve({ ok: true, provider: 'browser' });
                utterance.onerror = (event) => resolve({ ok: false, error: event.error || 'Browser speech failed', provider: 'browser' });
                this.synthesis.speak(utterance);
            }).finally(() => {
                if (this.activeSpeakToken === token) {
                    this.activeSpeakKey = '';
                    this.activeSpeakToken = null;
                    this.isSpeaking = false;
                }
            });
        }

        getPreparedText(rawText, options = {}) {
            const mode = options.mode || this.settings.autoSpeakMode || 'answer';
            return utils && typeof utils.extractSpeakableText === 'function'
                ? utils.extractSpeakableText(rawText, mode)
                : String(rawText || '').trim();
        }

        async getAudioContext() {
            if (!this.audioContext) {
                const AudioCtor = window.AudioContext || window.webkitAudioContext;
                this.audioContext = AudioCtor ? new AudioCtor() : null;
            }
            if (!this.audioContext) return null;
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            return this.audioContext;
        }

        base64ToArrayBuffer(base64) {
            const binary = atob(String(base64 || ''));
            const length = binary.length;
            const bytes = new Uint8Array(length);
            for (let index = 0; index < length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            return bytes.buffer;
        }

        async queueChunkAudio(audioContext, state, payload) {
            const arrayBuffer = this.base64ToArrayBuffer(payload.audio_base64);
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            state.scheduledAt = Math.max(state.scheduledAt, audioContext.currentTime + 0.02);
            const ended = new Promise((resolve) => {
                source.onended = () => resolve();
            });
            state.sourceEnds.push(ended);
            source.start(state.scheduledAt);
            state.scheduledAt += audioBuffer.duration;
            this.currentSources.push(source);
        }

        async playPluginStream(plan) {
            const audioContext = await this.getAudioContext();
            if (!audioContext) {
                throw new Error('Web Audio is unavailable in this renderer');
            }

            this.currentAbortController = new AbortController();
            try {
                const response = await fetch(plan.url, {
                    method: plan.method || 'POST',
                    headers: plan.headers || {},
                    body: JSON.stringify(plan.body || {}),
                    signal: this.currentAbortController.signal
                });
                if (!response.ok || !response.body) {
                    throw new Error(`Plugin stream request failed with HTTP ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const state = {
                    scheduledAt: audioContext.currentTime + 0.05,
                    sourceEnds: []
                };
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    let boundary = buffer.indexOf('\n\n');
                    while (boundary !== -1) {
                        const rawEvent = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const event = parseSseEvent(rawEvent);
                        if (event.event === 'chunk' && event.data) {
                            const payload = JSON.parse(event.data);
                            await this.queueChunkAudio(audioContext, state, payload);
                        } else if (event.event === 'error' && event.data) {
                            const payload = JSON.parse(event.data);
                            throw new Error(payload.message || 'Plugin streaming failed');
                        }
                        boundary = buffer.indexOf('\n\n');
                    }
                }

                await Promise.allSettled(state.sourceEnds);
                return { ok: true, provider: plan.provider || 'plugin-stream' };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    return { ok: true, stopped: true, provider: plan.provider || 'plugin-stream' };
                }
                throw error;
            } finally {
                this.currentAbortController = null;
            }
        }

        async speakText(rawText, options = {}) {
            await this.initPromise;
            await this.refreshSettings();

            const emotion = extractEmotionDirective(rawText);
            const text = this.getPreparedText(rawText, options);
            if (!text) {
                return { ok: false, skipped: true };
            }

            const speakKey = `${options.mode || this.settings.autoSpeakMode || 'answer'}\n${text}`;
            if (this.isSpeaking && this.activeSpeakKey === speakKey) {
                await this.stop();
                return { ok: true, stopped: true };
            }

            await this.stop();
            const token = Symbol('tts-speak');
            this.activeSpeakToken = token;
            this.activeSpeakKey = speakKey;
            this.isSpeaking = true;
            if (this.shouldUseBrowser()) {
                return this.speakBrowser(text, token);
            }

            try {
                const planResponse = await window.electronAPI.plugins.runAction(
                    this.settings.defaultPluginId,
                    'getStreamPlan',
                    {
                        text,
                        emotion,
                        speed: this.settings.speed
                    }
                );
                if (!planResponse?.success || !planResponse.result?.ok) {
                    throw new Error(planResponse?.error || 'Stream plan is unavailable');
                }
                const result = await this.playPluginStream(planResponse.result);
                if (this.activeSpeakToken === token) {
                    this.activeSpeakKey = '';
                    this.activeSpeakToken = null;
                    this.isSpeaking = false;
                }
                return result;
            } catch (error) {
                console.warn('Plugin TTS failed, falling back to browser speech:', error);
                return this.speakBrowser(text, token);
            }
        }
    }

    return {
        LocalAgentTtsController,
        extractEmotionDirective,
        parseSseEvent
    };
});
