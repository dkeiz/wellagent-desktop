// Usage statistics tracker
class StatsTracker {
    constructor() {
        this.stats = this.loadStats();
        this.init();
    }

    loadStats() {
        const saved = localStorage.getItem('localagent-stats');
        return saved ? JSON.parse(saved) : {
            messagesCount: 0,
            rulesUsed: {},
            toolsCalled: {},
            sessionsStarted: 0,
            lastUsed: null
        };
    }

    saveStats() {
        localStorage.setItem('localagent-stats', JSON.stringify(this.stats));
    }

    init() {
        window.localAgentRendererShell?.registerPanelMethodWrapper('sendMessage', 'stats', (originalSendMessage) => async function wrappedSendMessage() {
                window.statsTracker.trackMessage();
                return originalSendMessage.apply(this, arguments);
        });

        window.localAgentRendererShell?.registerPanelMethodWrapper('newChat', 'stats', (originalNewChat) => async function wrappedNewChat() {
                window.statsTracker.trackNewSession();
                return originalNewChat.apply(this, arguments);
        });

        this.stats.lastUsed = new Date().toISOString();
        this.saveStats();
    }

    trackMessage() {
        this.stats.messagesCount++;
        this.stats.lastUsed = new Date().toISOString();
        this.saveStats();
    }

    trackNewSession() {
        this.stats.sessionsStarted++;
        this.saveStats();
    }

    trackRuleUsage(ruleName) {
        this.stats.rulesUsed[ruleName] = (this.stats.rulesUsed[ruleName] || 0) + 1;
        this.saveStats();
    }

    trackToolCall(toolName) {
        this.stats.toolsCalled[toolName] = (this.stats.toolsCalled[toolName] || 0) + 1;
        this.saveStats();
    }

    getStats() {
        return { ...this.stats };
    }

    showStats() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📊 Usage Statistics</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">${this.stats.messagesCount}</div>
                        <div class="stat-label">Messages Sent</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${this.stats.sessionsStarted}</div>
                        <div class="stat-label">Chats Started</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${Object.keys(this.stats.rulesUsed).length}</div>
                        <div class="stat-label">Rules Created</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${Object.keys(this.stats.toolsCalled).length}</div>
                        <div class="stat-label">Tools Used</div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary-btn close-stats">Close</button>
                    <button class="secondary-btn reset-stats">Reset Stats</button>
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
            width: 500px; max-width: 90%;
        `;

        modal.querySelector('.close-stats').addEventListener('click', () => modal.remove());
        modal.querySelector('.reset-stats').addEventListener('click', () => {
            if (confirm('Reset all statistics?')) {
                this.resetStats();
                modal.remove();
            }
        });

        document.body.appendChild(modal);
    }

    resetStats() {
        this.stats = {
            messagesCount: 0,
            rulesUsed: {},
            toolsCalled: {},
            sessionsStarted: 0,
            lastUsed: new Date().toISOString()
        };
        this.saveStats();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.statsTracker = new StatsTracker();
    }, 1000);
});
