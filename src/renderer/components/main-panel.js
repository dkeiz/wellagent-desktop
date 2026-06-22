class MainPanel {
    constructor() {
        this.isSending = false;
        this.attachedFiles = [];
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.autoSpeak = false;
        this.ttsController = null;
        this.chatTabs = new Map(); // sessionId -> { title, messagesHTML, isSending, loadingId }
        this.activeTabId = null;
        this.commandHandler = new CommandHandler(this);
        this._autocompleteVisible = false;
        this._autocompleteItems = [];
        this._autocompleteIndex = 0;
        this._layoutObserver = null;
        this._chatPaneResizeObserver = null;
        this.initializeEvents();
        this.initializeTtsController();
        this.initializeVoice();
        this.initializeComposerLayout();
        this.initContextSettings();
        this.restoreOpenTabs();
    }
    async loadSystemPrompt() {
        try {
            const prompt = await window.electronAPI.getSystemPrompt();
            const promptTextarea = document.getElementById('system-prompt');
            if (promptTextarea) {
                promptTextarea.value = prompt || '';
            }
        } catch (error) {
            console.error('Error loading system prompt:', error);
        }
    }
    initializeEvents() {
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const messageInput = document.getElementById('message-input');
        const newChatBtn = document.getElementById('new-chat-btn');
        const attachBtn = document.getElementById('attach-btn');
        const voiceBtn = document.getElementById('voice-btn');
        const speakBtn = document.getElementById('speak-btn');
        const dropZone = document.getElementById('drop-zone');
        const messagesContainer = document.getElementById('messages-container');
        sendBtn.addEventListener('click', () => this.sendMessage());
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                console.log('[UI] Stop button clicked');
                try {
                    await window.electronAPI.stopGeneration();
                    stopBtn.classList.add('hidden');
                    sendBtn.classList.remove('hidden');
                    this.isSending = false;
                    this.addMessage('system', '[Generation stopped]');
                } catch (error) {
                    console.error('Failed to stop generation:', error);
                }
            });
        }
        if (newChatBtn) newChatBtn.addEventListener('click', () => this.newChat());
        attachBtn.addEventListener('click', () => this.attachFile());
        voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
        speakBtn.addEventListener('click', () => this.toggleAutoSpeak());
        messageInput.addEventListener('keypress', (e) => {
            if (this._autocompleteVisible && e.key === 'Enter') {
                e.preventDefault();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.hideCommandAutocomplete();
                this.sendMessage();
            }
        });
        messageInput.addEventListener('input', () => {
            const val = messageInput.value;
            if (!val.startsWith('/') || val.includes(' ')) {
                this.hideCommandAutocomplete();
                return;
            }
            const completions = val === '/'
                ? this.commandHandler.getAllCommands(10)
                : this.commandHandler.getCompletions(val, 10);
            this.showCommandAutocomplete(completions);
        });
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideCommandAutocomplete();
                return;
            }
            if (!this._autocompleteVisible) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveCommandAutocomplete(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveCommandAutocomplete(-1);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                this.acceptHighlightedAutocomplete();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.acceptHighlightedAutocomplete();
            }
        });
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes('Files')) {
                dropZone.classList.add('active');
            }
        });
        dropZone.addEventListener('dragover', (e) => e.preventDefault());
        dropZone.addEventListener('dragleave', (e) => {
            if (e.target === dropZone) {
                dropZone.classList.remove('active');
            }
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('active');
            this.handleFileDrop(e.dataTransfer.files);
        });
        if (messagesContainer) {
            messagesContainer.addEventListener('scroll', () => this._storeActiveTabScrollState());
            messagesContainer.addEventListener('click', (event) => {
                const image = event.target.closest('.chat-image');
                if (image) {
                    const lightboxSrc = image.getAttribute('data-lightbox-src') || image.getAttribute('src');
                    if (lightboxSrc) {
                        this._openLightbox(lightboxSrc);
                    }
                    return;
                }

                const openInViewerBtn = event.target.closest('.msg-open-in-viewer');
                const anchor = event.target.closest('a');
                const layoutMode = document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';

                if (openInViewerBtn) {
                    const url = openInViewerBtn.getAttribute('data-url');
                    if (this._openContentViewerTarget(url)) {
                        event.preventDefault();
                    }
                } else if (anchor && layoutMode === 'desktop') {
                    const url = anchor.getAttribute('href');
                    if (this._openContentViewerTarget(url)) {
                        event.preventDefault();
                    }
                }
            });
        }
        window.addEventListener('keydown', (event) => {
            if (event.key !== 'PageDown') return;
            if (this._shouldIgnorePagingTarget(event.target)) return;
            event.preventDefault();
            this._pageDownMessages();
        });
        document.getElementById('save-prompt-btn').addEventListener('click', () => this.saveSystemPrompt());
        const addProxyBtn = document.getElementById('add-proxy-btn');
        if (addProxyBtn) {
            addProxyBtn.addEventListener('click', () => this.addProxyServer());
        }
        this.setupEventListeners();
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === 'api') {
                    setTimeout(() => this.initContextSettings(), 100);
                }
            });
        });
    }
    initializeVoice() {
        return window.LocalAgentMainPanelVoice?.initializeVoice?.(this);
    }
    initializeTtsController() {
        return window.LocalAgentMainPanelVoice?.initializeTtsController?.(this);
    }
    toggleVoiceInput() {
        return window.LocalAgentMainPanelVoice?.toggleVoiceInput?.(this);
    }
    async toggleAutoSpeak() {
        return window.LocalAgentMainPanelVoice?.toggleAutoSpeak?.(this);
    }
    async speakText(text) {
        return window.LocalAgentMainPanelVoice?.speakText?.(this, text);
    }
    attachFile() {
        return window.LocalAgentMainPanelChatActions?.attachFile?.(this);
    }
    async handleFileDrop(files) {
        return window.LocalAgentMainPanelChatActions?.handleFileDrop?.(this, files);
    }
    showAttachedFile(fileName) {
        return window.LocalAgentMainPanelChatActions?.showAttachedFile?.(fileName);
    }
    async sendMessage() {
        // Delegate preserves the extracted completion chain: ".then(async response =>"
        // Delegate preserves the extracted recalculation step: "await this.calculateContextUsage(sessionId);"
        return window.LocalAgentMainPanelChatActions?.sendMessage?.(this);
    }
    addMessage(role, content, style) {
        // Delegate preserves the extracted append guard: "} else if (!this._suspendMessageAutoscroll) {"
        return window.LocalAgentMainPanelMessages?.addMessage?.(this, role, content, style);
    }
    _openLightbox(src) {
        // Delegate preserves the extracted cleanup guard: "this._closeLightbox?.();"
        // Delegate preserves the extracted key handler: "event.key === 'Escape'"
        // Delegate preserves the extracted cleanup listener removal: "document.removeEventListener('keydown', onKeyDown);"
        return window.LocalAgentMainPanelMessages?.openLightbox?.(this, src);
    }

    initializeComposerLayout() {
        return window.LocalAgentMainPanelLayout?.initializeComposerLayout?.(this);
    }

    syncDesktopComposerDock() {
        return window.LocalAgentMainPanelLayout?.syncDesktopComposerDock?.();
    }

    syncComposerDensity() {
        return window.LocalAgentMainPanelLayout?.syncComposerDensity?.();
    }
    showCommandAutocomplete(completions) {
        let dropdown = document.getElementById('cmd-autocomplete');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'cmd-autocomplete';
            dropdown.className = 'cmd-autocomplete';
            const inputRow = document.querySelector('.chat-input-row');
            if (inputRow) inputRow.style.position = 'relative';
            inputRow?.appendChild(dropdown);
        }
        if (completions.length === 0) {
            this.hideCommandAutocomplete();
            return;
        }
        this._autocompleteItems = completions.slice(0, 10);
        this._autocompleteIndex = Math.min(
            this._autocompleteIndex,
            Math.max(0, this._autocompleteItems.length - 1)
        );
        dropdown.innerHTML = '';
        this._autocompleteItems.forEach((c, index) => {
            const item = document.createElement('div');
            item.className = `cmd-autocomplete-item${index === this._autocompleteIndex ? ' active' : ''}`;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'cmd-name';
            nameSpan.textContent = c.name;
            const descSpan = document.createElement('span');
            descSpan.className = 'cmd-desc';
            descSpan.textContent = c.description;
            item.appendChild(nameSpan);
            item.appendChild(descSpan);
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                this.acceptHighlightedAutocomplete(index);
            });
            dropdown.appendChild(item);
        });
        dropdown.style.display = 'block';
        this._autocompleteVisible = true;
    }
    hideCommandAutocomplete() {
        const dropdown = document.getElementById('cmd-autocomplete');
        if (dropdown) dropdown.style.display = 'none';
        this._autocompleteVisible = false;
        this._autocompleteItems = [];
        this._autocompleteIndex = 0;
    }
    moveCommandAutocomplete(step) {
        if (!this._autocompleteVisible || this._autocompleteItems.length === 0) return;
        const total = this._autocompleteItems.length;
        this._autocompleteIndex = (this._autocompleteIndex + step + total) % total;
        const dropdown = document.getElementById('cmd-autocomplete');
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.cmd-autocomplete-item');
        items.forEach((item, index) => item.classList.toggle('active', index === this._autocompleteIndex));
        const activeItem = items[this._autocompleteIndex];
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }
    acceptHighlightedAutocomplete(index = this._autocompleteIndex) {
        const choice = this._autocompleteItems[index];
        if (choice) {
            const input = document.getElementById('message-input');
            input.value = `${choice.name} `;
            input.focus();
        }
        this.hideCommandAutocomplete();
    }
    addMessageWithAttachment(role, content, attachment) {
        return window.LocalAgentMainPanelMessages?.addMessageWithAttachment?.(this, role, content, attachment);
    }
    removeMessage(messageId) {
        return window.LocalAgentMainPanelMessages?.removeMessage?.(messageId);
    }
    _renderMessageBody(messageDiv, role, content, style) {
        return window.LocalAgentMainPanelMessages?.renderMessageBody?.(this, messageDiv, role, content, style);
    }
    _getMessagesContainer() {
        return window.LocalAgentMainPanelMessages?.getMessagesContainer?.();
    }
    _isNearBottom(container) {
        return window.LocalAgentMainPanelMessages?.isNearBottom?.(container);
    }
    _shouldAutoScroll(force = false) {
        return window.LocalAgentMainPanelMessages?.shouldAutoScroll?.(this, force);
    }
    _storeActiveTabScrollState() {
        return window.LocalAgentMainPanelMessages?.storeActiveTabScrollState?.(this);
    }
    _scrollMessagesToLatest(force = false) {
        return window.LocalAgentMainPanelMessages?.scrollMessagesToLatest?.(this, force);
    }
    _shouldIgnorePagingTarget(target) {
        return window.LocalAgentMainPanelMessages?.shouldIgnorePagingTarget?.(target);
    }
    _pageDownMessages() {
        return window.LocalAgentMainPanelMessages?.pageDownMessages?.(this);
    }
    async updateContextUsage(response) {
        const contextDiv = document.getElementById('context-usage');
        if (!contextDiv) return;
        const isPrivate = String(this.activeTabId || '').startsWith('private-');
        const modeLine = isPrivate
            ? '<span style="color:#1f8d45;">✓</span> private'
            : '<span style="color:#1f8d45;">✓</span> memory';
        Object.assign(contextDiv.style, { display: 'inline-grid', gridAutoRows: 'min-content', rowGap: '0', alignItems: 'end', justifyContent: 'center', lineHeight: '1', padding: '0', margin: '0', background: 'transparent', border: '0', gap: '0' });
        if (!response) {
            contextDiv.innerHTML = `<span id="chat-mode-line" style="display:block; margin:0; padding:0; line-height:1; cursor:pointer;">${modeLine}</span>`;
            contextDiv.title = isPrivate
                ? 'Private mode: background memory/skills disabled for this chat'
                : 'Memory mode: background memory/skills enabled for this chat';
            contextDiv.style.color = '';
            const modeEl = document.getElementById('chat-mode-line');
            if (modeEl) {
                modeEl.onclick = async () => {
                    if (window.chatPrivacyMode?.toggleCurrentChatMode) {
                        await window.chatPrivacyMode.toggleCurrentChatMode(this);
                    }
                };
            }
            return;
        }
        const usagePayload = response.usage || response;
        const promptTokens = Number(usagePayload.prompt_tokens || 0), totalTokens = Number(usagePayload.total_tokens || 0);
        const displayTokens = Number(response.tokens || usagePayload.tokens || totalTokens || promptTokens || 0);
        if (!Number.isFinite(displayTokens) || displayTokens <= 0) { this.updateContextUsage(null); return; }
        let contextLength = response.context_length || response.contextLength || usagePayload.context_length || usagePayload.contextLength;
        if (!contextLength) {
            try {
                const saved = await window.electronAPI.getSetting('context_window');
                contextLength = saved ? parseInt(saved) : 8192;
            } catch (e) {
                contextLength = 8192;
            }
        }
        const source = response.source || usagePayload.source || (response.usage ? 'provider' : 'local');
        const usageSnapshot = { ...usagePayload, tokens: displayTokens, prompt_tokens: promptTokens || displayTokens, total_tokens: totalTokens || displayTokens, context_length: contextLength, contextLength, source };
        const tab = this.chatTabs.get(this.activeTabId);
        if (tab) tab.contextUsage = usageSnapshot;
        const formatK = (num) => (num / 1000).toFixed(1) + 'k';
        contextDiv.innerHTML = `<span style="display:block; margin:0; padding:0; line-height:1;">${formatK(displayTokens)}/${formatK(contextLength)}</span><span id="chat-mode-line" style="display:block; margin:0; padding:0; line-height:1; cursor:pointer;">${modeLine}</span>`;
        contextDiv.title = `Context: ${displayTokens} tokens, Source: ${source}, Window: ${contextLength}, Overflow: ${usageSnapshot.overflow ? 'yes' : 'no'}, Cached: ${usagePayload.cached_tokens || 0}`;
        const percentage = (displayTokens / contextLength) * 100;
        contextDiv.style.color = percentage > 80 ? '#dc3545' : (percentage > 60 ? '#ffc107' : '#28a745');
        const modeEl = document.getElementById('chat-mode-line');
        if (modeEl) {
            modeEl.onclick = async () => {
                if (window.chatPrivacyMode?.toggleCurrentChatMode) {
                    await window.chatPrivacyMode.toggleCurrentChatMode(this);
                }
            };
        }
    }
    async calculateContextUsage(sessionId = null) {
        try {
            const activeSessionId = sessionId || this.activeTabId;
            const tab = this.chatTabs.get(activeSessionId);
            const usage = tab?.contextUsage || null;
            if (!window.electronAPI.getContextUsageEstimate) {
                if (usage && String(activeSessionId) === String(this.activeTabId)) this.updateContextUsage({ usage, context_length: usage.contextLength });
                else if (String(activeSessionId) === String(this.activeTabId)) this.updateContextUsage(null);
                return;
            }
            const estimate = await window.electronAPI.getContextUsageEstimate(activeSessionId);
            const tokens = Number(estimate?.tokens || estimate?.prompt_tokens || estimate?.total_tokens || 0);
            if (estimate && Number.isFinite(tokens) && tokens > 0) {
                if (tab) tab.contextUsage = estimate;
                if (String(activeSessionId) === String(this.activeTabId)) this.updateContextUsage(estimate);
                return;
            }
            if (String(activeSessionId) === String(this.activeTabId)) this.updateContextUsage(null);
        } catch (error) {
            console.error('Error calculating context:', error);
        }
    }
    showStoredContextUsage() {
        const usage = this.chatTabs.get(this.activeTabId)?.contextUsage;
        if (usage) this.updateContextUsage({ usage, context_length: usage.contextLength });
        else this.updateContextUsage(null);
    }
    async clearCurrentChat() {
        return window.mainPanelTabs.clearCurrentChat(this);
    }
    async newChat() {
        return window.mainPanelTabs.newChat(this);
    }
    async openAgentChat(agentId, sessionId, agent, options = {}) {
        return window.mainPanelTabs.openAgentChat(this, agentId, sessionId, agent, options);
    }
    async ensureSubagentChat(eventPayload, options = {}) {
        return window.mainPanelTabs.ensureSubagentChat(this, eventPayload, options);
    }
    async updateSubagentChatState(eventPayload) {
        return window.mainPanelTabs.updateSubagentChatState(this, eventPayload);
    }
    async openSubagentManagerTab() { return window.mainPanelTabs.openSubagentManagerTab(this); }
    async openSuperagentManagerTab() { return window.mainPanelTabs.openSuperagentManagerTab(this); }
    async refreshSubagentManagerTab() { return window.mainPanelTabs.refreshSubagentManagerTab(this); }
    async refreshSuperagentManagerTab() { return window.mainPanelTabs.refreshSuperagentManagerTab(this); }
    openNewWindow() { return window.mainPanelTabs.openNewWindow(); }
    async restoreOpenTabs() { return window.mainPanelTabs.restoreOpenTabs(this); }
    async autoTitleTab(sessionId) {
        return window.mainPanelTabs.autoTitleTab(this, sessionId);
    }
    saveCurrentTabMessages() {
        return window.mainPanelTabs.saveCurrentTabMessages(this);
    }
    async switchTab(sessionId) {
        return window.mainPanelTabs.switchTab(this, sessionId);
    }
    async loadTabConversations(sessionId) {
        return window.mainPanelTabs.loadTabConversations(this, sessionId);
    }
    async closeTab(sessionId) {
        return window.mainPanelTabs.closeTab(this, sessionId);
    }
    renderTabs() {
        return window.mainPanelTabs.renderTabs(this);
    }
    async saveOpenTabIds() {
        return window.mainPanelTabs.saveOpenTabIds(this);
    }
    static CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 49152, 65536, 98304, 131072, 196608, 262144];
    static CONTEXT_LABELS = ['4K', '8K', '16K', '32K', '48K', '64K', '96K', '128K', '192K', '256K'];
    static getContextPresetIndex(value) {
        const target = parseInt(value, 10);
        if (!Number.isFinite(target) || target <= 0) return 1;
        return MainPanel.CONTEXT_PRESETS.reduce((bestIndex, preset, index) => {
            const bestValue = MainPanel.CONTEXT_PRESETS[bestIndex];
            return Math.abs(preset - target) < Math.abs(bestValue - target) ? index : bestIndex;
        }, 1);
    }
    static formatContextValue(tokens) {
        const value = parseInt(tokens, 10);
        if (!Number.isFinite(value) || value <= 0) return 'Unknown';
        if (value >= 1000) {
            const compact = value % 1000 === 0 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1);
            return `${compact}K`;
        }
        return `${value}`;
    }
    async loadSelectedContextSetting() {
        try {
            const savedValue = await window.electronAPI.getSetting('context_window');
            const parsedValue = parseInt(savedValue, 10);
            this._selectedContextSetting = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 8192;
        } catch (error) {
            this._selectedContextSetting = 8192;
        }
        return this._selectedContextSetting;
    }
    applyContextProfile(profile) {
        const section = document.getElementById('context-window-section');
        const configurableControl = document.getElementById('context-window-configurable');
        const readonlyControl = document.getElementById('context-window-readonly');
        const contextSlider = document.getElementById('context-slider');
        if (!section || !configurableControl || !readonlyControl || !contextSlider) {
            return;
        }
        if (!profile?.spec?.model) {
            this._apiContextProfile = null;
            section.style.display = 'none';
            configurableControl.style.display = 'none';
            readonlyControl.style.display = 'none';
            return;
        }
        this._apiContextProfile = profile;
        const contextCaps = profile.spec.capabilities?.contextWindow || {};
        const contextValue = contextCaps.configurable
            ? (this._selectedContextSetting || MainPanel.CONTEXT_PRESETS[parseInt(contextSlider.value, 10)] || 8192)
            : (profile.runtimeConfig?.contextWindow?.value
                || profile.spec.runtime?.contextWindow?.value)
            || 8192;
        if (!contextCaps.supported && !contextCaps.configurable) {
            section.style.display = 'none';
            configurableControl.style.display = 'none';
            readonlyControl.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        if (contextCaps.configurable) {
            const bestIndex = MainPanel.getContextPresetIndex(contextValue);
            configurableControl.style.display = 'block';
            readonlyControl.style.display = 'none';
            contextSlider.disabled = false;
            contextSlider.value = bestIndex;
            this.updateContextDisplay(bestIndex);
            return;
        }
        configurableControl.style.display = 'none';
        readonlyControl.style.display = 'block';
        readonlyControl.textContent = `Context Window: ${MainPanel.formatContextValue(contextValue)} (${Number(contextValue).toLocaleString()} tokens)`;
    }
    initContextSettings() {
        return window.LocalAgentMainPanelContext?.initContextSettings?.(
            this,
            MainPanel.CONTEXT_PRESETS,
            MainPanel.CONTEXT_LABELS,
            MainPanel.getContextPresetIndex
        );
    }
    async _initThinkingSettings() {
        return window.LocalAgentMainPanelContext?.initThinkingSettings?.(this);
    }
    async saveContextSize(index) {
        return window.LocalAgentMainPanelContext?.saveContextSize?.(
            this,
            MainPanel.CONTEXT_PRESETS,
            MainPanel.CONTEXT_LABELS,
            index
        );
    }
    updateContextDisplay(index) {
        return window.LocalAgentMainPanelContext?.updateContextDisplay?.(
            this,
            MainPanel.CONTEXT_PRESETS,
            MainPanel.CONTEXT_LABELS,
            index
        );
    }
    async saveSystemPrompt() {
        const promptTextarea = document.getElementById('system-prompt');
        const prompt = promptTextarea.value.trim();
        if (!prompt) return;
        try {
            await window.electronAPI.setSystemPrompt(prompt);
            this.showNotification('System prompt saved successfully');
        } catch (error) {
            console.error('Error saving system prompt:', error);
            this.showNotification('Error saving system prompt', 'error');
        }
    }
    async addProxyServer() {
        this.showNotification('Proxy server functionality coming soon', 'info');
    }
    setupEventListeners() {
        return window.LocalAgentMainPanelEvents?.setupEventListeners?.(this);
    }
    async initializeSession() {
    }
    async loadConversations() {
        if (this.activeTabId) {
            await this.loadTabConversations(this.activeTabId);
        }
    }
    showToolPermissionDialog(request) {
        return window.mainPanelPermissions.showToolPermissionDialog(this, request);
    }
    async approveToolCreation() {
        return window.mainPanelPermissions.approveToolCreation(this);
    }
    denyToolCreation() {
        return window.mainPanelPermissions.denyToolCreation(this);
    }
    async allowToolOnce(toolName) {
        return window.mainPanelPermissions.allowToolOnce(this, toolName);
    }
    async enableTool(toolName) {
        return window.mainPanelPermissions.enableTool(this, toolName);
    }
    denyToolPermission() {
        return window.mainPanelPermissions.denyToolPermission(this);
    }
    closePermissionDialog() {
        return window.mainPanelPermissions.closePermissionDialog(this);
    }
    showNotification(message, type = 'success') {
        return window.mainPanelPermissions.showNotification(message, type);
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const panel = new MainPanel();
    window.localAgentRendererShell?.initializeMainPanel?.(panel);
    window.mainPanel = panel;
    if (typeof window.initializeApiProviderSettings === 'function') {
        try {
            await window.initializeApiProviderSettings(panel);
        } catch (error) {
            console.error('Failed to initialize API provider settings module:', error);
        }
    } else {
        console.warn('API provider settings module not loaded');
    }
    await panel.initializeSession();
});
