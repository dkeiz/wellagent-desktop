class Sidebar {
    constructor() {
        this.currentTab = 'chat';
        this.toolActivity = [];
        this.unseenToolCount = 0;
        this.currentSessionId = null;
        this.sessionMetaById = new Map();
        this.agentMetaById = new Map();
        this.pendingSessionMetaIds = new Set();
        this.pendingAgentMetaIds = new Set();
        this.selectedDate = null;
        this.settingsDock = null;
        this.settingsFlyout = null;
        this.isSettingsFlyoutOpen = false;
        this.handleSettingsPointerDown = this.handleSettingsPointerDown.bind(this);
        this.handleSettingsKeyDown = this.handleSettingsKeyDown.bind(this);
        this.handleSettingsWindowBlur = this.handleSettingsWindowBlur.bind(this);
        this.initializeEvents();
        this.setupToolListeners();
        this.loadChatSessions();
        this.setupCollapsibleSections();
        this.setupCapabilityListener();
        this.setupTabContextListener();
        this.setupSettingsDock();
        this.updateToolIndicators();
    }
    resetUnseenToolCount() {
        this.unseenToolCount = 0;
        this.updateToolIndicators();
    }
    setupCollapsibleSections() {
        document.querySelectorAll('.collapsible-section').forEach(section => {
            const header = section.querySelector('.section-header');
            const toggleIcon = header.querySelector('.toggle-icon');
            header.addEventListener('click', () => {
                section.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
                const sectionId = section.getAttribute('data-section');
                localStorage.setItem(`section-${sectionId}-collapsed`, section.classList.contains('collapsed'));
            });
            const sectionId = section.getAttribute('data-section');
            const isCollapsed = localStorage.getItem(`section-${sectionId}-collapsed`) === 'true';
            if (isCollapsed) {
                section.classList.add('collapsed');
            }
            header.setAttribute('aria-expanded', String(!isCollapsed));
            toggleIcon?.setAttribute('aria-hidden', 'true');
        });
    }
    initializeEvents() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
            });
        });

        const toolActivityButton = document.getElementById('safe-tools-info');
        if (toolActivityButton) {
            toolActivityButton.addEventListener('click', () => {
                this.switchTab('tools');
            });
        }
    }

    switchTab(tabName) {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.classList.remove('active');
            if (button.dataset.tab === tabName) {
                button.classList.add('active');
            }
        });

        if (tabName === 'tools' || tabName === 'mcp') {
            this.resetUnseenToolCount();
        }

        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}-tab`) {
                content.classList.add('active');
            }
        });

        this.currentTab = tabName;

        if (tabName === 'chat') {
            this.focusPrimaryChatTab();
        }
        if (this.isSettingsFlyoutOpen && tabName !== 'chat') {
            this.closeSettingsFlyout();
        }

        this.loadTabData(tabName);

        const event = new CustomEvent('tab-activated', { detail: { tab: tabName } });
        document.dispatchEvent(event);
    }

    async loadTabData(tabName) {
        switch (tabName) {
            case 'mcp':
                await this.loadMCPTools();
                break;
            case 'llm':
                await this.loadSystemPrompt();
                break;
            case 'api':
                await this.loadAPIKeys();
                break;
            case 'tools':
                this.updateToolActivityTab();
                break;
            case 'workflows':
                if (!this.workflowEditor) {
                    this.workflowEditor = new window.WorkflowEditor();
                }
                break;
        }
    }

    async loadMCPTools() {
        try {
            const permissionContext = this.getPermissionContext();
            const tools = await window.electronAPI.getMCPTools(permissionContext);
            const customTools = await window.electronAPI.getCustomTools?.() || [];
            const resolvedContext = await window.electronAPI.permissions?.getContext?.(permissionContext) || null;
            // Use capability groups as the single source of truth for group info
            const capabilityGroups = await window.electronAPI.capability?.getGroups?.() || [];
            const container = document.getElementById('mcp-tools-container');
            const toolSelect = document.getElementById('tool-select');
            const activityContainer = document.getElementById('tool-activity');

            if (!container) return;

            container.innerHTML = '';

            // Get DB tool activation states
            let toolStates = {};
            try {
                toolStates = await window.electronAPI.getToolStates?.() || {};
            } catch (error) {
                console.warn('Could not load tool states, using defaults:', error);
            }

            // Also get the active tools list from CapabilityManager
            let activeToolNames = new Set();
            try {
                const activeTools = await window.electronAPI.capability?.getActiveTools?.(permissionContext) || [];
                activeToolNames = new Set(activeTools);
            } catch (e) { /* graceful fallback */ }

            const customToolNames = new Set(customTools.map(t => t.name));

            // Build tool -> group map from capability groups (dynamic, not hard-coded)
            const groupColorPalette = [
                '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
                '#ec4899', '#6b7280', '#ef4444', '#14b8a6'
            ];
            const toolToGroup = new Map();
            capabilityGroups.forEach((group, idx) => {
                const color = groupColorPalette[idx % groupColorPalette.length];
                // allTools covers all tools in any mode for this group
                const allTools = group.allTools || group.tools || [];
                allTools.forEach(toolName => {
                    toolToGroup.set(toolName, {
                        id: group.id,
                        name: group.name,
                        icon: group.icon,
                        enabled: group.enabled,
                        color
                    });
                });
            });

            // Group tools visually by their capability group
            // Sort: enabled groups first, then disabled, then ungrouped
            const groupOrder = capabilityGroups.map(g => g.id);
            const toolsByGroup = new Map(); // groupId -> tools[]
            const ungroupedTools = [];

            tools.forEach(tool => {
                const groupInfo = toolToGroup.get(tool.name);
                if (groupInfo) {
                    if (!toolsByGroup.has(groupInfo.id)) toolsByGroup.set(groupInfo.id, []);
                    toolsByGroup.get(groupInfo.id).push({ tool, groupInfo });
                } else if (customToolNames.has(tool.name)) {
                    // Custom tools go into a virtual "custom" group
                    if (!toolsByGroup.has('custom')) toolsByGroup.set('custom', []);
                    toolsByGroup.get('custom').push({ tool, groupInfo: { id: 'custom', name: 'Custom Tools', icon: '🔧', enabled: true, color: '#6b7280' } });
                } else {
                    ungroupedTools.push({ tool, groupInfo: null });
                }
            });

            if (tools.length === 0) {
                container.innerHTML = '<div class="no-activity">No tools are visible in this chat context.</div>';
            }

            // Render groups
            const renderOrder = [...groupOrder, 'custom'];
            renderOrder.forEach(groupId => {
                const groupTools = toolsByGroup.get(groupId);
                if (!groupTools || groupTools.length === 0) return;

                const groupInfo = groupTools[0].groupInfo;
                const groupEnabled = groupId === 'custom'
                    ? true
                    : this.isGroupEnabledForContext(groupId, groupInfo, resolvedContext);

                // Group header
                const groupHeader = document.createElement('div');
                groupHeader.className = `mcp-group-header ${groupEnabled ? '' : 'group-disabled'}`;
                groupHeader.style.cssText = `
                    display: flex; align-items: center; gap: 0.5rem;
                    padding: 0.4rem 0.6rem; margin: 0.6rem 0 0.2rem 0;
                    border-radius: 6px;
                    background: ${groupEnabled ? `${groupInfo.color}18` : 'rgba(100,100,100,0.08)'};
                    border-left: 3px solid ${groupEnabled ? groupInfo.color : '#9ca3af'};
                    font-size: 0.82rem; font-weight: 600; color: ${groupEnabled ? 'inherit' : '#9ca3af'};
                `;
                groupHeader.innerHTML = `
                    <span>${this.escapeHtml(groupInfo.icon)}</span>
                    <span>${this.escapeHtml(groupInfo.name)}</span>
                    ${groupEnabled ? '' : '<span style="margin-left:auto;font-size:0.75rem;">🔒 disabled</span>'}
                `;
                container.appendChild(groupHeader);

                groupTools.forEach(({ tool, groupInfo: gi }) => {
                    const toolElement = document.createElement('div');
                    const isCustom = customToolNames.has(tool.name);
                    const isCapabilityActive = activeToolNames.size > 0 ? activeToolNames.has(tool.name) : true;
                    const isDbActive = toolStates[tool.name]?.active !== false;
                    const resolvedActive = resolvedContext?.toolStates
                        ? resolvedContext.toolStates[tool.name] === true
                        : null;
                    const isActive = resolvedActive === null ? (isCapabilityActive && isDbActive) : resolvedActive;
                    const groupColor = gi?.color || '#6b7280';

                    toolElement.className = `mcp-tool-card ${!groupEnabled ? 'tool-group-disabled' : ''}`;
                    toolElement.style.borderLeft = `3px solid ${groupEnabled ? groupColor : '#9ca3af'}`;
                    toolElement.setAttribute('data-full-description', tool.description);
                    toolElement.setAttribute('data-group', gi?.id || 'custom');
                    toolElement.dataset.toolName = tool.name;

                    toolElement.innerHTML = `
                        <div class="tool-card-header">
                            <h4 class="tool-card-name">
                                ${isCustom ? '🔧 ' : ''}${this.escapeHtml(tool.name)}
                                ${!groupEnabled ? '<span class="tool-disabled-badge" title="Group disabled">🔒</span>' : ''}
                            </h4>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                ${isCustom ? '<button class="delete-tool-btn" title="Delete custom tool">🗑️</button>' : ''}
                                <label class="tool-toggle" title="${!groupEnabled ? 'Enable group to allow this tool' : ''}">
                                    <input type="checkbox" class="tool-active-checkbox" ${isActive ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div class="tool-card-description">${this.escapeHtml(tool.description || '')}</div>
                        ${tool.inputSchema?.properties ? `<div class="tool-card-params">Params: ${this.escapeHtml(Object.keys(tool.inputSchema.properties).join(', '))}</div>` : ''}
                    `;

                    const checkbox = toolElement.querySelector('.tool-active-checkbox');
                    checkbox.dataset.tool = tool.name;
                    checkbox.dataset.group = gi?.id || '';
                    checkbox.dataset.groupEnabled = String(groupEnabled);
                    checkbox.addEventListener('change', async (e) => {
                        const tName = e.target.dataset.tool;
                        const active = e.target.checked;
                        const gId = e.target.dataset.group;
                        const gEnabled = e.target.dataset.groupEnabled === 'true';
                        const activeScope = resolvedContext?.scope || 'global';
                        const activeAgentId = resolvedContext?.agentId || null;

                        if (active && !gEnabled && gId) {
                            if (activeScope === 'agent' && activeAgentId) {
                                if (gId === 'files') {
                                    await window.electronAPI.permissions?.setAgentGroup?.(activeAgentId, 'files', 'read');
                                } else {
                                    await window.electronAPI.permissions?.setAgentGroup?.(activeAgentId, gId, true);
                                }
                            } else {
                                const confirmed = confirm(`The "${gi?.name || gId}" group is currently disabled.\nEnable the group to allow this tool?`);
                                if (!confirmed) {
                                    e.target.checked = false;
                                    return;
                                }
                                // Enable the capability group
                                await window.electronAPI.capability?.setGroup?.(gId, true);
                            }
                        }
                        try {
                            if (activeScope === 'agent' && activeAgentId) {
                                await window.electronAPI.setToolActive?.(tName, active, { agentId: activeAgentId });
                            } else {
                                await window.electronAPI.setToolActive?.(tName, active, {});
                            }
                            await this.loadMCPTools();
                        } catch (error) {
                            console.error('Failed to update tool state:', error);
                            e.target.checked = !active;
                        }
                    });

                    const deleteBtn = toolElement.querySelector('.delete-tool-btn');
                    if (deleteBtn) {
                        deleteBtn.dataset.tool = tool.name;
                        deleteBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const tName = e.currentTarget.dataset.tool;
                            if (confirm(`Delete custom tool "${tName}"?`)) {
                                try {
                                    await window.electronAPI.deleteCustomTool(tName);
                                    await this.loadMCPTools();
                                    window.mainPanel?.showNotification?.(`Tool "${tName}" deleted`);
                                } catch (error) {
                                    console.error('Failed to delete tool:', error);
                                    window.mainPanel?.showNotification?.('Failed to delete tool', 'error');
                                }
                            }
                        });
                    }

                    container.appendChild(toolElement);
                });
            });

            // Render any ungrouped tools at the bottom
            if (ungroupedTools.length > 0) {
                const ugHeader = document.createElement('div');
                ugHeader.style.cssText = 'padding:0.3rem 0.6rem;margin:0.6rem 0 0.2rem;font-size:0.78rem;color:#9ca3af;';
                ugHeader.textContent = 'Other';
                container.appendChild(ugHeader);
                ungroupedTools.forEach(({ tool }) => {
                    const toolElement = document.createElement('div');
                    toolElement.className = 'mcp-tool-card';
                    toolElement.style.borderLeft = '3px solid #6b7280';
                    toolElement.dataset.toolName = tool.name;
                    toolElement.innerHTML = `
                        <div class="tool-card-header">
                            <h4 class="tool-card-name">${this.escapeHtml(tool.name)}</h4>
                        </div>
                        <div class="tool-card-description">${this.escapeHtml(tool.description || '')}</div>
                    `;
                    container.appendChild(toolElement);
                });
            }

            if (!container._cardClickListenerAdded) {
                container.addEventListener('click', (event) => {
                    const card = event.target.closest('.mcp-tool-card');
                    if (!card || !container.contains(card) || event.target.closest('.tool-toggle, .delete-tool-btn')) return;
                    if (!card.dataset.toolName) return;
                    window.mcpToolSetup?.open?.(tools.find((t) => t.name === card.dataset.toolName), this, { groupId: card.dataset.group || '', isCustom: customToolNames.has(card.dataset.toolName) });
                });
                container._cardClickListenerAdded = true;
            }

            // Update tool tester dropdown
            if (toolSelect) {
                toolSelect.innerHTML = `<option value="">${tools.length > 0 ? 'Select a tool...' : 'No visible tools in this context'}</option>`;
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = tool.name;
                    toolSelect.appendChild(option);
                });
            }

            // Setup tool tester button
            const testBtn = document.getElementById('test-tool-btn');
            if (testBtn && !testBtn._listenerAdded) {
                testBtn.addEventListener('click', () => this.testTool());
                testBtn._listenerAdded = true;
            }

            if (activityContainer) {
                if (this.toolActivity.length === 0) {
                    activityContainer.innerHTML = '<div class="no-activity">No tool activity yet</div>';
                } else {
                    this.updateToolIndicators();
                }
            }
        } catch (error) {
            console.error('Error loading MCP tools:', error);
        }
    }

    getPermissionContext() {
        const panel = window.app?.mainPanel || window.mainPanel;
        const sessionId = panel?.activeTabId ?? null;
        const tab = panel?.chatTabs?.get?.(sessionId);
        return { sessionId, agentId: tab?.agentId ?? null };
    }

    isGroupEnabledForContext(groupId, groupInfo, resolvedContext) {
        if (!resolvedContext?.groups) return groupInfo?.enabled ?? true;
        if (groupId === 'files') return String(resolvedContext.groups.files || 'off') !== 'off';
        if (groupId === 'terminal') return String(resolvedContext.groups.terminal || 'off') !== 'off';
        if (Object.prototype.hasOwnProperty.call(resolvedContext.groups, groupId)) return resolvedContext.groups[groupId] === true;
        return groupInfo?.enabled ?? true;
    }

    // Called on capability-update events to refresh MCP tab if it's visible
    setupCapabilityListener() {
        if (window.electronAPI?.onCapabilityUpdate) {
            window.electronAPI.onCapabilityUpdate(() => {
                if (this.currentTab === 'mcp') {
                    this.loadMCPTools();
                }
            });
        }
    }

    setupTabContextListener() {
        document.addEventListener('chat-tab-switched', () => {
            if (this.currentTab === 'mcp') {
                this.loadMCPTools();
            }
        });
    }

    async loadWorkflows() {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];
            const tools = await window.electronAPI.getMCPTools?.(this.getPermissionContext()) || [];
            const container = document.getElementById('workflows-container');
            const toolSelect = document.getElementById('workflow-tool-select');
            const selectedToolsDiv = document.getElementById('selected-workflow-tools');

            if (!container) return;

            // Populate tool select dropdown
            if (toolSelect) {
                toolSelect.innerHTML = '';
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = `${tool.name}`;
                    toolSelect.appendChild(option);
                });

                // Track selected tools in order
                this.selectedWorkflowTools = [];

                toolSelect.addEventListener('dblclick', (e) => {
                    const toolName = e.target.value;
                    if (toolName && !this.selectedWorkflowTools.includes(toolName)) {
                        this.selectedWorkflowTools.push(toolName);
                        this.updateSelectedToolsDisplay(selectedToolsDiv);
                    }
                });
            }

            // Setup save button
            document.getElementById('save-workflow-btn')?.addEventListener('click', () => this.saveWorkflow());
            document.getElementById('clear-workflow-form-btn')?.addEventListener('click', () => this.clearWorkflowForm());

            // Render saved workflows
            container.innerHTML = '';
            if (workflows.length === 0) {
                container.innerHTML = '<div class="no-workflows">No workflows saved yet. Create one above!</div>';
                return;
            }

            workflows.forEach(workflow => {
                const workflowCard = document.createElement('div');
                workflowCard.className = 'workflow-card';
                const toolChain = Array.isArray(workflow.tool_chain)
                    ? workflow.tool_chain
                    : JSON.parse(workflow.tool_chain || '[]');

                workflowCard.innerHTML = `
                    <div class="workflow-card-header">
                        <h4 class="workflow-name">🔄 ${this.escapeHtml(workflow.name || '')}</h4>
                        <div class="workflow-actions">
                            <button class="run-workflow-btn icon-btn" data-id="${workflow.id}" title="Run Workflow">▶️</button>
                            <button class="delete-workflow-btn icon-btn" data-id="${workflow.id}" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <div class="workflow-description">${this.escapeHtml(workflow.description || 'No description')}</div>
                    <div class="workflow-tools">
                        <span class="tools-label">Tools:</span>
                        ${toolChain.map(t => `<span class="workflow-tool-badge">${this.escapeHtml(t.tool || t)}</span>`).join(' → ')}
                    </div>
                    <div class="workflow-stats">
                        <span>Runs: ${workflow.execution_count || 0}</span>
                        <span>Success: ${workflow.success_count || 0}</span>
                    </div>
                `;

                // Run workflow handler
                workflowCard.querySelector('.run-workflow-btn').addEventListener('click', async () => {
                    try {
                        const result = await window.electronAPI.runWorkflow?.(workflow.id);
                        if (window.mainPanel) {
                            window.mainPanel.showNotification(result.success ? 'Workflow executed!' : 'Workflow failed');
                        }
                        await this.loadWorkflows(); // Refresh to update stats
                    } catch (error) {
                        console.error('Failed to run workflow:', error);
                    }
                });

                // Delete workflow handler
                workflowCard.querySelector('.delete-workflow-btn').addEventListener('click', async () => {
                    if (confirm(`Delete workflow "${workflow.name}"?`)) {
                        try {
                            await window.electronAPI.deleteWorkflow?.(workflow.id);
                            await this.loadWorkflows();
                            if (window.mainPanel) {
                                window.mainPanel.showNotification('Workflow deleted');
                            }
                        } catch (error) {
                            console.error('Failed to delete workflow:', error);
                        }
                    }
                });

                container.appendChild(workflowCard);
            });
        } catch (error) {
            console.error('Error loading workflows:', error);
        }
    }

    updateSelectedToolsDisplay(container) {
        if (!container) return;
        container.innerHTML = this.selectedWorkflowTools.map((tool, idx) => `
            <span class="selected-tool-chip" data-index="${idx}">
                ${idx + 1}. ${tool}
                <button class="remove-tool-btn" data-index="${idx}">×</button>
            </span>
        `).join(' → ');

        container.querySelectorAll('.remove-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.selectedWorkflowTools.splice(idx, 1);
                this.updateSelectedToolsDisplay(container);
            });
        });
    }

    async saveWorkflow() {
        const name = document.getElementById('workflow-name')?.value.trim();
        const description = document.getElementById('workflow-description')?.value.trim();

        if (!name) {
            if (window.mainPanel) window.mainPanel.showNotification('Please enter a workflow name', 'error');
            return;
        }

        if (!this.selectedWorkflowTools || this.selectedWorkflowTools.length === 0) {
            if (window.mainPanel) window.mainPanel.showNotification('Please select at least one tool', 'error');
            return;
        }

        try {
            const workflow = {
                name,
                description,
                tool_chain: this.selectedWorkflowTools.map(t => ({ tool: t, params: {} }))
            };

            await window.electronAPI.saveWorkflow?.(workflow);
            if (window.mainPanel) window.mainPanel.showNotification('Workflow saved!');
            this.clearWorkflowForm();
            await this.loadWorkflows();
        } catch (error) {
            console.error('Failed to save workflow:', error);
            if (window.mainPanel) window.mainPanel.showNotification('Failed to save workflow', 'error');
        }
    }

    clearWorkflowForm() {
        document.getElementById('workflow-name').value = '';
        document.getElementById('workflow-description').value = '';
        this.selectedWorkflowTools = [];
        const container = document.getElementById('selected-workflow-tools');
        if (container) container.innerHTML = '';
    }

    selectTool(toolName) {
        if (this.currentTab !== 'mcp') this.switchTab('mcp');
        const toolSelect = document.getElementById('tool-select');
        if (toolSelect) { toolSelect.value = toolName; toolSelect.focus(); }
    }

    async testTool() {
        const toolName = document.getElementById('tool-select')?.value;
        const paramsText = document.getElementById('tool-params')?.value || '{}';
        const resultDiv = document.getElementById('tool-result');

        if (!toolName) {
            resultDiv.innerHTML = '<div class="error">Please select a tool</div>';
            return;
        }

        try {
            const params = JSON.parse(paramsText);
            resultDiv.innerHTML = '<div class="loading">Executing...</div>';

            const result = await window.electronAPI.executeMCPTool(toolName, params);

            if (result.success) {
                resultDiv.innerHTML = `<div class="success"><strong>Success:</strong><pre>${JSON.stringify(result.result, null, 2)}</pre></div>`;
            } else {
                resultDiv.innerHTML = `<div class="error"><strong>Error:</strong> ${result.error}</div>`;
            }
        } catch (error) {
            resultDiv.innerHTML = `<div class="error"><strong>Error:</strong> ${error.message}</div>`;
        }
    }

    async loadSystemPrompt() {
        try {
            const prompt = await window.electronAPI.getSystemPrompt();
            const promptTextarea = document.getElementById('system-prompt');
            if (promptTextarea) {
                promptTextarea.value = prompt || '';
            }

            // Also load prompt rules
            if (window.mainPanel && window.mainPanel.loadPromptRules) {
                await window.mainPanel.loadPromptRules();
            }
        } catch (error) {
            console.error('Error loading system prompt:', error);
        }
    }

    async loadAPIKeys() {
        try {
            const settings = await window.electronAPI.getSettings();
            Object.keys(settings.apiKeys || {}).forEach(provider => {
                const input = document.getElementById(`${provider}-key`);
                if (input) {
                    input.value = settings.apiKeys[provider] || '';
                }
            });
        } catch (error) {
            console.error('Error loading API keys:', error);
        }
    }

    getCurrentTab() {
        return this.currentTab;
    }

    async focusPrimaryChatTab() {
        try {
            const panel = window.app?.mainPanel || window.mainPanel;
            if (!panel?.chatTabs || panel.chatTabs.size === 0 || typeof panel.switchTab !== 'function') {
                return;
            }

            // Main chat = first regular tab (non-agent, non-subtask).
            let targetSessionId = null;
            for (const [sessionId, tab] of panel.chatTabs) {
                const isAgentTab = Boolean(tab?.agentId) || String(sessionId).startsWith('subtask-');
                if (!isAgentTab) {
                    targetSessionId = sessionId;
                    break;
                }
            }

            // Fallback: if only agent tabs exist, focus the first available tab.
            if (targetSessionId === null) {
                targetSessionId = panel.chatTabs.keys().next().value;
            }

            if (targetSessionId !== undefined && targetSessionId !== null) {
                await panel.switchTab(targetSessionId);
            }
        } catch (error) {
            console.error('Failed to focus primary chat tab:', error);
        }
    }

    setupSettingsDock() {
        this.settingsDocks = [
            document.getElementById('settings-dock'),
            document.getElementById('statusbar-settings-dock')
        ].filter(Boolean);

        this.settingsFlyouts = [
            document.getElementById('settings-flyout'),
            document.getElementById('statusbar-settings-flyout')
        ].filter(Boolean);

        if (this.settingsDocks.length === 0 || this.settingsFlyouts.length === 0) {
            return;
        }

        this.settingsDocks.forEach(dock => {
            dock.addEventListener('click', () => {
                if (this.isSettingsFlyoutOpen) {
                    this.closeSettingsFlyout();
                } else {
                    this.openSettingsFlyout();
                }
            });

            dock.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (this.isSettingsFlyoutOpen) {
                    this.closeSettingsFlyout();
                } else {
                    this.openSettingsFlyout();
                }
            });
        });

        document.addEventListener('pointerdown', this.handleSettingsPointerDown);
        document.addEventListener('keydown', this.handleSettingsKeyDown);
        window.addEventListener('blur', this.handleSettingsWindowBlur);
    }

    openSettingsFlyout() {
        this.isSettingsFlyoutOpen = true;

        const layoutMode = document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';
        const activeDock = layoutMode === 'desktop'
            ? document.getElementById('statusbar-settings-dock')
            : document.getElementById('settings-dock');
        const activeFlyout = layoutMode === 'desktop'
            ? document.getElementById('statusbar-settings-flyout')
            : document.getElementById('settings-flyout');

        this.settingsFlyouts.forEach(f => {
            f.classList.remove('open');
            f.setAttribute('aria-hidden', 'true');
            f.style.display = 'none';
        });
        this.settingsDocks.forEach(d => d.setAttribute('aria-expanded', 'false'));

        if (activeFlyout && activeDock) {
            activeFlyout.classList.add('open');
            activeFlyout.setAttribute('aria-hidden', 'false');
            activeFlyout.style.display = '';
            activeDock.setAttribute('aria-expanded', 'true');
        }
    }

    closeSettingsFlyout() {
        this.isSettingsFlyoutOpen = false;
        this.settingsFlyouts.forEach(f => {
            f.classList.remove('open');
            f.setAttribute('aria-hidden', 'true');
            f.style.display = 'none';
        });
        this.settingsDocks.forEach(d => d.setAttribute('aria-expanded', 'false'));
    }

    handleSettingsPointerDown(event) {
        if (!this.isSettingsFlyoutOpen) return;
        const target = event.target;
        const isClickInsideAnyFlyout = this.settingsFlyouts.some(f => f.contains(target));
        const isClickInsideAnyDock = this.settingsDocks.some(d => d.contains(target));
        if (isClickInsideAnyFlyout || isClickInsideAnyDock) return;
        this.closeSettingsFlyout();
    }

    handleSettingsKeyDown(event) {
        if (event.key === 'Escape' && this.isSettingsFlyoutOpen) {
            this.closeSettingsFlyout();
            const layoutMode = document.querySelector('.app-container')?.getAttribute('data-layout-mode') || 'desktop';
            const activeDock = layoutMode === 'desktop'
                ? document.getElementById('statusbar-settings-dock')
                : document.getElementById('settings-dock');
            activeDock?.focus();
        }
    }

    handleSettingsWindowBlur() {
        if (this.isSettingsFlyoutOpen) {
            this.closeSettingsFlyout();
        }
    }

    normalizeActivityContextId(value) {
        const normalized = String(value ?? '').trim();
        return normalized || '';
    }

    normalizeActivityLabel(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    truncateActivityLabel(value, maxLength = 40) {
        const normalized = this.normalizeActivityLabel(value);
        if (!normalized || normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(1, maxLength - 1))}\u2026`;
    }

    isPlaceholderSessionLabel(value) {
        const normalized = this.normalizeActivityLabel(value).toLowerCase();
        return normalized === ''
            || normalized === 'chat'
            || normalized === 'new chat'
            || normalized === 'conversation'
            || normalized === 'agent chat'
            || normalized === 'private chat';
    }

    rememberSessionMeta(session = {}) {
        const id = this.normalizeActivityContextId(session.id ?? session.sessionId);
        if (!id) return false;

        const previous = this.sessionMetaById.get(id) || {};
        const title = this.normalizeActivityLabel(session.title ?? previous.title);
        const firstMessage = this.normalizeActivityLabel(
            session.first_message ?? session.firstMessage ?? previous.firstMessage
        );
        const nextAgentId = session.agent_id ?? session.agentId ?? previous.agentId ?? null;
        const agentId = nextAgentId === null || nextAgentId === undefined
            ? null
            : String(nextAgentId).trim();
        const next = {
            id,
            title,
            firstMessage,
            agentId,
            private: session.private === true || previous.private === true
        };
        const changed = previous.title !== next.title
            || previous.firstMessage !== next.firstMessage
            || this.normalizeActivityContextId(previous.agentId) !== this.normalizeActivityContextId(next.agentId)
            || Boolean(previous.private) !== Boolean(next.private);

        this.sessionMetaById.set(id, next);
        return changed;
    }

    rememberAgentMeta(agent = {}) {
        const id = this.normalizeActivityContextId(agent.id ?? agent.agentId);
        if (!id) return false;

        const previous = this.agentMetaById.get(id) || {};
        const next = {
            id,
            name: this.normalizeActivityLabel(agent.name ?? previous.name),
            icon: this.normalizeActivityLabel(agent.icon ?? previous.icon)
        };
        const changed = previous.name !== next.name || previous.icon !== next.icon;

        this.agentMetaById.set(id, next);
        return changed;
    }

    resolvePanelTab(sessionId) {
        const normalizedSessionId = this.normalizeActivityContextId(sessionId);
        if (!normalizedSessionId) return null;

        const panel = window.app?.mainPanel || window.mainPanel;
        if (!panel?.chatTabs) return null;

        const tabKey = typeof this.resolvePanelTabKey === 'function'
            ? this.resolvePanelTabKey(panel, sessionId)
            : [...panel.chatTabs.keys()].find((key) => String(key) === normalizedSessionId) ?? null;

        if (tabKey === null) return null;
        return panel.chatTabs.get(tabKey) || null;
    }

    captureSessionMetaFromPanel(sessionId) {
        const normalizedSessionId = this.normalizeActivityContextId(sessionId);
        if (!normalizedSessionId) return false;

        const tab = this.resolvePanelTab(sessionId);
        if (!tab) return false;

        return this.rememberSessionMeta({
            id: normalizedSessionId,
            title: tab.title || '',
            agent_id: tab.agentId ?? null
        });
    }

    resolveToolActivityAgentId(item = {}) {
        const directAgentId = this.normalizeActivityContextId(item.agentId);
        if (directAgentId) return directAgentId;

        const sessionId = this.normalizeActivityContextId(item.sessionId);
        if (!sessionId) return '';

        const sessionMeta = this.sessionMetaById.get(sessionId) || null;
        return this.normalizeActivityContextId(sessionMeta?.agentId);
    }

    formatToolActivitySessionContext(sessionId, { truncateLabel = 0 } = {}) {
        const normalizedSessionId = this.normalizeActivityContextId(sessionId);
        if (!normalizedSessionId) return '';

        this.captureSessionMetaFromPanel(normalizedSessionId);
        const meta = this.sessionMetaById.get(normalizedSessionId) || {};
        const rawLabel = meta.firstMessage || (this.isPlaceholderSessionLabel(meta.title) ? '' : meta.title);
        const label = truncateLabel > 0
            ? this.truncateActivityLabel(rawLabel, truncateLabel)
            : this.normalizeActivityLabel(rawLabel);

        if (label) {
            return `Chat: ${label} [sessionId: ${normalizedSessionId}]`;
        }
        return `sessionId: ${normalizedSessionId}`;
    }

    formatToolActivityAgentContext(agentId, { truncateLabel = 0 } = {}) {
        const normalizedAgentId = this.normalizeActivityContextId(agentId);
        if (!normalizedAgentId) return '';

        const meta = this.agentMetaById.get(normalizedAgentId) || {};
        const rawLabel = this.normalizeActivityLabel(meta.name);
        const label = truncateLabel > 0
            ? this.truncateActivityLabel(rawLabel, truncateLabel)
            : rawLabel;

        if (label) {
            return `Agent: ${label} [agentId: ${normalizedAgentId}]`;
        }
        return `agentId: ${normalizedAgentId}`;
    }

    getToolActivityContextLines(item = {}, { truncateLabel = 0 } = {}) {
        const lines = [];
        const sessionLine = this.formatToolActivitySessionContext(item.sessionId, { truncateLabel });
        const agentLine = this.formatToolActivityAgentContext(
            this.resolveToolActivityAgentId(item),
            { truncateLabel }
        );

        if (sessionLine) lines.push(sessionLine);
        if (agentLine) lines.push(agentLine);
        return lines;
    }

    renderToolActivityContextSummary(item = {}) {
        const lines = this.getToolActivityContextLines(item, { truncateLabel: 34 });
        if (lines.length === 0) return '';

        return `
            <div class="tool-context-row">
                ${lines.map((line) => `<span class="tool-context-pill">${this.escapeHtml(line)}</span>`).join('')}
            </div>
        `;
    }

    renderToolActivityContextDetails(item = {}) {
        const lines = this.getToolActivityContextLines(item);
        if (lines.length === 0) return '';

        return `
            <div class="tool-section">
                <div class="tool-section-label">Context:</div>
                <div class="tool-context-details">
                    ${lines.map((line) => `<div class="tool-context-line">${this.escapeHtml(line)}</div>`).join('')}
                </div>
            </div>
        `;
    }

    async ensureSessionMeta(sessionId) {
        const normalizedSessionId = this.normalizeActivityContextId(sessionId);
        if (!normalizedSessionId) return false;

        this.captureSessionMetaFromPanel(normalizedSessionId);
        if (this.pendingSessionMetaIds.has(normalizedSessionId) || !window.electronAPI?.getChatSessionMeta) {
            return false;
        }

        this.pendingSessionMetaIds.add(normalizedSessionId);
        try {
            const meta = await window.electronAPI.getChatSessionMeta(sessionId);
            if (!meta) return false;
            return this.rememberSessionMeta(meta);
        } catch (error) {
            console.warn(`Failed to resolve session label for ${normalizedSessionId}:`, error);
            return false;
        } finally {
            this.pendingSessionMetaIds.delete(normalizedSessionId);
        }
    }

    async ensureAgentMeta(agentId) {
        const normalizedAgentId = this.normalizeActivityContextId(agentId);
        if (!normalizedAgentId) return false;

        const current = this.agentMetaById.get(normalizedAgentId);
        if (current?.name || this.pendingAgentMetaIds.has(normalizedAgentId) || !window.electronAPI?.agents?.get) {
            return false;
        }

        this.pendingAgentMetaIds.add(normalizedAgentId);
        try {
            const agent = await window.electronAPI.agents.get(agentId);
            if (!agent) return false;
            return this.rememberAgentMeta(agent);
        } catch (error) {
            console.warn(`Failed to resolve agent label for ${normalizedAgentId}:`, error);
            return false;
        } finally {
            this.pendingAgentMetaIds.delete(normalizedAgentId);
        }
    }

    async hydrateToolActivityContext(item = {}) {
        let changed = false;

        changed = this.captureSessionMetaFromPanel(item.sessionId) || changed;
        changed = (await this.ensureSessionMeta(item.sessionId)) || changed;

        const resolvedAgentId = this.resolveToolActivityAgentId(item);
        if (!item.agentId && resolvedAgentId) {
            item.agentId = resolvedAgentId;
            changed = true;
        }

        changed = (await this.ensureAgentMeta(item.agentId)) || changed;

        if (changed) {
            this.updateToolIndicators();
        }
    }

    setupToolListeners() {
        document.addEventListener('chat-tab-switched', (event) => {
            const sessionId = event?.detail?.sessionId ?? null;
            if (this.captureSessionMetaFromPanel(sessionId) && this.toolActivity.length > 0) {
                this.updateToolIndicators();
            }
        });

        window.electronAPI.onToolUpdate((event, data) => {
            const activity = {
                tool: data.toolName,
                toolCallId: data.toolCallId || null,
                timestamp: data.timestamp || new Date().toISOString(),
                time: new Date(data.timestamp || Date.now()).toLocaleTimeString(),
                success: data.success,
                sessionId: data.sessionId ?? null,
                agentId: data.agentId ?? null,
                source: data.source || null,
                params: data.params || {},
                result: data.result,
                error: data.error
            };

            this.captureSessionMetaFromPanel(activity.sessionId);
            this.toolActivity.unshift(activity);

            // Keep only last 10 activities
            this.toolActivity = this.toolActivity.slice(0, 10);

            // Increment unseen tool count
            this.unseenToolCount++;
            this.updateToolIndicators();
            void this.hydrateToolActivityContext(activity);
        });

        // Listen for conversation updates to refresh chat list
        window.electronAPI.onConversationUpdate((event, data = {}) => {
            this.captureSessionMetaFromPanel(data.sessionId ?? null);
            void this.loadChatSessions();
        });
    }

    updateToolIndicators() {
        // Update badge count based on unseen activities
        const badge = document.getElementById('tool-count-badge');
        if (badge) {
            badge.textContent = this.unseenToolCount > 0 ? this.unseenToolCount : '';
            badge.style.display = this.unseenToolCount > 0 ? 'inline-block' : 'none';
        }

        // Repurpose capability footer as live tool-activity indicator
        const safeInfo = document.getElementById('safe-tools-info');
        if (safeInfo) {
            safeInfo.textContent = `🔧 Tool activity: ${this.unseenToolCount} recent`;
        }

        // Update MCP tab activity
        const mcpContainer = document.getElementById('tool-activity');
        if (mcpContainer) {
            mcpContainer.innerHTML = this.toolActivity.map(item => `
                <div class="tool-indicator ${item.success ? 'success' : 'error'}">
                    <span class="tool-name">${item.tool}</span>
                    <span class="tool-time">${item.time}</span>
                </div>
            `).join('');
        }

        // Update Tool Activity tab
        this.updateToolActivityTab();
    }

    updateToolActivityTab() {
        const list = document.getElementById('tool-activity-list');
        if (!list) return;

        if (this.toolActivity.length === 0) {
            list.innerHTML = '<div class="no-activity">No tool activity yet</div>';
        } else {
            list.innerHTML = this.toolActivity.map((item, index) => {
                const isSearxngSearch = item.tool === 'plugin_searxng_search_search';
                const paramsJson = JSON.stringify(item.params, null, 2);
                const resultJson = item.success
                    ? JSON.stringify(item.result, null, 2)
                    : item.error || 'Unknown error';
                const contextSummaryHtml = this.renderToolActivityContextSummary(item);
                const contextDetailsHtml = this.renderToolActivityContextDetails(item);

                return `
                <div class="tool-activity-item ${item.success ? 'success' : 'error'}${isSearxngSearch && item.success ? ' searxng-complete' : ''}" data-index="${index}">
                    <div class="tool-header" onclick="window.sidebar.toggleToolDetails(${index})">
                        <span class="tool-expand">
                            <svg class="arrow-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                        <div class="tool-header-main">
                            <div class="tool-header-top">
                                <strong>${this.escapeHtml(item.tool)}</strong>
                                <span class="tool-time">${this.escapeHtml(item.time)}</span>
                                <span class="tool-status-badge">${item.success ? '✓' : '✗'}</span>
                            </div>
                            ${contextSummaryHtml}
                        </div>
                    </div>
                    <div class="tool-details" style="display: none;">
                        ${contextDetailsHtml}
                        <div class="tool-section">
                            <div class="tool-section-label">Parameters:</div>
                            <pre class="tool-json">${this.escapeHtml(paramsJson)}</pre>
                        </div>
                        <div class="tool-section">
                            <div class="tool-section-label">${item.success ? 'Result:' : 'Error:'}</div>
                            <pre class="tool-json ${item.success ? '' : 'error-text'}">${this.escapeHtml(resultJson)}</pre>
                        </div>
                    </div>
                </div>
            `}).join('');
        }
    }

    toggleToolDetails(index) {
        const items = document.querySelectorAll('.tool-activity-item');
        const item = items[index];
        if (!item) return;

        const details = item.querySelector('.tool-details');

        if (details.style.display === 'none') {
            details.style.display = 'block';
            item.classList.add('expanded');
        } else {
            details.style.display = 'none';
            item.classList.remove('expanded');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

}

Object.assign(Sidebar.prototype, window.SidebarChatSessionMethods || {});

// Initialize sidebar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.sidebar = new Sidebar();
});

