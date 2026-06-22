(function () {
    async function renderSubagentManagerTab(panel, deps = {}) {
        const container = deps.getMessagesContainer ? deps.getMessagesContainer() : null;
        if (!container) return;

        const runs = window.electronAPI?.subagents?.listRuns
            ? await window.electronAPI.subagents.listRuns({ limit: 100 })
            : [];
        const activeRuns = runs.filter((run) => {
            const status = String(run.status || '').toLowerCase();
            return status === 'queued' || status === 'running' || status === 'cancelling';
        });
        const finishedRuns = runs.filter((run) => {
            const status = String(run.status || '').toLowerCase();
            return ['failed', 'completed', 'task_complete', 'task_failed', 'cancelled', 'stopped'].includes(status);
        });

        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'subagent-manager-tab';

        const title = document.createElement('h3');
        title.className = 'subagent-manager-title';
        title.textContent = 'Subagent Manager';
        root.appendChild(title);

        const controls = document.createElement('div');
        controls.className = 'subagent-manager-controls';

        const stats = document.createElement('div');
        stats.className = 'subagent-manager-stats';
        stats.textContent = `Showing ${runs.length} runs | active ${activeRuns.length} | finished ${finishedRuns.length}`;
        controls.appendChild(stats);

        const actions = document.createElement('div');
        actions.className = 'subagent-manager-global-actions';

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'compact-btn';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.addEventListener('click', async () => {
            if (deps.refreshSubagentManagerTab) {
                await deps.refreshSubagentManagerTab(panel);
            }
        });
        actions.appendChild(refreshBtn);

        const stopActiveBtn = document.createElement('button');
        stopActiveBtn.type = 'button';
        stopActiveBtn.className = 'compact-btn';
        stopActiveBtn.textContent = 'Stop Active';
        stopActiveBtn.disabled = activeRuns.length === 0;
        stopActiveBtn.addEventListener('click', async () => {
            if (!window.electronAPI?.subagents?.stopRun) return;
            const active = runs.filter((run) => {
                const status = String(run.status || '').toLowerCase();
                return status === 'queued' || status === 'running' || status === 'cancelling';
            });
            if (active.length === 0) {
                if (panel?.showNotification) {
                    panel.showNotification('No active subagent runs to stop.', 'info');
                }
                return;
            }
            let stopped = 0;
            for (const run of active) {
                const result = await window.electronAPI.subagents.stopRun(run.run_id);
                if (result?.success) stopped += 1;
            }
            if (panel?.showNotification) {
                panel.showNotification(`Stopped ${stopped} subagent run(s).`);
            }
            if (deps.refreshSubagentManagerTab) {
                await deps.refreshSubagentManagerTab(panel);
            }
        });
        actions.appendChild(stopActiveBtn);

        const clearFinishedBtn = document.createElement('button');
        clearFinishedBtn.type = 'button';
        clearFinishedBtn.className = 'compact-btn';
        clearFinishedBtn.textContent = 'Clear Finished';
        clearFinishedBtn.disabled = finishedRuns.length === 0;
        clearFinishedBtn.addEventListener('click', async () => {
            if (!window.electronAPI?.subagents?.clearRuns) return;
            const result = await window.electronAPI.subagents.clearRuns({ onlyFinished: true });
            if (panel?.showNotification) {
                panel.showNotification(`Cleared ${Number(result?.removed || 0)} finished run(s).`);
            }
            if (deps.refreshSubagentManagerTab) {
                await deps.refreshSubagentManagerTab(panel);
            }
        });
        actions.appendChild(clearFinishedBtn);

        const clearMockBtn = document.createElement('button');
        clearMockBtn.type = 'button';
        clearMockBtn.className = 'compact-btn';
        clearMockBtn.textContent = 'Clear Mock';
        clearMockBtn.disabled = runs.length === 0;
        clearMockBtn.addEventListener('click', async () => {
            if (!window.electronAPI?.subagents?.clearRuns) return;
            const result = await window.electronAPI.subagents.clearRuns({ onlyFinished: true, matchText: 'mock' });
            if (panel?.showNotification) {
                panel.showNotification(`Cleared ${Number(result?.removed || 0)} mock run(s).`);
            }
            if (deps.refreshSubagentManagerTab) {
                await deps.refreshSubagentManagerTab(panel);
            }
        });
        actions.appendChild(clearMockBtn);

        controls.appendChild(actions);
        root.appendChild(controls);

        if (!runs.length) {
            const empty = document.createElement('div');
            empty.className = 'subagent-manager-empty';
            empty.textContent = 'No subagent runs yet.';
            root.appendChild(empty);
            container.appendChild(root);
            return;
        }

        const list = document.createElement('div');
        list.className = 'subagent-manager-list';
        runs.forEach((run) => {
            const item = document.createElement('div');
            item.className = 'subagent-manager-item';

            const agentName = String(run.agent_name || `Subagent ${run.subagent_id || ''}`.trim());
            const status = String(run.status || 'unknown');
            const normalizedStatus = status.toLowerCase();
            const taskText = String(run.task || '').trim() || 'No task';
            const statusClass = normalizedStatus.replace(/[^a-z0-9_-]/g, '-');

            item.innerHTML = `
                <div class="subagent-manager-item-head">
                    <strong>${agentName}</strong>
                    <span class="subagent-manager-status status-${statusClass}">${status}</span>
                </div>
                <div class="subagent-manager-item-meta">id: ${run.run_id} | parent: ${run.parent_session_id ?? 'none'} | sub: ${run.subagent_id ?? 'n/a'}</div>
                <div class="subagent-manager-item-task">${taskText}</div>
            `;

            const actions = document.createElement('div');
            actions.className = 'subagent-manager-item-actions';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'compact-btn';
            openBtn.textContent = 'Open Chat';
            openBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!deps.ensureSubagentChat) return;
                await deps.ensureSubagentChat(panel, {
                    runId: run.run_id,
                    childSessionId: run.child_session_id,
                    child_session_id: run.child_session_id,
                    subagentId: run.subagent_id,
                    subagent_id: run.subagent_id,
                    agentName,
                    agent_name: agentName,
                    parentSessionId: run.parent_session_id,
                    parent_session_id: run.parent_session_id,
                    subagentMode: run.subagent_mode || 'no_ui',
                    subagent_mode: run.subagent_mode || 'no_ui',
                    __eventType: status === 'queued' || status === 'running' ? 'subagent:started' : 'subagent:completed'
                }, { activate: true });
            });

            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.className = 'compact-btn';
            stopBtn.textContent = 'Stop';
            const runStatus = normalizedStatus;
            const canStop = runStatus === 'queued' || runStatus === 'running' || runStatus === 'cancelling';

            actions.appendChild(openBtn);
            stopBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!window.electronAPI?.subagents?.stopRun) return;
                stopBtn.disabled = true;
                stopBtn.textContent = canStop ? 'Stopping...' : 'Stop';
                const result = await window.electronAPI.subagents.stopRun(run.run_id);
                if (panel?.showNotification) {
                    if (result?.success) {
                        const message = result?.alreadyTerminal
                            ? `No live execution for subagent run ${run.run_id}; status remains ${runStatus}.`
                            : `Stopped subagent run ${run.run_id}.`;
                        panel.showNotification(message, result?.alreadyTerminal ? 'info' : undefined);
                    } else {
                        panel.showNotification(result?.error || `Subagent run ${run.run_id} is already ${runStatus || 'finished'}.`, 'info');
                    }
                }
                if (deps.refreshSubagentManagerTab) {
                    await deps.refreshSubagentManagerTab(panel);
                }
            });
            actions.appendChild(stopBtn);
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'compact-btn';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!window.electronAPI?.subagents?.closeRun) return;
                closeBtn.disabled = true;
                closeBtn.textContent = 'Closing...';
                const result = await window.electronAPI.subagents.closeRun(run.run_id);
                if (panel?.showNotification) {
                    if (result?.success) {
                        panel.showNotification(`Closed subagent run ${run.run_id}.`, 'info');
                    } else {
                        panel.showNotification(result?.error || `Failed to close subagent run ${run.run_id}.`, 'error');
                    }
                }
                if (deps.refreshSubagentManagerTab) {
                    await deps.refreshSubagentManagerTab(panel);
                }
            });
            actions.appendChild(closeBtn);
            item.appendChild(actions);
            list.appendChild(item);
        });

        root.appendChild(list);
        container.appendChild(root);
    }

    function getAgentConfigSummary(agent) {
        if (!agent || !agent.config) return '';
        const config = typeof agent.config === 'string'
            ? (() => {
                try { return JSON.parse(agent.config); } catch (error) { return null; }
            })()
            : agent.config;
        if (!config || typeof config !== 'object') return '';

        const provider = config.provider || config.llm_provider || config.model_provider || '';
        const model = config.model || config.llm_model || config.model_name || '';
        if (provider && model) return `${provider} / ${model}`;
        return provider || model || '';
    }

    function openAgentSettings(agentId) {
        const normalized = Number(agentId);
        if (!Number.isFinite(normalized)) return;
        document.dispatchEvent(new CustomEvent('open-agent-config', {
            detail: { agentId: normalized }
        }));
    }

    async function openSuperagentChat(panel, agent) {
        if (!window.electronAPI?.agents?.activate || !panel?.openAgentChat) return;
        const result = await window.electronAPI.agents.activate(agent.id);
        if (result && result.sessionId) {
            await panel.openAgentChat(agent.id, result.sessionId, result.agent || agent);
        }
    }

    async function renderSuperagentManagerTab(panel, deps = {}) {
        const container = deps.getMessagesContainer ? deps.getMessagesContainer() : null;
        if (!container) return;

        const agents = window.electronAPI?.agents?.list
            ? await window.electronAPI.agents.list('pro')
            : [];

        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'superagent-manager-tab';

        const title = document.createElement('h3');
        title.className = 'superagent-manager-title';
        title.textContent = 'Superagent Manager';
        root.appendChild(title);

        if (!agents.length) {
            const empty = document.createElement('div');
            empty.className = 'superagent-manager-empty';
            empty.textContent = 'No superagents configured.';
            root.appendChild(empty);
            container.appendChild(root);
            return;
        }

        const list = document.createElement('div');
        list.className = 'superagent-manager-list';
        agents.forEach((agent) => {
            const item = document.createElement('div');
            item.className = 'superagent-manager-item';

            const status = String(agent.status || 'idle');
            const normalizedStatus = status.toLowerCase();
            const statusClass = normalizedStatus.replace(/[^a-z0-9_-]/g, '-');
            const description = String(agent.description || '').trim() || 'No description';
            const configLine = getAgentConfigSummary(agent);

            item.innerHTML = `
                <div class="superagent-manager-item-head">
                    <strong>${agent.icon || '🤖'} ${agent.name || `Agent ${agent.id}`}</strong>
                    <span class="superagent-manager-status status-${statusClass}">${status}</span>
                </div>
                <div class="superagent-manager-item-meta">id: ${agent.id} | type: ${agent.type || 'pro'}${configLine ? ` | model: ${configLine}` : ''}</div>
                <div class="superagent-manager-item-task">${description}</div>
            `;

            const actions = document.createElement('div');
            actions.className = 'superagent-manager-item-actions';
            const visible = agent.visibleInSidebar !== false && agent.visible_in_sidebar !== 0;

            const showBtn = document.createElement('button');
            showBtn.type = 'button';
            showBtn.className = `compact-btn superagent-manager-visibility${visible ? ' active' : ''}`;
            showBtn.textContent = 'Show';
            showBtn.title = visible ? 'Shown in left sidebar' : 'Hidden from left sidebar';
            showBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
            showBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!window.electronAPI?.agents?.setSidebarVisible) return;
                const result = await window.electronAPI.agents.setSidebarVisible(agent.id, !visible);
                if (result?.success === false && panel?.showNotification) {
                    panel.showNotification(result?.error || 'Failed to update agent visibility', 'error');
                    return;
                }
                if (deps.refreshSuperagentManagerTab) {
                    await deps.refreshSuperagentManagerTab(panel);
                }
            });

            const openChatBtn = document.createElement('button');
            openChatBtn.type = 'button';
            openChatBtn.className = 'compact-btn';
            openChatBtn.textContent = 'Open Chat';
            openChatBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await openSuperagentChat(panel, agent);
            });

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'compact-btn';
            settingsBtn.textContent = 'Settings';
            settingsBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                openAgentSettings(agent.id);
            });

            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.className = 'compact-btn';
            stopBtn.textContent = 'Stop';
            const canStop = normalizedStatus === 'active' || normalizedStatus === 'busy' || normalizedStatus === 'running';
            stopBtn.disabled = !canStop;
            stopBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!canStop || !window.electronAPI?.agents?.deactivate) return;
                const result = await window.electronAPI.agents.deactivate(agent.id);
                if (result?.success === false && panel?.showNotification) {
                    panel.showNotification(result?.error || 'Failed to stop superagent', 'error');
                }
                if (deps.refreshSuperagentManagerTab) {
                    await deps.refreshSuperagentManagerTab(panel);
                }
            });

            actions.appendChild(showBtn);
            actions.appendChild(openChatBtn);
            actions.appendChild(settingsBtn);
            actions.appendChild(stopBtn);
            item.appendChild(actions);
            list.appendChild(item);
        });

        root.appendChild(list);
        container.appendChild(root);
    }

    async function openSuperagentManagerTab(panel, deps = {}) {
        const tabId = deps.tabId || 'superagent-manager';
        if (!panel.chatTabs.has(tabId)) {
            deps.saveCurrentTabMessages?.(panel);
            panel.chatTabs.set(tabId, deps.createTabState?.({
                title: 'Superagent Manager',
                agentIcon: '🧠',
                isSuperagentManager: true
            }) || {
                title: 'Superagent Manager',
                agentIcon: '🧠',
                isSuperagentManager: true
            });
        }
        if (deps.switchTab) {
            await deps.switchTab(panel, tabId);
        }
    }

    async function refreshSuperagentManagerTab(panel, deps = {}) {
        const tabId = deps.tabId || 'superagent-manager';
        if (panel.activeTabId !== tabId) return;
        if (deps.renderSuperagentManagerTab) {
            await deps.renderSuperagentManagerTab(panel);
            panel._storeActiveTabScrollState();
        }
    }

    window.superagentManagerTab = {
        renderSubagentManagerTab,
        openSuperagentManagerTab,
        refreshSuperagentManagerTab,
        renderSuperagentManagerTab
    };
})();
