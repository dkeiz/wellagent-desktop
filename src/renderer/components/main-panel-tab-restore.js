(function () {
    async function resolveRestoreTabIds(settings, deps) {
        const {
            isPersistableChatSession
        } = deps;
        const openTabsRaw = settings?.open_chat_tabs;
        if (openTabsRaw) {
            try {
                const parsed = JSON.parse(openTabsRaw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            } catch (error) {
                // Fall through to current/recents recovery.
            }
        }

        const candidates = [];
        if (settings?.current_session_id != null) candidates.push(settings.current_session_id);
        if (settings?.active_chat_tab != null) candidates.push(settings.active_chat_tab);

        try {
            const recentSessions = await window.electronAPI.getChatSessions(null, 6);
            for (const session of (Array.isArray(recentSessions) ? recentSessions : [])) {
                if (session?.id != null) candidates.push(session.id);
            }
        } catch (error) {
            console.warn('Failed to load recent chat sessions during restore:', error);
        }

        const seen = new Set();
        for (const candidate of candidates) {
            const key = String(candidate || '').trim();
            if (!key || seen.has(key) || !isPersistableChatSession(candidate)) {
                continue;
            }
            seen.add(key);
            try {
                const meta = await window.electronAPI.getChatSessionMeta(candidate);
                if (meta?.id != null) {
                    return [meta.id];
                }
            } catch (error) {
                console.warn('Failed to validate restored chat session candidate:', error);
            }
        }

        const session = await window.electronAPI.createChatSession();
        return [session.id];
    }

    async function autoTitleTab(panel, sessionId) {
        try {
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            const firstUserMessage = conversations.find(conversation => conversation.role === 'user');
            if (!firstUserMessage) {
                return;
            }
            const title = firstUserMessage.content.substring(0, 30)
                + (firstUserMessage.content.length > 30 ? '…' : '');
            const tab = panel.chatTabs.get(sessionId);
            if (tab) {
                tab.title = title;
            }
        } catch (error) {
            console.error('Error auto-titling tab:', error);
        }
    }

    async function restoreOpenTabs(panel, deps) {
        const {
            createTabState,
            emitActiveTabChanged,
            loadTabConversations,
            newChat,
            nextRegularChatTitle,
            renderAgentPanel,
            renderTabs,
            resolveSessionAgentId,
            resolveTabKey,
            saveOpenTabIds
        } = deps;

        try {
            const settings = await window.electronAPI.getSettings();
            const activeRaw = settings?.active_chat_tab;
            const currentSessionId = settings?.current_session_id != null ? String(settings.current_session_id) : null;
            const tabIds = await resolveRestoreTabIds(settings, deps);
            const regularTabIds = [];
            for (const sessionId of tabIds) {
                await window.electronAPI.loadChatSession(sessionId);
                if (deps.isPersistableChatSession(sessionId) && !regularTabIds.some(id => String(id) === String(sessionId))) {
                    regularTabIds.push(sessionId);
                }
            }
            if (regularTabIds.length === 0) {
                const session = await window.electronAPI.createChatSession();
                regularTabIds.push(session.id);
            }
            for (let index = 0; index < regularTabIds.length; index++) {
                const sessionId = regularTabIds[index];
                const agentId = await resolveSessionAgentId(sessionId);
                if (agentId) {
                    let agent = null;
                    try {
                        agent = await window.electronAPI?.agents?.get?.(agentId);
                    } catch (error) {
                        console.warn('Failed to load restored agent:', error);
                    }
                    panel.chatTabs.set(sessionId, createTabState({
                        title: agent?.name || `Agent ${agentId}`,
                        agentId,
                        agentType: agent?.type || null,
                        agentIcon: agent?.icon || '🤖',
                        uiMode: 'plugin'
                    }));
                } else {
                    panel.chatTabs.set(sessionId, createTabState({
                        title: nextRegularChatTitle(panel)
                    }));
                }
            }
            const activeFromSettings = activeRaw != null ? String(activeRaw) : null;
            const activeId = regularTabIds.find(id => String(id) === String(activeFromSettings))
                || regularTabIds.find(id => String(id) === String(currentSessionId))
                || null;
            panel.activeTabId = (activeId && resolveTabKey(panel, activeId) !== null)
                ? resolveTabKey(panel, activeId)
                : regularTabIds[0];
            emitActiveTabChanged(panel);
            await loadTabConversations(panel, panel.activeTabId);
            await renderAgentPanel(panel, panel.activeTabId);
            await window.electronAPI.switchChatSession(panel.activeTabId);
            await panel.calculateContextUsage(panel.activeTabId);
            for (const sessionId of regularTabIds) {
                await autoTitleTab(panel, sessionId);
            }
            renderTabs(panel);
            await saveOpenTabIds(panel);
        } catch (error) {
            console.error('Error restoring tabs:', error);
            await newChat(panel);
        }
    }

    window.LocalAgentMainPanelTabRestore = {
        autoTitleTab,
        restoreOpenTabs
    };
})();
