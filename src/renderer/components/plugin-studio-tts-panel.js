(function (root) {
    const PLUGIN_ID = 'http-tts-bridge';
    const DEFAULT_BUILTIN_MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';
    const DEFAULT_CLONE_MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-Base';
    const DEFAULT_PIPER_VOICE_ID = 'en_US-lessac-medium';
    const DEFAULT_PREVIEW_TEXT = 'Quick voice check.';
    const VOICE_DESCRIPTION_PRESETS = ['Speak in a calm, professional assistant tone.', 'Sound warm and empathetic, like a personal AI companion.', 'Use clear pacing and strong pronunciation for commands.', 'Energetic and motivational tone.', 'Whisper softly with low intensity.', 'Read this as a concise system notification.'];

    function getSelectedPlugin(panel) {
        return panel && typeof panel.getSelectedPlugin === 'function'
            ? panel.getSelectedPlugin()
            : null;
    }
    function getState(panel) {
        if (!panel._ttsStudioState) {
            panel._ttsStudioState = {
                previewText: DEFAULT_PREVIEW_TEXT,
                cloneName: '',
                sourceFile: '',
                sourceFiles: [],
                downloadTasks: {},
                prepareTaskId: '',
                prepareStatus: null,
                voiceDescriptionSaveTimer: null,
                refreshTimer: null,
                renderToken: null
            };
        }
        return panel._ttsStudioState;
    }
    function clearStateTimer(panel, key) {
        const state = getState(panel);
        if (!state[key]) return;
        clearTimeout(state[key]);
        state[key] = null;
    }
    function clearRefresh(panel) {
        clearStateTimer(panel, 'refreshTimer');
    }
    function clearVoiceDescriptionSave(panel) {
        clearStateTimer(panel, 'voiceDescriptionSaveTimer');
    }
    function scheduleRefresh(panel, delayMs = 1200) {
        const state = getState(panel);
        clearRefresh(panel);
        state.refreshTimer = setTimeout(() => {
            const plugin = getSelectedPlugin(panel);
            if (!plugin || plugin.id !== PLUGIN_ID) return;
            if (panel.overlay && panel.overlay.classList.contains('hidden')) return;
            root.LocalAgentPluginTtsStudio.render(panel).catch(error => {
                panel.setResult(error.message || String(error));
            });
        }, delayMs);
    }
    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (textContent != null) element.textContent = textContent;
        return element;
    }
    function createButton(label, onClick, className = 'compact-btn') {
        const button = createElement('button', className, label);
        button.type = 'button';
        button.addEventListener('click', onClick);
        return button;
    }
    function createOption(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }
    function boolFromConfig(value, fallback = false) {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
    }
    function getPluginConfigValue(panel, key, fallback = '') {
        const raw = panel?.selectedDetail?.config?.[key];
        return raw == null || raw === '' ? fallback : raw;
    }
    function prettifyVoiceId(voiceId) {
        const value = String(voiceId || '').trim();
        if (!value) return 'None';
        if (value.startsWith('qwen-builtin:')) return value.slice('qwen-builtin:'.length);
        if (value.startsWith('qwen-clone:')) return `${value.slice('qwen-clone:'.length)} (clone)`;
        if (value.startsWith('piper:')) return value.slice('piper:'.length);
        return value;
    }
    function statusLabel(plugin, backend) {
        if (plugin?.status !== 'enabled') return 'Disabled';
        if (isBackendLoading(backend)) return 'Loading';
        if (backend?.ready && backend?.healthy) return 'Ready';
        if (backend?.running) return 'Running';
        if (backend?.lastError) return 'Error';
        return 'Stopped';
    }
    function statusTone(plugin, backend) {
        if (plugin?.status !== 'enabled') return 'muted';
        if (backend?.ready && backend?.healthy) return 'good';
        if (backend?.lastError) return 'bad';
        if (isBackendLoading(backend) || backend?.running) return 'warm';
        return 'muted';
    }
    function isBackendLoading(backend) {
        return Boolean(backend?.starting || (backend?.running && !backend?.ready));
    }
    function formatSeconds(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return '-';
        return `${number.toFixed(number < 1 ? 2 : 1)}s`;
    }
    function shortModelLabel(modelId) {
        const value = String(modelId || '').trim();
        if (!value) return 'Model';
        if (value.startsWith('Qwen/')) {
            return value.split('/').pop().replace('Qwen3-TTS-12Hz-', '');
        }
        if (value.startsWith('piper:')) {
            return value.slice('piper:'.length);
        }
        return value;
    }
    function modelStatusText(item) {
        if (!item) return 'Not checked';
        if (item.loaded) return 'Loaded';
        if (item.local_usable) return 'Ready';
        if (item.local_available) return 'Present';
        return item.status || 'Missing';
    }
    function modelTone(item) {
        if (!item) return 'muted';
        if (item.loaded || item.local_usable) return 'good';
        if (item.local_available) return 'warm';
        return 'muted';
    }
    function dedupeVoiceOptions(options) {
        const seen = new Set();
        const items = [];
        for (const option of options || []) {
            const id = String(option?.id || '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            items.push({
                id,
                label: option?.label || id
            });
        }
        return items;
    }
    function buildPiperModelVoiceOptions(state) {
        const items = Array.isArray(state?.models?.items) ? state.models.items : [];
        return items
            .filter(item => String(item?.id || '').startsWith('piper:'))
            .filter(item => item?.loaded || item?.local_usable || item?.local_available || ['ready', 'loaded', 'present'].includes(String(item?.status || '').toLowerCase()))
            .map(item => ({ id: item.id, label: String(item.id).slice('piper:'.length) }));
    }
    function getVoiceOptions(state, provider) {
        if (provider === 'browser') {
            return [{ id: '', label: 'Browser default' }];
        }
        const source = Array.isArray(state.voices) ? state.voices : [];
        const filtered = source
            .filter(voice => voice.provider === provider)
            .map(voice => ({
                id: voice.id,
                label: voice.kind === 'clone' ? `${voice.name} (clone)` : voice.name
            }));
        if (provider === 'piper') {
            const piperOptions = dedupeVoiceOptions([
                ...filtered,
                ...buildPiperModelVoiceOptions(state)
            ]);
            if (piperOptions.length) return piperOptions;
        }
        if (filtered.length) {
            return filtered;
        }
        if (provider === 'fast-qwen') {
            return [{ id: '', label: 'Start backend for Qwen voices' }];
        }
        if (provider === 'piper') {
            return [{ id: '', label: 'Import Piper voice first' }];
        }
        return [{ id: '', label: 'No voices' }];
    }
    function resolveActiveVoice(state, voiceOptions) {
        const savedVoice = String(state?.settings?.voice || '').trim();
        const firstRealOption = voiceOptions.find(option => option.id)?.id || '';
        const activeVoice = voiceOptions.some(option => option.id === savedVoice)
            ? savedVoice
            : firstRealOption;
        state.settings = state.settings || {};
        state.settings.voice = activeVoice;
        return activeVoice;
    }
    function normalizeVoiceDescription(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500); }
    function getVoiceDescriptionValue(state) { return normalizeVoiceDescription(state?.settings?.voiceDescription || ''); }
    function findVoiceMeta(state, voiceId) {
        const voices = Array.isArray(state?.voices) ? state.voices : [];
        return voices.find(voice => String(voice?.id || '') === String(voiceId || '')) || null;
    }
    function getVoiceDescriptionMeta(panel, state) {
        const provider = state.settings?.provider || 'browser';
        const voiceId = String(state.settings?.voice || '').trim();
        const builtinModel = String(getPluginConfigValue(panel, 'builtinModel', DEFAULT_BUILTIN_MODEL));
        const cloneModel = String(getPluginConfigValue(panel, 'cloneModel', DEFAULT_CLONE_MODEL));

        if (provider === 'browser') {
            return {
                editable: false,
                heading: 'Browser fallback',
                tag: 'System',
                body: 'Voice description is a Fast Qwen feature. Browser fallback ignores it.',
                subline: 'Good fallback when the local backend is off.'
            };
        }

        if (isBackendLoading(state.backend)) {
            return {
                editable: provider === 'fast-qwen',
                heading: prettifyVoiceId(voiceId) || (provider === 'piper' ? 'Piper voice' : 'Fast Qwen voice'),
                tag: 'Loading',
                body: provider === 'fast-qwen'
                    ? 'Voice description will apply once the backend is ready.'
                    : 'Backend is still warming up.',
                subline: state.backend?.baseUrl || 'Starting local backend'
            };
        }

        if (provider === 'piper') {
            const model = findModelItem(state, voiceId);
            return {
                editable: false,
                heading: prettifyVoiceId(voiceId) || 'Piper voice',
                tag: 'Piper',
                body: 'Voice description is not used by Piper in this plugin.',
                subline: model ? `Status: ${modelStatusText(model)}` : 'Import a Piper voice to enable it here.'
            };
        }

        const voice = findVoiceMeta(state, voiceId);
        const isClone = voice?.kind === 'clone' || String(voiceId).startsWith('qwen-clone:');
        return {
            editable: true,
            heading: prettifyVoiceId(voiceId) || 'Fast Qwen voice',
            tag: isClone ? 'Clone' : 'Built-in',
            body: 'Describe the voice delivery you want. This is sent to Qwen during synthesis.',
            subline: isClone
                ? `Model: ${shortModelLabel(cloneModel)}`
                : `Model: ${shortModelLabel(builtinModel)}`
        };
    }

    function scheduleVoiceDescriptionSave(panel, nextValue) {
        const state = getState(panel);
        state.settings = state.settings || {};
        state.settings.voiceDescription = normalizeVoiceDescription(nextValue);
        clearVoiceDescriptionSave(panel);
        state.voiceDescriptionSaveTimer = setTimeout(async () => {
            state.voiceDescriptionSaveTimer = null;
            try {
                await saveVoiceSettings(panel, { voiceDescription: state.settings.voiceDescription });
            } catch (error) {
                panel.setResult(error.message || String(error));
            }
        }, 350);
    }

    function createAutoStartToggle(panel) {
        const autoWrap = createElement('label', 'plugin-studio-tts-inline-check');
        const autoStart = document.createElement('input');
        autoStart.type = 'checkbox';
        autoStart.checked = boolFromConfig(getPluginConfigValue(panel, 'backendAutoStart', false), false);
        autoStart.addEventListener('change', async () => {
            try {
                await savePluginConfig(panel, 'backendAutoStart', autoStart.checked);
                panel.setResult(`Backend auto start ${autoStart.checked ? 'enabled' : 'disabled'}`);
            } catch (error) {
                panel.setResult(error.message || String(error));
                autoStart.checked = !autoStart.checked;
            }
        });
        autoWrap.appendChild(autoStart);
        autoWrap.appendChild(createElement('span', '', 'Auto start in background'));
        return autoWrap;
    }

    async function saveTtsSettings(panel, patch) {
        const response = await window.electronAPI.tts.saveSettings(patch || {});
        if (!response?.success) {
            throw new Error(response?.error || 'Failed to save TTS settings');
        }
        const state = getState(panel);
        state.settings = {
            ...(state.settings || {}),
            ...(response.settings || {})
        };
        return state.settings;
    }

    async function saveVoiceSettings(panel, patch) {
        const state = getState(panel);
        const updates = [];
        if (patch.provider !== undefined) updates.push(['selectedProvider', patch.provider]);
        if (patch.voice !== undefined) updates.push(['selectedVoice', patch.voice]);
        if (patch.voiceDescription !== undefined) updates.push(['voiceDescription', patch.voiceDescription]);

        for (const [key, value] of updates) {
            await savePluginConfig(panel, key, value);
        }
        if (patch.provider !== undefined) {
            await saveTtsSettings(panel, {
                defaultPluginId: patch.provider === 'browser' ? '' : PLUGIN_ID
            });
        }
        state.settings = {
            ...(state.settings || {}),
            ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
            ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
            ...(patch.voiceDescription !== undefined ? { voiceDescription: patch.voiceDescription } : {})
        };
        return state.settings;
    }

    async function savePluginConfig(panel, key, value) {
        const plugin = getSelectedPlugin(panel);
        if (!plugin) throw new Error('Plugin is not selected');
        const response = await window.electronAPI.plugins.setConfig(plugin.id, key, value);
        if (!response?.success) {
            throw new Error(response?.error || `Failed to save ${key}`);
        }
        panel.selectedDetail = panel.selectedDetail || {};
        panel.selectedDetail.config = panel.selectedDetail.config || {};
        panel.selectedDetail.config[key] = value;
        return true;
    }

    async function runPluginAction(panel, action, params = {}) {
        const plugin = getSelectedPlugin(panel);
        if (!plugin) throw new Error('Plugin is not selected');
        const response = await window.electronAPI.plugins.runAction(plugin.id, action, params);
        if (!response?.success) {
            throw new Error(response?.error || `Action failed: ${action}`);
        }
        return response.result;
    }

    async function withBusy(panel, button, task) {
        panel.setActionBusy(button, true);
        try {
            await task();
        } catch (error) {
            panel.setResult(error.message || String(error));
        } finally {
            panel.setActionBusy(button, false);
        }
    }

    async function pickDirectory(title) {
        const result = await window.electronAPI.dialogs.pickDirectory({ title });
        return result?.canceled ? '' : String(result?.filePath || '');
    }

    async function pickAudioFile() {
        const result = await window.electronAPI.dialogs.pickFile({
            title: 'Select source audio',
            filters: [
                { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg'] }
            ]
        });
        return result?.canceled ? '' : String(result?.filePath || '');
    }

    async function hydrateState(panel) {
        const state = getState(panel);
        const plugin = getSelectedPlugin(panel);

        const ttsSettings = await window.electronAPI.tts.getSettings();
        state.settings = {
            ...(ttsSettings || {}),
            provider: getPluginConfigValue(panel, 'selectedProvider', ttsSettings?.defaultPluginId === PLUGIN_ID ? 'fast-qwen' : 'browser'),
            voice: getPluginConfigValue(panel, 'selectedVoice', ''),
            voiceDescription: getPluginConfigValue(panel, 'voiceDescription', '')
        };
        state.backend = null;
        state.models = null;
        state.voices = [];
        state.performance = null;

        if (!plugin || plugin.id !== PLUGIN_ID || plugin.status !== 'enabled') {
            clearRefresh(panel);
            return state;
        }

        state.backend = await runPluginAction(panel, 'getBackendStatus');

        if (state.backend?.starting || (state.backend?.running && !state.backend?.ready)) {
            scheduleRefresh(panel, 900);
            return state;
        }

        if (!state.backend?.ready || !state.backend?.healthy) {
            clearRefresh(panel);
            return state;
        }

        const [models, voices, performance, sourceFiles] = await Promise.all([
            runPluginAction(panel, 'getModels'),
            runPluginAction(panel, 'listVoices'),
            runPluginAction(panel, 'getPerformance'),
            runPluginAction(panel, 'listVoiceSourceFiles')
        ]);

        state.models = models;
        state.voices = Array.isArray(voices?.voices) ? voices.voices : [];
        state.performance = performance;
        state.sourceFiles = Array.isArray(sourceFiles?.files) ? sourceFiles.files : [];

        const activeDownloads = Object.entries(state.downloadTasks || {}).filter(([, task]) => {
            return task && task.taskId && !['completed', 'failed'].includes(task.status);
        });
        if (activeDownloads.length) {
            const updates = await Promise.all(activeDownloads.map(async ([modelName, task]) => {
                const item = await runPluginAction(panel, 'getDownloadStatus', { taskId: task.taskId });
                return [modelName, item?.item || null];
            }));
            let completedDownload = false;
            for (const [modelName, item] of updates) {
                if (!item) continue;
                state.downloadTasks[modelName] = {
                    taskId: item.task_id,
                    status: item.status,
                    message: item.message
                };
                if (['completed', 'failed'].includes(item.status)) {
                    completedDownload = true;
                }
            }
            const stillRunning = Object.values(state.downloadTasks).some(task => {
                return task && !['completed', 'failed'].includes(task.status);
            });
            if (stillRunning) scheduleRefresh(panel, 1200);
            else if (completedDownload) scheduleRefresh(panel, 250);
        }

        if (state.prepareTaskId) {
            const prepare = await runPluginAction(panel, 'getVoicePrepareStatus', { taskId: state.prepareTaskId });
            state.prepareStatus = prepare?.item || null;
            if (state.prepareStatus && !['completed', 'failed'].includes(state.prepareStatus.status)) {
                scheduleRefresh(panel, 1400);
            } else if (state.prepareStatus?.status === 'completed') {
                state.prepareTaskId = '';
                scheduleRefresh(panel, 250);
            } else if (state.prepareStatus?.status === 'failed') {
                state.prepareTaskId = '';
            }
        } else {
            state.prepareStatus = null;
        }

        return state;
    }

    function findModelItem(state, modelId) {
        const items = Array.isArray(state?.models?.items) ? state.models.items : [];
        return items.find(item => item.id === modelId) || null;
    }

    function appendMetricCard(parent, label, value) {
        const card = createElement('div', 'plugin-studio-tts-card');
        card.appendChild(createElement('div', 'plugin-studio-tts-card-label', label));
        card.appendChild(createElement('div', 'plugin-studio-tts-card-value', value));
        parent.appendChild(card);
    }

    function buildStatusRow(panel, state) {
        const plugin = getSelectedPlugin(panel);
        const row = createElement('div', 'plugin-studio-tts-toolbar');

        const left = createElement('div', 'plugin-studio-tts-toolbar-left');
        const loadingClass = isBackendLoading(state.backend) ? ' plugin-studio-tts-pill-loading' : '';
        const pill = createElement(
            'span',
            `plugin-studio-tts-pill plugin-studio-tts-pill-${statusTone(plugin, state.backend)}${loadingClass}`,
            statusLabel(plugin, state.backend)
        );
        left.appendChild(pill);

        const note = state.backend?.lastError
            ? state.backend.lastError
            : (isBackendLoading(state.backend)
                ? `Local backend is loading at ${state.backend?.baseUrl || '127.0.0.1'}`
            : (plugin?.status === 'enabled'
                ? (state.backend?.baseUrl || 'Backend idle')
                : 'Enable the plugin to use Fast Qwen or Piper'));
        left.appendChild(createElement('span', 'plugin-studio-tts-quiet', note));

        const actions = createElement('div', 'plugin-studio-tts-toolbar-actions');
        const refreshButton = createButton('Refresh', () => withBusy(panel, refreshButton, async () => {
            await root.LocalAgentPluginTtsStudio.render(panel);
            panel.setResult('TTS status refreshed');
        }));
        const startButton = createButton('Start', () => withBusy(panel, startButton, async () => {
            await runPluginAction(panel, 'startBackend');
            panel.setResult('Backend start requested');
            scheduleRefresh(panel, 700);
            await root.LocalAgentPluginTtsStudio.render(panel);
        }));
        const restartButton = createButton('Restart', () => withBusy(panel, restartButton, async () => {
            await runPluginAction(panel, 'restartBackend');
            panel.setResult('Backend restart requested');
            scheduleRefresh(panel, 700);
            await root.LocalAgentPluginTtsStudio.render(panel);
        }));
        const stopButton = createButton('Stop', () => withBusy(panel, stopButton, async () => {
            await runPluginAction(panel, 'stopBackend');
            clearRefresh(panel);
            panel.setResult('Backend stopped');
            await root.LocalAgentPluginTtsStudio.render(panel);
        }));

        startButton.disabled = plugin?.status !== 'enabled';
        restartButton.disabled = plugin?.status !== 'enabled' || !state.backend?.running;
        stopButton.disabled = plugin?.status !== 'enabled' || !state.backend?.running;

        actions.appendChild(startButton);
        actions.appendChild(restartButton);
        actions.appendChild(stopButton);
        actions.appendChild(refreshButton);

        row.appendChild(left);
        row.appendChild(actions);
        return row;
    }

    function buildBackendMetaRow(panel) {
        const row = createElement('div', 'plugin-studio-tts-meta-row');
        const label = createElement('div', 'plugin-studio-tts-section-label', 'Backend');
        row.appendChild(label);
        row.appendChild(createAutoStartToggle(panel));
        return row;
    }

    function buildSettingsGrid(panel, state) {
        const provider = state.settings?.provider || 'browser';
        const voiceOptions = getVoiceOptions(state, provider);
        const activeVoice = resolveActiveVoice(state, voiceOptions);

        const grid = createElement('div', 'plugin-studio-tts-compact-grid');

        const providerField = createElement('label', 'plugin-studio-field');
        providerField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Voice engine'));
        const providerSelect = document.createElement('select');
        providerSelect.appendChild(createOption('browser', 'Browser fallback'));
        providerSelect.appendChild(createOption('piper', 'Piper'));
        providerSelect.appendChild(createOption('fast-qwen', 'Fast Qwen'));
        providerSelect.value = provider;
        providerSelect.addEventListener('change', async () => {
            const nextProvider = providerSelect.value;
            const nextOptions = getVoiceOptions(state, nextProvider);
            const nextVoice = nextProvider === 'browser' ? '' : (nextOptions[0]?.id || '');
            try {
                await saveVoiceSettings(panel, {
                    provider: nextProvider,
                    voice: nextVoice
                });
                panel.setResult(`TTS provider set to ${nextProvider}`);
                await root.LocalAgentPluginTtsStudio.render(panel);
            } catch (error) {
                panel.setResult(error.message || String(error));
            }
        });
        providerField.appendChild(providerSelect);

        const voiceField = createElement('label', 'plugin-studio-field');
        voiceField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Voice'));
        const voiceSelect = document.createElement('select');
        for (const option of voiceOptions) {
            voiceSelect.appendChild(createOption(option.id, option.label));
        }
        voiceSelect.value = activeVoice;
        voiceSelect.disabled = provider !== 'browser' && !voiceOptions.some(option => option.id);
        voiceSelect.addEventListener('change', async () => {
            try {
                await saveVoiceSettings(panel, { voice: voiceSelect.value });
                panel.setResult(`Voice set to ${prettifyVoiceId(voiceSelect.value)}`);
            } catch (error) {
                panel.setResult(error.message || String(error));
            }
        });
        voiceField.appendChild(voiceSelect);

        const modeField = createElement('label', 'plugin-studio-field');
        modeField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Auto mode'));
        const modeSelect = document.createElement('select');
        modeSelect.appendChild(createOption('answer', 'Answer'));
        modeSelect.appendChild(createOption('thinking+answer', 'Thinking + answer'));
        modeSelect.value = state.settings?.autoSpeakMode || 'answer';
        modeSelect.addEventListener('change', async () => {
            try {
                await saveTtsSettings(panel, { autoSpeakMode: modeSelect.value });
                panel.setResult(`Auto mode set to ${modeSelect.value}`);
            } catch (error) {
                panel.setResult(error.message || String(error));
            }
        });
        modeField.appendChild(modeSelect);

        grid.appendChild(providerField);
        grid.appendChild(voiceField);
        grid.appendChild(modeField);
        return grid;
    }

    function buildVoiceDescriptionPanel(panel, state) {
        if ((state.settings?.provider || 'browser') !== 'fast-qwen') {
            return null;
        }
        const info = getVoiceDescriptionMeta(panel, state);
        const wrap = createElement('section', 'plugin-studio-tts-panel plugin-studio-tts-voice-panel');
        const top = createElement('div', 'plugin-studio-tts-voice-top');
        top.appendChild(createElement('div', 'plugin-studio-tts-title', 'Voice description'));
        top.appendChild(createElement('span', 'plugin-studio-tts-pill plugin-studio-tts-pill-muted', info.tag));
        wrap.appendChild(top);

        if (info.editable) {
            const presetRow = createElement('div', 'plugin-studio-tts-description-controls');
            const presetSelect = document.createElement('select');
            presetSelect.className = 'plugin-studio-tts-description-preset';
            presetSelect.appendChild(createOption('', 'Quick preset'));
            for (const preset of VOICE_DESCRIPTION_PRESETS) {
                presetSelect.appendChild(createOption(preset, preset));
            }
            presetSelect.addEventListener('change', () => {
                if (!presetSelect.value) return;
                textarea.value = presetSelect.value;
                scheduleVoiceDescriptionSave(panel, presetSelect.value);
                panel.setResult('Voice description preset applied');
            });
            presetRow.appendChild(presetSelect);
            wrap.appendChild(presetRow);
        }

        const textarea = createElement('textarea', 'plugin-studio-tts-text plugin-studio-tts-description-input');
        textarea.placeholder = 'Warm, clear, and confident assistant voice.';
        textarea.value = getVoiceDescriptionValue(state);
        textarea.disabled = !info.editable;
        textarea.addEventListener('input', () => {
            const nextValue = normalizeVoiceDescription(textarea.value);
            if (textarea.value !== nextValue) {
                textarea.value = nextValue;
            }
            scheduleVoiceDescriptionSave(panel, nextValue);
        });
        wrap.appendChild(textarea);

        return wrap;
    }

    function buildPreviewPanel(panel, state) {
        const provider = state.settings?.provider || 'browser';
        const wrap = createElement('section', 'plugin-studio-tts-panel');
        wrap.appendChild(createElement('div', 'plugin-studio-tts-title', 'Preview'));

        const helper = createElement('div', 'plugin-studio-tts-quiet', 'Follows the main chat 🔊 toggle.');
        wrap.appendChild(helper);

        const textarea = createElement('textarea', 'plugin-studio-tts-text');
        textarea.value = state.previewText || DEFAULT_PREVIEW_TEXT;
        textarea.placeholder = 'Enter preview text';
        textarea.addEventListener('input', () => {
            state.previewText = textarea.value;
        });
        wrap.appendChild(textarea);

        const actions = createElement('div', 'plugin-studio-tts-actions');
        const previewButton = createButton('Preview', () => withBusy(panel, previewButton, async () => {
            const text = String(textarea.value || '').trim() || DEFAULT_PREVIEW_TEXT;
            state.previewText = text;
            panel.stopAllTts();
            if (provider === 'browser') {
                if (!window.speechSynthesis) {
                    throw new Error('Browser speech synthesis is unavailable');
                }
                const utterance = new SpeechSynthesisUtterance(text);
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);
                panel.setResult('Browser preview started');
                return;
            }
            const result = await runPluginAction(panel, 'previewVoice', { text });
            if (!panel.playAudioPayload(result)) {
                throw new Error('No playable audio was returned');
            }
            panel.setResult(`Preview ready · ${provider} · ${prettifyVoiceId(state.settings?.voice || '')} · ${result.durationMs || 0}ms`);
        }));
        const stopButton = createButton('Stop', () => withBusy(panel, stopButton, async () => {
            panel.stopAllTts();
            if (getSelectedPlugin(panel)?.status === 'enabled') {
                await runPluginAction(panel, 'stop');
            }
            panel.setResult('Playback stopped');
        }));
        previewButton.disabled = provider !== 'browser' && getSelectedPlugin(panel)?.status !== 'enabled';
        actions.appendChild(previewButton);
        actions.appendChild(stopButton);
        wrap.appendChild(actions);

        return wrap;
    }

    function buildPerformancePanel(state) {
        const wrap = createElement('section', 'plugin-studio-tts-panel');
        wrap.appendChild(createElement('div', 'plugin-studio-tts-title', 'Performance'));

        const cards = createElement('div', 'plugin-studio-tts-cards');
        const snapshot = state.performance?.snapshot || {};
        appendMetricCard(cards, 'First chunk', formatSeconds(snapshot?.last_stream?.first_chunk_latency));
        appendMetricCard(cards, 'Last generation', formatSeconds(snapshot?.last_generation?.generation_time));
        appendMetricCard(cards, 'Warm average', formatSeconds(snapshot?.warm_generation_average));
        wrap.appendChild(cards);

        return wrap;
    }

    function buildMainPanels(panel, state) {
        const wrap = createElement('div', 'plugin-studio-tts-main-panels');
        wrap.appendChild(buildPreviewPanel(panel, state));
        wrap.appendChild(buildPerformancePanel(state));
        return wrap;
    }

    function buildModelRow(panel, state, options) {
        const row = createElement('div', 'plugin-studio-tts-model-row');
        const meta = createElement('div', 'plugin-studio-tts-model-meta');
        meta.appendChild(createElement('div', 'plugin-studio-tts-model-name', options.label));
        meta.appendChild(createElement('div', 'plugin-studio-tts-model-sub', shortModelLabel(options.modelId)));

        const detail = findModelItem(state, options.modelId);
        const info = createElement('span', `plugin-studio-tts-pill plugin-studio-tts-pill-${modelTone(detail)}`, modelStatusText(detail));
        const buttons = createElement('div', 'plugin-studio-tts-model-actions');

        if (options.onPickFolder) {
            const folderButton = createButton('Folder', () => withBusy(panel, folderButton, options.onPickFolder));
            buttons.appendChild(folderButton);
        }
        if (options.onDownload) {
            const downloadButton = createButton('Download', () => withBusy(panel, downloadButton, options.onDownload));
            buttons.appendChild(downloadButton);
        }
        if (options.onCopy) {
            const copyButton = createButton(options.copyLabel || 'Copy', () => withBusy(panel, copyButton, options.onCopy));
            buttons.appendChild(copyButton);
        }

        row.appendChild(meta);
        row.appendChild(info);
        row.appendChild(buttons);
        return row;
    }

    function buildModelsPanel(panel, state) {
        const builtinModel = String(getPluginConfigValue(panel, 'builtinModel', DEFAULT_BUILTIN_MODEL));
        const cloneModel = String(getPluginConfigValue(panel, 'cloneModel', DEFAULT_CLONE_MODEL));
        const piperVoiceId = String(getPluginConfigValue(panel, 'piperVoiceId', DEFAULT_PIPER_VOICE_ID));
        const piperModelId = `piper:${piperVoiceId}`;

        const details = createElement('details', 'plugin-studio-tts-details');
        const summary = createElement('summary', 'plugin-studio-tts-details-summary', 'Models');
        details.appendChild(summary);

        const body = createElement('div', 'plugin-studio-tts-details-body');
        body.appendChild(buildModelRow(panel, state, {
            label: 'Fast Qwen built-ins',
            modelId: builtinModel,
            onPickFolder: async () => {
                const folderPath = await pickDirectory('Select Fast Qwen built-in model folder');
                if (!folderPath) return;
                await runPluginAction(panel, 'setModelFolder', { modelName: builtinModel, folderPath });
                panel.setResult(`Model folder saved for ${shortModelLabel(builtinModel)}`);
                scheduleRefresh(panel, 500);
                await root.LocalAgentPluginTtsStudio.render(panel);
            },
            onDownload: async () => {
                const task = await runPluginAction(panel, 'downloadModel', { modelName: builtinModel });
                state.downloadTasks[builtinModel] = {
                    taskId: task?.item?.task_id,
                    status: task?.item?.status || 'queued',
                    message: task?.item?.message || 'Queued'
                };
                panel.setResult(`Download started for ${shortModelLabel(builtinModel)}`);
                scheduleRefresh(panel, 900);
                await root.LocalAgentPluginTtsStudio.render(panel);
            }
        }));
        body.appendChild(buildModelRow(panel, state, {
            label: 'Fast Qwen clone model',
            modelId: cloneModel,
            onPickFolder: async () => {
                const folderPath = await pickDirectory('Select Fast Qwen clone model folder');
                if (!folderPath) return;
                await runPluginAction(panel, 'setModelFolder', { modelName: cloneModel, folderPath });
                panel.setResult(`Model folder saved for ${shortModelLabel(cloneModel)}`);
                scheduleRefresh(panel, 500);
                await root.LocalAgentPluginTtsStudio.render(panel);
            },
            onDownload: async () => {
                const task = await runPluginAction(panel, 'downloadModel', { modelName: cloneModel });
                state.downloadTasks[cloneModel] = {
                    taskId: task?.item?.task_id,
                    status: task?.item?.status || 'queued',
                    message: task?.item?.message || 'Queued'
                };
                panel.setResult(`Download started for ${shortModelLabel(cloneModel)}`);
                scheduleRefresh(panel, 900);
                await root.LocalAgentPluginTtsStudio.render(panel);
            }
        }));
        body.appendChild(buildModelRow(panel, state, {
            label: 'Piper runtime voice',
            modelId: piperModelId,
            onPickFolder: async () => {
                const folderPath = await pickDirectory('Select Piper source folder');
                if (!folderPath) return;
                await savePluginConfig(panel, 'piperSourceDir', folderPath);
                panel.setResult(`Piper source folder saved: ${folderPath}`);
                await root.LocalAgentPluginTtsStudio.render(panel);
            },
            onCopy: async () => {
                let sourceDir = String(getPluginConfigValue(panel, 'piperSourceDir', ''));
                if (!sourceDir) {
                    sourceDir = await pickDirectory('Select Piper source folder');
                    if (!sourceDir) return;
                    await savePluginConfig(panel, 'piperSourceDir', sourceDir);
                }
                const result = await runPluginAction(panel, 'importPiperAssets', {
                    sourceDir,
                    voiceId: piperVoiceId
                });
                panel.setResult(`Piper voice copied · ${result.voiceId || piperVoiceId}`);
                scheduleRefresh(panel, 600);
                await root.LocalAgentPluginTtsStudio.render(panel);
            },
            copyLabel: 'Copy'
        }));
        details.appendChild(body);
        return details;
    }

    function buildClonePanel(panel, state) {
        const details = createElement('details', 'plugin-studio-tts-details');
        const summary = createElement('summary', 'plugin-studio-tts-details-summary', 'Clone voice');
        details.appendChild(summary);

        const body = createElement('div', 'plugin-studio-tts-details-body');
        const intro = createElement('div', 'plugin-studio-tts-quiet', 'One source file is enough. Prepare it here, then it appears in the voice picker.');
        body.appendChild(intro);

        const sourceField = createElement('label', 'plugin-studio-field');
        sourceField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Copied source'));
        const sourceSelect = document.createElement('select');
        sourceSelect.appendChild(createOption('', 'Select copied source'));
        for (const file of state.sourceFiles || []) {
            const label = `${file.file_name || file.name || file}`;
            sourceSelect.appendChild(createOption(file.file_name || file.name || file, label));
        }
        const selectedSource = state.sourceFile && Array.from(sourceSelect.options).some(option => option.value === state.sourceFile)
            ? state.sourceFile
            : '';
        sourceSelect.value = selectedSource;
        sourceSelect.addEventListener('change', () => {
            state.sourceFile = sourceSelect.value;
        });
        sourceField.appendChild(sourceSelect);
        body.appendChild(sourceField);

        const cloneGrid = createElement('div', 'plugin-studio-tts-compact-grid');
        const nameField = createElement('label', 'plugin-studio-field');
        nameField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Voice name'));
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'speaker_name';
        nameInput.value = state.cloneName || '';
        nameInput.addEventListener('input', () => {
            state.cloneName = nameInput.value;
        });
        nameField.appendChild(nameInput);

        const uploadField = createElement('div', 'plugin-studio-field');
        uploadField.appendChild(createElement('span', 'plugin-studio-tts-field-label', 'Source file'));
        const uploadActions = createElement('div', 'plugin-studio-tts-actions');
        const chooseButton = createButton('Choose audio', () => withBusy(panel, chooseButton, async () => {
            const filePath = await pickAudioFile();
            if (!filePath) return;
            const result = await runPluginAction(panel, 'copyVoiceSource', { sourceFilePath: filePath });
            state.sourceFile = result.fileName || '';
            panel.setResult(`Copied voice source: ${state.sourceFile}`);
            scheduleRefresh(panel, 400);
            await root.LocalAgentPluginTtsStudio.render(panel);
        }));
        uploadActions.appendChild(chooseButton);
        uploadField.appendChild(uploadActions);

        cloneGrid.appendChild(nameField);
        cloneGrid.appendChild(uploadField);
        body.appendChild(cloneGrid);

        const prepareActions = createElement('div', 'plugin-studio-tts-actions');
        const prepareButton = createButton('Prepare clone', () => withBusy(panel, prepareButton, async () => {
            const speakerName = String(state.cloneName || '').trim();
            const sourceFile = String(state.sourceFile || sourceSelect.value || '').trim();
            if (!speakerName || !sourceFile) {
                throw new Error('Choose a copied source file and enter a voice name first');
            }
            const result = await runPluginAction(panel, 'prepareVoice', {
                speakerName,
                sourceFile
            });
            state.prepareTaskId = result?.item?.task_id || '';
            panel.setResult(`Voice preparation started for ${speakerName}`);
            scheduleRefresh(panel, 1200);
            await root.LocalAgentPluginTtsStudio.render(panel);
        }));
        prepareActions.appendChild(prepareButton);
        body.appendChild(prepareActions);

        if (state.prepareStatus) {
            const prepareStatus = createElement('div', 'plugin-studio-tts-prepare-status');
            const label = `${state.prepareStatus.speaker_name || state.cloneName || 'Voice'}: ${state.prepareStatus.status}`;
            prepareStatus.appendChild(createElement('span', 'plugin-studio-tts-quiet', label));
            if (state.prepareStatus.message) {
                prepareStatus.appendChild(createElement('span', 'plugin-studio-tts-quiet', state.prepareStatus.message));
            }
            body.appendChild(prepareStatus);
        }

        details.appendChild(body);
        return details;
    }

    function buildDownloadNotes(state) {
        const tasks = Object.entries(state.downloadTasks || {}).filter(([, task]) => task && task.taskId);
        if (!tasks.length) return null;

        const wrap = createElement('div', 'plugin-studio-tts-downloads');
        for (const [modelName, task] of tasks) {
            const row = createElement('div', 'plugin-studio-tts-download-row');
            row.appendChild(createElement('span', 'plugin-studio-tts-download-name', shortModelLabel(modelName)));
            row.appendChild(createElement('span', 'plugin-studio-tts-quiet', `${task.status || 'queued'}${task.message ? ` · ${task.message}` : ''}`));
            wrap.appendChild(row);
        }
        return wrap;
    }

    const api = {
        canHandle(panel) {
            return getSelectedPlugin(panel)?.id === PLUGIN_ID;
        },

        async render(panel) {
            const state = getState(panel);
            const token = Symbol('tts-render');
            state.renderToken = token;

            try {
                await hydrateState(panel);
            } catch (error) {
                clearRefresh(panel);
                panel.setResult(error.message || String(error));
            }

            if (state.renderToken !== token) return;

            const plugin = getSelectedPlugin(panel);
            const wrap = createElement('div', 'plugin-studio-tts-compact');
            wrap.appendChild(buildBackendMetaRow(panel));
            wrap.appendChild(buildStatusRow(panel, state));
            wrap.appendChild(buildSettingsGrid(panel, state));
            const voiceDescriptionPanel = buildVoiceDescriptionPanel(panel, state);
            if (voiceDescriptionPanel) wrap.appendChild(voiceDescriptionPanel);
            wrap.appendChild(buildMainPanels(panel, state));
            wrap.appendChild(buildModelsPanel(panel, state));
            wrap.appendChild(buildClonePanel(panel, state));

            const downloadNotes = buildDownloadNotes(state);
            if (downloadNotes) wrap.appendChild(downloadNotes);

            if (plugin?.status !== 'enabled') {
                const hint = createElement('div', 'plugin-studio-tts-quiet', 'Enable the plugin from the top-right button when you want embedded voices.');
                wrap.appendChild(hint);
            }

            panel.form.replaceChildren(wrap);
        }
    };

    root.LocalAgentPluginTtsStudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
