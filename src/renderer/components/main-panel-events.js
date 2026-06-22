(function installMainPanelEvents(global) {
    async function handleBackgroundEvent(panel, bgEvent) {
        if (!bgEvent || !bgEvent.type || !bgEvent.payload) return;
        const type = bgEvent.type;
        const payload = bgEvent.payload || {};
        const mode = String(payload.subagentMode || payload.subagent_mode || 'no_ui').toLowerCase();
        if (!type.startsWith('subagent:')) return;
        const childSessionId = payload.childSessionId || payload.child_session_id;
        const hasExistingTab = childSessionId ? panel.chatTabs.has(childSessionId) : false;
        try {
            if (type === 'subagent:queued' || type === 'subagent:started') {
                if (mode === 'ui' || hasExistingTab) {
                    await panel.ensureSubagentChat({ ...payload, __eventType: type }, { activate: false });
                }
            } else if (type === 'subagent:completed' || type === 'subagent:failed') {
                await panel.updateSubagentChatState({ ...payload, __eventType: type });
            }
        } catch (error) {
            console.error('Failed to process subagent background event:', error);
        }
        try {
            await panel.refreshSubagentManagerTab();
        } catch (error) {
            console.error('Failed to refresh Subagent Manager tab:', error);
        }
    }

    function setupEventListeners(panel) {
        window.electronAPI.onConversationUpdate(() => {
        });
        window.electronAPI.onBackgroundEvent(async (event, bgEvent) => {
            await handleBackgroundEvent(panel, bgEvent);
        });
        window.electronAPI.onAgentUpdate(async () => {
            try {
                await panel.refreshSuperagentManagerTab();
            } catch (error) {
                console.error('Failed to refresh Superagent Manager tab:', error);
            }
        });
        window.electronAPI.onToolPermissionRequest((event, request) => {
            panel.showToolPermissionDialog(request);
        });
    }

    global.LocalAgentMainPanelEvents = {
        setupEventListeners
    };
})(window);
