/**
 * PluginPanel — Renderer component for the plugins widget in the right column.
 * Loads plugin list via IPC, renders items with enable/disable toggles.
 */
(function () {
    class PluginPanel {
        constructor() {
            this.listEl = document.getElementById('plugins-list');
            this.widgetHeader = document.getElementById('toggle-plugins-widget');
            this.widgetContent = document.getElementById('plugins-widget-content');
            this.plugins = [];

            if (!this.listEl) return;

            this._bindEvents();
            this.load();
        }

        _bindEvents() {
            // Split behavior:
            // - Collapse arrow toggles compact mode.
            // - Left label area opens Plugin Studio.
            if (this.widgetHeader) {
                this.widgetHeader.addEventListener('click', async (event) => {
                    const clickedCollapseArrow = Boolean(event.target.closest('.collapse-arrow'));
                    const widget = this.widgetHeader.closest('.plugins-widget');
                    if (!widget) return;

                    if (clickedCollapseArrow) {
                        const collapsed = widget.classList.toggle('collapsed');
                        window.LocalAgentLayoutMode?.setSidebarSectionCollapsed?.('plugins', collapsed);
                        return;
                    }

                    try {
                        await window.electronAPI.plugins.openStudio({});
                    } catch (error) {
                        console.error('[PluginPanel] Failed to open plugin studio:', error);
                        await this.load();
                    }
                });
            }

            window.electronAPI.onPluginStateChanged(async () => {
                await this.load();
            });
        }

        async load() {
            try {
                await window.electronAPI.plugins.scan();
                this.plugins = await window.electronAPI.plugins.list();
                this.render();
            } catch (e) {
                console.error('[PluginPanel] Failed to load plugins:', e);
            }
        }

        render() {
            if (!this.listEl) return;
            this.listEl.replaceChildren();

            const visiblePlugins = this.plugins.filter((plugin) => plugin.visibleInSidebar !== false);

            if (this.plugins.length === 0 || visiblePlugins.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'no-plugins';
                empty.textContent = this.plugins.length === 0 ? 'No plugins installed' : 'No plugins shown';
                this.listEl.appendChild(empty);
                return;
            }

            visiblePlugins.forEach((plugin) => {
                const item = document.createElement('div');
                item.className = 'plugin-item';
                item.dataset.id = plugin.id;

                const info = document.createElement('div');
                info.className = 'plugin-info';

                const status = document.createElement('span');
                status.className = `plugin-status ${plugin.status}`;
                info.appendChild(status);

                const name = document.createElement('span');
                name.className = 'plugin-name';
                name.textContent = plugin.name;
                info.appendChild(name);

                info.addEventListener('click', async () => {
                    try {
                        await window.electronAPI.plugins.openStudio({ focusPluginId: plugin.id });
                    } catch (error) {
                        console.error('[PluginPanel] Failed to open studio for plugin:', error);
                    }
                });

                const toggleBtn = document.createElement('button');
                toggleBtn.className = `plugin-toggle-btn ${plugin.status === 'enabled' ? 'active' : ''}`;
                toggleBtn.dataset.id = plugin.id;
                toggleBtn.dataset.status = plugin.status;
                toggleBtn.title = plugin.status === 'enabled' ? 'Disable' : 'Enable';
                toggleBtn.textContent = plugin.status === 'enabled' ? 'ON' : 'OFF';

                toggleBtn.addEventListener('click', async () => {
                    const id = toggleBtn.dataset.id;
                    const currentStatus = toggleBtn.dataset.status;
                    try {
                        let result;
                        if (currentStatus === 'enabled') {
                            result = await window.electronAPI.plugins.disable(id);
                        } else {
                            result = await window.electronAPI.plugins.enable(id);
                        }
                        if (!result?.success) {
                            throw new Error(result?.error || 'Plugin toggle failed');
                        }
                        await this.load(); // Refresh
                    } catch (err) {
                        console.error('[PluginPanel] Toggle failed:', err);
                        window.mainPanel?.showNotification?.(err.message || 'Plugin toggle failed', 'error');
                    }
                });

                item.appendChild(info);
                item.appendChild(toggleBtn);
                this.listEl.appendChild(item);
            });
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new PluginPanel());
    } else {
        new PluginPanel();
    }
})();
