(function () {
    const DESKTOP_MODE = 'desktop';
    const CLASSIC_MODE = 'classic';
    const LEGACY_DESKTOP_ALIAS = 'ide';
    const SIDEBAR_SECTION_STORAGE_PREFIX = 'ui.sidebarSection';
    const COMPACTABLE_SIDEBAR_SECTIONS = [
        { id: 'agents', selector: '.agent-picker-widget' },
        { id: 'plugins', selector: '.plugins-widget' },
        { id: 'subagents', selector: '.subagents-widget' },
        { id: 'workflows', selector: '.workflows-widget' }
    ];

    function normalize(mode) {
        if (mode === CLASSIC_MODE) return CLASSIC_MODE;
        if (mode === LEGACY_DESKTOP_ALIAS || mode === DESKTOP_MODE) return DESKTOP_MODE;
        return DESKTOP_MODE;
    }

    async function initialize() {
        let layoutMode = DESKTOP_MODE;
        try {
            const settings = await window.electronAPI?.getSettings?.();
            layoutMode = settings?.['ui.layoutMode'] || localStorage.getItem('ui.layoutMode') || layoutMode;
        } catch (error) {
            console.error('Failed to load layout mode:', error);
            layoutMode = localStorage.getItem('ui.layoutMode') || layoutMode;
        }
        const normalizedMode = apply(layoutMode);
        if (normalizedMode && layoutMode !== normalizedMode) {
            localStorage.setItem('ui.layoutMode', normalizedMode);
            try {
                await window.electronAPI?.saveSetting?.('ui.layoutMode', normalizedMode);
            } catch (error) {
                console.error('Failed to persist migrated layout mode:', error);
            }
        }
    }

    function apply(mode) {
        const appContainer = document.querySelector('.app-container');
        if (!appContainer) return;
        const normalizedMode = normalize(mode);
        appContainer.setAttribute('data-layout-mode', normalizedMode);

        const leftSidebar = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-panel');
        const widgetStack = document.getElementById('widget-stack');
        const pluginSidebarWidgets = document.getElementById('plugin-sidebar-widgets');

        if (normalizedMode === DESKTOP_MODE) {
            if (leftSidebar && widgetStack && pluginSidebarWidgets) {
                const agentPicker = leftSidebar.querySelector('.agent-picker-widget');
                if (agentPicker?.parentElement) {
                    agentPicker.parentElement.insertBefore(widgetStack, agentPicker.nextSibling);
                    agentPicker.parentElement.insertBefore(pluginSidebarWidgets, widgetStack.nextSibling);
                } else {
                    leftSidebar.appendChild(widgetStack);
                    leftSidebar.appendChild(pluginSidebarWidgets);
                }
            }
        } else if (rightPanel && widgetStack && pluginSidebarWidgets) {
            rightPanel.appendChild(widgetStack);
            rightPanel.appendChild(pluginSidebarWidgets);
        }

        if (window._pluginSidebarWidget?.load) {
            window._pluginSidebarWidget.load();
        }
        applySidebarCompaction(normalizedMode);
        window.capabilityPanel?.applyLayoutDensity?.(normalizedMode);
        return normalizedMode;
    }

    function sidebarStorageKey(sectionId) {
        return `${SIDEBAR_SECTION_STORAGE_PREFIX}.${sectionId}.collapsed`;
    }

    function resolveSidebarCollapsed(sectionId, defaultCollapsed = false) {
        const saved = localStorage.getItem(sidebarStorageKey(sectionId));
        return saved === null ? defaultCollapsed : saved === 'true';
    }

    function applySidebarSectionCollapsed(sectionId, element, defaultCollapsed = false) {
        if (!element) return;
        element.classList.toggle('collapsed', resolveSidebarCollapsed(sectionId, defaultCollapsed));
    }

    function setSidebarSectionCollapsed(sectionId, collapsed) {
        localStorage.setItem(sidebarStorageKey(sectionId), String(collapsed));
    }

    function applySidebarCompaction(mode) {
        const defaultCollapsed = normalize(mode) === DESKTOP_MODE;
        for (const section of COMPACTABLE_SIDEBAR_SECTIONS) {
            applySidebarSectionCollapsed(section.id, document.querySelector(section.selector), defaultCollapsed);
        }
    }

    function applyPluginWidgetCompaction(widgetId, element, mode = document.querySelector('.app-container')?.getAttribute('data-layout-mode')) {
        if (!widgetId) return;
        applySidebarSectionCollapsed(`pluginWidget.${widgetId}`, element, normalize(mode) === DESKTOP_MODE);
    }

    window.LocalAgentLayoutMode = {
        initialize,
        apply,
        normalize,
        setSidebarSectionCollapsed,
        applyPluginWidgetCompaction
    };
})();
