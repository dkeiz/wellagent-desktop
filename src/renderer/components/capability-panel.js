/**
 * CapabilityPanel - UI Controller for Nested Toggle System
 * 
 * Manages:
 * - Main Pad (master toggle)
 * - 6 Group Pads (unsafe, web, files, terminal, ports, visual)
 * - Files and terminal mode switching
 * - Sync with backend CapabilityManager
 */
class CapabilityPanel {
    constructor() {
        this.panel = document.getElementById('capability-panel');
        this.mainPad = document.getElementById('capability-main-toggle');
        this.groupsContainer = document.getElementById('capability-groups');
        this.toolCountEl = document.getElementById('active-tool-count');
        this.safeInfoEl = document.getElementById('safe-tools-info');
        this.densityToggle = document.getElementById('tools-density-toggle');
        this.toolsCompactStorageKey = 'ui.toolsCompact';
        this.activeContext = { sessionId: null, agentId: null };

        this.state = {
            mainEnabled: true,
            groups: {}
        };

        this.init();
    }

    async init() {
        // Load initial state from backend
        await this.loadState();
        await this.refreshContextView();

        // Setup event listeners
        this.applyLayoutDensity(this.currentLayoutMode());
        this.setupDensityToggle();
        this.setupMainPadToggle();
        this.setupGroupToggles();

        // Listen for capability updates from backend
        if (window.electronAPI?.onCapabilityUpdate) {
            window.electronAPI.onCapabilityUpdate((event, newState) => {
                this.updateUI(newState);
            });
        }

        document.addEventListener('chat-tab-switched', async (event) => {
            this.activeContext = {
                sessionId: event?.detail?.sessionId ?? null,
                agentId: event?.detail?.agentId ?? null
            };
            await this.refreshContextView();
        });
    }

    resolveUiContext() {
        const panel = window.mainPanel || window.app?.mainPanel || null;
        const sessionId = panel?.activeTabId ?? this.activeContext.sessionId ?? null;
        const tab = panel?.chatTabs?.get?.(sessionId);
        const agentId = tab?.agentId ?? this.activeContext.agentId ?? null;
        return { sessionId, agentId };
    }

    currentLayoutMode() {
        return document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';
    }

    resolveCompactPreference(layoutMode = this.currentLayoutMode()) {
        const saved = localStorage.getItem(this.toolsCompactStorageKey);
        if (saved !== null) {
            return saved === 'true';
        }
        return layoutMode === 'desktop';
    }

    applyToolsCompact(compact, persist = false) {
        if (!this.panel) return;
        this.panel.classList.toggle('tools-compact', compact);
        this.panel.classList.toggle('tools-expanded', !compact);
        if (this.densityToggle) {
            this.densityToggle.setAttribute('aria-pressed', String(compact));
            this.densityToggle.textContent = compact ? '▦' : '▤';
            this.densityToggle.title = compact ? 'Show expanded tools' : 'Show compact tools';
        }
        if (persist) {
            localStorage.setItem(this.toolsCompactStorageKey, String(compact));
        }
    }

    applyLayoutDensity(layoutMode = this.currentLayoutMode()) {
        const normalizedMode = window.LocalAgentLayoutMode?.normalize?.(layoutMode) || layoutMode || 'desktop';
        this.applyToolsCompact(this.resolveCompactPreference(normalizedMode), false);
    }

    setupDensityToggle() {
        if (!this.densityToggle) return;
        this.densityToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const compact = !this.panel?.classList.contains('tools-compact');
            this.applyToolsCompact(compact, true);
        });
    }

    async refreshContextView() {
        const context = this.resolveUiContext();
        this.activeContext = context;
        // Do not render permission scope labels such as "Resolved Context",
        // "Global", or "Agent #..." in the compact tools UI. Scope is an
        // internal input for permission/tool-count queries only.
        await this.updateToolCount();
    }

    async loadState() {
        try {
            const state = await window.electronAPI?.capability?.getState?.();
            if (state && !state.error) {
                this.state = state;
                this.updateUI(state);
            }
        } catch (error) {
            console.error('Failed to load capability state:', error);
        }
    }

    setupMainPadToggle() {
        if (!this.mainPad) return;

        this.mainPad.addEventListener('click', async (event) => {
            if (event.target.closest('.tools-density-toggle')) {
                return;
            }
            const clickedToggle = Boolean(event.target.closest('.main-toggle-indicator'));
            if (!clickedToggle) {
                const mcpNavButton = document.querySelector('.nav-btn[data-tab="mcp"]');
                if (mcpNavButton) {
                    mcpNavButton.click();
                } else if (window.sidebar?.switchTab) {
                    window.sidebar.switchTab('mcp');
                }
                return;
            }

            const newState = !this.state.mainEnabled;
            try {
                await window.electronAPI?.capability?.setMain?.(newState);
                this.state.mainEnabled = newState;
                this.updateMainPad();
            } catch (error) {
                console.error('Failed to toggle main switch:', error);
            }
        });
    }

    setupGroupToggles() {
        const groupPads = document.querySelectorAll('.capability-group-pad');

        groupPads.forEach(pad => {
            const groupId = pad.dataset.group;

            pad.addEventListener('click', async (e) => {
                // Special handling for Files group (3-mode cycle)
                if (groupId === 'files') {
                    await this.cycleFilesMode(pad);
                    return;
                }

                if (groupId === 'terminal') {
                    await this.cycleTerminalMode(pad);
                    return;
                }

                // Special handling for Ports (show config dialog)
                if (groupId === 'ports') {
                    // For now, just toggle. Later: show config modal
                    const newState = !pad.classList.contains('active');
                    try {
                        await window.electronAPI?.capability?.setGroup?.(groupId, newState);
                        pad.classList.toggle('active', newState);
                        this.autoEnableMainIfNeeded();
                    } catch (error) {
                        console.error('Failed to toggle group:', error);
                    }
                    return;
                }

                // Standard toggle for other groups
                const newState = !pad.classList.contains('active');
                try {
                    await window.electronAPI?.capability?.setGroup?.(groupId, newState);
                    pad.classList.toggle('active', newState);
                    this.autoEnableMainIfNeeded();
                } catch (error) {
                    console.error('Failed to toggle group:', error);
                }
            });
        });
    }

    async cycleFilesMode(pad) {
        const currentMode = pad.dataset.mode || 'off';
        const modes = ['off', 'read', 'full'];
        const currentIndex = modes.indexOf(currentMode);
        const nextMode = modes[(currentIndex + 1) % 3];

        try {
            await window.electronAPI?.capability?.setFilesMode?.(nextMode);
            pad.dataset.mode = nextMode;
            pad.classList.toggle('active', nextMode !== 'off');
            this.updateFilesIndicator(pad, nextMode);
            this.autoEnableMainIfNeeded();
        } catch (error) {
            console.error('Failed to cycle files mode:', error);
        }
    }

    updateFilesIndicator(pad, mode) {
        this.updateModeIndicator(pad, mode, {
            off: 0,
            read: 2,
            full: 3
        });
    }

    async cycleTerminalMode(pad) {
        const currentMode = pad.dataset.mode || 'off';
        const modes = ['off', 'workspace', 'system'];
        const currentIndex = modes.indexOf(currentMode);
        const nextMode = modes[(currentIndex + 1) % 3];

        try {
            await window.electronAPI?.capability?.setTerminalMode?.(nextMode);
            pad.dataset.mode = nextMode;
            pad.classList.toggle('active', nextMode !== 'off');
            this.updateTerminalIndicator(pad, nextMode);
            this.autoEnableMainIfNeeded();
        } catch (error) {
            console.error('Failed to cycle terminal mode:', error);
        }
    }

    updateTerminalIndicator(pad, mode) {
        this.updateModeIndicator(pad, mode, {
            off: 0,
            workspace: 2,
            system: 3
        });
    }

    updateModeIndicator(pad, mode, levels) {
        const dots = pad.querySelectorAll('.mode-dot');
        const activeDots = levels[mode] || 0;
        dots.forEach((dot, index) => {
            if (activeDots === 0) {
                dot.style.background = 'var(--border-color, #d1d5db)';
            } else if (activeDots >= 3) {
                dot.style.background = '#10b981';
            } else {
                dot.style.background = index < activeDots ? '#f59e0b' : 'var(--border-color, #d1d5db)';
            }
        });
    }

    autoEnableMainIfNeeded() {
        // If any group is active and main is off, enable main
        const anyActive = document.querySelector('.capability-group-pad.active');
        if (anyActive && !this.state.mainEnabled) {
            this.state.mainEnabled = true;
            this.updateMainPad();
            window.electronAPI?.capability?.setMain?.(true);
        }
    }

    updateMainPad() {
        if (!this.mainPad) return;

        this.mainPad.classList.toggle('active', this.state.mainEnabled);
        this.mainPad.classList.toggle('inactive', !this.state.mainEnabled);

        // Update safe tools info
        if (this.safeInfoEl) {
            this.safeInfoEl.classList.toggle('inactive', !this.state.mainEnabled);
        }

        // Update tool count
        this.updateToolCount();
    }

    async updateToolCount() {
        try {
            const activeTools = await window.electronAPI?.capability?.getActiveTools?.(this.resolveUiContext());
            if (this.toolCountEl && Array.isArray(activeTools)) {
                this.toolCountEl.textContent = `${activeTools.length} active`;
            }
        } catch (error) {
            console.error('Failed to get active tools count:', error);
        }
    }

    updateUI(state) {
        if (!state) return;

        this.state = state;

        // Update main pad
        this.updateMainPad();

        // Update group states
        if (state.groups) {
            Object.entries(state.groups).forEach(([groupId, value]) => {
                const pad = document.querySelector(`.capability-group-pad[data-group="${groupId}"]`);
                if (!pad) return;

                if (groupId === 'files') {
                    const mode = typeof value === 'string' ? value : 'off';
                    pad.dataset.mode = mode;
                    pad.classList.toggle('active', mode !== 'off');
                    this.updateFilesIndicator(pad, mode);
                } else if (groupId === 'terminal') {
                    const mode = typeof value === 'string' ? value : (value ? 'workspace' : 'off');
                    pad.dataset.mode = mode;
                    pad.classList.toggle('active', mode !== 'off');
                    this.updateTerminalIndicator(pad, mode);
                } else {
                    // Others use boolean
                    pad.classList.toggle('active', !!value);
                }
            });
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.capabilityPanel = new CapabilityPanel();
});
