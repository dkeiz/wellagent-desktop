class RuleManager {
    constructor() {
        this.initialize();
    }

    initialize() {
        this.setupEventListeners();
        this.loadPromptRules();
    }

    setupEventListeners() {
        const addRuleBtn = document.getElementById('add-rule-btn');
        if (addRuleBtn) {
            addRuleBtn.addEventListener('click', () => this.showAddRuleModal());
        }

        const rulesSection = document.querySelector('.llm-settings');
        if (!rulesSection) return;

        document.getElementById('export-rules-btn')?.addEventListener('click', () => this.exportRules());
        document.getElementById('import-rules-btn')?.addEventListener('click', () => {
            document.getElementById('import-rules-file').click();
        });
        document.getElementById('import-rules-file')?.addEventListener('change', (e) => this.importRules(e));
    }

    async loadPromptRules() {
        try {
            const rules = await window.electronAPI.getPromptRules();
            const container = document.getElementById('prompt-rules-list');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (rules.length === 0) {
                container.innerHTML = '<p class="no-rules">No custom rules yet. Add one to get started!</p>';
                return;
            }
            
            rules.forEach(rule => {
                const ruleEl = document.createElement('div');
                ruleEl.className = 'prompt-rule-item';
                ruleEl.dataset.rule = JSON.stringify(rule);

                ruleEl.innerHTML = `
                    <div class="rule-header">
                        <input type="checkbox" class="rule-toggle" data-id="${rule.id}" ${rule.active ? 'checked' : ''}>
                        <div class="rule-name-container">
                            <span class="rule-name">${rule.name}</span>
                        </div>
                        <div class="rule-actions">
                            <button class="icon-btn edit-rule" title="Edit rule">✏️</button>
                            <button class="icon-btn delete-rule" title="Delete rule">🗑️</button>
                        </div>
                    </div>
                    <div class="rule-content-container">
                        <div class="rule-content">${rule.content}</div>
                    </div>
                `;
                
                ruleEl.querySelector('.rule-toggle').addEventListener('change', (e) => {
                    this.toggleRule(rule.id, e.target.checked);
                });
                
                ruleEl.querySelector('.edit-rule').addEventListener('click', (e) => {
                    this.switchToEditMode(e.currentTarget.closest('.prompt-rule-item'));
                });

                ruleEl.querySelector('.delete-rule').addEventListener('click', () => {
                    this.deleteRule(rule.id);
                });
                
                container.appendChild(ruleEl);
            });
        } catch (error) {
            console.error('Error loading prompt rules:', error);
        }
    }

    switchToEditMode(ruleEl) {
        if (ruleEl.classList.contains('editing')) return;
        ruleEl.classList.add('editing');

        const rule = JSON.parse(ruleEl.dataset.rule);

        const nameContainer = ruleEl.querySelector('.rule-name-container');
        const contentContainer = ruleEl.querySelector('.rule-content-container');
        const actionsContainer = ruleEl.querySelector('.rule-actions');

        nameContainer.innerHTML = `<input type="text" class="rule-name-input" value="${rule.name}">`;
        contentContainer.innerHTML = `<textarea class="rule-content-input">${rule.content}</textarea>`;
        actionsContainer.innerHTML = `
            <button class="primary-btn apply-changes">Apply</button>
            <button class="secondary-btn cancel-edit">Cancel</button>
        `;

        actionsContainer.querySelector('.apply-changes').addEventListener('click', async () => {
            const newName = nameContainer.querySelector('input').value;
            const newContent = contentContainer.querySelector('textarea').value;
            
            try {
                await window.electronAPI.updatePromptRule(rule.id, { ...rule, name: newName, content: newContent });
                this.showNotification('Rule updated');
                this.loadPromptRules();
            } catch (error) {
                this.showNotification('Failed to update rule', 'error');
                console.error(error);
            }
        });

        actionsContainer.querySelector('.cancel-edit').addEventListener('click', () => {
            this.loadPromptRules();
        });
    }

    showAddRuleModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Add Custom Rule</h3>
                <form id="rule-form">
                    <label>
                        Rule Name:
                        <input type="text" name="name" placeholder="e.g., Concise Answers" required>
                    </label>
                    <label>
                        Rule Content:
                        <textarea name="content" rows="4" placeholder="e.g., Answer only in 20 words" required></textarea>
                    </label>
                    <div class="modal-actions">
                        <button type="button" class="secondary-btn cancel-btn">Cancel</button>
                        <button type="submit" class="primary-btn">Add Rule</button>
                    </div>
                </form>
            </div>
        `;

        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const newRuleData = { name: formData.get('name'), content: formData.get('content'), type: 'rule' };
            
            try {
                await window.electronAPI.addPromptRule(newRuleData);
                await this.loadPromptRules();
                modal.remove();
                this.showNotification('Rule added successfully');
            } catch (error) {
                console.error('Error adding rule:', error);
                alert('Error adding rule: ' + error.message);
            }
        });
        
        modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
    }

    async toggleRule(id, active) {
        try {
            await window.electronAPI.togglePromptRule(id, active);
            this.showNotification(active ? 'Rule activated' : 'Rule deactivated');
        } catch (error) {
            console.error('Error toggling rule:', error);
            this.showNotification('Error toggling rule', 'error');
        }
    }

    async deleteRule(id) {
        if (confirm('Are you sure you want to delete this rule?')) {
            try {
                await window.electronAPI.deletePromptRule(id);
                await this.loadPromptRules();
                this.showNotification('Rule deleted');
            } catch (error) {
                console.error('Error deleting rule:', error);
                this.showNotification('Error deleting rule', 'error');
            }
        }
    }

    async exportRules() {
        try {
            const rules = await window.electronAPI.getPromptRules();
            const data = {
                version: '1.0',
                exported: new Date().toISOString(),
                rules: rules.map(r => ({ name: r.name, content: r.content, type: r.type }))
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `localagent-rules-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showNotification('Rules exported successfully!');
        } catch (error) {
            console.error('Export error:', error);
            this.showNotification('Export failed', 'error');
        }
    }

    async importRules(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.rules || !Array.isArray(data.rules)) {
                throw new Error('Invalid rules file format');
            }
            let imported = 0;
            for (const rule of data.rules) {
                await window.electronAPI.addPromptRule(rule);
                imported++;
            }
            await this.loadPromptRules();
            this.showNotification(`Imported ${imported} rules!`);
        } catch (error) {
            console.error('Import error:', error);
            this.showNotification('Import failed: ' + error.message, 'error');
        }
        event.target.value = '';
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.ruleManager = new RuleManager();
});
