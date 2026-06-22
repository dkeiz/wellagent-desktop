class ToolCallPreview {
    constructor() {
        this.storageKey = 'showToolCallsInChat';
        this.visible = localStorage.getItem(this.storageKey) !== 'false';
        this.items = new Map();
        this.maxVisible = 2;
        this.bindSetting();
        this.bindEvents();
        this.patchMessageLifecycle();
    }

    bindSetting() {
        const checkbox = document.getElementById('show-tool-calls');
        if (!checkbox) return;
        checkbox.checked = this.visible;
        checkbox.addEventListener('change', async () => {
            this.visible = checkbox.checked;
            localStorage.setItem(this.storageKey, this.visible ? 'true' : 'false');
            await window.electronAPI?.saveSetting?.('ui.showToolCalls', this.visible ? 'true' : 'false');
            if (!this.visible) this.clear();
        });
        window.electronAPI?.getSettings?.().then((settings) => {
            const saved = settings?.['ui.showToolCalls'];
            if (saved === 'true' || saved === 'false') {
                this.visible = saved === 'true';
                checkbox.checked = this.visible;
                localStorage.setItem(this.storageKey, saved);
            }
        }).catch(() => {});
    }

    bindEvents() {
        window.electronAPI?.onToolPreviewUpdate?.((event, data) => {
            this.upsert(data || {});
        });
    }

    patchMessageLifecycle() {
        window.localAgentRendererShell?.registerPanelMethodWrapper('addMessage', 'tool-call-preview', (originalAddMessage) => function patchedAddMessage(role, content, style) {
                if (window.toolCallPreview && ((role === 'assistant' && content !== '...') || role === 'system')) {
                    window.toolCallPreview.clear();
                }
                return originalAddMessage(role, content, style);
            });

        window.localAgentRendererShell?.registerTabMethodWrapper('saveCurrentTabMessages', 'tool-call-preview', (originalSave) => function patchedSave(panel) {
                window.toolCallPreview?.clear();
                return originalSave(panel);
            });
    }

    upsert(data) {
        if (!this.visible) return;
        const panel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel;
        if (data.sessionId && panel?.activeTabId && String(data.sessionId) !== String(panel.activeTabId)) {
            return;
        }
        const id = data.toolCallId || `${data.toolName}-${Date.now()}`;
        const previous = this.items.get(id) || {};
        this.items.set(id, { ...previous, ...data, id, updatedAt: Date.now() });
        while (this.items.size > this.maxVisible) {
            const oldest = [...this.items.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
            if (!oldest) break;
            this.items.delete(oldest.id);
        }
        this.render();
    }

    clear() {
        this.items.clear();
        const root = document.getElementById('tool-call-preview');
        if (root) root.remove();
    }

    render() {
        const container = document.getElementById('messages-container');
        if (!container || this.items.size === 0) return;
        let root = document.getElementById('tool-call-preview');
        if (!root) {
            root = document.createElement('div');
            root.id = 'tool-call-preview';
            root.className = 'tool-call-preview';
        }
        root.innerHTML = '';
        [...this.items.values()]
            .sort((a, b) => a.updatedAt - b.updatedAt)
            .forEach((item) => root.appendChild(this.renderItem(item)));

        const loading = container.querySelector('.message-wrapper.assistant .message.loading');
        const loadingWrapper = loading?.closest('.message-wrapper');
        if (loadingWrapper) {
            container.insertBefore(root, loadingWrapper);
        } else {
            container.appendChild(root);
        }
        container.scrollTop = container.scrollHeight;
    }

    renderItem(item) {
        const row = document.createElement('div');
        const status = item.status || (item.success === false ? 'error' : 'queued');
        row.className = `tool-call-preview-item ${status}`;
        const title = document.createElement('div');
        title.className = 'tool-call-preview-title';
        title.textContent = `${status === 'queued' ? 'Queued' : status === 'error' ? 'Error' : 'Done'}: ${item.toolName || 'tool'}`;
        const params = document.createElement('div');
        params.className = 'tool-call-preview-params';
        params.textContent = `Params: ${this.compactJson(item.params || {})}`;
        const result = document.createElement('div');
        result.className = 'tool-call-preview-result';
        result.textContent = this.resultPreview(item);
        row.appendChild(title);
        row.appendChild(params);
        row.appendChild(result);
        return row;
    }

    compactJson(value) {
        try {
            return this.truncate(JSON.stringify(value), 180);
        } catch (_) {
            return '{}';
        }
    }

    resultPreview(item) {
        if ((item.status || '') === 'queued') return 'Waiting for tool result...';
        if (item.error) return `Error: ${this.truncate(item.error, 180)}`;
        return `Result: ${this.truncate(this.stringifyResult(item.result), 220)}`;
    }

    stringifyResult(result) {
        if (result === undefined || result === null) return '';
        if (typeof result === 'string') return result;
        try {
            return JSON.stringify(result);
        } catch (_) {
            return String(result);
        }
    }

    truncate(text, max) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.toolCallPreview = new ToolCallPreview();
});
