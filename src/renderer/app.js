class App {
    static TYPE_SIZE_MIN = 11;
    static TYPE_SIZE_MAX = 18;
    static TYPE_SIZE_DEFAULT = 13;
    static TYPEFACE_DEFAULT_ID = 'current';
    static TYPEFACE_DEFAULT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    static DEFAULT_TYPEFACES = Object.freeze([
        { id: 'current', label: 'Current UI', family: App.TYPEFACE_DEFAULT_FAMILY },
        { id: 'terminal', label: 'Terminal', family: '"Consolas", "Monaco", "Courier New", monospace' }
    ]);

    constructor() {
        // MainPanel is bootstrapped in components/main-panel.js.
        // Reuse the existing instance to avoid duplicate listener registration.
        this.mainPanel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel || new MainPanel();
        window.mainPanel = this.mainPanel;
        this._settingsTabInitPromise = null;
        this._settingsTabBound = false;
        this._companionQrCache = new Map();
        this.initializeApp();
        this.initializePanelToggles();
        this.initializeToolGroups();
    }

    async initializeApp() {
        this.applyTypeface({
            id: localStorage.getItem('uiTypeId') || App.TYPEFACE_DEFAULT_ID,
            family: localStorage.getItem('uiTypeFamily') || App.TYPEFACE_DEFAULT_FAMILY
        });
        if (window.electronAPI?.onLlmSoftAlert) {
            window.electronAPI.onLlmSoftAlert((_event, payload = {}) => {
                const message = String(payload?.message || '').trim();
                if (!message) return;
                const level = String(payload?.level || 'info').toLowerCase();
                const type = level === 'warning' ? 'info' : (level === 'error' ? 'error' : 'info');
                this.mainPanel?.showNotification?.(message, type);
            });
        }
        // Listen for provider changes to refresh models
        const providerSelect = document.getElementById('ai-provider');
        if (providerSelect) {
            providerSelect.addEventListener('change', async (e) => {
                await this.mainPanel.loadModelsForProvider(e.target.value);
            });
        }
        await this.initializeLayoutMode();
        this.bindDeferredSettingsInitialization();
    }

    bindDeferredSettingsInitialization() {
        if (this._settingsTabBound) return;
        this._settingsTabBound = true;
        const initialize = () => {
            this.ensureSettingsTabInitialized().catch((error) => {
                console.error('Failed to initialize settings tab:', error);
            });
        };
        document.querySelectorAll('[data-tab="settings"]').forEach((button) => {
            button.addEventListener('click', initialize);
        });
        if (document.getElementById('settings-tab')?.classList.contains('active')) {
            initialize();
        }
    }

    ensureSettingsTabInitialized() {
        if (!this._settingsTabInitPromise) {
            this._settingsTabInitPromise = this.initializeSettingsTab().catch((error) => {
                this._settingsTabInitPromise = null;
                throw error;
            });
        }
        return this._settingsTabInitPromise;
    }

    initializePanelToggles() {
        const appContainer = document.querySelector('.app-container');
        const leftSidebar = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-panel');
        const leftToggle = document.getElementById('toggle-left-sidebar');
        const rightToggle = document.getElementById('toggle-right-panel');

        // Restore saved panel states
        const leftCollapsed = localStorage.getItem('leftSidebarCollapsed') === 'true';
        const rightCollapsed = localStorage.getItem('rightPanelCollapsed') === 'true';

        if (leftCollapsed) {
            appContainer.classList.add('left-collapsed');
            leftSidebar.classList.add('collapsed');
            leftToggle.setAttribute('aria-expanded', 'false');
        }

        if (rightCollapsed) {
            appContainer.classList.add('right-collapsed');
            rightPanel.classList.add('collapsed');
            rightToggle.setAttribute('aria-expanded', 'false');
        }

        // Left sidebar toggle
        leftToggle.addEventListener('click', () => {
            const isCollapsed = leftSidebar.classList.toggle('collapsed');
            appContainer.classList.toggle('left-collapsed', isCollapsed);
            leftToggle.setAttribute('aria-expanded', String(!isCollapsed));
            localStorage.setItem('leftSidebarCollapsed', isCollapsed);
        });

        // Right panel toggle
        rightToggle.addEventListener('click', () => {
            const isCollapsed = rightPanel.classList.toggle('collapsed');
            appContainer.classList.toggle('right-collapsed', isCollapsed);
            rightToggle.setAttribute('aria-expanded', String(!isCollapsed));
            localStorage.setItem('rightPanelCollapsed', isCollapsed);
        });
    }

    async initializeToolGroups() {
        const container = document.getElementById('tool-groups-container');
        if (!container) return;

        try {
            const groups = await window.electronAPI.getToolGroups();
            this.renderToolGroups(container, groups);
        } catch (error) {
            console.error('Failed to load tool groups:', error);
        }
    }

    renderToolGroups(container, groups) {
        container.innerHTML = '';

        // groups is an array of {id, name, description, icon, tools, active, toolCount}
        groups.forEach((group) => {
            const groupId = group.id; // Use the actual group ID from the object
            const item = document.createElement('div');
            item.className = `tool-group-item ${group.active ? 'active' : ''}`;
            item.dataset.groupId = groupId;

            item.innerHTML = `
                <button class="tool-group-settings" title="Configure ${group.name}">⚙</button>
                <span class="tool-group-icon">${group.icon}</span>
                <span class="tool-group-label">${group.name}</span>
                <span class="tool-group-count">${group.tools.length}</span>
            `;

            // Click on main area toggles the group
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('tool-group-settings')) return;

                const isActive = item.classList.contains('active');
                console.log(`[Frontend] Toggling group: ${groupId}, currently active: ${isActive}`);
                try {
                    if (isActive) {
                        console.log(`[Frontend] Calling deactivateToolGroup(${groupId})`);
                        await window.electronAPI.deactivateToolGroup(groupId);
                    } else {
                        console.log(`[Frontend] Calling activateToolGroup(${groupId})`);
                        const result = await window.electronAPI.activateToolGroup(groupId);
                        console.log(`[Frontend] activateToolGroup result:`, result);
                    }
                    item.classList.toggle('active');
                } catch (error) {
                    console.error(`Failed to toggle group ${groupId}:`, error);
                }
            });

            // Settings button navigates to MCP page
            const settingsBtn = item.querySelector('.tool-group-settings');
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Switch to MCP tools tab
                const mcpTab = document.querySelector('[data-tab="mcp"]');
                if (mcpTab) mcpTab.click();
            });

            container.appendChild(item);
        });
    }

    initializeTheme() {
        // Load saved theme or default to light
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);

        // Theme picker handlers (both classic right-panel and status-bar pickers)
        const pickers = [
            document.getElementById('theme-picker'),
            document.getElementById('statusbar-theme-picker')
        ];
        pickers.forEach(themePicker => {
            if (themePicker) {
                themePicker.querySelectorAll('.theme-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const theme = btn.dataset.theme;
                        this.setTheme(theme);
                    });
                });
            }
        });
    }

    async initializeLayoutMode() {
        await window.LocalAgentLayoutMode?.initialize?.();
    }

    applyLayoutMode(mode) {
        window.LocalAgentLayoutMode?.apply?.(mode);
    }

    setTheme(theme) {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', theme);

        // Update button states
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // Save preference
        localStorage.setItem('theme', theme);
        Promise.resolve(window.electronAPI?.saveSetting?.('ui.theme', theme)).catch(() => {}).finally(() => {
            Promise.resolve(window.electronAPI?.companion?.notifyStateChanged?.('ui', { keys: ['ui.theme'] })).catch(() => {});
        });
    }

    parseTypeSize(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
            return App.TYPE_SIZE_DEFAULT;
        }
        return Math.min(App.TYPE_SIZE_MAX, Math.max(App.TYPE_SIZE_MIN, parsed));
    }

    applyTypeSize(sizePx) {
        const clamped = this.parseTypeSize(sizePx);
        const scale = clamped / App.TYPE_SIZE_DEFAULT;
        document.documentElement.style.setProperty('--type-base', `${clamped}px`);
        document.documentElement.style.setProperty('--type-scale', `${scale}`);
        const display = document.getElementById('type-size-display');
        if (display) {
            display.textContent = `${clamped}px`;
        }
        return clamped;
    }

    cleanTypefaceFamily(value) {
        return String(value || '')
            .replace(/[;\r\n]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    normalizeTypefaceEntry(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const id = String(entry.id || '').trim();
        const family = this.cleanTypefaceFamily(entry.family);
        if (!id || !family) return null;
        return {
            id,
            label: String(entry.label || id).trim() || id,
            family
        };
    }

    normalizeTypefaceList(typefaces) {
        const seen = new Set();
        const normalized = [];
        const rawList = Array.isArray(typefaces) ? typefaces : App.DEFAULT_TYPEFACES;
        rawList.forEach((entry) => {
            const typeface = this.normalizeTypefaceEntry(entry);
            if (!typeface || seen.has(typeface.id)) return;
            seen.add(typeface.id);
            normalized.push(typeface);
        });
        return normalized.length ? normalized : App.DEFAULT_TYPEFACES.map(entry => ({ ...entry }));
    }

    async loadTypefaces() {
        try {
            const payload = await window.electronAPI?.appearance?.getTypefaces?.();
            return this.normalizeTypefaceList(payload?.typefaces);
        } catch (error) {
            console.warn('Failed to load typefaces:', error);
            return this.normalizeTypefaceList(App.DEFAULT_TYPEFACES);
        }
    }

    findTypeface(typefaces, preferredId) {
        const list = this.normalizeTypefaceList(typefaces);
        return list.find(typeface => typeface.id === preferredId) || list[0];
    }

    applyTypeface(typeface) {
        const normalized = this.normalizeTypefaceEntry(typeface)
            || this.normalizeTypefaceEntry(App.DEFAULT_TYPEFACES[0]);
        document.documentElement.style.setProperty('--ui-type-family', normalized.family);
        document.documentElement.setAttribute('data-ui-type-id', normalized.id);
        if (document.body) {
            document.body.style.fontFamily = 'var(--ui-type-family)';
        }
        return normalized;
    }

    renderTypePicker(select, typefaces, selectedId) {
        if (!select) return null;
        const list = this.normalizeTypefaceList(typefaces);
        const selected = this.findTypeface(list, selectedId);
        select.replaceChildren(...list.map((typeface) => {
            const option = document.createElement('option');
            option.value = typeface.id;
            option.textContent = typeface.label;
            return option;
        }));
        select.value = selected.id;
        return selected;
    }

    escapeHtml(value) {
        return window.LocalAgentAppCompanionUi?.escapeHtml?.(value) || String(value ?? '');
    }

    formatDateTime(value) {
        return window.LocalAgentAppCompanionUi?.formatDateTime?.(value) || '—';
    }

    async copyToClipboard(text) {
        const value = String(text || '').trim();
        if (!value) return false;

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }

        const probe = document.createElement('textarea');
        probe.value = value;
        probe.setAttribute('readonly', 'readonly');
        probe.style.position = 'fixed';
        probe.style.opacity = '0';
        document.body.appendChild(probe);
        probe.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(probe);
        return copied;
    }

    closeCompanionQrModal() {
        const overlay = document.getElementById('companion-qr-modal');
        if (!overlay) return;
        overlay.classList.add('hidden');
    }

    async renderCompanionQrPayload(value) {
        const payload = String(value || '').trim();
        if (this._companionQrCache.has(payload)) {
            return this._companionQrCache.get(payload);
        }

        let result = null;
        if (window.LocalAgentQrCodeRenderer?.renderQrPayload) {
            try {
                result = window.LocalAgentQrCodeRenderer.renderQrPayload(payload);
            } catch (error) {
                console.warn('Renderer QR failed, falling back to main process:', error);
            }
        }
        if (!result?.success || !result?.svg) {
            result = await window.electronAPI.companion.renderQr(payload);
        }
        if (!result?.success || !result?.svg) {
            throw new Error(result?.error || 'Failed to render QR code');
        }

        this._companionQrCache.set(payload, result);
        if (this._companionQrCache.size > 16) {
            this._companionQrCache.delete(this._companionQrCache.keys().next().value);
        }
        return result;
    }

    async showCompanionQrModal(title, payload) {
        const qrTitle = document.getElementById('companion-qr-title');
        const qrSvg = document.getElementById('companion-qr-svg');
        const qrPayload = document.getElementById('companion-qr-payload');
        const overlay = document.getElementById('companion-qr-modal');
        if (!qrTitle || !qrSvg || !qrPayload || !overlay) return;

        const value = String(payload || '').trim();
        if (!value) {
            this.mainPanel?.showNotification?.('QR payload is empty', 'error');
            return;
        }

        const result = await this.renderCompanionQrPayload(value);

        qrTitle.textContent = title || 'Companion QR';
        qrSvg.innerHTML = result.svg;
        qrPayload.value = value;
        overlay.classList.remove('hidden');
    }

    getDefaultCompanionScope(presetId) {
        return window.LocalAgentAppCompanionUi?.getDefaultCompanionScope?.(this, presetId);
    }

    renderCompanionDevices(elements, devices = []) {
        return window.LocalAgentAppCompanionUi?.renderCompanionDevices?.(this, elements, devices);
    }

    formatCompanionAndroidHttpsStatus(tls = {}) {
        return window.LocalAgentAppCompanionUi?.formatCompanionAndroidHttpsStatus?.(tls) || 'Off';
    }

    renderCompanionState(elements, status = {}, pairing = null, devices = []) {
        // Delegate preserves the single preferred link field: "preferredBrowserUrl"
        return window.LocalAgentAppCompanionUi?.renderCompanionState?.(this, elements, status, pairing, devices);
    }

    async initializeCompanionSettings() {
        if (!window.electronAPI?.companion) return;

        const elements = {
            enabled: document.getElementById('companion-enabled'),
            host: document.getElementById('companion-host'),
            port: document.getElementById('companion-port'),
            saveBtn: document.getElementById('companion-save-btn'),
            refreshBtn: document.getElementById('companion-refresh-btn'),
            androidHttpsEnabled: document.getElementById('companion-android-https-enabled'),
            androidHttpsStatus: document.getElementById('companion-android-https-status'),
            androidHttpsSetupBtn: document.getElementById('companion-android-https-setup-btn'),
            androidHttpsNote: document.getElementById('companion-android-https-note'),
            generatePairingBtn: document.getElementById('companion-generate-pairing-btn'),
            cancelPairingBtn: document.getElementById('companion-cancel-pairing-btn'),
            showAppQrBtn: document.getElementById('companion-show-app-qr-btn'),
            showWebQrBtn: document.getElementById('companion-show-web-qr-btn'),
            showDownloadQrBtn: document.getElementById('companion-show-download-qr-btn'),
            statusText: document.getElementById('companion-status-text'),
            deviceCount: document.getElementById('companion-device-count'),
            connectedCount: document.getElementById('companion-connected-count'),
            browserUrl: document.getElementById('companion-browser-url'),
            pairingUrl: document.getElementById('companion-pairing-url'),
            nativeAppUrl: document.getElementById('companion-native-app-url'),
            copyLinkBtn: document.getElementById('companion-copy-link-btn'),
            copyPairingLinkBtn: document.getElementById('companion-copy-pairing-link-btn'),
            toggleAdvancedBtn: document.getElementById('companion-toggle-advanced-btn'),
            pairingCode: document.getElementById('companion-pairing-code'),
            pairingExpiry: document.getElementById('companion-pairing-expiry'),
            warning: document.getElementById('companion-warning'),
            advancedPanel: document.getElementById('companion-advanced-panel'),
            devicesPanel: document.getElementById('companion-devices-panel'),
            devicesEmpty: document.getElementById('companion-devices-empty'),
            devicesList: document.getElementById('companion-devices-list')
        };

        if (!elements.enabled || elements.enabled.dataset.initialized === 'true') return;
        elements.enabled.dataset.initialized = 'true';

        this.companionPermissionPresets = await window.electronAPI.companion.getPermissionPresets().catch(() => []);
        this.companionElements = elements;
        this.companionAdvancedOpen = false;

        const refresh = async () => {
            const [status, pairing, devices] = await Promise.all([
                window.electronAPI.companion.getStatus().catch(() => ({})),
                window.electronAPI.companion.getPairing().catch(() => null),
                window.electronAPI.companion.listDevices().catch(() => [])
            ]);
            this.renderCompanionState(elements, status, pairing, devices);
            return { status, pairing, devices };
        };

        const readHostPort = () => ({
            host: String(elements.host.value || '').trim() || '0.0.0.0',
            port: Number.parseInt(elements.port.value, 10) || 8790
        });

        const saveNetworkSettings = async ({ enableAfterSave = elements.enabled.checked } = {}) => {
            const { host, port } = readHostPort();
            await window.electronAPI.saveSetting('companion.host', host);
            await window.electronAPI.saveSetting('companion.port', String(port));
            if (enableAfterSave) {
                const startupCheckbox = document.getElementById('companion-startup');
                if (startupCheckbox) startupCheckbox.checked = true;
                return window.electronAPI.companion.enable({ host, port });
            }
            return window.electronAPI.companion.getStatus();
        };

        const withTimeout = (promise, message, timeoutMs = 150000) => {
            let timer = null;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            });
            return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
        };

        elements.refreshBtn.addEventListener('click', async () => {
            await refresh();
            this.mainPanel?.showNotification?.('Companion status refreshed');
        });

        elements.androidHttpsEnabled?.addEventListener('change', async (event) => {
            const checkbox = event.target;
            checkbox.disabled = true;
            try {
                const result = await window.electronAPI.companion.setAndroidBrowserHttps(checkbox.checked);
                if (result?.success === false) throw new Error(result.error || 'Failed to update Android browser HTTPS');
                await refresh();
                this.mainPanel?.showNotification?.(checkbox.checked ? 'Android browser HTTPS enabled' : 'Android browser HTTPS disabled');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to update Android browser HTTPS', 'error');
            } finally {
                checkbox.disabled = false;
                await refresh();
            }
        });

        elements.androidHttpsSetupBtn?.addEventListener('click', async () => {
            elements.androidHttpsSetupBtn.disabled = true;
            try {
                const result = await withTimeout(
                    window.electronAPI.companion.setupAndroidBrowserHttps(),
                    'Mobile mic setup took too long. Check Windows certificate prompts or try again.'
                );
                if (result?.success === false) throw new Error(result.error || 'Failed to set up Android browser HTTPS');
                await refresh();
                this.mainPanel?.showNotification?.('Android browser HTTPS is ready');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to set up Android browser HTTPS', 'error');
            } finally {
                elements.androidHttpsSetupBtn.disabled = false;
                await refresh();
            }
        });

        elements.saveBtn.addEventListener('click', async () => {
            elements.saveBtn.disabled = true;
            try {
                const result = await saveNetworkSettings();
                if (result?.success === false) throw new Error(result.error || 'Failed to save companion settings');
                await refresh();
                this.mainPanel?.showNotification?.('Companion settings applied');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to save companion settings', 'error');
            } finally {
                elements.saveBtn.disabled = false;
            }
        });

        elements.enabled.addEventListener('change', async (event) => {
            elements.enabled.disabled = true;
            try {
                if (event.target.checked) {
                    const { host, port } = readHostPort();
                    const result = await window.electronAPI.companion.enable({ host, port });
                    if (result?.success === false) throw new Error(result.error || 'Failed to enable companion');
                    this.mainPanel?.showNotification?.('Companion server enabled');
                } else {
                    const result = await window.electronAPI.companion.disable();
                    if (result?.success === false) throw new Error(result.error || 'Failed to disable companion');
                    this.mainPanel?.showNotification?.('Companion server disabled');
                }
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Companion toggle failed', 'error');
            } finally {
                elements.enabled.disabled = false;
                const startupCheckbox = document.getElementById('companion-startup');
                if (startupCheckbox) startupCheckbox.checked = elements.enabled.checked;
                await refresh();
            }
        });

        elements.generatePairingBtn.addEventListener('click', async () => {
            elements.generatePairingBtn.disabled = true;
            try {
                if (!elements.enabled.checked) {
                    const saveResult = await saveNetworkSettings({ enableAfterSave: true });
                    if (saveResult?.success === false) {
                        throw new Error(saveResult.error || 'Failed to start companion server');
                    }
                }
                const pairingResult = await window.electronAPI.companion.generatePairing();
                if (!pairingResult?.success) {
                    throw new Error(pairingResult?.error || 'Failed to generate pairing code');
                }
                await refresh();
                this.mainPanel?.showNotification?.('Pairing code generated');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to generate pairing code', 'error');
            } finally {
                elements.generatePairingBtn.disabled = false;
            }
        });

        elements.cancelPairingBtn.addEventListener('click', async () => {
            elements.cancelPairingBtn.disabled = true;
            try {
                await window.electronAPI.companion.cancelPairing();
                await refresh();
                this.mainPanel?.showNotification?.('Pairing code cancelled');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to cancel pairing', 'error');
            } finally {
                elements.cancelPairingBtn.disabled = false;
            }
        });

        elements.copyLinkBtn.addEventListener('click', async () => {
            const copied = await this.copyToClipboard(elements.browserUrl.value).catch(() => false);
            this.mainPanel?.showNotification?.(copied ? 'Browser URL copied' : 'Unable to copy browser URL', copied ? 'info' : 'error');
        });

        elements.copyPairingLinkBtn.addEventListener('click', async () => {
            const copied = await this.copyToClipboard(elements.pairingUrl.value).catch(() => false);
            this.mainPanel?.showNotification?.(copied ? 'Pairing link copied' : 'Unable to copy pairing link', copied ? 'info' : 'error');
        });

        elements.showAppQrBtn?.addEventListener('click', async () => {
            try {
                await this.showCompanionQrModal('Android App QR', elements.nativeAppUrl.value);
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to render app QR', 'error');
            }
        });

        elements.showWebQrBtn?.addEventListener('click', async () => {
            try {
                await this.showCompanionQrModal('Web Companion QR', elements.pairingUrl.value);
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to render web QR', 'error');
            }
        });

        elements.showDownloadQrBtn?.addEventListener('click', async () => {
            try {
                const browserUrl = elements.browserUrl.value;
                if (!browserUrl) throw new Error('Companion is not running or URL is empty');
                const u = new URL(browserUrl);
                const downloadUrl = `${u.protocol}//${u.host}/companion/app/android/download`;
                await this.showCompanionQrModal('Download Android App', downloadUrl);
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to render download QR', 'error');
            }
        });

        elements.toggleAdvancedBtn.addEventListener('click', async () => {
            const skinManagePanel = document.getElementById('skin-manage-panel');
            const skinManageToggle = document.getElementById('skin-manage-toggle-btn');
            if (!this.companionAdvancedOpen && skinManagePanel && !skinManagePanel.hidden) {
                skinManagePanel.hidden = true;
                if (skinManageToggle) skinManageToggle.textContent = 'Manage';
            }
            this.companionAdvancedOpen = !this.companionAdvancedOpen;
            await refresh();
        });

        elements.devicesList.addEventListener('click', async (event) => {
            const button = event.target.closest('.companion-remove-device-btn');
            if (!button) return;
            const deviceId = button.dataset.deviceId;
            if (!deviceId) return;
            const confirmed = window.confirm(`Remove paired device "${deviceId}"?`);
            if (!confirmed) return;

            button.disabled = true;
            try {
                const result = await window.electronAPI.companion.removeDevice(deviceId);
                if (result?.success === false) throw new Error(result.error || 'Failed to remove device');
                await refresh();
                this.mainPanel?.showNotification?.('Companion device removed');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to remove device', 'error');
            } finally {
                button.disabled = false;
            }
        });

        elements.devicesList.addEventListener('change', async (event) => {
            const select = event.target.closest('.companion-device-preset');
            if (!select) return;
            const deviceId = select.dataset.deviceId;
            const preset = select.value;
            if (!deviceId || !preset) return;

            select.disabled = true;
            try {
                const scope = this.getDefaultCompanionScope(preset);
                const result = await window.electronAPI.companion.updateDevicePermissions(deviceId, scope);
                if (result?.success === false) throw new Error(result.error || 'Failed to update device permissions');
                await refresh();
                this.mainPanel?.showNotification?.('Device permissions updated');
            } catch (error) {
                this.mainPanel?.showNotification?.(error.message || 'Failed to update device permissions', 'error');
            } finally {
                select.disabled = false;
            }
        });

        const settingsTabButton = document.querySelector('[data-tab="settings"]');
        settingsTabButton?.addEventListener('click', () => {
            refresh().catch(() => {});
        });

        document.getElementById('companion-qr-copy-btn')?.addEventListener('click', async () => {
            const payload = document.getElementById('companion-qr-payload')?.value || '';
            const copied = await this.copyToClipboard(payload).catch(() => false);
            this.mainPanel?.showNotification?.(copied ? 'QR link copied' : 'Unable to copy QR link', copied ? 'info' : 'error');
        });
        document.getElementById('companion-qr-close-btn')?.addEventListener('click', () => this.closeCompanionQrModal());
        document.getElementById('companion-qr-modal')?.addEventListener('click', (event) => {
            if (event.target?.id === 'companion-qr-modal') {
                this.closeCompanionQrModal();
            }
        });

        await refresh();
    }

    async initializeSettingsTab() {
        const autoStartCheckbox = document.getElementById('auto-start');
        const minimizeToTrayCheckbox = document.getElementById('minimize-to-tray');
        const typeSizeSlider = document.getElementById('type-size-slider');
        const typePicker = document.getElementById('type-picker');
        const a2aExposeCheckbox = document.getElementById('a2a-expose-enabled');
        const a2aStatusChip = document.getElementById('a2a-status-chip');
        const a2aStatusTip = document.getElementById('a2a-status-tip');
        const companionStartupCheckbox = document.getElementById('companion-startup');
        const workspaceTodoBadgeCheckbox = document.getElementById('workspace-todo-badge');
        const openedContentModeSelect = document.getElementById('settings-opened-content-mode');
        const contentViewerModeSelect = document.getElementById('content-viewer-mode');
        const defaultPrivateChatBehaviorSelect = document.getElementById('default-private-chat-behavior');
        const privateCloseNoConfirmCheckbox = document.getElementById('private-close-no-confirm');
        const toolsCompactCheckbox = document.getElementById('settings-tools-compact');
        const skinManageToggle = document.getElementById('skin-manage-toggle-btn');
        const skinManagePanel = document.getElementById('skin-manage-panel');
        const skinActiveChip = document.getElementById('skin-active-chip');

        const renderA2AStatus = (status = {}) => {
            if (!a2aStatusTip && !a2aStatusChip) return;
            const enabled = status?.enabled === true;
            const running = status?.running === true || status?.configuredEnabled === true;
            const statusText = !enabled
                ? 'A2A discovery is off.'
                : running
                    ? `Listening at ${status.cardUrl || 'localhost'}`
                    : 'Listener is starting.';
            if (a2aStatusChip) {
                a2aStatusChip.hidden = false;
                a2aStatusChip.textContent = !enabled ? 'Off' : (running ? 'Live' : 'Saved');
                a2aStatusChip.dataset.state = !enabled ? 'muted' : (running ? 'live' : 'saved');
                a2aStatusChip.title = statusText;
            }
            if (!enabled) {
                if (a2aStatusTip) {
                    a2aStatusTip.title = '';
                    a2aStatusTip.hidden = true;
                }
                return;
            }
            if (a2aStatusTip) {
                a2aStatusTip.title = statusText;
                a2aStatusTip.hidden = false;
            }
        };

        const syncSkinSummary = () => {
            if (!skinActiveChip) return;
            const skin = window.skinManager?.getSkin?.(window.skinManager?.state?.skinId) || null;
            skinActiveChip.textContent = skin?.name || 'Default';
            skinActiveChip.title = String(skin?.description || 'Default production skin.');
        };
        const syncOpenedContentMode = () => {
            if (!openedContentModeSelect) return;
            const currentMode = window.contentViewer?.mode || contentViewerModeSelect?.value || localStorage.getItem('contentViewerMode');
            openedContentModeSelect.value = currentMode === 'multi' ? 'multi' : 'single';
        };

        if (skinManageToggle && skinManagePanel) {
            skinManageToggle.addEventListener('click', () => {
                const nextHidden = !skinManagePanel.hidden;
                if (!nextHidden) {
                    this.companionAdvancedOpen = false;
                    document.getElementById('companion-advanced-panel')?.setAttribute('hidden', 'hidden');
                    const companionToggle = document.getElementById('companion-toggle-advanced-btn');
                    if (companionToggle) companionToggle.textContent = 'Advanced';
                }
                skinManagePanel.hidden = nextHidden;
                skinManageToggle.textContent = nextHidden ? 'Manage' : 'Hide';
                syncSkinSummary();
            });
            new MutationObserver(syncSkinSummary).observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-active-skin', 'data-theme']
            });
            setTimeout(syncSkinSummary, 0);
        }

        try {
            const settings = await window.electronAPI.getSettings();
            if (autoStartCheckbox) {
                autoStartCheckbox.checked = settings?.auto_start === 'true';
                autoStartCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('auto_start', event.target.checked ? 'true' : 'false');
                });
            }

            if (minimizeToTrayCheckbox) {
                minimizeToTrayCheckbox.checked = settings?.minimize_to_tray === 'true';
                minimizeToTrayCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('minimize_to_tray', event.target.checked ? 'true' : 'false');
                });
            }
            if (companionStartupCheckbox) {
                companionStartupCheckbox.checked = settings?.['companion.enabled'] === 'true';
                companionStartupCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('companion.enabled', event.target.checked ? 'true' : 'false');
                });
            }
            if (workspaceTodoBadgeCheckbox) {
                workspaceTodoBadgeCheckbox.checked = settings?.['todo.visible'] === 'true';
                workspaceTodoBadgeCheckbox.addEventListener('change', async (event) => {
                    if (window.workspaceIndicator?.setTodoVisibleFromUser) {
                        await window.workspaceIndicator.setTodoVisibleFromUser(event.target.checked);
                        return;
                    }
                    await window.electronAPI.saveSetting('todo.visible', event.target.checked ? 'true' : 'false');
                });
            }
            if (openedContentModeSelect) {
                syncOpenedContentMode();
                openedContentModeSelect.addEventListener('change', (event) => {
                    const nextMode = event.target.value === 'multi' ? 'multi' : 'single';
                    if (window.contentViewer?.setMode) {
                        window.contentViewer.setMode(nextMode);
                    } else {
                        localStorage.setItem('contentViewerMode', nextMode);
                        if (contentViewerModeSelect) contentViewerModeSelect.value = nextMode;
                    }
                    syncOpenedContentMode();
                });
                contentViewerModeSelect?.addEventListener('change', syncOpenedContentMode);
            }
            if (defaultPrivateChatBehaviorSelect) {
                defaultPrivateChatBehaviorSelect.value = settings?.['chat.privateDefault'] === 'true' ? 'private' : 'normal';
                defaultPrivateChatBehaviorSelect.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('chat.privateDefault', event.target.value === 'private' ? 'true' : 'false');
                });
            }
            if (privateCloseNoConfirmCheckbox) {
                privateCloseNoConfirmCheckbox.checked = settings?.private_close_no_confirm === 'true';
                privateCloseNoConfirmCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('private_close_no_confirm', event.target.checked ? 'true' : 'false');
                });
            }

            const savedFromSettings = settings?.['ui.typeSize'];
            const savedFromLocal = localStorage.getItem('uiTypeSize');
            const initialTypeSize = this.applyTypeSize(savedFromSettings || savedFromLocal || App.TYPE_SIZE_DEFAULT);

            if (typeSizeSlider) {
                typeSizeSlider.value = `${initialTypeSize}`;
                const saveTypeSize = async (event) => {
                    const nextSize = this.applyTypeSize(event.target.value);
                    localStorage.setItem('uiTypeSize', `${nextSize}`);
                    await window.electronAPI.saveSetting('ui.typeSize', `${nextSize}`);
                    await Promise.resolve(window.electronAPI?.companion?.notifyStateChanged?.('ui', { keys: ['ui.typeSize'] })).catch(() => {});
                };
                typeSizeSlider.addEventListener('input', (event) => this.applyTypeSize(event.target.value));
                typeSizeSlider.addEventListener('change', saveTypeSize);
            }

            const typefaces = await this.loadTypefaces();
            const savedTypeId = settings?.['ui.typeId'] || localStorage.getItem('uiTypeId') || App.TYPEFACE_DEFAULT_ID;
            const initialTypeface = this.renderTypePicker(typePicker, typefaces, savedTypeId);
            if (initialTypeface) {
                const appliedTypeface = this.applyTypeface(initialTypeface);
                localStorage.setItem('uiTypeId', appliedTypeface.id);
                localStorage.setItem('uiTypeFamily', appliedTypeface.family);
            }
            if (typePicker) {
                typePicker.addEventListener('change', async (event) => {
                    const nextTypeface = this.applyTypeface(this.findTypeface(typefaces, event.target.value));
                    localStorage.setItem('uiTypeId', nextTypeface.id);
                    localStorage.setItem('uiTypeFamily', nextTypeface.family);
                    await window.electronAPI.saveSetting('ui.typeId', nextTypeface.id);
                });
            }

            const layoutModeSelect = document.getElementById('layout-mode');
            if (layoutModeSelect) {
                const savedMode = window.LocalAgentLayoutMode?.normalize?.(
                    settings?.['ui.layoutMode'] || localStorage.getItem('ui.layoutMode') || 'desktop'
                ) || 'desktop';
                layoutModeSelect.value = savedMode;
                layoutModeSelect.addEventListener('change', async (event) => {
                    const nextMode = window.LocalAgentLayoutMode?.normalize?.(event.target.value) || 'desktop';
                    this.applyLayoutMode(nextMode);
                    localStorage.setItem('ui.layoutMode', nextMode);
                    await window.electronAPI.saveSetting('ui.layoutMode', nextMode);
                });
            }

            if (toolsCompactCheckbox) {
                toolsCompactCheckbox.checked = window.capabilityPanel?.resolveCompactPreference?.()
                    ?? (localStorage.getItem('ui.toolsCompact') === 'true');
                toolsCompactCheckbox.addEventListener('change', (event) => {
                    const compact = event.target.checked;
                    if (window.capabilityPanel?.applyToolsCompact) {
                        window.capabilityPanel.applyToolsCompact(compact, true);
                        return;
                    }
                    localStorage.setItem('ui.toolsCompact', String(compact));
                });
            }

            if (a2aExposeCheckbox && window.electronAPI?.a2a?.getStatus) {
                const status = await window.electronAPI.a2a.getStatus();
                a2aExposeCheckbox.checked = status?.enabled === true;
                renderA2AStatus(status);
                a2aExposeCheckbox.addEventListener('change', async (event) => {
                    const nextStatus = await window.electronAPI.a2a.setExposure(event.target.checked);
                    a2aExposeCheckbox.checked = nextStatus?.enabled === true;
                    renderA2AStatus(nextStatus);
                });
                if (window.electronAPI?.onA2AStatusUpdate) {
                    window.electronAPI.onA2AStatusUpdate((_event, payload = {}) => {
                        const configuredEnabled = payload?.configuredEnabled === true || a2aExposeCheckbox.checked === true;
                        renderA2AStatus({
                            ...payload,
                            enabled: configuredEnabled,
                            running: payload?.enabled === true || payload?.running === true,
                            configuredEnabled
                        });
                    });
                }
            }
        } catch (error) {
            console.error('Failed to initialize settings tab:', error);
            const fallbackTypeSize = this.applyTypeSize(localStorage.getItem('uiTypeSize') || App.TYPE_SIZE_DEFAULT);
            if (typeSizeSlider) {
                typeSizeSlider.value = `${fallbackTypeSize}`;
                typeSizeSlider.addEventListener('input', (event) => this.applyTypeSize(event.target.value));
                typeSizeSlider.addEventListener('change', (event) => {
                    const nextSize = this.applyTypeSize(event.target.value);
                    localStorage.setItem('uiTypeSize', `${nextSize}`);
                });
            }
            const fallbackTypefaces = this.normalizeTypefaceList(App.DEFAULT_TYPEFACES);
            const fallbackTypeId = localStorage.getItem('uiTypeId') || App.TYPEFACE_DEFAULT_ID;
            const fallbackTypeface = this.renderTypePicker(typePicker, fallbackTypefaces, fallbackTypeId);
            if (fallbackTypeface) {
                const appliedTypeface = this.applyTypeface({
                    ...fallbackTypeface,
                    family: localStorage.getItem('uiTypeFamily') || fallbackTypeface.family
                });
                localStorage.setItem('uiTypeId', appliedTypeface.id);
                localStorage.setItem('uiTypeFamily', appliedTypeface.family);
            }
            if (typePicker) {
                typePicker.addEventListener('change', (event) => {
                    const nextTypeface = this.applyTypeface(this.findTypeface(fallbackTypefaces, event.target.value));
                    localStorage.setItem('uiTypeId', nextTypeface.id);
                    localStorage.setItem('uiTypeFamily', nextTypeface.family);
                });
            }

            const layoutModeSelect = document.getElementById('layout-mode');
            if (layoutModeSelect) {
                const savedMode = window.LocalAgentLayoutMode?.normalize?.(
                    localStorage.getItem('ui.layoutMode') || 'desktop'
                ) || 'desktop';
                layoutModeSelect.value = savedMode;
                layoutModeSelect.addEventListener('change', (event) => {
                    const nextMode = window.LocalAgentLayoutMode?.normalize?.(event.target.value) || 'desktop';
                    this.applyLayoutMode(nextMode);
                    localStorage.setItem('ui.layoutMode', nextMode);
                });
            }

            if (toolsCompactCheckbox) {
                toolsCompactCheckbox.checked = localStorage.getItem('ui.toolsCompact') === 'true';
                toolsCompactCheckbox.addEventListener('change', (event) => {
                    localStorage.setItem('ui.toolsCompact', String(event.target.checked));
                });
            }
            renderA2AStatus({ enabled: false });
        }

        await this.initializeCompanionSettings();
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.initializeTheme();

    // Privacy: Delete All Conversations modal handlers
    const deleteBtn = document.getElementById('delete-all-conversations-btn');
    const modal = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const confirmBtn = document.getElementById('confirm-delete-btn');

    if (deleteBtn && modal) {
        deleteBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });

        cancelBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.textContent = 'Deleting...';
            confirmBtn.disabled = true;

            try {
                await window.electronAPI.deleteAllConversations();
                modal.classList.add('hidden');
                // Refresh the UI
                location.reload();
            } catch (error) {
                console.error('Failed to delete conversations:', error);
                confirmBtn.textContent = 'Error! Try Again';
                confirmBtn.disabled = false;
            }
        });
    }
});
