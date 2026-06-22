(function () {
    const SUBAGENT_MANAGER_TAB_ID = 'subagent-manager';
    const SUPERAGENT_MANAGER_TAB_ID = 'superagent-manager';
    const SHARED_CHAT_MOUNT_KEY = '__agentSharedChatMountState';
    function getMessagesContainer() {
        return document.getElementById('messages-container');
    }
    function ensureSharedChatMountState() {
        if (window[SHARED_CHAT_MOUNT_KEY]) {
            return window[SHARED_CHAT_MOUNT_KEY];
        }
        const nodes = [
            document.getElementById('messages-container')
        ].filter(Boolean);
        const placements = nodes.map(node => ({
            node,
            parent: node.parentElement,
            nextSibling: node.nextSibling,
            placeholder: null
        }));
        const state = { placements, mountedHost: null };
        window[SHARED_CHAT_MOUNT_KEY] = state;
        return state;
    }
    function restoreSharedChatToDefault() {
        const state = window[SHARED_CHAT_MOUNT_KEY];
        if (!state) return;
        state.placements.forEach(item => {
            if (!item?.node || !item?.parent) return;
            if (item.nextSibling && item.nextSibling.parentElement === item.parent) {
                item.parent.insertBefore(item.node, item.nextSibling);
            } else {
                item.parent.appendChild(item.node);
            }
            if (item.placeholder?.parentElement) {
                item.placeholder.remove();
            }
            item.placeholder = null;
        });
        state.mountedHost = null;
    }
    function syncSharedChatMount(root) {
        const host = root?.querySelector?.('[data-agent-ui-chat-host]') || null;
        if (!host) {
            restoreSharedChatToDefault();
            return;
        }
        const state = ensureSharedChatMountState();
        if (state.mountedHost === host) return;
        state.placements.forEach(item => {
            if (!item?.node) return;
            if (!item.placeholder && item.parent) {
                const ph = document.createElement('div');
                ph.className = 'agent-shared-chat-placeholder';
                if (item.node.id === 'messages-container') {
                    ph.classList.add('agent-shared-chat-placeholder-messages');
                    ph.style.flex = '1 1 auto';
                    ph.style.minHeight = '0';
                }
                item.placeholder = ph;
            }
            if (item.parent && item.placeholder && !item.placeholder.parentElement) {
                if (item.nextSibling && item.nextSibling.parentElement === item.parent) {
                    item.parent.insertBefore(item.placeholder, item.nextSibling);
                } else {
                    item.parent.appendChild(item.placeholder);
                }
            }
            host.appendChild(item.node);
        });
        state.mountedHost = host;
    }
    function emitActiveTabChanged(panel) {
        const sessionId = panel?.activeTabId ?? null;
        const tab = (sessionId !== null && sessionId !== undefined)
            ? panel.chatTabs.get(sessionId)
            : null;
        window.localAgentRendererShell?.emit?.('active-tab-changed', {
            panel,
            sessionId,
            tab
        });
        document.dispatchEvent(new CustomEvent('chat-tab-switched', {
            detail: {
                sessionId,
                agentId: tab?.agentId ?? null
            }
        }));
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
    function getTabUiContext(panel, sessionId) {
        const tab = panel?.chatTabs?.get?.(sessionId) || {};
        return {
            sessionId,
            uiMode: tab.uiMode || 'plugin',
            uiPluginId: tab.uiPluginId || null
        };
    }
    function createTabState(overrides = {}) {
        return {
            messagesHTML: '', isSending: false, loadingId: null, scrollTop: 0, followOutput: true,
            uiMode: 'plugin', uiPluginId: null, needsReload: false, hasUnread: false,
            interruptionState: null, hasChanges: false,
            ...overrides
        };
    }
    function nextRegularChatTitle(panel) {
        const used = new Set([...panel.chatTabs.values()].map(tab => parseInt((/^Chat (\d+)$/.exec(tab?.title || '') || [])[1], 10)).filter(Number.isInteger)); let index = 1;
        while (used.has(index)) index += 1; return `Chat ${index}`;
    }
    function getAgentChatPanel() {
        let panel = document.getElementById('agent-chat-ui-panel');
        if (panel) return panel;
        const messages = getMessagesContainer();
        if (!messages?.parentElement) return null;
        panel = document.createElement('div');
        panel.id = 'agent-chat-ui-panel';
        panel.className = 'agent-chat-ui-panel';
        panel.hidden = true;
        messages.parentElement.insertBefore(panel, messages);
        return panel;
    }
    function updateAgentPanelStyle(css = '') {
        let styleEl = document.getElementById('agent-chat-ui-plugin-style');
        if (!css) {
            if (styleEl) styleEl.remove();
            return;
        }
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'agent-chat-ui-plugin-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    }
    function hydrateAgentCharts(root) {
        if (window.agentChartRenderer?.hydrate) {
            window.agentChartRenderer.hydrate(root);
        }
    }
    function activateAgentPanelTab(root, tabName) {
        root.querySelectorAll('[data-agent-ui-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.agentUiTab === tabName);
        });
        root.querySelectorAll('[data-agent-ui-section]').forEach(section => {
            section.hidden = section.dataset.agentUiSection !== tabName;
        });
    }
    function readActionPayload(element) {
        const payload = {};
        const rawPayload = element.dataset.agentUiPayload || element.dataset.pluginPayload || '';
        if (rawPayload) {
            try {
                Object.assign(payload, JSON.parse(rawPayload));
            } catch (error) {
                payload.rawPayload = rawPayload;
            }
        }
        for (const [key, value] of Object.entries(element.dataset || {})) {
            if (['agentUiAction', 'pluginAction', 'agentUiPayload', 'pluginPayload', 'agentUiBound', 'agentUiTabBound'].includes(key)) {
                continue;
            }
            payload[key] = value;
        }
        const pluginRoot = element.closest('[data-agent-ui-plugin-id]');
        if (pluginRoot?.dataset.agentUiPluginId) {
            payload.pluginId = pluginRoot.dataset.agentUiPluginId;
        }
        const form = element.tagName === 'FORM' ? element : element.closest('form');
        if (form) {
            const formData = new FormData(form);
            for (const [key, value] of formData.entries()) {
                if (payload[key] === undefined) payload[key] = value;
                else if (Array.isArray(payload[key])) payload[key].push(value);
                else payload[key] = [payload[key], value];
            }
        }
        return payload;
    }
    async function applyAgentActionResult(root, result, fallbackPluginId = '') {
        if (!result || result.success === false) {
            if (result?.error) console.warn('Agent UI action failed:', result.error);
            return;
        }
        if (result.css !== undefined) {
            updateAgentPanelStyle(result.css);
        }
        const pluginId = result.pluginId || fallbackPluginId;
        if (result.replaceHtml) {
            const replacements = Array.isArray(result.replaceHtml) ? result.replaceHtml : [result.replaceHtml];
            replacements.forEach(item => {
                const target = root.querySelector(item.selector);
                if (target) target.innerHTML = item.html || '';
            });
        }
        if (result.text) {
            const updates = Array.isArray(result.text) ? result.text : [result.text];
            updates.forEach(item => {
                const target = root.querySelector(item.selector);
                if (target) {
                    target.hidden = item.hidden === undefined ? false : Boolean(item.hidden);
                    target.textContent = item.text || '';
                }
            });
        }
        if (result.show) {
            root.querySelectorAll(result.show).forEach(target => { target.hidden = false; });
        }
        if (result.hide) {
            root.querySelectorAll(result.hide).forEach(target => { target.hidden = true; });
        }
        if (result.html !== undefined) {
            const wrapper = pluginId
                ? root.querySelector(`[data-agent-ui-plugin-id="${pluginId}"]`)
                : null;
            if (wrapper) wrapper.innerHTML = result.html;
            else root.innerHTML = result.html;
        }
        if (result.openSidebarTab && window.sidebar?.switchTab) {
            window.sidebar.switchTab(String(result.openSidebarTab));
        }
        if (result.openPluginStudio && window.electronAPI?.plugins?.openStudio) {
            try {
                await window.electronAPI.plugins.openStudio(result.openPluginStudio || {});
            } catch (error) {
                console.warn('Failed to open Plugin Studio from agent UI action:', error);
            }
        }
        syncSharedChatMount(root);
        hydrateAgentCharts(root);
    }
    async function sendAgentUiEvent(panel, sessionId, eventName) {
        const tab = panel.chatTabs.get(sessionId);
        if (!tab?.agentId || !window.electronAPI?.agents?.chatUIEvent) return;
        try {
            await window.electronAPI.agents.chatUIEvent(
                tab.agentId,
                eventName,
                { sessionId },
                getTabUiContext(panel, sessionId)
            );
        } catch (error) {
            console.warn(`Agent UI ${eventName} event failed:`, error);
        }
    }
    function bindAgentPanelActions(panel, root, agentId) {
        root.querySelectorAll('[data-agent-ui-tab]').forEach(button => {
            if (button.dataset.agentUiTabBound === 'true') return;
            button.dataset.agentUiTabBound = 'true';
            button.addEventListener('click', () => activateAgentPanelTab(root, button.dataset.agentUiTab));
        });
        root.querySelectorAll('[data-agent-ui-action], [data-plugin-action]').forEach(element => {
            if (element.dataset.agentUiBound === 'true') return;
            element.dataset.agentUiBound = 'true';
            const runAction = async (event) => {
                event.preventDefault();
                const action = element.dataset.agentUiAction || element.dataset.pluginAction;
                const payload = readActionPayload(element);
                const pluginId = payload.pluginId || '';
                try {
                    const result = await window.electronAPI.agents.runChatUIAction(
                        agentId,
                        action,
                        payload,
                        getTabUiContext(panel, panel.activeTabId)
                    );
                    await applyAgentActionResult(root, result, pluginId);
                    bindAgentPanelActions(panel, root, agentId);
                    if (window.researchOrchestratorUI?.hydrate) {
                        await window.researchOrchestratorUI.hydrate(panel, root, agentId);
                    }
                    if (result?.refresh === true) {
                        await renderAgentPanel(panel, panel.activeTabId);
                    }
                } catch (error) {
                    console.warn(`Agent UI action "${action}" failed:`, error);
                }
            };
            element.addEventListener(element.tagName === 'FORM' ? 'submit' : 'click', runAction);
        });
    }
    async function renderAgentPanel(panel, sessionId) {
        const root = getAgentChatPanel();
        if (!root) return;
        const tab = panel.chatTabs.get(sessionId);
        if (!tab?.agentId) {
            restoreSharedChatToDefault();
            root.hidden = true;
            root.innerHTML = '';
            if (tab) tab.uiPluginId = null;
            updateAgentPanelStyle('');
            return;
        }
        try {
            const ui = await window.electronAPI.agents.getChatUI(tab.agentId, getTabUiContext(panel, sessionId));
            if (!ui?.html) {
                restoreSharedChatToDefault();
                root.hidden = true;
                root.innerHTML = '';
                tab.uiPluginId = null;
                updateAgentPanelStyle('');
                return;
            }
            root.innerHTML = ui.html;
            root.hidden = false;
            tab.uiPluginId = ui.uiPluginId || null;
            updateAgentPanelStyle(ui.css || '');
            syncSharedChatMount(root);
            hydrateAgentCharts(root);
            bindAgentPanelActions(panel, root, tab.agentId);
            if (window.researchOrchestratorUI?.hydrate) {
                await window.researchOrchestratorUI.hydrate(panel, root, tab.agentId);
            }
            await sendAgentUiEvent(panel, sessionId, 'activated');
        } catch (error) {
            console.warn('Failed to render agent chat UI:', error);
            restoreSharedChatToDefault();
            root.hidden = true;
            root.innerHTML = '';
            tab.uiPluginId = null;
            updateAgentPanelStyle('');
        }
    }
    async function resolveAgentType(tab) {
        if (!tab?.agentId) {
            return null;
        }
        if (tab.agentType) {
            return tab.agentType;
        }
        try {
            const agent = await window.electronAPI.agents.get(tab.agentId);
            return agent?.type || null;
        } catch (error) {
            console.warn('Failed to resolve agent type during tab close:', error);
            return null;
        }
    }
    async function maybeDeactivateAgentAfterTabClose(panel, closingSessionId, closingTab) {
        const agentId = closingTab?.agentId;
        if (!agentId) {
            return;
        }
        // Fast-close path: skip on-close lifecycle when session had no new changes.
        if (!closingTab?.hasChanges) {
            return;
        }
        const isSubtaskSession = String(closingSessionId).startsWith('subtask-');
        if (isSubtaskSession) {
            return;
        }
        const agentType = await resolveAgentType(closingTab);
        if (agentType !== 'pro') {
            return;
        }
        const hasAnotherTabForSameAgent = [...panel.chatTabs.entries()]
            .some(([sessionId, tab]) =>
                sessionId !== closingSessionId
                && Number(tab?.agentId) === Number(agentId)
                && !String(sessionId).startsWith('subtask-')
            );
        if (hasAnotherTabForSameAgent) {
            return;
        }
        try {
            await window.electronAPI.agents.deactivate(agentId);
        } catch (error) {
            console.warn(`Failed to auto-deactivate agent ${agentId}:`, error);
        }
    }
    function getClearedTabTitle(tab, sessionId) {
        const isAgentTab = Boolean(tab?.agentId) || String(sessionId).startsWith('subtask-');
        return isAgentTab ? (tab.title || 'Agent Chat') : 'New Chat';
    }
    function isPrivateSession(sessionId) {
        return String(sessionId || '').startsWith('private-');
    }
    function isManagerSession(sessionId) {
        const value = String(sessionId || '');
        return value === SUBAGENT_MANAGER_TAB_ID || value === SUPERAGENT_MANAGER_TAB_ID;
    }
    function isPersistableChatSession(sessionId) {
        return Boolean(sessionId) && !isManagerSession(sessionId) && !isPrivateSession(sessionId);
    }
    function resolveTabKey(panel, sessionId) {
        if (!panel?.chatTabs || sessionId === null || sessionId === undefined) {
            return null;
        }
        if (panel.chatTabs.has(sessionId)) {
            return sessionId;
        }
        return [...panel.chatTabs.keys()].find(key => String(key) === String(sessionId)) ?? null;
    }
    function isActiveTab(panel, sessionId) {
        return String(sessionId) === String(panel?.activeTabId);
    }
    async function resolveSessionAgentId(sessionId) {
        if (!window.electronAPI?.getChatSessionMeta || !isPersistableChatSession(sessionId)) {
            return null;
        }
        try {
            const meta = await window.electronAPI.getChatSessionMeta(sessionId);
            return meta?.agent_id ?? meta?.agentId ?? null;
        } catch (error) {
            console.warn('Failed to resolve chat session metadata:', error);
            return null;
        }
    }
    async function ensureTabAgentId(panel, sessionId, tab = null) {
        const targetTab = tab || panel?.chatTabs?.get?.(sessionId);
        if (targetTab?.agentId) {
            return targetTab.agentId;
        }
        const agentId = await resolveSessionAgentId(sessionId);
        if (agentId && targetTab) {
            targetTab.agentId = agentId;
            try {
                const agent = await window.electronAPI?.agents?.get?.(agentId);
                if (agent) {
                    targetTab.title = targetTab.title || agent.name || `Agent ${agentId}`;
                    targetTab.agentType = targetTab.agentType || agent.type || null;
                    targetTab.agentIcon = targetTab.agentIcon || agent.icon || '🤖';
                }
            } catch (error) {
                console.warn('Failed to hydrate restored agent tab:', error);
            }
        }
        return agentId;
    }
    function resetTabState(tab, sessionId) {
        tab.title = getClearedTabTitle(tab, sessionId);
        tab.messagesHTML = '';
        tab.isSending = false;
        tab.loadingId = null;
        tab.scrollTop = 0;
        tab.followOutput = true;
        tab.subagentRunning = false;
        tab.subagentPulse = false;
        tab.hasChanges = false;
        tab.contextUsage = null;
    }
    async function clearTab(panel, sessionId) {
        const tabKey = resolveTabKey(panel, sessionId);
        if (!tabKey) {
            return;
        }
        if (isManagerSession(tabKey)) {
            return;
        }
        try {
            const oldTab = panel.chatTabs.get(tabKey);
            const wasActive = isActiveTab(panel, tabKey);
            const agentId = await ensureTabAgentId(panel, tabKey, oldTab);
            const isAgentTab = Boolean(agentId) || String(tabKey).startsWith('subtask-');
            // For agent/subagent tabs: wipe messages in-place (no new session)
            if (isAgentTab) {
                await window.electronAPI.clearChatSession(tabKey);
                if (oldTab) {
                    resetTabState(oldTab, tabKey);
                }
                if (wasActive) {
                    const container = getMessagesContainer();
                    if (container) container.innerHTML = '';
                    await renderAgentPanel(panel, tabKey);
                    panel.updateContextUsage(null);
                }
                renderTabs(panel);
                await saveOpenTabIds(panel);
                if (window.sidebar) window.sidebar.loadChatSessions();
                return;
            }
            // For regular chat tabs: preserve old session in history, create fresh one
            const newSession = await window.electronAPI.createChatSession();
            const newSessionId = newSession.id;
            // Remove old tab entry, keep old session untouched in DB (visible in Recent Chats)
            panel.chatTabs.delete(tabKey);
            // Create tab for new session
            panel.chatTabs.set(newSessionId, createTabState({ title: 'New Chat' }));
            // Switch to new tab if the cleared tab was active
            if (wasActive) {
                panel.activeTabId = newSessionId;
                emitActiveTabChanged(panel);
                const container = getMessagesContainer();
                if (container) container.innerHTML = '';
                await renderAgentPanel(panel, newSessionId);
                panel.updateContextUsage(null);
                await window.electronAPI.switchChatSession(newSessionId);
            }
            renderTabs(panel);
            await saveOpenTabIds(panel);
            if (window.sidebar) {
                window.sidebar.loadChatSessions();
            }
        } catch (error) {
            console.error('Error clearing chat:', error);
        }
    }
    async function clearCurrentChat(panel) {
        return clearTab(panel, panel.activeTabId);
    }
    async function shouldDefaultToPrivateChat() {
        try {
            return String(await window.electronAPI.getSettingValue('chat.privateDefault') || '').toLowerCase() === 'true';
        } catch (_) {
            return false;
        }
    }
    async function newChat(panel) {
        try {
            const defaultToPrivate = await shouldDefaultToPrivateChat();
            const session = defaultToPrivate
                ? await window.electronAPI.privateSession.create({ title: 'Private Chat' })
                : await window.electronAPI.createChatSession();
            const sessionId = session.id;
            const isPrivate = session?.private === true || isPrivateSession(sessionId);
            saveCurrentTabMessages(panel);
            panel.chatTabs.set(sessionId, createTabState({
                title: isPrivate ? (session?.title || 'Private Chat') : nextRegularChatTitle(panel),
                privateSession: isPrivate
            }));
            panel.activeTabId = sessionId;
            emitActiveTabChanged(panel);
            const container = getMessagesContainer();
            if (container) {
                container.innerHTML = '';
            }
            await renderAgentPanel(panel, sessionId);
            panel.updateContextUsage(null);
            renderTabs(panel);
            await window.electronAPI.switchChatSession(sessionId);
            await saveOpenTabIds(panel);
            if (window.sidebar && !isPrivate) {
                window.sidebar.loadChatSessions();
            }
        } catch (error) {
            console.error('Error starting new chat:', error);
        }
    }
    async function newPrivateChat(panel) {
        const session = await window.electronAPI.privateSession.create();
        const sessionId = session.id;
        saveCurrentTabMessages(panel);
        panel.chatTabs.set(sessionId, createTabState({ title: 'Private Chat', privateSession: true }));
        panel.activeTabId = sessionId;
        emitActiveTabChanged(panel);
        const container = getMessagesContainer();
        if (container) container.innerHTML = '';
        await renderAgentPanel(panel, sessionId);
        panel.updateContextUsage(null);
        renderTabs(panel);
        await saveOpenTabIds(panel);
        await window.electronAPI.switchChatSession(sessionId);
        return session;
    }
    async function openAgentChat(panel, agentId, sessionId, agent, options = {}) {
        try {
            if (panel.chatTabs.has(sessionId)) {
                await switchTab(panel, sessionId);
                return;
            }
            saveCurrentTabMessages(panel);
            panel.chatTabs.set(sessionId, createTabState({
                title: agent ? agent.name : `Agent ${agentId}`,
                agentId,
                agentType: agent?.type || null,
                agentIcon: agent ? agent.icon : '🤖',
                uiMode: options.uiMode || 'plugin'
            }));
            panel.activeTabId = sessionId;
            emitActiveTabChanged(panel);
            await loadTabConversations(panel, sessionId);
            await renderAgentPanel(panel, sessionId);
            renderTabs(panel);
            await saveOpenTabIds(panel);
            await window.electronAPI.switchChatSession(sessionId);
            await panel.calculateContextUsage(sessionId);
        } catch (error) {
            console.error('Error opening agent chat:', error);
        }
    }
    async function renderSubagentManagerTab(panel) {
        if (!window.superagentManagerTab?.renderSubagentManagerTab) return;
        await window.superagentManagerTab.renderSubagentManagerTab(panel, {
            getMessagesContainer,
            closeSubagentChat,
            ensureSubagentChat,
            refreshSubagentManagerTab
        });
    }
    async function openSubagentManagerTab(panel) {
        if (!panel.chatTabs.has(SUBAGENT_MANAGER_TAB_ID)) {
            saveCurrentTabMessages(panel);
            panel.chatTabs.set(SUBAGENT_MANAGER_TAB_ID, createTabState({ title: 'Subagent Manager', agentIcon: '🛰️', isSubagentManager: true }));
        }
        await switchTab(panel, SUBAGENT_MANAGER_TAB_ID);
    }
    async function openSuperagentManagerTab(panel) {
        if (!window.superagentManagerTab?.openSuperagentManagerTab) return;
        await window.superagentManagerTab.openSuperagentManagerTab(panel, {
            tabId: SUPERAGENT_MANAGER_TAB_ID,
            createTabState,
            saveCurrentTabMessages,
            switchTab
        });
    }
    async function refreshSubagentManagerTab(panel) {
        if (panel.activeTabId !== SUBAGENT_MANAGER_TAB_ID) return;
        await renderSubagentManagerTab(panel); panel._storeActiveTabScrollState();
    }
    async function refreshSuperagentManagerTab(panel) {
        if (!window.superagentManagerTab?.refreshSuperagentManagerTab) return;
        await window.superagentManagerTab.refreshSuperagentManagerTab(panel, {
            tabId: SUPERAGENT_MANAGER_TAB_ID,
            renderSuperagentManagerTab
        });
    }
    async function renderSuperagentManagerTab(panel) {
        if (!window.superagentManagerTab?.renderSuperagentManagerTab) return;
        await window.superagentManagerTab.renderSuperagentManagerTab(panel, {
            getMessagesContainer,
            refreshSuperagentManagerTab
        });
    }
    async function ensureSubagentChat(panel, eventPayload, { activate = false } = {}) {
        const sessionId = eventPayload?.childSessionId || eventPayload?.child_session_id;
        if (!sessionId) return;
        const agentId = eventPayload?.subagentId || eventPayload?.subagent_id || null;
        const agentName = eventPayload?.agentName || eventPayload?.agent_name || `Subagent ${agentId || ''}`.trim();
        if (!panel.chatTabs.has(sessionId)) {
            saveCurrentTabMessages(panel);
            panel.chatTabs.set(sessionId, createTabState({
                title: agentName,
                agentId,
                agentType: 'sub',
                agentIcon: '🛰️',
                subagentRunning: true,
                subagentPulse: true
            }));
        }
        const tab = panel.chatTabs.get(sessionId);
        if (!tab) return;
        tab.subagentRunning = true;
        tab.subagentPulse = true;
        tab.agentId = tab.agentId || agentId;
        tab.title = tab.title || agentName;
        if (activate) {
            await switchTab(panel, sessionId);
            await loadTabConversations(panel, sessionId);
        } else {
            renderTabs(panel);
            await saveOpenTabIds(panel);
        }
    }
    async function updateSubagentChatState(panel, eventPayload) {
        const sessionId = eventPayload?.childSessionId || eventPayload?.child_session_id;
        if (!sessionId || !panel.chatTabs.has(sessionId)) {
            return;
        }
        const tab = panel.chatTabs.get(sessionId);
        const eventType = eventPayload.__eventType || '';
        if (eventType === 'subagent:completed' || eventType === 'subagent:failed') {
            tab.subagentRunning = false;
            tab.subagentPulse = true;
            setTimeout(() => {
                const t = panel.chatTabs.get(sessionId);
                if (!t) return;
                t.subagentPulse = false;
                renderTabs(panel);
            }, 1400);
        }
        if (panel.activeTabId === sessionId) {
            await loadTabConversations(panel, sessionId);
        } else {
            renderTabs(panel);
        }
    }
    async function closeSubagentChat(panel, run) {
        const sessionId = run?.child_session_id || run?.childSessionId || run?.run_id || run?.runId;
        if (!sessionId || !panel.chatTabs.has(sessionId)) {
            if (panel?.showNotification) {
                panel.showNotification('Subagent chat is already closed.', 'info');
            }
            return;
        }
        await closeTab(panel, sessionId);
    }
    function openNewWindow() {
        window.electronAPI.openNewWindow().catch(error => {
            console.error('Failed to open new window:', error);
        });
    }
    async function restoreOpenTabs(panel) {
        return window.LocalAgentMainPanelTabRestore.restoreOpenTabs(panel, {
            createTabState,
            emitActiveTabChanged,
            isPersistableChatSession,
            loadTabConversations,
            newChat,
            nextRegularChatTitle,
            renderAgentPanel,
            renderTabs,
            resolveSessionAgentId,
            resolveTabKey,
            saveOpenTabIds
        });
    }
    async function autoTitleTab(panel, sessionId) {
        return window.LocalAgentMainPanelTabRestore.autoTitleTab(panel, sessionId);
    }
    function saveCurrentTabMessages(panel) {
        if (!panel.activeTabId || !panel.chatTabs.has(panel.activeTabId)) {
            return;
        }
        const container = getMessagesContainer();
        if (container) {
            panel.chatTabs.get(panel.activeTabId).messagesHTML = container.innerHTML;
            panel.chatTabs.get(panel.activeTabId).scrollTop = container.scrollTop;
            panel.chatTabs.get(panel.activeTabId).followOutput = panel._isNearBottom(container);
            window.localAgentRendererShell?.emit?.('tab-messages-saved', {
                panel,
                sessionId: panel.activeTabId,
                tab: panel.chatTabs.get(panel.activeTabId)
            });
        }
    }
    async function persistActiveTabSetting(sessionId) {
        try {
            await window.electronAPI.saveSetting('active_chat_tab', sessionId.toString());
        } catch (error) {
            console.warn('Failed to persist active chat tab:', error);
        }
    }
    async function switchTab(panel, sessionId) {
        const tabKey = resolveTabKey(panel, sessionId);
        if (!tabKey || isActiveTab(panel, tabKey)) {
            return;
        }
        const previousTabId = panel.activeTabId;
        await sendAgentUiEvent(panel, previousTabId, 'deactivated');
        saveCurrentTabMessages(panel);
        panel.activeTabId = tabKey;
        emitActiveTabChanged(panel);
        const tab = panel.chatTabs.get(tabKey);
        const container = getMessagesContainer();
        if (!container) {
            return;
        }
        if (String(tabKey) === SUBAGENT_MANAGER_TAB_ID || tab.isSubagentManager) {
            await renderSubagentManagerTab(panel);
            await renderAgentPanel(panel, tabKey);
            renderTabs(panel);
            await persistActiveTabSetting(tabKey);
            panel.updateContextUsage(null);
            return;
        }
        if (String(tabKey) === SUPERAGENT_MANAGER_TAB_ID || tab.isSuperagentManager) {
            await renderSuperagentManagerTab(panel);
            await renderAgentPanel(panel, tabKey);
            renderTabs(panel);
            await persistActiveTabSetting(tabKey);
            panel.updateContextUsage(null);
            return;
        }
        tab.hasUnread = false;
        if (tab.messagesHTML && !tab.needsReload) {
            container.innerHTML = tab.messagesHTML;
        } else {
            await loadTabConversations(panel, tabKey);
            tab.needsReload = false;
        }
        await renderAgentPanel(panel, tabKey);
        if (tab.followOutput === false && typeof tab.scrollTop === 'number') {
            container.scrollTop = tab.scrollTop;
        } else {
            container.scrollTop = container.scrollHeight;
        }
        renderTabs(panel);
        await persistActiveTabSetting(tabKey);
        await window.electronAPI.switchChatSession(tabKey);
        await panel.calculateContextUsage(tabKey);
    }
    async function loadTabConversations(panel, sessionId) {
        const tabKey = resolveTabKey(panel, sessionId) ?? sessionId;
        let deferredScrollStore = false;
        try {
            const conversations = await window.electronAPI.loadChatSession(tabKey);
            const container = getMessagesContainer();
            if (!container) {
                return;
            }
            panel._suspendMessageAutoscroll = true;
            container.innerHTML = '';
            conversations.forEach(conversation => {
                panel.addMessage(conversation.role, conversation.content);
            });
            const tab = panel.chatTabs.get(tabKey);
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
                panel._storeActiveTabScrollState();
            }
        }
    }
    async function closeTab(panel, sessionId) {
        if (panel.chatTabs.size <= 1) {
            return;
        }
        const tabKey = resolveTabKey(panel, sessionId);
        if (!tabKey) {
            return;
        }
        const closingTab = panel.chatTabs.get(tabKey);
        const wasActive = isActiveTab(panel, tabKey);
        if (isPrivateSession(tabKey) && window.chatPrivacyMode?.handlePrivateTabClose) {
            const result = await window.chatPrivacyMode.handlePrivateTabClose(panel, tabKey);
            if (result?.canceled) return;
        }
        if (wasActive) {
            await sendAgentUiEvent(panel, tabKey, 'deactivated');
        }
        panel.chatTabs.delete(tabKey);
        if (wasActive) {
            const remaining = [...panel.chatTabs.keys()];
            await switchTab(panel, remaining[remaining.length - 1]);
        }
        renderTabs(panel);
        await saveOpenTabIds(panel);
        maybeDeactivateAgentAfterTabClose(panel, tabKey, closingTab)
            .catch(error => console.warn('Background tab close cleanup failed:', error));
    }
    function renderTabs(panel) {
        const list = document.getElementById('chat-tabs-list');
        if (!list) {
            return;
        }
        list.innerHTML = '';
        for (const [sessionId, tab] of panel.chatTabs) {
            const tabEl = document.createElement('div');
            tabEl.className = `chat-tab${isActiveTab(panel, sessionId) ? ' active' : ''}${tab.subagentPulse ? ' subagent-pulse' : ''}${tab.hasUnread ? ' unread' : ''}`;
            tabEl.dataset.sessionId = sessionId;
            const clearBtn = document.createElement('button');
            clearBtn.className = 'chat-tab-reset';
            clearBtn.type = 'button';
            clearBtn.title = 'Clear Chat';
            clearBtn.textContent = '🖌';
            clearBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                clearTab(panel, sessionId);
            });
            const statusDot = document.createElement('span');
            const isSubagent = String(sessionId).startsWith('subtask-');
            statusDot.className = `chat-tab-status${tab.isSending || tab.subagentRunning ? ' thinking' : ''}${isSubagent && !tab.subagentRunning ? ' subagent-done' : ''}`;
            const label = document.createElement('span');
            label.className = 'chat-tab-label';
            const agentPrefix = tab.agentIcon ? `${tab.agentIcon} ` : '';
            label.textContent = agentPrefix + (tab.title || `Chat ${sessionId}`);
            if (!tab.isSubagentManager && !tab.isSuperagentManager) {
                tabEl.appendChild(clearBtn);
            }
            tabEl.appendChild(statusDot);
            tabEl.appendChild(label);
            if (panel.chatTabs.size > 1) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'chat-tab-close';
                closeBtn.type = 'button';
                closeBtn.title = 'Close Tab';
                closeBtn.textContent = '×';
                closeBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    closeTab(panel, sessionId);
                });
                tabEl.appendChild(closeBtn);
            }
            tabEl.addEventListener('click', () => switchTab(panel, sessionId));
            list.appendChild(tabEl);
        }
        window.localAgentRendererShell?.emit?.('tabs-rendered', { panel, list });
    }
    async function saveOpenTabIds(panel) {
        const ids = [...panel.chatTabs.keys()].filter(isPersistableChatSession);
        try {
            await window.electronAPI.saveSetting('open_chat_tabs', JSON.stringify(ids));
            if (isPersistableChatSession(panel.activeTabId) && ids.some(id => String(id) === String(panel.activeTabId))) {
                const activeSessionId = resolveTabKey(panel, panel.activeTabId) ?? panel.activeTabId;
                await window.electronAPI.saveSetting('active_chat_tab', activeSessionId.toString());
                await window.electronAPI.switchChatSession(activeSessionId);
            }
        } catch (error) {
            console.error('Error saving open tabs:', error);
        }
    }
    const api = {
        autoTitleTab,
        clearTab,
        clearCurrentChat,
        closeTab,
        closeSubagentChat,
        ensureSubagentChat,
        loadTabConversations,
        newChat,
        newPrivateChat,
        openAgentChat,
        openSubagentManagerTab, openSuperagentManagerTab, openNewWindow,
        refreshSubagentManagerTab, refreshSuperagentManagerTab,
        renderTabs,
        restoreOpenTabs,
        saveCurrentTabMessages,
        saveOpenTabIds,
        switchTab,
        updateSubagentChatState
    };
    window.localAgentRendererShell?.installTabApi?.(api);
    window.mainPanelTabs = api;
})();
