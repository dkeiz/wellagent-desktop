(function installMainPanelLayout(global) {
    function initializeComposerLayout(panel) {
        const appContainer = document.querySelector('.app-container');
        const chatContainer = document.querySelector('.chat-container');
        if (!appContainer) return;

        const syncLayout = () => {
            syncDesktopComposerDock();
            syncComposerDensity();
        };
        syncLayout();

        panel._layoutObserver = new MutationObserver(syncLayout);
        panel._layoutObserver.observe(appContainer, {
            attributes: true,
            attributeFilter: ['data-layout-mode']
        });

        if (chatContainer && typeof ResizeObserver === 'function') {
            panel._chatPaneResizeObserver = new ResizeObserver(() => {
                syncComposerDensity();
            });
            panel._chatPaneResizeObserver.observe(chatContainer);
        }
    }

    function syncDesktopComposerDock() {
        const appContainer = document.querySelector('.app-container');
        const providerRow = document.querySelector('.chat-provider-row');
        const statusBarCenter = document.querySelector('.status-bar-center');
        const artifactsBtn = document.getElementById('artifacts-btn');
        const speakBtn = document.getElementById('speak-btn');
        const desktopMode = appContainer?.getAttribute('data-layout-mode') === 'desktop';

        if (!providerRow || !statusBarCenter || !artifactsBtn || !speakBtn) {
            return;
        }

        const targetContainer = desktopMode ? statusBarCenter : providerRow;
        [artifactsBtn, speakBtn].forEach((button) => {
            if (button.parentElement !== targetContainer) {
                targetContainer.appendChild(button);
            }
        });
        window.workspaceIndicator?.syncMountTarget?.();
    }

    function syncComposerDensity() {
        const appContainer = document.querySelector('.app-container');
        const chatContainer = document.querySelector('.chat-container');
        if (!chatContainer) return;

        const desktopMode = appContainer?.getAttribute('data-layout-mode') === 'desktop';
        const width = Math.round(chatContainer.getBoundingClientRect().width || 0);
        const compact = desktopMode && width <= 980;
        const tight = desktopMode && width <= 760;

        chatContainer.classList.toggle('chat-pane-compact', compact);
        chatContainer.classList.toggle('chat-pane-tight', tight);
    }

    global.LocalAgentMainPanelLayout = {
        initializeComposerLayout,
        syncComposerDensity,
        syncDesktopComposerDock
    };
})(window);
