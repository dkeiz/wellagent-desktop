/**
 * PluginSidebarWidget — Renderer component that manages plugin sidebar widgets.
 * Fetches registered sidebar widgets from the backend via IPC and injects their
 * HTML/CSS into the #plugin-sidebar-widgets slot in the right column.
 * Also bridges chat events to widget actions for reactive behavior (e.g. avatar emotions).
 */
(function () {
    class PluginSidebarWidget {
        constructor() {
            this.container = document.getElementById('plugin-sidebar-widgets');
            this._mountedWidgets = new Map();
            this._styleElements = new Map();
            this._openStatusbarWidgetId = null;
            this._handleDocumentPointerDown = this._handleDocumentPointerDown.bind(this);
            this._handleWindowBlur = this._handleWindowBlur.bind(this);
            this._handleWindowResize = this._handleWindowResize.bind(this);

            if (!this.container) return;

            this._bindEvents();
            this.load();
        }

        _bindEvents() {
            // Reload when plugins change state
            if (window.electronAPI?.onPluginStateChanged) {
                window.electronAPI.onPluginStateChanged(() => this.load());
            }
            if (window.electronAPI?.onConversationUpdate) {
                window.electronAPI.onConversationUpdate((event, data = {}) => {
                    const messages = Array.isArray(data.messages) ? data.messages : [];
                    const last = messages[messages.length - 1];
                    if (!last?.content) return;
                    this.broadcastEvent('chat-message', {
                        role: last.role || '',
                        text: String(last.content).slice(0, 500)
                    });
                });
            }
            if (window.electronAPI?.onAgentUpdate) {
                window.electronAPI.onAgentUpdate((event, data = {}) => {
                    this.broadcastEvent('agent-update', data || {});
                });
            }

            document.addEventListener('pointerdown', this._handleDocumentPointerDown);
            window.addEventListener('blur', this._handleWindowBlur);
            window.addEventListener('resize', this._handleWindowResize);
        }

        async load() {
            if (!this.container) return;
            try {
                const widgets = await window.electronAPI.plugins.getSidebarWidgets();
                this._render(widgets || []);
            } catch (e) {
                console.error('[PluginSidebarWidget] Failed to load sidebar widgets:', e);
            }
        }

        _render(widgets) {
            // Remove widgets that are no longer registered
            for (const [id] of this._mountedWidgets) {
                if (!widgets.some(w => w.id === id)) {
                    this._unmountWidget(id);
                }
            }

            const layoutMode = document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';

            // Add or update widgets
            for (const widget of widgets) {
                const mounted = this._mountedWidgets.get(widget.id);
                const expectedContainer = (this._isStatusbarAvatarWidget(widget.id, layoutMode))
                    ? document.getElementById('status-bar-avatar')
                    : this.container;

                if (mounted) {
                    const currentContainer = mounted.wrapper.parentNode;
                    if (currentContainer !== expectedContainer || this._widgetChanged(mounted.widget, widget)) {
                        this._unmountWidget(widget.id);
                        this._mountWidget(widget);
                    } else {
                        mounted.widget = widget;
                    }
                    continue;
                }
                this._mountWidget(widget);
            }

            // Toggle container visibility based on whether it has children mounted to it
            let hasSidebarWidgets = false;
            for (const [id, mounted] of this._mountedWidgets) {
                if (mounted.wrapper.parentNode === this.container) {
                    hasSidebarWidgets = true;
                    break;
                }
            }
            this.container.style.display = hasSidebarWidgets ? '' : 'none';
        }

        _mountWidget(widget) {
            // Inject CSS
            if (widget.css) {
                const style = document.createElement('style');
                style.dataset.pluginWidget = widget.id;
                style.textContent = widget.css;
                document.head.appendChild(style);
                this._styleElements.set(widget.id, style);
            }

            // Create widget container
            const wrapper = document.createElement('div');
            wrapper.className = 'plugin-sidebar-widget-item collapsible-widget';
            wrapper.dataset.widgetId = widget.id;
            wrapper.dataset.pluginId = widget.pluginId;

            // Header
            if (widget.chrome !== false) {
                const header = document.createElement('div');
                header.className = 'widget-header';
                header.innerHTML = `<span>${this._escapeHtml(widget.title)}</span><span class="collapse-arrow"><svg class="arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg></span>`;
                header.addEventListener('click', (e) => {
                    if (e.target.closest('.collapse-arrow')) {
                        const collapsed = wrapper.classList.toggle('collapsed');
                        window.LocalAgentLayoutMode?.setSidebarSectionCollapsed?.(`pluginWidget.${widget.id}`, collapsed);
                    }
                });
                wrapper.appendChild(header);
            } else {
                wrapper.classList.add('no-chrome');
            }

            const layoutMode = document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';
            const isStatusbarAvatarWidget = this._isStatusbarAvatarWidget(widget.id, layoutMode);

            // Content
            const content = document.createElement('div');
            content.className = 'widget-content';
            if (isStatusbarAvatarWidget) {
                content.innerHTML = this._createStatusbarAvatarPreviewHtml(widget);
            } else {
                content.innerHTML = widget.html;
            }

            wrapper.appendChild(content);

            const targetContainer = isStatusbarAvatarWidget
                ? document.getElementById('status-bar-avatar')
                : this.container;

            if (targetContainer) {
                targetContainer.appendChild(wrapper);
            }
            let flyoutWrapper = null;
            if (isStatusbarAvatarWidget) {
                this._setupStatusbarAvatarWidget(wrapper, widget.id);
                flyoutWrapper = this._createStatusbarAvatarFlyout(widget);
            } else if (targetContainer === this.container) {
                window.LocalAgentLayoutMode?.applyPluginWidgetCompaction?.(widget.id, wrapper, layoutMode);
            }

            this._mountedWidgets.set(widget.id, { wrapper, flyoutWrapper, widget });

            // Wire action buttons
            wrapper.querySelectorAll('[data-sidebar-action]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.sidebarAction;
                    this._runAction(widget, action, {});
                });
            });
            flyoutWrapper?.querySelectorAll('[data-sidebar-action]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.sidebarAction;
                    this._runAction(widget, action, {});
                });
            });

            // Initialize scripts if the widget HTML contains them
            if (!isStatusbarAvatarWidget) {
                this._executeScripts(content);
            }
            if (flyoutWrapper) {
                this._executeScripts(flyoutWrapper.querySelector('.widget-content'));
            }
        }

        _unmountWidget(id) {
            const entry = this._mountedWidgets.get(id);
            if (this._openStatusbarWidgetId === id) {
                this._closeStatusbarFlyout();
            }
            if (entry?.wrapper) {
                entry.wrapper.dispatchEvent(new CustomEvent('sidebar-widget-unmount'));
                entry.wrapper.remove();
            }
            if (entry?.flyoutWrapper) {
                entry.flyoutWrapper.dispatchEvent(new CustomEvent('sidebar-widget-unmount'));
                entry.flyoutWrapper.remove();
            }
            const style = this._styleElements.get(id);
            if (style) {
                style.remove();
                this._styleElements.delete(id);
            }
            this._mountedWidgets.delete(id);
        }

        _widgetChanged(previous = {}, next = {}) {
            return previous.html !== next.html
                || previous.css !== next.css
                || previous.chrome !== next.chrome
                || previous.title !== next.title
                || previous.pluginId !== next.pluginId;
        }

        _isStatusbarAvatarWidget(widgetId, layoutMode) {
            return layoutMode === 'desktop' && widgetId === 'pixel-avatar-widget';
        }

        _setupStatusbarAvatarWidget(wrapper, widgetId) {
            wrapper.classList.add('statusbar-avatar-widget');
            wrapper.setAttribute('role', 'button');
            wrapper.setAttribute('tabindex', '0');
            wrapper.setAttribute('aria-expanded', 'false');
            wrapper.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._toggleStatusbarFlyout(widgetId);
            });
            wrapper.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                this._toggleStatusbarFlyout(widgetId);
            });
        }

        _createStatusbarAvatarPreviewHtml(widget) {
            const previewSrc = this._extractAvatarPreviewSrc(widget.html);
            if (!previewSrc) {
                return '<div class="statusbar-avatar-fallback" aria-hidden="true">A</div>';
            }
            return `<img class="statusbar-avatar-preview" src="${this._escapeAttribute(previewSrc)}" alt="Avatar">`;
        }

        _extractAvatarPreviewSrc(html) {
            const match = String(html || '').match(/data-avatar-preview-src="([^"]+)"/i);
            return match ? this._decodeHtml(match[1]) : '';
        }

        _createStatusbarAvatarFlyout(widget) {
            const flyoutWrapper = document.createElement('div');
            flyoutWrapper.className = 'plugin-sidebar-widget-item no-chrome avatar-flyout-panel';
            flyoutWrapper.dataset.widgetId = widget.id;
            flyoutWrapper.dataset.pluginId = widget.pluginId;
            flyoutWrapper.setAttribute('aria-hidden', 'true');

            const content = document.createElement('div');
            content.className = 'widget-content';
            content.innerHTML = this._createAvatarFlyoutHtml(widget);
            flyoutWrapper.appendChild(content);

            document.body.appendChild(flyoutWrapper);
            return flyoutWrapper;
        }

        _createAvatarFlyoutHtml(widget) {
            const baseCanvasId = `pixel-avatar-canvas-${widget.id}`;
            const flyoutCanvasId = `${baseCanvasId}-flyout`;
            return String(widget.html || '').split(baseCanvasId).join(flyoutCanvasId);
        }

        _toggleStatusbarFlyout(widgetId) {
            if (this._openStatusbarWidgetId === widgetId) {
                this._closeStatusbarFlyout();
                return;
            }
            this._openStatusbarFlyout(widgetId);
        }

        _openStatusbarFlyout(widgetId) {
            const entry = this._mountedWidgets.get(widgetId);
            const anchor = document.getElementById('status-bar-avatar');
            if (!entry?.flyoutWrapper || !anchor) {
                return;
            }

            this._closeStatusbarFlyout();
            this._openStatusbarWidgetId = widgetId;
            this._positionStatusbarFlyout(entry.flyoutWrapper, anchor);
            entry.wrapper?.setAttribute('aria-expanded', 'true');
            entry.flyoutWrapper.classList.add('avatar-flyout-open');
            entry.flyoutWrapper.setAttribute('aria-hidden', 'false');
        }

        _closeStatusbarFlyout() {
            if (!this._openStatusbarWidgetId) {
                return;
            }
            const entry = this._mountedWidgets.get(this._openStatusbarWidgetId);
            if (entry?.wrapper) {
                entry.wrapper.setAttribute('aria-expanded', 'false');
            }
            if (entry?.flyoutWrapper) {
                entry.flyoutWrapper.classList.remove('avatar-flyout-open');
                entry.flyoutWrapper.setAttribute('aria-hidden', 'true');
                entry.flyoutWrapper.style.left = '';
                entry.flyoutWrapper.style.bottom = '';
            }
            this._openStatusbarWidgetId = null;
        }

        _positionStatusbarFlyout(wrapper, anchor) {
            const rect = anchor.getBoundingClientRect();
            const cornerAnchor = document.getElementById('status-bar-calendar')
                || anchor.closest('.status-bar-right')
                || anchor;
            const cornerRect = cornerAnchor.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const flyoutWidth = 224;
            const margin = 4;
            const gap = 4;
            const left = Math.max(
                margin,
                Math.min(cornerRect.right - flyoutWidth, viewportWidth - flyoutWidth - margin)
            );
            const bottom = Math.max(margin, window.innerHeight - rect.top + gap);
            wrapper.style.left = `${left}px`;
            wrapper.style.bottom = `${bottom}px`;
        }

        _handleDocumentPointerDown(event) {
            if (!this._openStatusbarWidgetId) {
                return;
            }
            const entry = this._mountedWidgets.get(this._openStatusbarWidgetId);
            const anchor = document.getElementById('status-bar-avatar');
            const target = event.target;
            if (entry?.wrapper?.contains(target) || anchor?.contains(target)) {
                return;
            }
        }

        _handleWindowBlur() {
            this._closeStatusbarFlyout();
        }

        _handleWindowResize() {
            if (!this._openStatusbarWidgetId) {
                return;
            }
            const entry = this._mountedWidgets.get(this._openStatusbarWidgetId);
            const anchor = document.getElementById('status-bar-avatar');
            if (entry?.flyoutWrapper && anchor) {
                this._positionStatusbarFlyout(entry.flyoutWrapper, anchor);
            }
        }

        _executeScripts(container) {
            // Re-execute <script> tags that were injected via innerHTML
            const scripts = container.querySelectorAll('script');
            scripts.forEach(oldScript => {
                const newScript = document.createElement('script');
                if (oldScript.src) {
                    newScript.src = oldScript.src;
                } else {
                    newScript.textContent = oldScript.textContent;
                }
                oldScript.replaceWith(newScript);
            });
        }

        async _handleActionResult(result = {}) {
            if (result?.openSidebarTab && window.sidebar?.switchTab) {
                window.sidebar.switchTab(String(result.openSidebarTab));
            }

            const openAgentSlug = String(
                result?.openAgentSlug
                || result?.openAgentChat?.agentSlug
                || ''
            ).trim();
            if (openAgentSlug) {
                const agents = await window.electronAPI?.agents?.list?.('pro');
                const target = (Array.isArray(agents) ? agents : []).find((agent) =>
                    String(agent?.slug || '').trim() === openAgentSlug
                );
                if (!target?.id) {
                    throw new Error(`Agent slug "${openAgentSlug}" not found`);
                }
                const activation = await window.electronAPI.agents.activate(target.id);
                if (!activation?.sessionId) {
                    throw new Error(`Failed to activate agent "${openAgentSlug}"`);
                }
                await window.mainPanel?.openAgentChat?.(target.id, activation.sessionId, activation.agent || target);
            }

            if (result?.openPluginStudio && window.electronAPI?.plugins?.openStudio) {
                await window.electronAPI.plugins.openStudio(result.openPluginStudio || {});
            }

            if (result?.refresh === true) {
                await this.load();
            }
        }

        async _runAction(widget, action, payload) {
            try {
                if (!widget?.actionNames?.includes(action)) {
                    return;
                }
                const response = await window.electronAPI.plugins.runSidebarWidgetAction(widget.id, action, payload || {});
                if (!response?.success) {
                    throw new Error(response?.error || `Sidebar widget action "${action}" failed`);
                }
                await this._handleActionResult(response.result || {});
            } catch (e) {
                console.error(`[PluginSidebarWidget] Action "${action}" failed:`, e);
            }
        }

        /**
         * Public API: Send an event to all mounted sidebar widgets.
         * Used by the chat system to notify widgets of chat activity.
         */
        broadcastEvent(eventName, payload = {}) {
            for (const [, entry] of this._mountedWidgets) {
                const targets = [entry.wrapper, entry.flyoutWrapper].filter(Boolean);
                targets.forEach((wrapper) => {
                    const event = new CustomEvent('sidebar-widget-event', {
                        detail: { event: eventName, ...payload }
                    });
                    wrapper.dispatchEvent(event);
                });
            }
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        _escapeAttribute(text) {
            return this._escapeHtml(text).replace(/"/g, '&quot;');
        }

        _decodeHtml(text) {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text || '';
            return textarea.value;
        }
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window._pluginSidebarWidget = new PluginSidebarWidget();
        });
    } else {
        window._pluginSidebarWidget = new PluginSidebarWidget();
    }
})();
