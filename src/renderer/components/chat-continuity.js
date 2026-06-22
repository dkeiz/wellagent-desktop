(function () {
    function getTab(panel, sessionId) {
        if (!panel || !sessionId) return null;
        return panel.chatTabs?.get?.(sessionId) || null;
    }

    function getMessagesContainer() {
        return document.getElementById('messages-container');
    }

    function scheduleBottomRestore(panel, container) {
        const apply = () => {
            container.scrollTop = container.scrollHeight;
        };
        apply();
        const schedule = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
        schedule(() => {
            apply();
            schedule(() => {
                apply();
                panel._storeActiveTabScrollState?.();
            });
        });
    }

    function markInterrupted(tab, type, reason) {
        if (!tab) return;
        tab.interruptionState = {
            type,
            reason: String(reason || '').trim() || 'Interrupted',
            at: new Date().toISOString()
        };
    }

    function clearInterrupted(tab) {
        if (!tab) return;
        tab.interruptionState = null;
    }

    function decorateSourceMessage(messageId, role, metadata) {
        if (role !== 'user' || !metadata || typeof metadata !== 'object') return;
        const label = String(metadata.sourceLabel || metadata.clientSource || '').trim();
        if (!label) return;
        const messageDiv = document.getElementById(messageId);
        if (!messageDiv || messageDiv.querySelector('.message-source-chip')) return;
        messageDiv.dataset.clientSource = String(metadata.clientSource || '').trim().toLowerCase();
        const chip = document.createElement('div');
        chip.className = 'message-source-chip';
        chip.textContent = label;
        messageDiv.prepend(chip);
    }

    function patchMessageRenderer() {
        window.localAgentRendererShell?.registerPanelMethodWrapper('addMessage', 'chat-continuity', (originalAddMessage) => function wrappedAddMessage(role, content, style, metadata = null) {
            const messageId = originalAddMessage(role, content, style);
            decorateSourceMessage(messageId, role, metadata);
            return messageId;
        });
    }

    function patchTabLoader() {
        window.localAgentRendererShell?.registerTabMethodWrapper('loadTabConversations', 'chat-continuity', () => async (panel, sessionId) => {
            let deferredScrollStore = false;
            try {
                const conversations = await window.electronAPI.loadChatSession(sessionId);
                const container = getMessagesContainer();
                if (!container) return;
                panel._suspendMessageAutoscroll = true;
                container.innerHTML = '';
                conversations.forEach((conversation) => {
                    panel.addMessage(conversation.role, conversation.content, null, conversation.metadata || null);
                });
                const tab = getTab(panel, sessionId);
                if (tab && tab.followOutput === false && typeof tab.scrollTop === 'number') {
                    container.scrollTop = tab.scrollTop;
                } else {
                    deferredScrollStore = true;
                    scheduleBottomRestore(panel, container);
                }
            } catch (error) {
                console.error('Error loading tab conversations:', error);
            } finally {
                panel._suspendMessageAutoscroll = false;
                if (!deferredScrollStore) {
                    panel._storeActiveTabScrollState?.();
                }
            }
        });
    }

    async function refreshActiveTab(panel, sessionId) {
        const tab = getTab(panel, sessionId);
        await panel.loadTabConversations?.(sessionId);
        if (tab) {
            tab.needsReload = false;
            tab.hasUnread = false;
        }
        panel.saveCurrentTabMessages?.();
        await panel.calculateContextUsage?.(sessionId);
        panel.renderTabs?.();
    }

    function install() {
        if (!window.mainPanel || !window.electronAPI || window.__chatContinuityInstalled) {
            return;
        }
        window.__chatContinuityInstalled = true;
        const panel = window.mainPanel;
        patchMessageRenderer();
        patchTabLoader();

        window.localAgentRendererShell?.registerBridgeMethodWrapper('sendMessage', 'chat-continuity', (originalSendMessage) => async (message, sessionId) => {
            const tab = getTab(panel, sessionId);
            if (tab && String(message || '').trim()) {
                tab.hasChanges = true;
            }
            try {
                const response = await originalSendMessage(message, sessionId);
                if (tab) {
                    if (response?.stopped) {
                        markInterrupted(tab, 'manual_stop', 'Generation was stopped');
                    } else if (response?.chainExhausted) {
                        markInterrupted(tab, 'chain_exhausted', 'Chain exhausted before completion');
                    } else {
                        clearInterrupted(tab);
                    }
                }
                return response;
            } catch (error) {
                const tab = getTab(panel, sessionId);
                markInterrupted(tab, 'error', error?.message || 'Generation failed');
                throw error;
            } finally {
                const activeSessionId = sessionId || panel.activeTabId;
                const activeTab = getTab(panel, activeSessionId);
                if (activeTab?.needsReload && String(activeSessionId) === String(panel.activeTabId)) {
                    activeTab.needsReload = false;
                }
            }
        });

        window.electronAPI.onConversationUpdate((event, data) => {
            const sessionId = data?.sessionId ?? panel.activeTabId;
            if (!sessionId) return;
            const tab = getTab(panel, sessionId);
            if (!tab) return;
            tab.hasChanges = true;
            Promise.resolve(panel.autoTitleTab?.(sessionId)).catch((error) => {
                console.warn('Failed to refresh chat tab title after update:', error);
            });
            if (String(sessionId) === String(panel.activeTabId) && (tab.isSending || panel.isSending)) {
                tab.needsReload = true;
                return;
            }
            if (String(sessionId) !== String(panel.activeTabId)) {
                tab.needsReload = true;
                tab.hasUnread = true;
                panel.renderTabs?.();
                return;
            }
            Promise.resolve()
                .then(() => refreshActiveTab(panel, sessionId))
                .catch((error) => {
                    console.error('Failed to refresh active chat after conversation update:', error);
                });
        });

        const stopBtn = document.getElementById('stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                const tab = getTab(panel, panel.activeTabId);
                markInterrupted(tab, 'manual_stop', 'Stopped by user');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const maxAttempts = 80;
        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            if (window.mainPanel) {
                clearInterval(timer);
                install();
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(timer);
            }
        }, 100);
    });
})();
