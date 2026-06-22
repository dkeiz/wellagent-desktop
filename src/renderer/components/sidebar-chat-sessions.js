(function () {
    function resolvePanelTabKey(panel, sessionId) {
        if (!panel?.chatTabs || sessionId === null || sessionId === undefined) {
            return null;
        }
        if (panel.chatTabs.has(sessionId)) {
            return sessionId;
        }
        return [...panel.chatTabs.keys()].find(key => String(key) === String(sessionId)) ?? null;
    }

    function createSidebarChatTabState(title = 'Chat') {
        return {
            title,
            messagesHTML: '',
            isSending: false,
            loadingId: null,
            scrollTop: 0,
            followOutput: true,
            uiMode: 'plugin',
            uiPluginId: null,
            needsReload: false,
            hasUnread: false,
            interruptionState: null,
            hasChanges: false
        };
    }

    async function loadChatSessions(date = null) {
        try {
            let sessions = await window.electronAPI.getChatSessions(null, 6);
            if (date) {
                const dateSessions = await window.electronAPI.getChatSessions(date, 100);
                if (dateSessions.length > 0) sessions = dateSessions.slice(0, 6);
            }
            let activityMetaChanged = false;

            const container = document.getElementById('chat-sessions-list');
            if (!container) return;
            container.replaceChildren();

            if (sessions.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'no-sessions';
                empty.textContent = 'No chats';
                container.appendChild(empty);
                return;
            }

            sessions.forEach((session) => {
                activityMetaChanged = this.rememberSessionMeta(session) || activityMetaChanged;
                const preview = session.first_message
                    ? (session.first_message.length > 15 ? `${session.first_message.substring(0, 15)}...` : session.first_message)
                    : 'Empty';
                const time = new Date(session.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                const item = document.createElement('div');
                item.className = 'chat-session-compact nav-btn';
                item.dataset.sessionId = String(session.id);
                item.title = session.first_message || 'Empty chat';

                const timeEl = document.createElement('span');
                timeEl.className = 'session-time';
                timeEl.textContent = time;
                item.appendChild(timeEl);

                const previewEl = document.createElement('span');
                previewEl.className = 'session-preview';
                previewEl.textContent = preview;
                item.appendChild(previewEl);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-session-btn';
                deleteBtn.dataset.sessionId = String(session.id);
                deleteBtn.title = 'Delete chat';
                deleteBtn.textContent = '\u00d7';
                item.appendChild(deleteBtn);

                const rawSessionId = item.dataset.sessionId;
                const sessionId = /^\d+$/.test(rawSessionId) ? parseInt(rawSessionId, 10) : rawSessionId;

                item.addEventListener('click', (event) => {
                    if (event.target.classList.contains('delete-session-btn')) return;
                    this.loadSession(sessionId);
                });

                deleteBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.deleteSession(sessionId);
                });

                container.appendChild(item);
            });

            if (activityMetaChanged && this.toolActivity?.length > 0) {
                this.updateToolIndicators();
            }
        } catch (error) {
            console.error('Error loading chat sessions:', error);
        }
    }

    async function loadSession(sessionId) {
        try {
            if (window.app && window.app.mainPanel) {
                const mainPanel = window.app.mainPanel;
                const existingKey = this.resolvePanelTabKey(mainPanel, sessionId);
                if (existingKey !== null) {
                    await mainPanel.switchTab(existingKey);
                    this.switchTab('chat');
                    return;
                }

                mainPanel.saveCurrentTabMessages();
                mainPanel.chatTabs.set(sessionId, this.createSidebarChatTabState('Chat'));
                mainPanel.activeTabId = sessionId;
                await mainPanel.loadTabConversations(sessionId);
                await mainPanel.autoTitleTab(sessionId);
                const activityMetaChanged = this.captureSessionMetaFromPanel(sessionId);
                mainPanel.renderTabs();
                await mainPanel.saveOpenTabIds();
                await window.electronAPI.switchChatSession(sessionId);
                await mainPanel.calculateContextUsage();
                if (activityMetaChanged && this.toolActivity?.length > 0) {
                    this.updateToolIndicators();
                }
            }

            this.switchTab('chat');
        } catch (error) {
            console.error('Error loading session:', error);
        }
    }

    async function deleteSession(sessionId) {
        if (!confirm('Delete this chat? This cannot be undone.')) return;
        try {
            await window.electronAPI.deleteChatSession(sessionId);
            const mainPanel = window.app?.mainPanel || window.mainPanel;
            const tabKey = this.resolvePanelTabKey(mainPanel, sessionId);
            if (tabKey !== null) {
                const wasActive = String(mainPanel.activeTabId) === String(tabKey);
                mainPanel.chatTabs.delete(tabKey);
                if (wasActive) {
                    const remaining = [...mainPanel.chatTabs.keys()];
                    if (remaining.length > 0) {
                        await mainPanel.switchTab(remaining[remaining.length - 1]);
                    } else {
                        const freshSession = await window.electronAPI.createChatSession();
                        const freshSessionId = freshSession.id;
                        mainPanel.chatTabs.set(freshSessionId, this.createSidebarChatTabState('New Chat'));
                        mainPanel.activeTabId = freshSessionId;
                        const container = document.getElementById('messages-container');
                        if (container) container.innerHTML = '';
                        mainPanel.updateContextUsage?.(null);
                        await window.electronAPI.switchChatSession(freshSessionId);
                    }
                }
                mainPanel.renderTabs?.();
                await mainPanel.saveOpenTabIds?.();
            }
            await this.loadChatSessions();
        } catch (error) {
            console.error('Error deleting session:', error);
        }
    }

    window.SidebarChatSessionMethods = {
        resolvePanelTabKey,
        createSidebarChatTabState,
        loadChatSessions,
        loadSession,
        deleteSession
    };
})();

