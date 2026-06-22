(function () {
    class ContentViewer {
        static MODE_SINGLE = 'single';
        static MODE_MULTI = 'multi';
        static STORAGE_MODE_KEY = 'contentViewerMode';
        static SETTINGS_STATE_KEY = 'ui.contentViewer.state';

        constructor() {
            this.panel = document.getElementById('content-viewer-panel');
            this.tabsContainer = document.getElementById('content-viewer-tabs');
            this.body = document.getElementById('content-viewer-body');
            this.modeSelect = document.getElementById('content-viewer-mode');
            this.chatToggle = document.getElementById('content-viewer-chat-toggle');

            if (!this.panel || !this.body) return;

            /** @type {Map<string, {id:string, title:string, icon:string, type:string, content:any, sourceAgentId:string|null, sourceSessionId:string|null}>} */
            this.tabs = new Map();
            this.activeTabId = null;
            this.mode = this._loadMode();
            this.isChatMode = false;
            this._tabCounter = 0;
            this.contextMenu = null;
            this.boundSessionId = null;
            this._init();
        }

        _init() {
            if (this.modeSelect) {
                this.modeSelect.value = this.mode;
                this.modeSelect.addEventListener('change', (e) => {
                    this.setMode(e.target.value);
                });
            }

            if (this.chatToggle) {
                this.chatToggle.addEventListener('click', () => this.toggleChatMode());
            }
            document.addEventListener('content-viewer:open', (e) => {
                this.openContent(e.detail || {});
            });
            document.addEventListener('chat-tab-switched', (e) => {
                const { sessionId, agentId } = e.detail || {};
                this._onChatTabSwitched(sessionId, agentId);
            });
            if (window.electronAPI?.onToolUpdate) {
                window.electronAPI.onToolUpdate((event, data) => {
                    const viewerContent = data?.toolName === 'display_content' ? data?.result : data?.result?.viewerContent;
                    if (data?.success && viewerContent) this.openContent(viewerContent);
                });
            }

            this._installBodyInteractionHandlers();
            this._installGlobalDismissHandlers();

            this._renderTabs();
            this._renderBody();
            this._restorePersistedState();
        }

        _installBodyInteractionHandlers() {
            if (!this.body?.addEventListener) return;

            this.body.addEventListener('click', (event) => {
                const command = event.target?.closest?.('[data-media-command]');
                if (command) {
                    event.preventDefault();
                    this._handleMediaCommand(command.dataset.mediaCommand);
                    return;
                }

                const preview = event.target?.closest?.('[data-media-preview="image"]');
                if (preview) {
                    this._toggleImageDisplayMode();
                }
            });

            this.body.addEventListener('auxclick', (event) => {
                const mediaRoot = event.target?.closest?.('[data-media-root="true"]');
                if (!mediaRoot || event.button !== 1) return;
                event.preventDefault();
                this._openActiveMediaExternally();
            });

            this.body.addEventListener('contextmenu', (event) => {
                const mediaRoot = event.target?.closest?.('[data-media-root="true"]');
                if (!mediaRoot) return;
                event.preventDefault();
                this._showMediaContextMenu(event.clientX || 0, event.clientY || 0);
            });
        }

        _installGlobalDismissHandlers() {
            if (!document?.addEventListener) return;

            document.addEventListener('click', (event) => {
                if (!this.contextMenu) return;
                if (event.target?.closest?.('.content-viewer-context-menu')) return;
                this._hideContextMenu();
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    this._hideContextMenu();
                }
            });
        }

        // --- Mode management ---

        _loadMode() {
            const saved = localStorage.getItem(ContentViewer.STORAGE_MODE_KEY);
            return saved === ContentViewer.MODE_MULTI ? ContentViewer.MODE_MULTI : ContentViewer.MODE_SINGLE;
        }

        setMode(mode) {
            const prev = this.mode;
            this.mode = mode === ContentViewer.MODE_MULTI ? ContentViewer.MODE_MULTI : ContentViewer.MODE_SINGLE;
            localStorage.setItem(ContentViewer.STORAGE_MODE_KEY, this.mode);

            if (this.modeSelect) this.modeSelect.value = this.mode;

            // When switching from multi to single, keep only the active tab
            if (prev === ContentViewer.MODE_MULTI && this.mode === ContentViewer.MODE_SINGLE) {
                if (this.activeTabId && this.tabs.has(this.activeTabId)) {
                    const activeTab = this.tabs.get(this.activeTabId);
                    this.tabs.clear();
                    this.tabs.set(this.activeTabId, activeTab);
                } else {
                    this.tabs.clear();
                    this.activeTabId = null;
                }
            }

            this._renderTabs();
            this._renderBody();
            this._persistState();
        }

        // --- Session binding (single-tab mode) ---

        _onChatTabSwitched(sessionId, agentId) {
            if (this.mode === ContentViewer.MODE_SINGLE) {
                // Bind viewer to the new active chat session
                this.boundSessionId = sessionId;
            } else {
                // In multi-tab mode, auto-focus the tab for this agent
                if (agentId) {
                    this.autoFocusForAgent(agentId);
                }
            }
        }

        bindToSession(sessionId) {
            this.boundSessionId = sessionId;
        }

        // --- Open content ---

        /**
         * Open content in the viewer.
         * @param {Object} content
         * @param {string} content.type - 'file', 'url', 'markdown', 'html', 'text', 'image', 'code', 'document'
         * @param {string} content.title - Display title
         * @param {string} [content.url] - URL to load
         * @param {string} [content.html] - Raw HTML to display
         * @param {string} [content.text] - Plain text or markdown content
         * @param {string} [content.language] - Language for code highlighting
         * @param {string} [content.sourceAgentId] - Agent that sent this content
         * @param {string} [content.sourceSessionId] - Session that sent this content
         * @param {string} [content.icon] - Tab icon override
         */
        openContent(content) {
            const normalizedContent = this._normalizeContent(content);
            if (!normalizedContent || !normalizedContent.type) return null;

            const id = this._nextTabId();
            const icon = normalizedContent.icon || this._iconForType(normalizedContent.type);
            const title = normalizedContent.title || this._titleForContent(normalizedContent);

            const tab = {
                id,
                title,
                icon,
                type: normalizedContent.type,
                content: normalizedContent,
                sourceAgentId: normalizedContent.sourceAgentId || null,
                sourceSessionId: normalizedContent.sourceSessionId || null
            };

            if (this.mode === ContentViewer.MODE_SINGLE) {
                // Replace the single tab
                this.tabs.clear();
                this.tabs.set(id, tab);
                this.activeTabId = id;
            } else {
                // Add new tab
                this.tabs.set(id, tab);
                this.activeTabId = id;
            }

            this._renderTabs();
            this._renderBody();
            this._persistState();
            return id;
        }

        openFile(filePath) {
            const normalizedPath = this._filePathFromTarget(filePath);
            const fileUrl = this._fileUrlFromPath(normalizedPath);
            const targetInfo = this._describeTarget(normalizedPath);
            const type = targetInfo.viewerType;
            const title = normalizedPath.split(/[/\\]/).pop() || normalizedPath;

            const tabId = this.openContent({
                type,
                title,
                url: fileUrl,
                text: '',
                language: targetInfo.language,
                mediaKind: targetInfo.mediaKind,
                filePath: normalizedPath
            });

            if (['code', 'text', 'markdown'].includes(type) && window.electronAPI?.readFileContent) {
                window.electronAPI.readFileContent(normalizedPath).then(text => {
                    const tab = this.tabs.get(tabId);
                    if (tab) {
                        tab.content.text = text;
                        if (this.activeTabId === tab.id) this._renderBody();
                    }
                }).catch(() => {});
            }
        }

        openUrl(url) {
            if (this._isFileTarget(url)) {
                this.openFile(url);
                return;
            }

            this.openContent({
                type: 'url',
                title: this._shortenUrl(url),
                url
            });
        }

        openDocument(doc) {
            this.openContent({
                type: doc.type || 'markdown',
                title: doc.title || 'Document',
                text: doc.content || doc.text || '',
                content: doc.content || doc.text || '',
                html: doc.html || '',
                sourceAgentId: doc.agentId || null,
                sourceSessionId: doc.sessionId || null
            });
        }

        // --- Tab management ---

        switchTab(tabId) {
            if (!this.tabs.has(tabId)) return;
            this.activeTabId = tabId;
            this._renderTabs();
            this._renderBody();
            this._ensureTabContentLoaded(tabId);
            this._persistState();
        }

        closeTab(tabId) {
            if (!this.tabs.has(tabId)) return;
            this.tabs.delete(tabId);

            if (this.activeTabId === tabId) {
                const keys = [...this.tabs.keys()];
                this.activeTabId = keys.length > 0 ? keys[keys.length - 1] : null;
            }

            this._renderTabs();
            this._renderBody();
            this._persistState();
        }

        autoFocusForAgent(agentId) {
            for (const [id, tab] of this.tabs) {
                if (tab.sourceAgentId && String(tab.sourceAgentId) === String(agentId)) {
                    this.switchTab(id);
                    return;
                }
            }
        }

        // --- Chat mode toggle ---

        toggleChatMode() {
            this.isChatMode = !this.isChatMode;
            this.panel?.classList.toggle('content-viewer-chat-mode', this.isChatMode);

            if (this.chatToggle) {
                this.chatToggle.textContent = this.isChatMode ? '📄' : '💬';
                this.chatToggle.title = this.isChatMode ? 'Back to Viewer' : 'Open Chat Here';
            }

            this._renderBody();
            this._persistState();
        }

        // --- Rendering ---

        _renderTabs() {
            if (!this.tabsContainer) return;
            this.tabsContainer.innerHTML = '';

            if (this.tabs.size === 0) return;

            if (this.mode === ContentViewer.MODE_SINGLE && this.tabs.size > 0) {
                // Single tab mode: show breadcrumb
                const tab = this.tabs.values().next().value;
                const breadcrumb = document.createElement('div');
                breadcrumb.className = 'content-viewer-breadcrumb';

                if (tab.sourceAgentId) {
                    breadcrumb.innerHTML = `
                        <span class="content-viewer-breadcrumb-agent">${this._esc(tab.icon)}</span>
                        <span class="content-viewer-breadcrumb-sep">›</span>
                        <span class="content-viewer-breadcrumb-title">${this._esc(tab.title)}</span>
                    `;
                } else {
                    breadcrumb.innerHTML = `
                        <span class="content-viewer-tab-icon">${this._esc(tab.icon)}</span>
                        <span class="content-viewer-breadcrumb-title">${this._esc(tab.title)}</span>
                    `;
                }
                this.tabsContainer.appendChild(breadcrumb);
                return;
            }

            // Multi-tab mode: render tabs
            for (const [id, tab] of this.tabs) {
                const tabEl = document.createElement('div');
                tabEl.className = `content-viewer-tab${id === this.activeTabId ? ' active' : ''}`;
                tabEl.dataset.tabId = id;

                tabEl.innerHTML = `
                    <span class="content-viewer-tab-icon">${this._esc(tab.icon)}</span>
                    <span class="content-viewer-tab-title">${this._esc(tab.title)}</span>
                    <button class="content-viewer-tab-close" data-close-tab="${id}" title="Close">×</button>
                `;

                tabEl.addEventListener('click', (e) => {
                    if (e.target.closest('.content-viewer-tab-close')) {
                        this.closeTab(e.target.closest('.content-viewer-tab-close').dataset.closeTab);
                        return;
                    }
                    this.switchTab(id);
                });

                this.tabsContainer.appendChild(tabEl);
            }
        }

        _renderBody() {
            if (!this.body) return;

            if (this.isChatMode) {
                this._renderChatMode();
                return;
            }

            if (!this.activeTabId || !this.tabs.has(this.activeTabId)) {
                this.body.innerHTML = `
                    <div class="content-viewer-empty">
                        <span>No content open</span>
                        <small>Click links in chat or agents will send content here</small>
                    </div>
                `;
                return;
            }

            const tab = this.tabs.get(this.activeTabId);
            const content = tab.content;

            switch (content.type) {
                case 'markdown':
                    this._renderMarkdown(content.text || content.content || content.html || '');
                    break;
                case 'html':
                    this._renderHtml(content.html || content.text || content.content || '');
                    break;
                case 'code':
                    this._renderCode(content.text || content.content || '', content.language || '');
                    break;
                case 'image':
                    this._renderImage(content);
                    break;
                case 'video':
                    this._renderVideo(content);
                    break;
                case 'audio':
                    this._renderAudio(content);
                    break;
                case 'text':
                    this._renderPlainText(content.text || content.content || '');
                    break;
                case 'url':
                    this._renderUrl(content.url || content.content || '');
                    break;
                case 'file':
                    this._renderFile(content);
                    break;
                case 'document':
                    if (content.filePath || content.url) {
                        this._renderUrl(content.url || this._fileUrlFromPath(content.filePath));
                    } else {
                        this._renderMarkdown(content.text || content.content || content.html || '');
                    }
                    break;
                default:
                    this._renderPlainText(content.text || JSON.stringify(content, null, 2));
            }
        }

        _renderMarkdown(text) {
            // Use the existing message formatter if available, otherwise basic rendering
            let html = text;
            if (window.messageFormatter?.renderMarkdown) {
                html = window.messageFormatter.renderMarkdown(text, { allowImages: true });
            } else if (window.markdownToHtml) {
                html = window.markdownToHtml(text);
            } else {
                html = this._basicMarkdown(text);
            }
            this.body.innerHTML = `<div class="content-viewer-render">${html}</div>`;
        }

        _renderHtml(html) {
            this.body.innerHTML = `
                <iframe class="content-viewer-iframe"
                        sandbox=""
                        srcdoc="${this._attr(html)}"></iframe>
            `;
        }

        _renderCode(text, language) {
            const escaped = this._esc(text);
            const langClass = language ? ` class="language-${this._attr(language)}"` : '';
            this.body.innerHTML = `
                <div class="content-viewer-render">
                    <pre><code${langClass}>${escaped}</code></pre>
                </div>
            `;
        }

        _renderImage(url) {
            const imageUrl = url.url || url.content || '';
            const displayMode = url.imageDisplayMode === 'original' ? 'original' : 'fit';
            this.body.innerHTML = `
                ${this._renderMediaFrame(
                    url,
                    `
                        <div class="content-viewer-image content-viewer-image--${displayMode}" data-media-preview="image">
                            <img src="${this._attr(imageUrl)}" alt="Content" loading="lazy" />
                        </div>
                    `
                )}
            `;
        }

        _renderVideo(content) {
            const source = content.url || content.content || '';
            this.body.innerHTML = `
                ${this._renderMediaFrame(
                    content,
                    `
                        <div class="content-viewer-av-wrap">
                            <video class="content-viewer-video" controls preload="metadata">
                                <source src="${this._attr(source)}" />
                            </video>
                        </div>
                    `
                )}
            `;
        }

        _renderAudio(content) {
            const source = content.url || content.content || '';
            this.body.innerHTML = `
                ${this._renderMediaFrame(
                    content,
                    `
                        <div class="content-viewer-av-wrap content-viewer-av-wrap--audio">
                            <audio class="content-viewer-audio" controls preload="metadata">
                                <source src="${this._attr(source)}" />
                            </audio>
                        </div>
                    `
                )}
            `;
        }

        _renderPlainText(text) {
            const lines = text.split('\n');
            const numbered = lines.map((line, i) =>
                `<span class="line-num">${i + 1}</span>${this._esc(line)}`
            ).join('\n');
            this.body.innerHTML = `
                <div class="content-viewer-render">
                    <pre style="counter-reset: line;">${numbered}</pre>
                </div>
            `;
        }

        _renderUrl(url) {
            const targetInfo = this._describeTarget(url);
            if (targetInfo.viewerType === 'image') {
                this._renderImage({ type: 'image', url, imageDisplayMode: 'fit', mediaKind: 'image' });
                return;
            }
            if (targetInfo.viewerType === 'video') {
                this._renderVideo({ type: 'video', url, mediaKind: 'video' });
                return;
            }
            if (targetInfo.viewerType === 'audio') {
                this._renderAudio({ type: 'audio', url, mediaKind: 'audio' });
                return;
            }
            if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
                this.body.innerHTML = `
                    <iframe class="content-viewer-iframe" 
                            src="${this._attr(url)}" 
                            sandbox="allow-scripts allow-same-origin allow-popups"
                            loading="lazy"></iframe>
                `;
            } else {
                this._renderPlainText(`Cannot display: ${url}`);
            }
        }

        _renderFile(content) {
            if (content.text || content.content) {
                this._renderCode(content.text || content.content, content.language || '');
            } else if (content.url || content.filePath) {
                const target = content.url || content.filePath;
                const targetInfo = this._describeTarget(target);
                if (targetInfo.viewerType === 'image') {
                    this._renderImage(content);
                    return;
                }
                if (targetInfo.viewerType === 'video') {
                    this._renderVideo(content);
                    return;
                }
                if (targetInfo.viewerType === 'audio') {
                    this._renderAudio(content);
                    return;
                }
                if (targetInfo.viewerType === 'document') {
                    this._renderUrl(content.url || this._fileUrlFromPath(content.filePath));
                    return;
                }
                this._renderPlainText(`Loading: ${target}`);
            }
        }

        _renderChatMode() {
            this.body.innerHTML = `
                <div class="content-viewer-render" style="flex:1; overflow-y:auto; padding:1rem;">
                    <div style="color: var(--text-secondary); text-align:center; padding: 2rem;">
                        <p>Secondary chat area</p>
                        <small>Select an agent or session to start chatting here</small>
                    </div>
                </div>
                <div class="content-viewer-chat-input">
                    <textarea placeholder="Type a message..." rows="1"></textarea>
                    <button class="primary-btn compact-btn">Send</button>
                </div>
            `;
        }

        // --- Utilities ---

        _nextTabId() {
            return `cv-tab-${++this._tabCounter}-${Date.now()}`;
        }

        _iconForType(type) {
            const icons = {
                file: '📄', url: '🌐', markdown: '📝', html: '🔖',
                text: '📃', image: '🖼️', code: '💻', document: '📋',
                video: '🎬', audio: '🎵'
            };
            return icons[type] || '📄';
        }

        _titleForContent(content) {
            if (content.url) return this._shortenUrl(content.url);
            if (content.filePath) return content.filePath.split(/[/\\]/).pop() || 'File';
            return content.type || 'Content';
        }

        _shortenUrl(url) {
            try {
                const parsed = new URL(url);
                const path = parsed.pathname.split('/').pop() || parsed.hostname;
                return path.length > 30 ? path.slice(0, 27) + '...' : path;
            } catch {
                return url.length > 35 ? url.slice(0, 32) + '...' : url;
            }
        }

        _normalizeContent(content) {
            if (!content || typeof content !== 'object') return null;
            const normalized = { ...content };
            normalized.type = String(normalized.type || '').toLowerCase();

            if (normalized.content !== undefined && normalized.text === undefined
                && ['markdown', 'code', 'text', 'document'].includes(normalized.type)) {
                normalized.text = String(normalized.content ?? '');
            }
            if (normalized.content !== undefined && normalized.html === undefined && normalized.type === 'html') {
                normalized.html = String(normalized.content ?? '');
            }
            if (normalized.content !== undefined && normalized.url === undefined
                && ['url', 'image'].includes(normalized.type)) {
                normalized.url = String(normalized.content ?? '');
            }
            if (normalized.type === 'file') {
                normalized.filePath = normalized.filePath || normalized.path || normalized.url || normalized.content || '';
                if (normalized.filePath && !normalized.url) {
                    normalized.url = this._fileUrlFromPath(normalized.filePath);
                }
            }

            const target = normalized.filePath || normalized.url || '';
            const targetInfo = this._describeTarget(target);
            if (!normalized.mediaKind && targetInfo.mediaKind) {
                normalized.mediaKind = targetInfo.mediaKind;
            }
            if (!normalized.language && targetInfo.language) {
                normalized.language = targetInfo.language;
            }
            if (normalized.type === 'file') {
                normalized.type = targetInfo.viewerType;
            } else if (normalized.type === 'url' && ['image', 'video', 'audio', 'document'].includes(targetInfo.viewerType)) {
                normalized.type = targetInfo.viewerType;
            }
            if (normalized.type === 'image' && !normalized.imageDisplayMode) {
                normalized.imageDisplayMode = 'fit';
            }

            return normalized;
        }

        _renderMediaFrame(content, innerHtml) {
            const canReveal = Boolean(content.filePath);
            const fitLabel = content.imageDisplayMode === 'original' ? 'Fit' : '100%';
            const fitButton = content.type === 'image'
                ? `<button type="button" class="content-viewer-media-btn" data-media-command="toggle-fit">${this._esc(fitLabel)}</button>`
                : '';
            const revealButton = canReveal
                ? `<button type="button" class="content-viewer-media-btn" data-media-command="reveal">Reveal</button>`
                : '';
            const hint = content.type === 'image'
                ? 'Click: fit/100%  Middle click: open externally  Right click: more'
                : 'Middle click: open externally  Right click: more';

            return `
                <div class="content-viewer-media-shell" data-media-root="true">
                    <div class="content-viewer-media-toolbar">
                        <div class="content-viewer-media-actions">
                            ${fitButton}
                            <button type="button" class="content-viewer-media-btn" data-media-command="open">Open</button>
                            ${revealButton}
                        </div>
                        <div class="content-viewer-media-hint">${this._esc(hint)}</div>
                    </div>
                    ${innerHtml}
                </div>
            `;
        }

        _handleMediaCommand(command) {
            if (command === 'toggle-fit') {
                this._toggleImageDisplayMode();
                return;
            }
            if (command === 'open') {
                this._openActiveMediaExternally();
                return;
            }
            if (command === 'reveal') {
                this._revealActiveMediaInFolder();
            }
        }

        _getActiveTab() {
            if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return null;
            return this.tabs.get(this.activeTabId);
        }

        _toggleImageDisplayMode() {
            const tab = this._getActiveTab();
            if (!tab?.content || tab.content.type !== 'image') return;
            tab.content.imageDisplayMode = tab.content.imageDisplayMode === 'original' ? 'fit' : 'original';
            this._renderBody();
            this._persistState();
        }

        async _openActiveMediaExternally() {
            const tab = this._getActiveTab();
            const content = tab?.content;
            if (!content) return;

            if (content.filePath && window.electronAPI?.shell?.openPath) {
                await window.electronAPI.shell.openPath(content.filePath).catch(() => {});
                return;
            }

            if (content.url && window.electronAPI?.shell?.openExternal && /^https?:/i.test(content.url)) {
                await window.electronAPI.shell.openExternal(content.url).catch(() => {});
            }
        }

        async _revealActiveMediaInFolder() {
            const tab = this._getActiveTab();
            const filePath = tab?.content?.filePath;
            if (!filePath || !window.electronAPI?.shell?.showItemInFolder) return;
            await window.electronAPI.shell.showItemInFolder(filePath).catch(() => {});
        }

        _showMediaContextMenu(clientX, clientY) {
            const tab = this._getActiveTab();
            const content = tab?.content;
            if (!content) return;

            this._hideContextMenu();
            if (!document?.createElement || !this.panel?.appendChild) return;

            const menu = document.createElement('div');
            menu.className = 'content-viewer-context-menu';
            const items = [];
            if (content.type === 'image') {
                items.push({
                    command: 'toggle-fit',
                    label: content.imageDisplayMode === 'original' ? 'Fit To Panel' : 'Show Original Size'
                });
            }
            items.push({ command: 'open', label: 'Open Externally' });
            if (content.filePath) {
                items.push({ command: 'reveal', label: 'Reveal In Folder' });
            }

            menu.innerHTML = items
                .map(item => `<button type="button" class="content-viewer-context-item" data-media-command="${this._attr(item.command)}">${this._esc(item.label)}</button>`)
                .join('');

            menu.addEventListener('click', (event) => {
                const button = event.target?.closest?.('[data-media-command]');
                if (!button) return;
                event.preventDefault();
                this._handleMediaCommand(button.dataset.mediaCommand);
                this._hideContextMenu();
            });

            this.panel.appendChild(menu);
            this.contextMenu = menu;

            if (typeof menu.getBoundingClientRect !== 'function' || typeof this.panel.getBoundingClientRect !== 'function') {
                menu.style.left = '8px';
                menu.style.top = '44px';
                return;
            }

            const panelRect = this.panel.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const left = Math.max(8, Math.min(clientX - panelRect.left, panelRect.width - menuRect.width - 8));
            const top = Math.max(44, Math.min(clientY - panelRect.top, panelRect.height - menuRect.height - 8));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        }

        _hideContextMenu() {
            if (!this.contextMenu) return;
            if (typeof this.contextMenu.remove === 'function') {
                this.contextMenu.remove();
            } else if (this.contextMenu.parentNode?.removeChild) {
                this.contextMenu.parentNode.removeChild(this.contextMenu);
            }
            this.contextMenu = null;
        }

        _describeTarget(target) {
            const normalizedTarget = String(target || '').trim();
            const normalizedPath = this._filePathFromTarget(normalizedTarget).toLowerCase();
            const ext = (normalizedPath.split('.').pop() || '').toLowerCase();
            const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
            const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'];
            const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'];
            const documentExts = ['pdf'];
            const markdownExts = ['md', 'markdown'];
            const textExts = ['txt', 'log', 'csv'];
            const codeExts = ['js', 'cjs', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'py', 'ps1', 'sh'];

            if (imageExts.includes(ext)) return { mediaKind: 'image', viewerType: 'image', language: ext };
            if (videoExts.includes(ext)) return { mediaKind: 'video', viewerType: 'video', language: ext };
            if (audioExts.includes(ext)) return { mediaKind: 'audio', viewerType: 'audio', language: ext };
            if (documentExts.includes(ext)) return { mediaKind: 'document', viewerType: 'document', language: ext };
            if (markdownExts.includes(ext)) return { mediaKind: 'text', viewerType: 'markdown', language: ext };
            if (textExts.includes(ext)) return { mediaKind: 'text', viewerType: 'text', language: ext };
            if (codeExts.includes(ext)) return { mediaKind: 'code', viewerType: 'code', language: ext };
            return { mediaKind: '', viewerType: 'file', language: ext };
        }

        _serializeTab(tab) {
            if (!tab?.content) return null;
            const content = tab.content;
            const safe = {
                type: content.type,
                title: tab.title || content.title || '',
                filePath: content.filePath || '',
                url: content.url || '',
                language: content.language || '',
                imageDisplayMode: content.imageDisplayMode || '',
                sourceAgentId: content.sourceAgentId || tab.sourceAgentId || null,
                sourceSessionId: content.sourceSessionId || tab.sourceSessionId || null
            };

            const hasRestorableTarget = Boolean(safe.filePath || safe.url);
            const isRestorableType = ['image', 'video', 'audio', 'document', 'url', 'file', 'code', 'text', 'markdown'].includes(safe.type);
            if (!hasRestorableTarget || !isRestorableType) {
                return null;
            }
            return safe;
        }

        async _persistState() {
            if (!window.electronAPI?.saveSetting) return;
            const tabs = [...this.tabs.values()]
                .map(tab => this._serializeTab(tab))
                .filter(Boolean);
            const payload = {
                mode: this.mode,
                activeIndex: Math.max(0, [...this.tabs.keys()].indexOf(this.activeTabId)),
                tabs
            };
            try {
                await window.electronAPI.saveSetting(ContentViewer.SETTINGS_STATE_KEY, JSON.stringify(payload));
            } catch (_) {}
        }

        async _restorePersistedState() {
            if (!window.electronAPI?.getSettingValue && !window.electronAPI?.getSetting) return;
            try {
                const raw = await (window.electronAPI.getSettingValue
                    ? window.electronAPI.getSettingValue(ContentViewer.SETTINGS_STATE_KEY)
                    : window.electronAPI.getSetting(ContentViewer.SETTINGS_STATE_KEY));
                if (!raw) return;

                const parsed = JSON.parse(raw);
                const savedTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
                if (!savedTabs.length) return;

                if (parsed.mode === ContentViewer.MODE_MULTI || parsed.mode === ContentViewer.MODE_SINGLE) {
                    this.mode = parsed.mode;
                    if (this.modeSelect) this.modeSelect.value = this.mode;
                    localStorage.setItem(ContentViewer.STORAGE_MODE_KEY, this.mode);
                }

                this.tabs.clear();
                this.activeTabId = null;

                for (const saved of savedTabs) {
                    const restored = this._normalizeContent(saved);
                    if (!restored?.type) continue;
                    const id = this._nextTabId();
                    const icon = restored.icon || this._iconForType(restored.type);
                    const title = saved.title || restored.title || this._titleForContent(restored);
                    this.tabs.set(id, {
                        id,
                        title,
                        icon,
                        type: restored.type,
                        content: restored,
                        sourceAgentId: restored.sourceAgentId || null,
                        sourceSessionId: restored.sourceSessionId || null
                    });
                }

                const keys = [...this.tabs.keys()];
                if (!keys.length) {
                    this._renderTabs();
                    this._renderBody();
                    return;
                }

                const activeIndex = Number.isInteger(parsed?.activeIndex) ? parsed.activeIndex : 0;
                this.activeTabId = keys[Math.max(0, Math.min(activeIndex, keys.length - 1))];
                this._renderTabs();
                this._renderBody();
                this._ensureTabContentLoaded(this.activeTabId);
            } catch (_) {}
        }

        _ensureTabContentLoaded(tabId) {
            const tab = this.tabs.get(tabId);
            if (!tab?.content?.filePath) return;
            if (!['code', 'text', 'markdown'].includes(tab.content.type)) return;
            if (tab.content.text) return;
            if (!window.electronAPI?.readFileContent) return;

            window.electronAPI.readFileContent(tab.content.filePath).then(text => {
                const currentTab = this.tabs.get(tabId);
                if (!currentTab) return;
                currentTab.content.text = text;
                if (this.activeTabId === tabId) {
                    this._renderBody();
                }
            }).catch(() => {});
        }

        _isFileTarget(value) {
            return window.LocalAgentContentViewerUtils?.isFileTarget?.(value)
                || /^(file:\/\/|[a-zA-Z]:[\\/]|\\\\|\/)/.test(String(value || '').trim());
        }

        _filePathFromTarget(value) {
            const delegated = window.LocalAgentContentViewerUtils?.filePathFromTarget?.(value);
            if (delegated !== undefined) return delegated;
            const clean = String(value || '').trim();
            if (!clean.startsWith('file://')) return clean;
            try {
                const parsed = new URL(clean);
                const decodedPath = decodeURIComponent(parsed.pathname || '');
                return parsed.hostname && parsed.hostname !== 'localhost'
                    ? `\\\\${parsed.hostname}${decodedPath.replace(/\//g, '\\')}`
                    : decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
            } catch {
                return clean.replace(/^file:\/+/, '');
            }
        }

        _fileUrlFromPath(value) {
            const delegated = window.LocalAgentContentViewerUtils?.fileUrlFromPath?.(value);
            if (delegated !== undefined) return delegated;
            const clean = String(value || '').trim();
            if (!clean || clean.startsWith('file://')) return clean;
            const normalized = clean.replace(/\\/g, '/');
            if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
            if (normalized.startsWith('//')) return `file://${normalized.slice(2)}`;
            return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
        }

        _attr(text) {
            return window.LocalAgentContentViewerUtils?.attr?.(text)
                || String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        _esc(text) {
            const delegated = window.LocalAgentContentViewerUtils?.esc?.(text);
            if (delegated !== undefined) return delegated;
            const div = document.createElement('div');
            div.textContent = String(text ?? '');
            return div.innerHTML;
        }

        _basicMarkdown(text) {
            return window.LocalAgentContentViewerUtils?.basicMarkdown?.(text)
                || String(text || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/\n/g, '<br>');
        }
    }
    window.ContentViewer = ContentViewer;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.contentViewer = new ContentViewer();
        });
    } else {
        window.contentViewer = new ContentViewer();
    }
})();
