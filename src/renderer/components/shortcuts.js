// Keyboard shortcuts handler
class ShortcutsManager {
    constructor() {
        this.shortcuts = {
            'ctrl+n': () => this.newChat(),
            'ctrl+k': () => this.focusInput(),
            'ctrl+/': () => this.toggleRules(),
            'ctrl+shift+c': () => this.copyLastResponse(),
            'escape': () => this.closeModals()
        };
        this.init();
    }

    init() {
        document.addEventListener('keydown', (e) => {
            const key = this.getKeyCombo(e);
            if (this.shortcuts[key]) {
                e.preventDefault();
                this.shortcuts[key]();
            }
        });
    }

    getKeyCombo(e) {
        const parts = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        parts.push(e.key.toLowerCase());
        return parts.join('+');
    }

    newChat() {
        // Ctrl+N clears the current chat in-place (same tab)
        window.mainPanel?.clearCurrentChat?.();
    }

    focusInput() {
        const input = document.getElementById('message-input');
        if (input) input.focus();
    }

    toggleRules() {
        const llmTab = document.querySelector('[data-tab="llm"]');
        if (llmTab) llmTab.click();
    }

    copyLastResponse() {
        const messages = document.querySelectorAll('.message.assistant');
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            navigator.clipboard.writeText(lastMsg.textContent);
            this.showToast('Response copied!');
        }
    }

    closeModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(m => m.remove());
    }

    showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background: #333; color: white; padding: 12px 20px;
            border-radius: 8px; z-index: 10000;
            animation: fadeIn 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    showHelp() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>⌨️ Keyboard Shortcuts</h3>
                <div class="shortcuts-list">
                    <div class="shortcut-item">
                        <kbd>Ctrl+N</kbd>
                        <span>New Chat</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Ctrl+K</kbd>
                        <span>Focus Input</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Ctrl+/</kbd>
                        <span>Toggle Rules</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Ctrl+Shift+C</kbd>
                        <span>Copy Last Response</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Escape</kbd>
                        <span>Close Modals</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Enter</kbd>
                        <span>Send Message</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Shift+Enter</kbd>
                        <span>New Line</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="primary-btn close-help">Got it!</button>
                </div>
            </div>
        `;

        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 1000;
        `;

        modal.querySelector('.modal-content').style.cssText = `
            background: white; padding: 2rem; border-radius: 8px;
            width: 400px; max-width: 90%;
        `;

        modal.querySelector('.close-help').addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
    }
}

// Add event listeners for help and stats buttons
document.addEventListener('DOMContentLoaded', () => {
    window.shortcuts = new ShortcutsManager();

    setTimeout(() => {
        const bindShortcuts = () => window.shortcuts.showHelp();
        document.getElementById('show-shortcuts-btn')?.addEventListener('click', bindShortcuts);
        document.getElementById('statusbar-show-shortcuts-btn')?.addEventListener('click', bindShortcuts);

        const bindStats = () => window.statsTracker?.showStats();
        document.getElementById('show-stats-btn')?.addEventListener('click', bindStats);
        document.getElementById('statusbar-show-stats-btn')?.addEventListener('click', bindStats);
    }, 1000);
});

