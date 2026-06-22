(function () {
    const NO_CONFIRM_KEY = 'private_close_no_confirm';

    function isPrivateSessionId(sessionId) {
        return String(sessionId || '').startsWith('private-');
    }

    async function toggleCurrentChatMode(panel) {
        const sessionId = panel?.activeTabId;
        if (!sessionId || !panel.chatTabs?.has(sessionId)) return false;
        if (isPrivateSessionId(sessionId)) {
            return convertPrivateToMemory(panel, sessionId);
        }
        return convertMemoryToPrivate(panel, sessionId);
    }

    async function convertMemoryToPrivate(panel, publicSessionId) {
        const messages = await window.electronAPI.loadChatSession(publicSessionId);
        const created = await window.electronAPI.privateSession.create({ title: panel.chatTabs.get(publicSessionId)?.title || 'Private Chat' });
        const privateSessionId = created?.id;
        if (!privateSessionId) return false;
        await window.electronAPI.importChatSessionMessages(privateSessionId, messages || []);
        const tab = panel.chatTabs.get(publicSessionId) || {};
        panel.chatTabs.delete(publicSessionId);
        panel.chatTabs.set(privateSessionId, { ...tab, title: tab.title || 'Private Chat', privateSession: true });
        panel.activeTabId = privateSessionId;
        await window.electronAPI.deleteChatSession(publicSessionId);
        await window.electronAPI.switchChatSession(privateSessionId);
        await window.mainPanelTabs.loadTabConversations(panel, privateSessionId);
        window.mainPanelTabs.renderTabs(panel);
        await window.mainPanelTabs.saveOpenTabIds(panel);
        await panel.calculateContextUsage(privateSessionId);
        return true;
    }

    async function convertPrivateToMemory(panel, privateSessionId) {
        const tab = panel.chatTabs.get(privateSessionId) || {};
        const result = await window.electronAPI.privateSession.save(privateSessionId, {
            title: tab.title || 'Chat',
            enqueueMemory: false
        });
        const publicSessionId = result?.publicSessionId;
        if (!result?.success || !publicSessionId) return false;
        panel.chatTabs.delete(privateSessionId);
        panel.chatTabs.set(publicSessionId, { ...tab, privateSession: false });
        panel.activeTabId = publicSessionId;
        await window.electronAPI.switchChatSession(publicSessionId);
        await window.mainPanelTabs.loadTabConversations(panel, publicSessionId);
        window.mainPanelTabs.renderTabs(panel);
        await window.mainPanelTabs.saveOpenTabIds(panel);
        await panel.calculateContextUsage(publicSessionId);
        return true;
    }

    function showCloseModal(summary) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.46);display:flex;align-items:center;justify-content:center;z-index:1500;';
        overlay.innerHTML = `
          <div style="width:min(460px,92vw);background:var(--card-bg);color:var(--text-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">
            <h3 style="margin:0 0 8px 0;">Close private chat</h3>
            <p style="margin:0 0 8px 0;">${Number(summary?.messageCount || 0)} messages and ${Number(summary?.fileCount || 0)} files.</p>
            <p style="margin:0 0 8px 0;">Save this history and skills?</p>
            <label style="display:inline-flex;align-items:center;gap:6px;margin:0 0 10px 0;">
              <input id="privacy-never-ask" type="checkbox"> never ask this again
            </label>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button data-action="save" class="secondary-btn">Save</button>
              <button data-action="discard" class="secondary-btn">Close</button>
              <button data-action="cancel" class="secondary-btn">Cancel</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        return new Promise(resolve => {
            overlay.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-action]');
                if (!btn) return;
                const neverAsk = overlay.querySelector('#privacy-never-ask')?.checked === true;
                overlay.remove();
                resolve({ action: btn.dataset.action, neverAsk });
            });
        });
    }

    async function handlePrivateTabClose(panel, sessionId) {
        if (!isPrivateSessionId(sessionId)) return { handled: false };
        let action = 'discard';
        let neverAsk = false;
        const noConfirm = String(await window.electronAPI.getSettingValue(NO_CONFIRM_KEY) || '') === 'true';
        if (!noConfirm) {
            const summary = await window.electronAPI.privateSession.closeSummary(sessionId);
            const decision = await showCloseModal(summary);
            action = decision?.action || 'cancel';
            neverAsk = decision?.neverAsk === true;
            if (action === 'cancel') return { handled: true, canceled: true };
        }
        if (neverAsk) await window.electronAPI.saveSetting(NO_CONFIRM_KEY, 'true');
        if (action === 'save') {
            const tab = panel.chatTabs.get(sessionId) || {};
            await window.electronAPI.privateSession.save(sessionId, {
                title: tab.title || 'Saved Private Chat',
                enqueueMemory: true
            });
            return { handled: true, saved: true };
        }
        await window.electronAPI.privateSession.discard(sessionId);
        return { handled: true, discarded: true };
    }

    window.chatPrivacyMode = {
        isPrivateSessionId,
        toggleCurrentChatMode,
        handlePrivateTabClose
    };
})();
