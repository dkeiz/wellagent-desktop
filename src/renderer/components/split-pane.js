/**
 * SplitPane - resizable drag handle between chat and content viewer.
 * Persists the split ratio to localStorage.
 */
(function () {
    class SplitPane {
        static DEFAULT_RATIO = 0.72;
        static MIN_CHAT = 0.62;
        static MIN_RATIO = 0.1;
        static MAX_RATIO = 0.9;
        static MIN_CHAT_PX = 300;
        static MIN_VIEWER_PX = 280;
        static HANDLE_WIDTH_PX = 5;
        static STORAGE_KEY = 'splitPaneRatio';

        constructor() {
            this.handle = document.getElementById('split-handle');
            this.chatPanel = document.getElementById('chat-tab');
            this.viewerPanel = document.getElementById('content-viewer-panel');
            this.appContainer = document.querySelector('.app-container');

            if (!this.handle || !this.viewerPanel) return;

            this.dragging = false;
            this.ratio = this._loadRatio();

            this._applyRatio();
            this._bindEvents();
        }

        _loadRatio() {
            const saved = parseFloat(localStorage.getItem(SplitPane.STORAGE_KEY));
            if (Number.isFinite(saved) && saved >= SplitPane.MIN_RATIO && saved <= SplitPane.MAX_RATIO) {
                return saved;
            }
            localStorage.setItem(SplitPane.STORAGE_KEY, String(SplitPane.DEFAULT_RATIO));
            return SplitPane.DEFAULT_RATIO;
        }

        _saveRatio() {
            localStorage.setItem(SplitPane.STORAGE_KEY, String(this.ratio));
        }

        _applyRatio() {
            this.ratio = this._clampRatioForCurrentWidth(this.ratio);
            const chatPercent = (this.ratio * 100).toFixed(2);
            const viewerPercent = ((1 - this.ratio) * 100).toFixed(2);

            document.documentElement.style.setProperty('--chat-flex', `0 0 ${chatPercent}%`);
            document.documentElement.style.setProperty('--viewer-flex', `0 0 clamp(280px, ${viewerPercent}%, 420px)`);
        }

        _bindEvents() {
            this.handle.addEventListener('mousedown', (e) => this._onDragStart(e));
            this.handle.addEventListener('touchstart', (e) => this._onDragStart(e), { passive: false });

            // Double-click to reset
            this.handle.addEventListener('dblclick', () => {
                this.ratio = SplitPane.DEFAULT_RATIO;
                this._applyRatio();
                this._saveRatio();
            });
        }

        _onDragStart(e) {
            e.preventDefault();
            this.dragging = true;
            this.handle.classList.add('dragging');
            this.appContainer?.classList.add('split-dragging');

            const contentPanel = this.handle.parentElement;
            if (!contentPanel) return;

            const onMove = (moveEvent) => {
                const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
                const rect = contentPanel.getBoundingClientRect();
                let newRatio = (clientX - rect.left) / rect.width;

                this.ratio = this._clampRatioForWidth(newRatio, rect.width);
                this._applyRatio();
            };

            const onEnd = () => {
                this.dragging = false;
                this.handle.classList.remove('dragging');
                this.appContainer?.classList.remove('split-dragging');
                this._saveRatio();

                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        }

        reset() {
            this.ratio = SplitPane.DEFAULT_RATIO;
            this._applyRatio();
            this._saveRatio();
        }

        _clampRatioForCurrentWidth(ratio) {
            const contentPanel = this.handle?.parentElement;
            const width = contentPanel?.getBoundingClientRect?.().width || 0;
            return this._clampRatioForWidth(ratio, width);
        }

        _clampRatioForWidth(ratio, totalWidth) {
            const normalizedRatio = Number.isFinite(ratio) ? ratio : SplitPane.DEFAULT_RATIO;
            if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
                return Math.max(SplitPane.MIN_RATIO, Math.min(SplitPane.MAX_RATIO, normalizedRatio));
            }

            const usableWidth = Math.max(1, totalWidth - SplitPane.HANDLE_WIDTH_PX);
            const minRatio = Math.max(SplitPane.MIN_RATIO, SplitPane.MIN_CHAT, SplitPane.MIN_CHAT_PX / usableWidth);
            const maxRatio = Math.min(SplitPane.MAX_RATIO, 1 - (SplitPane.MIN_VIEWER_PX / usableWidth));

            if (minRatio > maxRatio) {
                return Math.max(SplitPane.MIN_RATIO, Math.min(SplitPane.MAX_RATIO, normalizedRatio));
            }

            return Math.max(minRatio, Math.min(maxRatio, normalizedRatio));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.splitPane = new SplitPane();
        });
    } else {
        window.splitPane = new SplitPane();
    }
})();
