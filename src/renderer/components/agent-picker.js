/**
 * AgentPickerWidget — Splits agent display by type:
 * - Pro agents in the left sidebar.
 * - Sub-agents in the right widget panel (same visual style as before).
 *
 * Subagent area click opens Subagent Manager tab.
 */
class AgentPickerWidget {
    constructor() {
        this.agents = [];
        this.initializeEvents();
    }

    initializeEvents() {
        this.loadAgents();
        this.bindSubagentWidgetOpen();
        this.bindSuperagentManagerOpen();

        const addBtn = document.getElementById('add-agent-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAgentConfigModal());
        }

        document.addEventListener('open-agent-config', (event) => {
            const agentId = Number(event?.detail?.agentId);
            if (!Number.isFinite(agentId)) return;
            this.showAgentConfigModal(agentId);
        });

        window.electronAPI.onAgentUpdate(() => {
            this.loadAgents();
        });
    }

    bindSubagentWidgetOpen() {
        const widget = document.querySelector('.subagent-picker-widget');
        if (!widget) return;
        const header = document.getElementById('toggle-subagents-widget');
        const content = document.getElementById('subagents-widget-content');

        const openManager = async () => {
            if (!window.app?.mainPanel?.openSubagentManagerTab) return;
            await window.app.mainPanel.openSubagentManagerTab();
        };

        if (header) {
            header.addEventListener('click', (event) => {
                if (event.target.closest('.collapse-arrow')) {
                    const collapsed = widget.classList.toggle('collapsed');
                    window.LocalAgentLayoutMode?.setSidebarSectionCollapsed?.('subagents', collapsed);
                    return;
                }
                openManager();
            });
        }

        if (content) {
            content.addEventListener('click', (event) => {
                if (event.target.closest('.agent-item')) return;
                openManager();
            });
        }
    }

    bindSuperagentManagerOpen() {
        const header = document.getElementById('toggle-superagents-widget');
        if (!header) return;
        header.addEventListener('click', async (event) => {
            if (event.target.closest('.collapse-arrow')) {
                const widget = header.closest('.sidebar-agent-block');
                const collapsed = Boolean(widget?.classList.toggle('collapsed'));
                window.LocalAgentLayoutMode?.setSidebarSectionCollapsed?.('agents', collapsed);
                return;
            }
            if (!window.app?.mainPanel?.openSuperagentManagerTab) return;
            await window.app.mainPanel.openSuperagentManagerTab();
        });
    }

    async loadAgents() {
        try {
            this.agents = await window.electronAPI.agents.list();
            this.renderAgents();
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }

    renderAgents() {
        const proContainer = document.getElementById('agent-list');
        const subContainer = document.getElementById('subagent-list');
        if (proContainer) proContainer.innerHTML = '';
        if (subContainer) subContainer.innerHTML = '';

        const isShown = (agent) => agent.visibleInSidebar !== false && agent.visible_in_sidebar !== 0;
        const allProAgents = this.agents.filter(a => a.type === 'pro');
        const allSubAgents = this.agents.filter(a => a.type === 'sub');
        const proAgents = allProAgents.filter(isShown);
        const subAgents = allSubAgents.filter(isShown);

        if (proContainer && proAgents.length > 0) {
            const proGrid = document.createElement('div');
            proGrid.className = 'agent-grid';
            proAgents.forEach(agent => {
                proGrid.appendChild(this._createAgentItem(agent, { isSubagent: false }));
            });
            proContainer.appendChild(proGrid);
        } else if (proContainer) {
            proContainer.innerHTML = `<p class="no-agents">${allProAgents.length > 0 ? 'No pro agents shown' : 'No pro agents configured'}</p>`;
        }

        if (subContainer && subAgents.length > 0) {
            const subGrid = document.createElement('div');
            subGrid.className = 'agent-grid';
            subAgents.forEach(agent => {
                subGrid.appendChild(this._createAgentItem(agent, { isSubagent: true }));
            });
            subContainer.appendChild(subGrid);
        } else if (subContainer) {
            subContainer.innerHTML = `<p class="no-agents">${allSubAgents.length > 0 ? 'No sub-agents shown' : 'No sub-agents configured'}</p>`;
        }
    }

    _createAgentItem(agent, { isSubagent = false } = {}) {
        const item = document.createElement('div');
        item.className = `agent-item ${agent.status === 'active' ? 'active' : ''}`;
        item.dataset.agentId = agent.id;
        item.title = `${agent.name}\n${agent.description || ''}`;

        item.innerHTML = `
            <span class="agent-icon">${agent.icon}</span>
            <span class="agent-name">${agent.name}</span>
            <span class="agent-status-dot ${agent.status}"></span>
        `;

        item.addEventListener('click', async (e) => {
            if (e.target.closest('.agent-config-btn')) return;
            e.stopPropagation();
            if (isSubagent && window.app?.mainPanel?.openSubagentManagerTab) {
                await window.app.mainPanel.openSubagentManagerTab();
                return;
            }
            this.activateAgent(agent.id);
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showAgentConfigModal(agent.id);
        });

        return item;
    }

    async activateAgent(agentId) {
        try {
            const result = await window.electronAPI.agents.activate(agentId);
            if (result && result.sessionId) {
                // Open or switch to the agent's chat tab
                if (window.app && window.app.mainPanel) {
                    await window.app.mainPanel.openAgentChat(agentId, result.sessionId, result.agent);
                }
            }
        } catch (error) {
            console.error('Error activating agent:', error);
        }
    }

    showAgentConfigModal(agentId = null) {
        const isEdit = agentId !== null;
        const existingAgent = isEdit ? this.agents.find(a => a.id === agentId) : null;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content agent-config-modal">
                <h3>${isEdit ? 'Edit Agent' : 'Create Agent'}</h3>
                <form id="agent-config-form">
                    <label>
                        Name:
                        <input type="text" name="name" value="${existingAgent?.name || ''}" required>
                    </label>
                    <label>
                        Type:
                        <select name="type">
                            <option value="pro" ${(!existingAgent || existingAgent.type === 'pro') ? 'selected' : ''}>Pro Agent</option>
                            <option value="sub" ${existingAgent?.type === 'sub' ? 'selected' : ''}>Sub Agent</option>
                        </select>
                    </label>
                    <label>
                        Icon:
                        <div class="icon-picker" id="icon-picker">
                            ${this._renderIconPicker(existingAgent?.icon || '🤖')}
                        </div>
                        <input type="hidden" name="icon" value="${existingAgent?.icon || '🤖'}">
                    </label>
                    <label>
                        Description:
                        <input type="text" name="description" value="${existingAgent?.description || ''}" placeholder="Brief description...">
                    </label>
                    <label>
                        System Prompt:
                        <textarea name="system_prompt" rows="8" placeholder="Define this agent's behavior...">${existingAgent?.system_prompt || ''}</textarea>
                    </label>
                    ${isEdit ? `
                    <fieldset id="agent-permissions-section" style="margin-top:0.9rem;">
                        <legend>Agent Permissions</legend>
                        <div id="agent-permissions-content">Loading permissions...</div>
                    </fieldset>` : ''}
                    <div class="modal-actions">
                        ${isEdit ? '<button type="button" class="danger-btn delete-agent-btn">Delete</button>' : ''}
                        <button type="button" class="secondary-btn cancel-btn">Cancel</button>
                        <button type="submit" class="primary-btn">${isEdit ? 'Save' : 'Create'}</button>
                    </div>
                </form>
            </div>
        `;

        // Modal styling
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
        `;

        const content = modal.querySelector('.modal-content');
        content.style.cssText = `
            background: var(--bg-primary, #fff); color: var(--text-primary, #222);
            padding: 1.5rem; border-radius: 8px;
            width: 500px; max-width: 90%; max-height: 80vh; overflow-y: auto;
        `;

        // Icon picker click handler
        modal.querySelectorAll('.icon-option').forEach(opt => {
            opt.addEventListener('click', () => {
                modal.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                modal.querySelector('input[name="icon"]').value = opt.dataset.icon;
            });
        });

        // Form submit
        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                name: formData.get('name'),
                type: formData.get('type'),
                icon: formData.get('icon'),
                description: formData.get('description'),
                system_prompt: formData.get('system_prompt')
            };

            try {
                if (isEdit) {
                    await window.electronAPI.agents.update(agentId, data);
                    await this.saveAgentPermissionEditor(modal, agentId);
                } else {
                    await window.electronAPI.agents.create(data);
                }
                modal.remove();
            } catch (error) {
                console.error('Error saving agent:', error);
                alert('Error saving agent: ' + error.message);
            }
        });

        // Delete button
        const deleteBtn = modal.querySelector('.delete-agent-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Delete agent "${existingAgent.name}"?`)) {
                    try {
                        await window.electronAPI.agents.delete(agentId);
                        modal.remove();
                    } catch (error) {
                        console.error('Error deleting agent:', error);
                    }
                }
            });
        }

        // Cancel
        modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.body.appendChild(modal);

        if (isEdit) {
            this.renderAgentPermissionEditor(modal, agentId);
        }
    }

    _renderIconPicker(selectedIcon) {
        const icons = ['🤖', '🔍', '🔬', '📂', '📊', '🌐', '💻', '🧠', '📝', '🎯', '⚡', '🛡️', '🔧', '📡', '🎨', '📈'];
        return icons.map(icon =>
            `<span class="icon-option ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</span>`
        ).join('');
    }

    async renderAgentPermissionEditor(modal, agentId) {
        const host = modal.querySelector('#agent-permissions-content');
        if (!host) return;

        try {
            const [profileResult, visibleTools, inventoryTools] = await Promise.all([
                window.electronAPI.permissions.getAgentProfile(agentId),
                window.electronAPI.getMCPTools({ agentId }),
                window.electronAPI.getMCPToolInventory()
            ]);
            const profile = profileResult?.profile || {};
            const toolStates = profileResult?.toolStates || {};
            const activePresetId = String(profileResult?.activePresetId || profile.preset_id || '').trim();
            const visibleToolNames = new Set(visibleTools.filter(tool => tool?.name).map(tool => tool.name));
            const otherTools = inventoryTools.filter(tool => tool?.name && !visibleToolNames.has(tool.name));
            const groupFields = [
                ['main', 'main_enabled', 'Main Switch'],
                ['unsafe', 'unsafe_enabled', 'Unsafe'],
                ['web', 'web_enabled', 'Web'],
                ['ports', 'ports_enabled', 'Ports'],
                ['visual', 'visual_enabled', 'Visual']
            ];

            const groupsHtml = groupFields.map(([groupId, field, label]) => `
                <label style="display:inline-flex;gap:0.35rem;align-items:center;margin-right:0.8rem;margin-bottom:0.3rem;">
                    <input type="checkbox" data-agent-group="${groupId}" ${profile[field] === 1 ? 'checked' : ''}>
                    <span>${label}</span>
                </label>
            `).join('');

            const renderToolToggle = (tool) => {
                const checked = toolStates[tool.name] === true;
                return `<label style="display:block;font-size:0.85rem;">
                    <input type="checkbox" data-agent-tool="${tool.name}" ${checked ? 'checked' : ''}>
                    <span>${tool.name}</span>
                </label>`;
            };
            const visibleToolsHtml = visibleTools
                .filter(tool => tool?.name)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(renderToolToggle)
                .join('');
            const otherToolsHtml = otherTools
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(renderToolToggle)
                .join('');

            host.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.7rem;padding:0.55rem 0.7rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
                    <div>
                        <div style="font-size:0.82rem;font-weight:600;">Permission Preset</div>
                        <div style="font-size:0.8rem;opacity:0.82;">
                            ${activePresetId === 'developer'
                                ? 'Developer preset active. Manual permission edits will exit preset mode.'
                                : 'Uses global defaults unless you enable a preset or change permissions here.'}
                        </div>
                    </div>
                    <button type="button" class="secondary-btn" id="toggle-developer-agent-profile-btn">
                        ${activePresetId === 'developer' ? 'Disable Developer Profile' : 'Enable Developer Profile'}
                    </button>
                </div>
                <div style="margin-bottom:0.6rem;">
                    ${groupsHtml}
                </div>
                <label style="display:block;margin-bottom:0.6rem;">
                    Files Mode:
                    <select data-agent-group="files" style="margin-left:0.4rem;">
                        <option value="off" ${profile.files_mode === 'off' ? 'selected' : ''}>off</option>
                        <option value="read" ${profile.files_mode === 'read' ? 'selected' : ''}>read</option>
                        <option value="full" ${profile.files_mode === 'full' ? 'selected' : ''}>full</option>
                    </select>
                </label>
                <label style="display:block;margin-bottom:0.6rem;">
                    Terminal Mode:
                    <select data-agent-group="terminal" style="margin-left:0.4rem;">
                        <option value="off" ${profile.terminal_mode === 'off' ? 'selected' : ''}>off</option>
                        <option value="workspace" ${profile.terminal_mode !== 'off' && profile.terminal_mode !== 'system' ? 'selected' : ''}>workspace</option>
                        <option value="system" ${profile.terminal_mode === 'system' ? 'selected' : ''}>system</option>
                    </select>
                    <button type="button" class="secondary-btn" id="reset-agent-permissions-btn" style="margin-left:0.5rem;">Reset To Global</button>
                </label>
                <details open>
                    <summary>Visible by default (${visibleTools.length})</summary>
                    <div style="max-height:180px;overflow:auto;border:1px solid var(--border-color);padding:0.4rem;margin-top:0.4rem;">
                        ${visibleToolsHtml || '<div style="font-size:0.82rem;opacity:0.8;">No tools are visible by default for this agent.</div>'}
                    </div>
                </details>
                <details style="margin-top:0.6rem;">
                    <summary>Other registered tools (${otherTools.length})</summary>
                    <div style="max-height:180px;overflow:auto;border:1px solid var(--border-color);padding:0.4rem;margin-top:0.4rem;">
                        ${otherToolsHtml || '<div style="font-size:0.82rem;opacity:0.8;">No additional registered tools.</div>'}
                    </div>
                </details>
            `;

            const resetBtn = modal.querySelector('#reset-agent-permissions-btn');
            const toggleDeveloperBtn = modal.querySelector('#toggle-developer-agent-profile-btn');
            if (toggleDeveloperBtn) {
                toggleDeveloperBtn.addEventListener('click', async () => {
                    if (activePresetId === 'developer') {
                        await window.electronAPI.permissions.resetAgentProfile(agentId);
                    } else {
                        await window.electronAPI.permissions.applyAgentPreset(agentId, 'developer');
                    }
                    await this.renderAgentPermissionEditor(modal, agentId);
                });
            }
            if (resetBtn) {
                resetBtn.addEventListener('click', async () => {
                    await window.electronAPI.permissions.resetAgentProfile(agentId);
                    await this.renderAgentPermissionEditor(modal, agentId);
                });
            }
        } catch (error) {
            host.textContent = `Failed to load permissions: ${error.message}`;
        }
    }

    async saveAgentPermissionEditor(modal, agentId) {
        const host = modal.querySelector('#agent-permissions-content');
        if (!host) return;

        const groupToggles = host.querySelectorAll('input[data-agent-group]');
        for (const toggle of groupToggles) {
            const groupId = toggle.dataset.agentGroup;
            const value = toggle.checked;
            await window.electronAPI.permissions.setAgentGroup(agentId, groupId, value);
        }

        const filesSelect = host.querySelector('select[data-agent-group="files"]');
        if (filesSelect) {
            await window.electronAPI.permissions.setAgentGroup(agentId, 'files', filesSelect.value);
        }

        const terminalSelect = host.querySelector('select[data-agent-group="terminal"]');
        if (terminalSelect) {
            await window.electronAPI.permissions.setAgentGroup(agentId, 'terminal', terminalSelect.value);
        }

        const toolToggles = host.querySelectorAll('input[data-agent-tool]');
        for (const toggle of toolToggles) {
            await window.electronAPI.permissions.setAgentTool(agentId, toggle.dataset.agentTool, toggle.checked);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.agentPicker = new AgentPickerWidget();
});
