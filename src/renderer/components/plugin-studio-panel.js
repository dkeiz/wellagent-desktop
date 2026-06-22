(function () {
    class PluginStudioPanel {
        constructor() {
            this.overlay = document.getElementById('plugin-studio-overlay');
            this.panel = document.getElementById('plugin-studio-panel');
            this.list = document.getElementById('plugin-studio-list');
            this.empty = document.getElementById('plugin-studio-empty');
            this.content = document.getElementById('plugin-studio-content');
            this.title = document.getElementById('plugin-studio-title');
            this.meta = document.getElementById('plugin-studio-meta');
            this.toggleBtn = document.getElementById('plugin-studio-toggle');
            this.visibilityBtn = document.getElementById('plugin-studio-visibility');
            this.discoverBtn = document.getElementById('plugin-studio-discover');
            this.saveBtn = document.getElementById('plugin-studio-save');
            this.form = document.getElementById('plugin-studio-form');
            this.result = document.getElementById('plugin-studio-result');
            this.previewAudio = null;

            this.plugins = [];
            this.selectedPluginId = null;
            this.selectedDetail = null;

            if (!this.overlay || !this.panel) return;
            this._bindEvents();
        }

        _bindEvents() {
            this.overlay.addEventListener('mousedown', (event) => {
                if (event.target === this.overlay) this.hide();
            });

            this.panel.addEventListener('mousedown', (event) => event.stopPropagation());
            this.toggleBtn.addEventListener('click', () => this.toggleSelected());
            this.visibilityBtn.addEventListener('click', () => this.toggleSelectedVisibility());
            this.saveBtn.addEventListener('click', () => this.saveConfig());
            this.discoverBtn.addEventListener('click', () => this.runDiscover());
            this.form.addEventListener('click', (event) => this.handlePluginOwnedChoice(event));

            window.electronAPI.onPluginStudioOpen(async (event, options) => {
                await this.show(options || {});
            });

            window.electronAPI.onPluginStateChanged(async (event, payload = {}) => {
                if (this.overlay.classList.contains('hidden')) return;
                if (String(payload?.source || '').startsWith('action:')) return;
                const focused = this.selectedPluginId;
                await this.loadPlugins(focused);
            });
        }

        setActionBusy(button, busy) {
            if (!button) return;
            button.disabled = !!busy;
            button.classList.toggle('is-busy', !!busy);
            if (busy) {
                button.dataset.originalText = button.textContent;
                button.textContent = 'Working...';
            } else if (button.dataset.originalText && button.textContent === 'Working...') {
                button.textContent = button.dataset.originalText;
            }
            if (!busy) delete button.dataset.originalText;
        }

        setResult(payload) {
            if (payload == null || payload === '') {
                this.result.textContent = '';
                return;
            }
            this.result.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        }

        playAudioPayload(payload) {
            const result = payload?.result || payload;
            const audio = result?.audio || {};
            const url = audio.url || result?.audioUrl || result?.audio_url || result?.url || '';
            const base64 = audio.base64 || result?.audioBase64 || result?.audio_base64 || '';
            const mimeType = audio.mimeType || result?.mimeType || result?.mime_type || 'audio/wav';
            const source = url || (base64 ? `data:${mimeType};base64,${base64}` : '');
            if (!source) return false;
            this.stopAllTts();
            this.previewAudio = new Audio(source);
            this.previewAudio.play().catch((error) => this.setResult({ success: false, error: error.message }));
            return true;
        }

        hide() {
            this.overlay.classList.add('hidden');
        }

        async show(options = {}) {
            this.overlay.classList.remove('hidden');
            await this.loadPlugins(options.focusPluginId || null);
        }

        getSelectedPlugin() {
            return this.plugins.find((plugin) => plugin.id === this.selectedPluginId) || null;
        }

        async loadPlugins(focusPluginId = null) {
            await window.electronAPI.plugins.scan?.();
            this.plugins = await window.electronAPI.plugins.list();
            if (focusPluginId) this.selectedPluginId = focusPluginId;
            if (!this.selectedPluginId && this.plugins.length) this.selectedPluginId = this.plugins[0].id;
            if (this.selectedPluginId && !this.getSelectedPlugin() && this.plugins.length) {
                this.selectedPluginId = this.plugins[0].id;
            }
            this.renderList();
            await this.loadSelectedDetail();
        }

        renderList() {
            this.list.replaceChildren();
            if (!this.plugins.length) {
                const empty = document.createElement('div');
                empty.className = 'plugin-studio-item';
                empty.textContent = 'No plugins found';
                this.list.appendChild(empty);
                return;
            }

            this.plugins.forEach((plugin) => {
                const item = document.createElement('div');
                item.className = `plugin-studio-item${plugin.id === this.selectedPluginId ? ' active' : ''}`;
                item.addEventListener('click', async () => {
                    this.selectedPluginId = plugin.id;
                    this.renderList();
                    await this.loadSelectedDetail();
                });

                const title = document.createElement('div');
                title.className = 'plugin-studio-item-title';
                title.textContent = plugin.name;

                const sub = document.createElement('div');
                sub.className = 'plugin-studio-item-sub';
                sub.textContent = `${plugin.id} · ${plugin.status}`;

                item.appendChild(title);
                item.appendChild(sub);
                this.list.appendChild(item);
            });
        }

        async loadSelectedDetail() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) {
                this.empty.classList.remove('hidden');
                this.content.classList.add('hidden');
                this.selectedDetail = null;
                return;
            }

            this.selectedDetail = await window.electronAPI.plugins.inspect(plugin.id);
            this.empty.classList.add('hidden');
            this.content.classList.remove('hidden');

            this.title.textContent = this.selectedDetail?.manifest?.name || plugin.name;
            this.meta.textContent = `${plugin.id} · v${this.selectedDetail?.manifest?.version || '0.0.0'} · ${plugin.status}`;
            this.toggleBtn.textContent = plugin.status === 'enabled' ? 'Disable' : 'Enable';
            const visible = plugin.visibleInSidebar !== false;
            this.visibilityBtn.textContent = 'Show';
            this.visibilityBtn.classList.toggle('active', visible);
            this.visibilityBtn.title = visible ? 'Shown in right sidebar' : 'Hidden from right sidebar';
            const capabilities = this.selectedDetail?.capabilities || this.selectedDetail?.manifest?.capabilities || [];
            const isTts = capabilities.includes('tts');
            const isEmbeddedTts = plugin.id === 'http-tts-bridge';
            this.discoverBtn.hidden = isTts;
            this.discoverBtn.textContent = isTts ? 'Probe' : 'Discover';
            this.saveBtn.hidden = isEmbeddedTts;

            await this.renderForm();
        }

        async renderForm() {
            this.form.replaceChildren();
            this.form.classList.remove('plugin-studio-form-telegram', 'plugin-studio-form-plugin-owned');
            const schema = this.selectedDetail?.manifest?.configSchema || {};
            const entries = Object.entries(schema);
            const isTts = this.isSelectedTts();
            this.form.classList.toggle('plugin-studio-form-tts', isTts);

            if (await this.renderPluginSetupUI()) {
                return;
            }
            if (window.LocalAgentPluginTelegramStudio?.canHandle?.(this)) {
                await window.LocalAgentPluginTelegramStudio.render(this);
                return;
            }
            if (window.LocalAgentPluginTtsStudio?.canHandle?.(this)) {
                await window.LocalAgentPluginTtsStudio.render(this);
                return;
            }
            if (isTts) {
                await this.renderTtsPanel();
                return;
            } else if (!entries.length) {
                const none = document.createElement('div');
                none.textContent = 'No configurable fields.';
                this.form.appendChild(none);
                return;
            }

            entries.forEach(([key, def]) => {
                const field = document.createElement('div');
                field.className = 'plugin-studio-field';

                const label = document.createElement('label');
                label.textContent = def?.label || key;
                if (def?.description) label.title = def.description;

                const type = def?.type || 'string';
                const input = this.createConfigInput(type, def);
                input.dataset.key = key;
                input.dataset.type = type;
                if (type === 'boolean' && (def?.display === 'toggle' || def?.control === 'toggle')) {
                    input.classList.add('plugin-studio-toggle');
                    input.setAttribute('role', 'switch');
                }
                const raw = this.selectedDetail?.config?.[key] ?? def?.default;

                if (input.type === 'checkbox') {
                    input.checked = String(raw).toLowerCase() === 'true';
                } else {
                    input.value = raw == null ? '' : String(raw);
                }

                field.appendChild(label);
                field.appendChild(input);
                if (def?.description) {
                    field.appendChild(this.createFieldDescription(def.description));
                }
                this.form.appendChild(field);
            });
        }

        async renderPluginSetupUI() {
            const plugin = this.getSelectedPlugin();
            if (!plugin || !window.electronAPI?.plugins?.getSetupUI) return false;

            const setup = await window.electronAPI.plugins.getSetupUI(plugin.id);
            if (!setup || setup.success === false || !setup.html) return false;

            this.form.classList.add('plugin-studio-form-plugin-owned');
            if (setup.css) {
                const style = document.createElement('style');
                style.textContent = setup.css;
                this.form.appendChild(style);
            }

            const body = document.createElement('div');
            body.className = 'plugin-studio-plugin-setup';
            body.innerHTML = setup.html;
            this.form.appendChild(body);
            return true;
        }

        async handlePluginOwnedChoice(event) {
            const button = event.target.closest('[data-config-key][data-config-value]');
            if (!button || !this.form.contains(button)) return;

            const plugin = this.getSelectedPlugin();
            const key = button.dataset.configKey;
            const value = button.dataset.configValue;
            if (!plugin || !key) return;

            const field = Array.from(this.form.querySelectorAll('[data-key]'))
                .find(input => input.dataset.key === key);
            if (field) field.value = value;

            const group = button.closest('[role="group"]') || button.parentElement;
            group?.querySelectorAll('[data-config-key]').forEach((choice) => {
                const active = choice === button;
                choice.classList.toggle('is-active', active);
                choice.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            const result = await window.electronAPI.plugins.setConfig(plugin.id, key, value);
            if (!result?.success) {
                this.setResult(result?.error || `Failed to save ${key}`);
                return;
            }
            await this.loadSelectedDetail();
            this.setResult('');
        }

        createFieldDescription(text) {
            const container = document.createElement('div');
            container.className = 'plugin-studio-field-description';

            const source = String(text || '');
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            let lastIndex = 0;
            let match;

            while ((match = urlRegex.exec(source)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (start > lastIndex) {
                    container.appendChild(document.createTextNode(source.slice(lastIndex, start)));
                }
                const link = document.createElement('a');
                link.href = match[0];
                link.target = '_blank';
                link.rel = 'noreferrer noopener';
                link.textContent = match[0];
                container.appendChild(link);
                lastIndex = end;
            }

            if (lastIndex < source.length) {
                container.appendChild(document.createTextNode(source.slice(lastIndex)));
            }

            return container;
        }

        isSelectedTts() {
            const capabilities = this.selectedDetail?.capabilities || this.selectedDetail?.manifest?.capabilities || [];
            return capabilities.includes('tts');
        }

        async renderTtsPanel() {
            const defaultPanel = this.createTtsSection('Default');
            const defaultText = this.createTtsTextArea('Text to speak with the built-in voice');
            const defaultActions = this.createTtsActions({
                onPlay: () => this.playDefaultTts(defaultText.value),
                onStop: () => this.stopDefaultTts()
            });
            defaultPanel.appendChild(defaultText);
            defaultPanel.appendChild(defaultActions);

            const customPanel = this.createTtsSection('Custom');
            customPanel.appendChild(this.createTtsInput('Address', 'serverUrl', 'http://127.0.0.1:8000'));
            customPanel.appendChild(this.createTtsConfigField());
            const customText = this.createTtsTextArea('Text to speak through the custom server');
            const customActions = this.createTtsActions({
                onPlay: async () => this.playCustomTts(customText.value),
                onStop: async () => this.stopCustomTts()
            });
            customPanel.appendChild(customText);
            customPanel.appendChild(customActions);

            this.form.appendChild(defaultPanel);
            this.form.appendChild(customPanel);
        }

        createTtsSection(titleText) {
            const section = document.createElement('section');
            section.className = 'plugin-studio-tts-panel';
            const title = document.createElement('div');
            title.className = 'plugin-studio-tts-title';
            title.textContent = titleText;
            section.appendChild(title);
            return section;
        }

        createTtsTextArea(placeholder) {
            const textarea = document.createElement('textarea');
            textarea.className = 'plugin-studio-tts-text';
            textarea.placeholder = placeholder;
            textarea.value = 'Voice probe ready.';
            return textarea;
        }

        createTtsInput(labelText, key, fallback = '') {
            const field = document.createElement('label');
            field.className = 'plugin-studio-field';
            field.textContent = labelText;
            const input = document.createElement('input');
            input.dataset.key = key;
            input.dataset.type = 'string';
            input.value = this.selectedDetail?.config?.[key] || fallback;
            field.appendChild(input);
            return field;
        }

        createTtsConfigField() {
            const field = document.createElement('label');
            field.className = 'plugin-studio-field plugin-studio-config-link-field';
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = 'config.txt';
            const input = document.createElement('input');
            input.dataset.key = 'configFile';
            input.dataset.type = 'string';
            input.value = this.selectedDetail?.config?.configFile || 'config.txt';
            link.addEventListener('click', (event) => {
                event.preventDefault();
                input.value = 'config.txt';
            });
            field.appendChild(link);
            field.appendChild(input);
            return field;
        }

        createTtsActions({ onPlay, onStop }) {
            const actions = document.createElement('div');
            actions.className = 'plugin-studio-tts-actions';
            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'compact-btn';
            play.textContent = 'Play';
            play.addEventListener('click', onPlay);
            const stop = document.createElement('button');
            stop.type = 'button';
            stop.className = 'compact-btn';
            stop.textContent = 'Stop';
            stop.addEventListener('click', onStop);
            actions.appendChild(play);
            actions.appendChild(stop);
            return actions;
        }

        playDefaultTts(text) {
            this.stopAllTts();
            if (!window.speechSynthesis) {
                this.setResult({ success: false, error: 'Built-in speech is not available' });
                return;
            }
            const utterance = new SpeechSynthesisUtterance(String(text || '').trim() || 'Voice probe ready.');
            window.speechSynthesis.speak(utterance);
            this.setResult({ success: true, mode: 'default' });
        }

        stopDefaultTts() {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            this.setResult({ success: true, stopped: true, mode: 'default' });
        }

        stopAllTts() {
            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio.currentTime = 0;
                this.previewAudio = null;
            }
            if (window.speechSynthesis) window.speechSynthesis.cancel();
        }

        async ensureTtsPluginEnabled(plugin) {
            if (plugin?.status === 'enabled') return true;
            const result = await window.electronAPI.plugins.enable(plugin.id);
            if (!result?.success) {
                this.setResult(result?.error || 'Enable failed');
                return false;
            }
            await this.loadPlugins(plugin.id);
            return true;
        }

        async playCustomTts(text) {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;

            const saveResult = await this.saveCurrentConfig(plugin);
            if (!saveResult?.success) {
                this.setResult(saveResult?.error || 'Save failed');
                return;
            }
            if (!await this.ensureTtsPluginEnabled(plugin)) return;

            const result = await window.electronAPI.plugins.runAction(plugin.id, 'previewVoice', {
                text: String(text || '').trim() || 'Voice probe ready.'
            });
            this.setResult(result);
            if (result?.success && !this.playAudioPayload(result.result)) {
                this.setResult({ success: false, error: 'TTS server did not return playable audio' });
            }
        }

        async stopCustomTts() {
            const plugin = this.getSelectedPlugin();
            this.stopAllTts();
            if (plugin?.status === 'enabled') {
                await window.electronAPI.plugins.runAction(plugin.id, 'stop', {});
            }
            this.setResult({ success: true, stopped: true, mode: 'custom' });
        }

        createConfigInput(type, def = {}) {
            if (type === 'select') {
                const select = document.createElement('select');
                const options = Array.isArray(def.options) ? def.options : [];
                options.forEach((entry) => {
                    const option = document.createElement('option');
                    option.value = typeof entry === 'object' ? String(entry.value ?? entry.id ?? '') : String(entry);
                    option.textContent = typeof entry === 'object' ? String(entry.label ?? entry.name ?? option.value) : String(entry);
                    select.appendChild(option);
                });
                return select;
            }
            if (type === 'textarea') {
                return document.createElement('textarea');
            }
            const input = document.createElement('input');
            if (type === 'number') input.type = 'number';
            else if (type === 'boolean') input.type = 'checkbox';
            else if (type === 'password') input.type = 'password';
            else if (type === 'url') input.type = 'url';
            else input.type = 'text';
            return input;
        }

        async toggleSelected() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.toggleBtn, true);
            try {
                const result = plugin.status === 'enabled'
                    ? await window.electronAPI.plugins.disable(plugin.id)
                    : await window.electronAPI.plugins.enable(plugin.id);
                if (!result?.success) {
                    this.setResult(result?.error || 'Toggle failed');
                    return;
                }
                await this.loadPlugins(plugin.id);
                this.setResult({ success: true, pluginId: plugin.id });
            } finally {
                this.setActionBusy(this.toggleBtn, false);
            }
        }

        async toggleSelectedVisibility() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.visibilityBtn, true);
            try {
                const nextVisible = plugin.visibleInSidebar === false;
                const result = await window.electronAPI.plugins.setSidebarVisible(plugin.id, nextVisible);
                if (!result?.success) {
                    this.setResult(result?.error || 'Visibility toggle failed');
                    return;
                }
                await this.loadPlugins(plugin.id);
                this.setResult({ success: true, pluginId: plugin.id, visibleInSidebar: nextVisible });
            } finally {
                this.setActionBusy(this.visibilityBtn, false);
            }
        }

        parseInputValue(input) {
            const type = input.dataset.type || 'string';
            if (type === 'number') return Number(input.value || 0);
            if (type === 'boolean') return Boolean(input.checked);
            return input.value;
        }

        async saveConfig() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.saveBtn, true);

            try {
                const result = await this.saveCurrentConfig(plugin);
                if (!result?.success) {
                    this.setResult(result?.error || 'Save failed');
                    return;
                }
                await this.loadSelectedDetail();
                this.setResult({ success: true, saved: true, pluginId: plugin.id });
            } finally {
                this.setActionBusy(this.saveBtn, false);
            }
        }

        async saveCurrentConfig(plugin) {
            const inputs = Array.from(this.form.querySelectorAll('[data-key]'));
            for (const input of inputs) {
                const key = input.dataset.key;
                const value = this.parseInputValue(input);
                const result = await window.electronAPI.plugins.setConfig(plugin.id, key, value);
                if (!result?.success) {
                    return { success: false, error: result?.error || `Failed to save ${key}` };
                }
            }
            return { success: true };
        }

        async runDiscover() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.discoverBtn, true);
            try {
                const saveResult = await this.saveCurrentConfig(plugin);
                if (!saveResult?.success) {
                    this.setResult(saveResult?.error || 'Save failed');
                    return;
                }
                const capabilities = this.selectedDetail?.capabilities || this.selectedDetail?.manifest?.capabilities || [];
                const isTts = capabilities.includes('tts');
                const action = isTts ? 'previewVoice' : 'discover';
                const params = isTts
                    ? { text: 'Voice probe ready.', style: this.getFieldValue('style') || 'default' }
                    : {};
                const result = await window.electronAPI.plugins.runAction(plugin.id, action, params);
                this.setResult(result);
                if (isTts && result?.success) {
                    this.playAudioPayload(result.result);
                }
                await this.loadSelectedDetail();
            } finally {
                this.setActionBusy(this.discoverBtn, false);
            }
        }

        getFieldValue(key) {
            const field = this.form.querySelector(`[data-key="${key}"]`);
            if (!field) return '';
            return field.type === 'checkbox' ? field.checked : field.value;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new PluginStudioPanel());
    } else {
        new PluginStudioPanel();
    }
})();
