(function () {
    const MANAGER_TAB_IDS = new Set(['subagent-manager', 'superagent-manager']);

    function isManagerTab(sessionId) {
        return MANAGER_TAB_IDS.has(String(sessionId || ''));
    }

    function getFolderLabel(rawPath) {
        const normalized = String(rawPath || '').replace(/[\\/]+$/, '');
        if (!normalized) return 'Workspace';
        const parts = normalized.split(/[\\/]/).filter(Boolean);
        return parts[parts.length - 1] || normalized;
    }

    function isTruthySetting(value) {
        return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
    }

    class WorkspaceIndicator {
        constructor() {
            this.context = null;
            this.activeSessionId = window.mainPanel?.activeTabId ?? null;
            this.todoState = { visible: false, todos: [] };
            this.todoExpanded = false;
            this.elements = {};
            this.ensureMounted();
            this.bindEvents();
            this.refreshContext().catch(error => console.warn('Workspace context load failed:', error));
            this.refreshTodos().catch(error => console.warn('Todo state load failed:', error));
        }

        runUiAction(action, fallbackMessage = 'Workspace action failed') {
            Promise.resolve()
                .then(() => action())
                .catch((error) => {
                    console.warn(fallbackMessage, error);
                    this.notify(`${fallbackMessage}: ${error.message}`, 'error');
                });
        }

        requireContextResult(result, actionLabel = 'Workspace action') {
            if (result?.success === false) {
                throw new Error(result.error || `${actionLabel} failed`);
            }
            if (!result || typeof result.rootPath !== 'string') {
                throw new Error(`${actionLabel} returned an invalid context`);
            }
            return result;
        }

        bindEvents() {
            document.addEventListener('chat-tab-switched', (event) => {
                this.handleTabSwitched(event.detail || {});
            });

            if (window.electronAPI?.onExecutionContextUpdate) {
                window.electronAPI.onExecutionContextUpdate((_event, context) => {
                    this.applyContext(context || null);
                });
            }

            if (window.electronAPI?.onTodoUpdate) {
                window.electronAPI.onTodoUpdate(() => {
                    this.refreshTodos().catch(error => console.warn('Todo refresh failed:', error));
                });
            }

            document.addEventListener('click', (event) => {
                if (!this.todoExpanded || !this.elements.anchor) return;
                if (!this.elements.anchor.contains(event.target)) {
                    this.setTodoExpanded(false);
                }
            });

            window.addEventListener('resize', () => this.syncMountTarget(), { passive: true });
        }

        ensureMounted() {
            if (this.elements.shell) return true;

            const anchor = document.createElement('div');
            anchor.className = 'workspace-status-anchor';

            const row = document.createElement('div');
            row.className = 'workspace-status-row';

            const shell = document.createElement('div');
            shell.className = 'workspace-control-shell';
            shell.hidden = true;

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'workspace-chip';
            chip.title = 'Change workspace';
            chip.innerHTML = `
                <span class="workspace-chip-icon">⌂</span>
                <span class="workspace-chip-copy">
                    <span class="workspace-chip-name">Default</span>
                </span>
            `;
            chip.addEventListener('click', () => {
                this.runUiAction(() => this.openModal(), 'Workspace dialog failed');
            });
            shell.appendChild(chip);

            const todoFlag = document.createElement('button');
            todoFlag.type = 'button';
            todoFlag.className = 'workspace-todo-flag';
            todoFlag.hidden = true;
            todoFlag.setAttribute('aria-hidden', 'true');
            todoFlag.setAttribute('aria-expanded', 'false');
            todoFlag.title = 'Show active todos';
            todoFlag.innerHTML = `
                <span class="workspace-todo-icon">☑</span>
                <span class="workspace-todo-progress"></span>
            `;
            todoFlag.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setTodoExpanded(!this.todoExpanded);
            });

            const todoDropdown = document.createElement('div');
            todoDropdown.className = 'workspace-todo-dropdown';
            todoDropdown.hidden = true;

            row.appendChild(shell);
            row.appendChild(todoFlag);
            anchor.appendChild(row);
            anchor.appendChild(todoDropdown);

            anchor.addEventListener('mouseleave', () => this.setTodoExpanded(false), { passive: true });
            anchor.addEventListener('focusout', (event) => {
                if (!anchor.contains(event.relatedTarget)) {
                    this.setTodoExpanded(false);
                }
            });

            this.elements = {
                anchor,
                shell,
                chip,
                chipName: chip.querySelector('.workspace-chip-name'),
                todoFlag,
                todoProgress: todoFlag.querySelector('.workspace-todo-progress'),
                todoDropdown
            };
            this.syncMountTarget();
            this.updateVisibility();
            return true;
        }

        resolveMountTarget() {
            const artifactsBtn = document.getElementById('artifacts-btn');
            const target = artifactsBtn?.parentElement || document.querySelector('.chat-provider-row');
            return target instanceof HTMLElement ? { target, before: artifactsBtn } : null;
        }

        syncMountTarget() {
            if (!this.elements.anchor) return false;
            const resolved = this.resolveMountTarget();
            if (!resolved?.target) return false;
            const { target, before } = resolved;
            if (before && before.parentElement === target) {
                if (this.elements.anchor.parentElement !== target || this.elements.anchor.nextSibling !== before) {
                    target.insertBefore(this.elements.anchor, before);
                }
                return true;
            }
            if (this.elements.anchor.parentElement !== target) {
                target.appendChild(this.elements.anchor);
            }
            return true;
        }

        handleTabSwitched(detail) {
            this.activeSessionId = detail?.sessionId ?? null;
            this.syncMountTarget();
            this.updateVisibility();
            this.refreshContext().catch(error => console.warn('Workspace refresh failed:', error));
            this.refreshTodos().catch(error => console.warn('Todo refresh failed:', error));
        }

        updateVisibility() {
            if (!this.elements.shell) return;
            const shouldHide = !this.activeSessionId || isManagerTab(this.activeSessionId);
            this.elements.shell.hidden = shouldHide;
            if (shouldHide) {
                this.setTodoExpanded(false);
                if (this.elements.todoFlag) this.elements.todoFlag.hidden = true;
            }
        }

        async refreshContext() {
            if (!window.electronAPI?.execution?.getContext) return;
            const context = this.requireContextResult(
                await window.electronAPI.execution.getContext(),
                'Workspace context load'
            );
            this.applyContext(context || null);
        }

        async refreshTodos() {
            if (!this.ensureMounted()) return;
            if (!window.electronAPI?.getTodos || !window.electronAPI?.getSetting) return;

            const sessionId = this.activeSessionId && !isManagerTab(this.activeSessionId)
                ? this.activeSessionId
                : null;
            const [todos, visibleValue] = await Promise.all([
                sessionId ? window.electronAPI.getTodos(sessionId) : Promise.resolve([]),
                window.electronAPI.getSetting('todo.visible')
            ]);
            this.applyTodoState(Array.isArray(todos) ? todos : [], isTruthySetting(visibleValue));
        }

        applyTodoState(todos, visible) {
            this.todoState = { visible: Boolean(visible), todos: Array.isArray(todos) ? todos : [] };
            this.renderTodoDropdown();
        }

        getTodoCounts() {
            const todos = this.todoState.todos || [];
            const total = todos.length;
            const done = todos.filter(todo => todo.completed === true || todo.completed === 1).length;
            const active = total - done;
            return { total, done, active };
        }

        renderTodoDropdown() {
            if (!this.elements.todoFlag || !this.elements.todoDropdown) return;
            const { total, done, active } = this.getTodoCounts();
            const shouldShow = this.todoState.visible && active > 0;

            this.elements.todoFlag.hidden = !shouldShow;
            this.elements.todoFlag.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
            this.elements.todoProgress.textContent = shouldShow ? `${done}/${total}` : '';

            if (!shouldShow) {
                this.setTodoExpanded(false);
                this.elements.todoDropdown.replaceChildren();
                return;
            }

            const header = document.createElement('div');
            header.className = 'workspace-todo-header';

            const title = document.createElement('div');
            title.className = 'workspace-todo-title';
            title.textContent = 'Active todos';

            const progress = document.createElement('strong');
            progress.textContent = `${done}/${total} done`;

            const hideButton = document.createElement('button');
            hideButton.type = 'button';
            hideButton.className = 'workspace-todo-hide';
            hideButton.textContent = 'Hide';
            hideButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.runUiAction(() => this.setTodoVisibleFromUser(false), 'Todo visibility update failed');
            });

            header.appendChild(title);
            header.appendChild(progress);
            header.appendChild(hideButton);

            const list = document.createElement('div');
            list.className = 'workspace-todo-list';

            this.todoState.todos.forEach((todo) => {
                const item = document.createElement('div');
                const completed = todo.completed === true || todo.completed === 1;
                item.className = completed ? 'workspace-todo-item completed' : 'workspace-todo-item';

                const marker = document.createElement('span');
                marker.className = 'workspace-todo-marker';
                marker.textContent = completed ? '✓' : '•';

                const text = document.createElement('span');
                text.className = 'workspace-todo-text';
                text.textContent = String(todo.task || `Todo ${todo.id || ''}`).trim();

                item.appendChild(marker);
                item.appendChild(text);
                list.appendChild(item);
            });

            this.elements.todoDropdown.replaceChildren(header, list);
            this.setTodoExpanded(this.todoExpanded);
        }

        setTodoExpanded(expanded) {
            const { active } = this.getTodoCounts();
            this.todoExpanded = Boolean(expanded && this.todoState.visible && active > 0);
            this.elements.todoFlag?.setAttribute('aria-expanded', this.todoExpanded ? 'true' : 'false');
            if (this.elements.todoDropdown) {
                this.elements.todoDropdown.hidden = !this.todoExpanded;
                this.elements.todoDropdown.classList.toggle('expanded', this.todoExpanded);
            }
        }

        async setTodoVisibleFromUser(visible) {
            if (!window.electronAPI?.saveSetting) return;
            await window.electronAPI.saveSetting('todo.visible', visible ? 'true' : 'false');
            this.applyTodoState(this.todoState.todos, visible);
        }

        applyContext(context) {
            this.context = context;
            if (!this.ensureMounted()) return;

            const rootPath = String(context?.rootPath || '');
            const folderLabel = getFolderLabel(rootPath);
            this.elements.chipName.textContent = folderLabel;
            this.elements.chip.title = rootPath || 'Change workspace';
            this.elements.chip.dataset.source = context?.source || 'default';
            this.updateVisibility();
            this.refreshModalState();
        }

        ensureModal() {
            if (this.elements.backdrop?.isConnected) return;

            const backdrop = document.createElement('div');
            backdrop.className = 'modal workspace-modal-shell';
            backdrop.innerHTML = `
                <div class="modal-content workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title">
                    <div class="workspace-modal-header">
                        <div>
                            <h3 id="workspace-modal-title">Workspace</h3>
                            <p>Used by file tools, terminal tools, and provider working directories.</p>
                        </div>
                        <button type="button" class="workspace-modal-close" aria-label="Close workspace dialog">×</button>
                    </div>
                    <label class="workspace-field">
                        <span>Current folder</span>
                        <input type="text" class="workspace-path-input" spellcheck="false" />
                    </label>
                    <div class="workspace-modal-meta">
                        <div><span>Mode</span><strong class="workspace-current-mode">Default</strong></div>
                        <div><span>Default</span><strong class="workspace-default-path">—</strong></div>
                    </div>
                    <div class="workspace-modal-actions">
                        <button type="button" class="secondary-btn compact-btn workspace-pick-btn">Choose Folder</button>
                        <button type="button" class="secondary-btn compact-btn workspace-reset-btn">Use Default</button>
                        <div class="workspace-modal-spacer"></div>
                        <button type="button" class="secondary-btn compact-btn workspace-cancel-btn">Cancel</button>
                        <button type="button" class="compact-btn workspace-apply-btn">Apply</button>
                    </div>
                </div>
            `;

            document.body.appendChild(backdrop);

            const close = () => this.closeModal();
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) close();
            });
            backdrop.querySelector('.workspace-modal-close').addEventListener('click', close);
            backdrop.querySelector('.workspace-cancel-btn').addEventListener('click', close);
            backdrop.querySelector('.workspace-pick-btn').addEventListener('click', () => {
                this.runUiAction(() => this.pickDirectory(), 'Workspace folder picker failed');
            });
            backdrop.querySelector('.workspace-reset-btn').addEventListener('click', () => {
                this.runUiAction(() => this.resetRoot(), 'Workspace reset failed');
            });
            backdrop.querySelector('.workspace-apply-btn').addEventListener('click', () => {
                this.runUiAction(() => this.applyRoot(), 'Workspace update failed');
            });

            this.elements.backdrop = backdrop;
            this.elements.pathInput = backdrop.querySelector('.workspace-path-input');
            this.elements.mode = backdrop.querySelector('.workspace-current-mode');
            this.elements.defaultPath = backdrop.querySelector('.workspace-default-path');
            this.elements.resetBtn = backdrop.querySelector('.workspace-reset-btn');
        }

        focusChatInput() {
            const input = document.getElementById('message-input');
            if (!input || typeof input.focus !== 'function') {
                return false;
            }
            input.focus();
            if (typeof input.setSelectionRange === 'function') {
                const length = String(input.value || '').length;
                input.setSelectionRange(length, length);
            }
            return true;
        }

        async openModal() {
            this.ensureModal();
            if (!this.context) {
                try {
                    await this.refreshContext();
                } catch (error) {
                    console.warn('Workspace context refresh failed before modal open:', error);
                }
            }
            this.refreshModalState();
            this.elements.pathInput?.focus();
            this.elements.pathInput?.select();
        }

        closeModal() {
            if (!this.elements.backdrop) return;
            this.elements.backdrop.remove();
            this.elements.backdrop = null;
            this.elements.pathInput = null;
            this.elements.mode = null;
            this.elements.defaultPath = null;
            this.elements.resetBtn = null;
            this.focusChatInput();
        }

        refreshModalState() {
            if (!this.elements.backdrop || !this.context) return;
            const rootPath = String(this.context.rootPath || '');
            const defaultRoot = String(this.context.defaultRoot || '');
            const isDefault = (this.context.source || 'default') !== 'configured';
            this.elements.pathInput.value = rootPath;
            this.elements.mode.textContent = isDefault ? 'Default' : 'Custom';
            this.elements.defaultPath.textContent = defaultRoot || '—';
            this.elements.resetBtn.disabled = isDefault;
        }

        async pickDirectory() {
            if (!window.electronAPI?.dialogs?.pickDirectory) return;
            const result = await window.electronAPI.dialogs.pickDirectory({
                title: 'Select workspace folder'
            });
            if (!result?.canceled && result?.filePath && this.elements.pathInput) {
                this.elements.pathInput.value = result.filePath;
            }
        }

        async applyRoot() {
            const nextPath = String(this.elements.pathInput?.value || '').trim();
            if (!nextPath) return;
            try {
                const context = this.requireContextResult(
                    await window.electronAPI.execution.setRoot(nextPath),
                    'Workspace update'
                );
                this.applyContext(context || null);
                this.closeModal();
                this.notify(`Workspace set to ${getFolderLabel(context?.rootPath)}`);
            } catch (error) {
                this.notify(`Workspace update failed: ${error.message}`, 'error');
            }
        }

        async resetRoot() {
            try {
                const context = this.requireContextResult(
                    await window.electronAPI.execution.clearRoot(),
                    'Workspace reset'
                );
                this.applyContext(context || null);
                this.closeModal();
                this.notify('Workspace reset to default');
            } catch (error) {
                this.notify(`Workspace reset failed: ${error.message}`, 'error');
            }
        }

        notify(message, type = 'success') {
            if (window.mainPanel?.showNotification) {
                window.mainPanel.showNotification(message, type);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.workspaceIndicator = new WorkspaceIndicator();
    });
})();
