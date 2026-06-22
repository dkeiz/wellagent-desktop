class PromptBehaviorManager {
    constructor() {
        this.storage = {
            mode: 'agentBehaviorMode',
            single: 'agentBehaviorSingleText',
            multi: 'agentBehaviorMultiText',
            minimal: 'agentBehaviorMinimalText'
        };
        this.defaults = {
            single: 'Subagents are available, but use actions in the same chat without subagent calls until the user explicitly asks for a subagent.',
            multi: 'Subagents are available; use them for side tasks efficiently when that helps the main task.',
            minimal: 'Use minimal start context: inspect only the file tree/structure first, do not read skill or knowledge file contents unless the user asks or the task clearly requires it, and discover further with tools as needed.'
        };
        this.markerStart = '<!-- agent-behavior:start -->';
        this.markerEnd = '<!-- agent-behavior:end -->';
        this.mode = localStorage.getItem(this.storage.mode) || 'multi';
        this.suppressPromptInput = false;
        this.saveTimer = null;
        this.bindElements();
        if (!this.prompt || !this.singleText || !this.multiText || !this.minimalText) return;
        this.load();
        this.bindEvents();
    }

    bindElements() {
        this.prompt = document.getElementById('system-prompt');
        this.singleText = document.getElementById('agent-behavior-single');
        this.multiText = document.getElementById('agent-behavior-multi');
        this.minimalText = document.getElementById('agent-behavior-minimal');
        this.options = Array.from(document.querySelectorAll('.agent-behavior-option'));
        this.radios = Array.from(document.querySelectorAll('input[name="agent-behavior-mode"]'));
    }

    async load() {
        this.singleText.value = localStorage.getItem(this.storage.single) || this.defaults.single;
        this.multiText.value = localStorage.getItem(this.storage.multi) || this.defaults.multi;
        this.minimalText.value = localStorage.getItem(this.storage.minimal) || this.defaults.minimal;
        try {
            const prompt = await window.electronAPI?.getSystemPrompt?.();
            if (typeof prompt === 'string') {
                this.prompt.value = prompt;
                this.syncModeFromPrompt(prompt);
            }
        } catch (error) {
            console.error('Failed to load agent behavior prompt state:', error);
        }
        this.applyBehaviorToPrompt();
        this.queueSave();
        this.updateUI();
    }

    bindEvents() {
        this.radios.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                this.mode = ['single', 'multi', 'minimal'].includes(radio.value) ? radio.value : 'multi';
                localStorage.setItem(this.storage.mode, this.mode);
                this.applyBehaviorToPrompt();
                this.queueSave();
                this.updateUI();
            });
        });
        this.singleText.addEventListener('input', () => this.onTextChanged('single'));
        this.multiText.addEventListener('input', () => this.onTextChanged('multi'));
        this.minimalText.addEventListener('input', () => this.onTextChanged('minimal'));
        this.prompt.addEventListener('input', () => {
            if (!this.suppressPromptInput) this.syncModeFromPrompt(this.prompt.value);
        });
    }

    onTextChanged(mode) {
        const key = this.storage[mode] || this.storage.multi;
        const value = this.getTextForMode(mode);
        localStorage.setItem(key, value);
        if (this.mode === mode) {
            this.applyBehaviorToPrompt();
            this.queueSave();
        }
    }

    syncModeFromPrompt(prompt) {
        const block = this.extractBehaviorBlock(prompt);
        if (!block) return;
        const content = block.replace(/^- Agent behavior:\s*/i, '').trim();
        if (content === this.singleText.value.trim()) this.mode = 'single';
        if (content === this.multiText.value.trim()) this.mode = 'multi';
        if (content === this.minimalText.value.trim()) this.mode = 'minimal';
        localStorage.setItem(this.storage.mode, this.mode);
        this.updateUI();
    }

    extractBehaviorBlock(prompt) {
        const start = prompt.indexOf(this.markerStart);
        const end = prompt.indexOf(this.markerEnd);
        if (start < 0 || end < 0 || end <= start) return '';
        return prompt.slice(start + this.markerStart.length, end).trim();
    }

    applyBehaviorToPrompt() {
        const text = this.getTextForMode(this.mode);
        const block = `${this.markerStart}\n- Agent behavior: ${text.trim()}\n${this.markerEnd}`;
        const current = this.prompt.value || '';
        let next = '';
        const start = current.indexOf(this.markerStart);
        const end = current.indexOf(this.markerEnd);
        if (start >= 0 && end > start) {
            next = `${current.slice(0, start).trimEnd()}\n${block}\n${current.slice(end + this.markerEnd.length).trimStart()}`;
        } else if (current.includes('## Behavior')) {
            next = current.replace('## Behavior', `## Behavior\n${block}`);
        } else {
            next = `${current.trimEnd()}\n\n## Behavior\n${block}\n`;
        }
        this.suppressPromptInput = true;
        this.prompt.value = next;
        this.suppressPromptInput = false;
    }

    updateUI() {
        this.radios.forEach((radio) => {
            radio.checked = radio.value === this.mode;
        });
        this.options.forEach((option) => {
            option.classList.toggle('active', option.dataset.behaviorOption === this.mode);
        });
    }

    getTextForMode(mode) {
        if (mode === 'single') return this.singleText.value;
        if (mode === 'minimal') return this.minimalText.value;
        return this.multiText.value;
    }

    queueSave() {
        if (!window.electronAPI?.setSystemPrompt) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(async () => {
            try {
                await window.electronAPI.setSystemPrompt(this.prompt.value);
            } catch (error) {
                console.error('Failed to save agent behavior prompt:', error);
            }
        }, 250);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.promptBehaviorManager = new PromptBehaviorManager();
});
