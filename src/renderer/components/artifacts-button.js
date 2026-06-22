(function () {
    const ARTIFACT_TAB_PREFIX = 'artifact:';
    const docsByTabId = new Map();

    function formatSize(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isArtifactTabId(tabId) {
        return String(tabId || '').startsWith(ARTIFACT_TAB_PREFIX);
    }

    function getActiveSessionId() {
        return window.localAgentRendererShell?.getMainPanel?.()?.activeTabId || window.mainPanel?.activeTabId || null;
    }

    function buildPopover() {
        const popover = document.createElement('div');
        popover.className = 'artifacts-popover hidden';
        popover.id = 'artifacts-popover';
        popover.innerHTML = `
            <div class="artifacts-popover-title" id="artifacts-popover-title">Artifacts</div>
            <div class="artifacts-popover-list" id="artifacts-popover-list"></div>
            <div class="artifacts-popover-empty hidden" id="artifacts-popover-empty">No artifacts in this conversation yet.</div>
        `;
        return popover;
    }

    function fileUrl(absolutePath) {
        const normalized = String(absolutePath || '').replace(/\\/g, '/');
        return `file:///${encodeURI(normalized).replace(/#/g, '%23')}`;
    }

    function getArtifactTabId(sessionId, fileName) {
        return `${ARTIFACT_TAB_PREFIX}${sessionId}:${encodeURIComponent(String(fileName || ''))}`;
    }

    function renderArtifactDocHtml(doc, tabTitle = '') {
        if (!doc) return '<div class="artifacts-empty">Artifact is unavailable.</div>';
        const name = escapeHtml(doc.name || tabTitle || 'Artifact');
        const meta = `${name} • ${formatSize(doc.size)}`;
        if (doc.kind === 'text') {
            const value = escapeHtml(doc.editedContent ?? doc.content ?? '');
            return `
                <div class="artifacts-doc-meta">${meta}</div>
                <textarea class="artifacts-editor" data-artifact-editor>${value}</textarea>
                <div class="artifacts-doc-actions">
                    <button type="button" class="compact-btn" data-artifact-save ${doc.dirty ? '' : 'disabled'}>Save</button>
                </div>
            `;
        }
        if (doc.kind === 'image') {
            return `
                <div class="artifacts-doc-meta">${meta}</div>
                <div class="artifacts-media-wrap"><img class="artifacts-image" src="${fileUrl(doc.path)}" alt="${name}"></div>
            `;
        }
        if (doc.kind === 'audio') {
            return `
                <div class="artifacts-doc-meta">${meta}</div>
                <audio class="artifacts-media" controls src="${fileUrl(doc.path)}"></audio>
            `;
        }
        if (doc.kind === 'video') {
            return `
                <div class="artifacts-doc-meta">${meta}</div>
                <video class="artifacts-media" controls src="${fileUrl(doc.path)}"></video>
            `;
        }
        return `
            <div class="artifacts-doc-meta">${meta}</div>
            <div class="artifacts-binary-note">Preview is not supported for this file type.</div>
        `;
    }

    function bindArtifactEditor(panel, tabId, refreshArtifactsState) {
        const doc = docsByTabId.get(tabId);
        const container = document.getElementById('messages-container');
        if (!doc || !container || !doc.kind || doc.kind !== 'text') return;

        const editor = container.querySelector('[data-artifact-editor]');
        const saveBtn = container.querySelector('[data-artifact-save]');
        if (editor) {
            editor.addEventListener('input', () => {
                doc.editedContent = editor.value;
                doc.dirty = doc.editedContent !== doc.content;
                if (saveBtn) saveBtn.disabled = !doc.dirty;
                const tab = panel.chatTabs.get(tabId);
                if (tab) {
                    tab.title = `${doc.name}${doc.dirty ? '*' : ''}`;
                    if (typeof panel.renderTabs === 'function') panel.renderTabs();
                }
            });
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (!doc.dirty) return;
                const result = await window.electronAPI.writeSessionArtifact(doc.sessionId, doc.name, doc.editedContent || '');
                if (!result?.success) {
                    window.mainPanel?.showNotification?.(result?.error || 'Failed to save artifact', 'error');
                    return;
                }
                doc.content = doc.editedContent || '';
                doc.size = Number(result.size || doc.size || 0);
                doc.dirty = false;
                const tab = panel.chatTabs.get(tabId);
                if (tab) {
                    tab.title = doc.name;
                    tab.messagesHTML = renderArtifactDocHtml(doc, tab.title);
                }
                if (saveBtn) saveBtn.disabled = true;
                if (typeof panel.renderTabs === 'function') panel.renderTabs();
                window.mainPanel?.showNotification?.('Artifact saved');
                await refreshArtifactsState();
            });
        }
    }

    function installTabPatches(refreshArtifactsState) {
        const shell = window.localAgentRendererShell;
        if (!shell || shell.__artifactsPatched === true) return;
        shell.__artifactsPatched = true;

        shell.registerBridgeMethodWrapper('switchChatSession', 'artifacts', (originalSwitchChatSession) => async (sessionId) => {
            if (isArtifactTabId(sessionId)) return { success: true, skipped: true };
            return originalSwitchChatSession(sessionId);
        });

        shell.registerTabMethodWrapper('saveCurrentTabMessages', 'artifacts', (originalSaveCurrent) => function patchedSaveCurrent(p) {
            const activeId = p.activeTabId;
            const activeDoc = docsByTabId.get(activeId);
            if (activeDoc && activeDoc.kind === 'text') {
                const editor = document.querySelector('#messages-container [data-artifact-editor]');
                if (editor) {
                    activeDoc.editedContent = editor.value;
                    activeDoc.dirty = activeDoc.editedContent !== activeDoc.content;
                    const tab = p.chatTabs.get(activeId);
                    if (tab) {
                        tab.title = `${activeDoc.name}${activeDoc.dirty ? '*' : ''}`;
                        tab.messagesHTML = renderArtifactDocHtml(activeDoc, tab.title);
                    }
                }
            }
            return originalSaveCurrent(p);
        });

        shell.registerTabMethodWrapper('saveOpenTabIds', 'artifacts', () => async function patchedSaveOpen(p) {
            const ids = [...p.chatTabs.keys()].filter(id => (
                String(id) !== 'subagent-manager' &&
                String(id) !== 'superagent-manager' &&
                !isArtifactTabId(id)
            ));
            try {
                await window.electronAPI.saveSetting('open_chat_tabs', JSON.stringify(ids));
                if (p.activeTabId && !isArtifactTabId(p.activeTabId)) {
                    await window.electronAPI.saveSetting('active_chat_tab', p.activeTabId.toString());
                }
            } catch (error) {
                console.error('Error saving open tabs:', error);
            }
        });

        shell.registerTabMethodWrapper('switchTab', 'artifacts', (originalSwitchTab) => async function patchedSwitchTab(p, sessionId) {
            const targetTab = p.chatTabs.get(sessionId);
            const isArtifactTarget = Boolean(targetTab?.isArtifactTab);
            if (isArtifactTarget) {
                const doc = docsByTabId.get(sessionId);
                if (doc) {
                    targetTab.messagesHTML = renderArtifactDocHtml(doc, targetTab.title);
                }
            }
            await originalSwitchTab(p, sessionId);
            if (isArtifactTarget) {
                bindArtifactEditor(p, sessionId, refreshArtifactsState);
            }
        });

        shell.registerTabMethodWrapper('closeTab', 'artifacts', (originalCloseTab) => async function patchedCloseTab(p, sessionId) {
            await originalCloseTab(p, sessionId);
            if (isArtifactTabId(sessionId)) {
                docsByTabId.delete(sessionId);
            }
        });

        shell.registerPanelMethodWrapper('sendMessage', 'artifacts', (originalSendMessage) => async function patchedSendMessage() {
            const active = this.chatTabs.get(this.activeTabId);
            if (active?.isArtifactTab) {
                this.showNotification('Artifact tab is file-view mode. Switch to a chat tab to send messages.', 'info');
                return;
            }
            return originalSendMessage();
        });

        const tabsList = document.getElementById('chat-tabs-list');
        if (tabsList) {
            tabsList.addEventListener('click', (event) => {
                const resetBtn = event.target.closest('.chat-tab-reset');
                if (!resetBtn) return;
                const tabEl = resetBtn.closest('.chat-tab');
                const tabId = tabEl?.dataset?.sessionId;
                const panel = shell.getMainPanel?.();
                const tab = tabId ? panel?.chatTabs?.get?.(tabId) : null;
                if (tab?.isArtifactTab) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    shell.getTabApi?.()?.closeTab(panel, tabId);
                }
            }, true);
        }
    }

    async function initArtifactsButton() {
        const button = document.getElementById('artifacts-btn');
        if (!button || !window.electronAPI?.getSessionArtifacts) return;
        let refreshRequestId = 0;

        const popover = buildPopover();
        const titleEl = popover.querySelector('#artifacts-popover-title');
        const listEl = popover.querySelector('#artifacts-popover-list');
        const emptyEl = popover.querySelector('#artifacts-popover-empty');

        function resolveAnchor() {
            return button.parentElement || document.querySelector('.chat-provider-row');
        }

        function syncPopoverAnchor() {
            const anchor = resolveAnchor();
            if (anchor && popover.parentElement !== anchor) {
                anchor.appendChild(popover);
            }
        }

        syncPopoverAnchor();

        function closePopover() {
            popover.classList.add('hidden');
            button.setAttribute('aria-expanded', 'false');
        }

        function shouldRefreshForSession(sessionId) {
            const activeSessionId = getActiveSessionId();
            return !sessionId || !activeSessionId || sessionId === activeSessionId;
        }

        async function refreshArtifactsState() {
            const requestId = ++refreshRequestId;
            const sessionId = getActiveSessionId();
            const panel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel;
            const tab = sessionId ? panel?.chatTabs?.get?.(sessionId) : null;
            if (!sessionId || sessionId === 'subagent-manager' || sessionId === 'superagent-manager' || tab?.isArtifactTab) {
                button.classList.remove('has-artifacts');
                button.title = 'Artifacts (0 files for conversation)';
                return;
            }
            const result = await window.electronAPI.getSessionArtifacts(sessionId);
            if (requestId !== refreshRequestId || getActiveSessionId() !== sessionId) {
                return;
            }
            const files = Array.isArray(result?.files) ? result.files : [];
            button.classList.toggle('has-artifacts', files.length > 0);
            button.title = `Artifacts (${files.length} items for conversation)`;
            if (popover.classList.contains('hidden')) return;

            titleEl.textContent = `Artifacts (${files.length})`;
            if (!files.length) {
                listEl.innerHTML = '';
                emptyEl.classList.remove('hidden');
                return;
            }
            emptyEl.classList.add('hidden');
            listEl.innerHTML = files.map(file => {
                const nameStr = escapeHtml(file.name);
                const isVirtual = file.virtual === true;
                const isAccepted = file.accepted === true;
                const actionLabel = file.action === 'edited' ? '✏' : file.action === 'deleted' ? '🗑' : '';
                const sourceLabel = file.source ? `<span class="artifact-source">${escapeHtml(file.source)}</span>` : '';
                const acceptedClass = isAccepted ? ' accepted' : '';
                const virtualClass = isVirtual ? ' virtual' : '';
                const keyAttr = file.key ? `data-artifact-key="${escapeHtml(file.key)}"` : '';
                return `<div class="artifacts-popover-item${acceptedClass}${virtualClass}" ${keyAttr} data-artifact-name="${nameStr}" data-artifact-virtual="${isVirtual}" title="${nameStr}">
                    <span class="artifact-item-name">${actionLabel}${nameStr}</span>
                    ${sourceLabel}
                    <span class="artifact-item-actions">
                        <button type="button" class="artifact-action-btn artifact-accept-btn${isAccepted ? ' active' : ''}" data-action="accept" title="Accept">✓</button>
                        <button type="button" class="artifact-action-btn artifact-clean-btn" data-action="clean" title="Clean">✕</button>
                    </span>
                </div>`;
            }).join('');

            listEl.querySelectorAll('.artifact-action-btn').forEach(btn => {
                btn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const action = btn.dataset.action;
                    const row = btn.closest('.artifacts-popover-item');
                    const artifactKey = row?.dataset?.artifactKey || '';
                    const currentSessionId = getActiveSessionId();
                    if (!currentSessionId || !artifactKey) return;
                    if (action === 'accept') {
                        await window.electronAPI.acceptArtifact(currentSessionId, artifactKey);
                        btn.classList.add('active');
                        row.classList.add('accepted');
                    } else if (action === 'clean') {
                        await window.electronAPI.cleanArtifact(currentSessionId, artifactKey);
                        row.remove();
                        const remaining = listEl.querySelectorAll('.artifacts-popover-item');
                        if (!remaining.length) {
                            emptyEl.classList.remove('hidden');
                            button.classList.remove('has-artifacts');
                        }
                        titleEl.textContent = `Artifacts (${remaining.length})`;
                    }
                });
            });

            listEl.querySelectorAll('.artifacts-popover-item').forEach(item => {
                item.addEventListener('click', async (event) => {
                    if (event.target.closest('.artifact-action-btn')) return;
                    const panel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel;
                    if (!panel) return;
                    const currentSessionId = getActiveSessionId();
                    if (!currentSessionId || isArtifactTabId(currentSessionId)) return;
                    const isVirtual = item.dataset.artifactVirtual === 'true';
                    if (isVirtual) return;
                    const fileName = item.dataset.artifactName || '';
                    const read = await window.electronAPI.readSessionArtifact(currentSessionId, fileName);
                    if (!read?.success) {
                        panel.showNotification?.(read?.error || 'Failed to open artifact', 'error');
                        return;
                    }

                    const tabId = getArtifactTabId(currentSessionId, read.name);
                    docsByTabId.set(tabId, {
                        sessionId: currentSessionId,
                        name: read.name,
                        kind: read.kind || 'binary',
                        path: read.path || '',
                        size: Number(read.size || 0),
                        content: typeof read.content === 'string' ? read.content : '',
                        editedContent: typeof read.content === 'string' ? read.content : '',
                        dirty: false
                    });

                    if (!panel.chatTabs.has(tabId)) {
                        panel.saveCurrentTabMessages?.();
                        panel.chatTabs.set(tabId, {
                            title: read.name,
                            agentIcon: '🗂',
                            isArtifactTab: true,
                            messagesHTML: renderArtifactDocHtml(docsByTabId.get(tabId), read.name),
                            isSending: false,
                            loadingId: null,
                            scrollTop: 0,
                            followOutput: true
                        });
                        panel.renderTabs?.();
                        panel.saveOpenTabIds?.();
                    }

                    installTabPatches(refreshArtifactsState);
                    await window.localAgentRendererShell?.getTabApi?.()?.switchTab(panel, tabId);
                    bindArtifactEditor(panel, tabId, refreshArtifactsState);
                    closePopover();
                });
            });
        }

        button.addEventListener('click', async (event) => {
            event.preventDefault();
            syncPopoverAnchor();
            const willOpen = popover.classList.contains('hidden');
            if (willOpen) {
                await refreshArtifactsState();
                popover.classList.remove('hidden');
                button.setAttribute('aria-expanded', 'true');
            } else {
                closePopover();
            }
        });

        document.addEventListener('click', (event) => {
            if (popover.classList.contains('hidden')) return;
            const target = event.target;
            if (popover.contains(target) || button.contains(target)) return;
            closePopover();
        });

        document.addEventListener('chat-tab-switched', async (event) => {
            const tabId = event?.detail?.sessionId;
            const panel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel;
            const tab = tabId ? panel?.chatTabs?.get?.(tabId) : null;
            if (tab?.isArtifactTab) {
                bindArtifactEditor(panel, tabId, refreshArtifactsState);
            }
            await refreshArtifactsState();
        });

        if (window.electronAPI.onConversationUpdate) {
            window.electronAPI.onConversationUpdate(async (_event, detail = {}) => {
                if (!shouldRefreshForSession(detail?.sessionId)) return;
                await refreshArtifactsState();
            });
        }

        if (window.electronAPI.onArtifactUpdate) {
            window.electronAPI.onArtifactUpdate(async (_event, detail = {}) => {
                if (!shouldRefreshForSession(detail?.sessionId)) return;
                await refreshArtifactsState();
            });
        }

        installTabPatches(refreshArtifactsState);
        await refreshArtifactsState();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const maxAttempts = 80;
        let attempt = 0;
        const timer = setInterval(() => {
            attempt += 1;
            if (window.localAgentRendererShell?.getMainPanel?.() && window.localAgentRendererShell?.getTabApi?.()) {
                clearInterval(timer);
                initArtifactsButton().catch(error => {
                    console.error('Failed to initialize artifacts button:', error);
                });
                return;
            }
            if (attempt >= maxAttempts) {
                clearInterval(timer);
            }
        }, 100);
    });
})();
