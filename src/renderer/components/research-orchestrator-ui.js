(function () {
    const PLUGIN_ID = 'agent-research-orchestrator-ui';
    const childStateByParent = new Map();
    let cachedProviders = null;
    const cachedModelsByProvider = new Map();

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;');
    }

    function getUiContext(panel) {
        const activeTab = panel?.chatTabs?.get?.(panel.activeTabId) || {};
        return {
            sessionId: panel?.activeTabId || null,
            uiMode: activeTab.uiMode || 'plugin',
            uiPluginId: activeTab.uiPluginId || PLUGIN_ID
        };
    }

    async function runPluginAction(panel, agentId, action, payload = {}) {
        if (!window.electronAPI?.agents?.runChatUIAction) return { success: false };
        return window.electronAPI.agents.runChatUIAction(
            agentId,
            action,
            { ...payload, pluginId: PLUGIN_ID },
            getUiContext(panel)
        );
    }

    function getOrCreateParentState(parentSessionId) {
        const key = String(parentSessionId || 'default');
        if (!childStateByParent.has(key)) {
            childStateByParent.set(key, {
                childMessages: new Map(),
                artifactsOpen: new Set(),
                artifactPreviewByChild: new Map(),
                artifactListByChild: new Map(),
                sendingByChild: new Set()
            });
        }
        return childStateByParent.get(key);
    }

    function getPluginRoot(root) {
        if (!root?.querySelector) return null;
        return root.querySelector(`[data-agent-ui-plugin-id="${PLUGIN_ID}"] [data-research-orch-root]`)
            || root.querySelector('[data-research-orch-root]')
            || null;
    }

    function parsePluginState(pluginRoot) {
        const raw = pluginRoot?.dataset?.roState || '{}';
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
            return {};
        } catch (_) {
            return {};
        }
    }

    async function getProviders() {
        if (cachedProviders) return cachedProviders;
        const providers = await window.electronAPI.getProviders();
        cachedProviders = Array.isArray(providers) ? providers : [];
        return cachedProviders;
    }

    async function getModels(provider) {
        const key = String(provider || '').trim();
        if (!key) return [];
        if (cachedModelsByProvider.has(key)) {
            return cachedModelsByProvider.get(key);
        }
        const models = await window.electronAPI.llm.getModels(key, false);
        const normalized = Array.isArray(models) ? models : [];
        cachedModelsByProvider.set(key, normalized);
        return normalized;
    }

    function setSendingState(parentState, childId, sending) {
        const id = String(childId || '');
        if (!id) return;
        if (sending) parentState.sendingByChild.add(id);
        else parentState.sendingByChild.delete(id);
    }

    function renderMessagesInto(container, messages = []) {
        if (!container) return;
        if (!messages.length) {
            container.textContent = 'No messages yet.';
            return;
        }
        container.innerHTML = messages.map(item => {
            const role = String(item?.role || 'assistant');
            const content = String(item?.content || '').trim();
            const trimmed = content.length > 1400 ? `${content.slice(0, 1400)}...` : content;
            return `<div class="research-child-message"><span class="research-child-message-role">${escapeHtml(role)}:</span>${escapeHtml(trimmed)}</div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    }

    async function loadChildMessages(sessionId) {
        if (!sessionId) return [];
        const all = await window.electronAPI.loadChatSession(sessionId);
        const list = Array.isArray(all) ? all : [];
        return list.slice(Math.max(0, list.length - 12));
    }

    async function ensureChildSession(panel, agentId, childId, card) {
        const current = String(card.dataset.childSessionId || '').trim();
        if (current) return current;
        const created = await window.electronAPI.createChatSession();
        const sessionId = String(created?.id || '').trim();
        if (!sessionId) return '';
        card.dataset.childSessionId = sessionId;
        await runPluginAction(panel, agentId, 'link-child-session', { childId, sessionId });
        return sessionId;
    }

    async function persistChildPicker(panel, agentId, childId, card) {
        const providerEl = card.querySelector('[data-research-provider]');
        const modelEl = card.querySelector('[data-research-model]');
        const provider = String(providerEl?.value || '').trim();
        const model = String(modelEl?.value || '').trim();
        await runPluginAction(panel, agentId, 'set-child-llm', { childId, provider, model });
    }

    async function applyProviderForSend(card) {
        const providerEl = card.querySelector('[data-research-provider]');
        const modelEl = card.querySelector('[data-research-model]');
        let provider = String(providerEl?.value || '').trim();
        let model = String(modelEl?.value || '').trim();

        if (!provider || !model) {
            const globalConfig = await window.electronAPI.llm.getConfig();
            if (!provider && globalConfig?.provider) {
                provider = String(globalConfig.provider);
                if (providerEl) providerEl.value = provider;
            }
            if (!model && globalConfig?.model) {
                model = String(globalConfig.model);
                if (modelEl) modelEl.value = model;
            }
        }

        if (!provider || !model) return { provider: '', model: '' };
        await window.electronAPI.llm.saveConfig({ provider, model });
        return { provider, model };
    }

    function setCardStatus(card, status) {
        const badge = card.querySelector('.research-child-status');
        if (!badge) return;
        badge.className = `research-child-status status-${String(status || 'idle').toLowerCase()}`;
        badge.textContent = String(status || 'idle');
    }

    async function renderArtifacts(card, sessionId, parentState, childId) {
        const host = card.querySelector(`[data-research-artifacts="${String(childId)}"]`);
        if (!host) return;
        const isOpen = parentState.artifactsOpen.has(childId);
        host.hidden = !isOpen;
        if (!isOpen) return;

        if (!sessionId) {
            host.innerHTML = '<div class="research-child-artifact-preview">Create/send in this child first to attach artifacts.</div>';
            return;
        }

        let files = parentState.artifactListByChild.get(childId);
        if (!files) {
            const result = await window.electronAPI.getSessionArtifacts(sessionId);
            files = Array.isArray(result?.files) ? result.files : [];
            parentState.artifactListByChild.set(childId, files);
        }

        const preview = parentState.artifactPreviewByChild.get(childId) || 'Select an artifact to preview.';
        const listMarkup = files.length
            ? files.slice(0, 8).map(file => (
                `<button type="button" class="research-child-artifact-item" data-research-artifact-item data-artifact-name="${escapeHtml(file.name)}" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</button>`
            )).join('')
            : '<div class="research-child-artifact-preview">No artifacts for this child yet.</div>';

        host.innerHTML = `${listMarkup}<div class="research-child-artifact-preview">${escapeHtml(preview)}</div>`;

        host.querySelectorAll('[data-research-artifact-item]').forEach(button => {
            if (button.dataset.bound === '1') return;
            button.dataset.bound = '1';
            button.addEventListener('click', async () => {
                const fileName = button.dataset.artifactName || '';
                const result = await window.electronAPI.readSessionArtifact(sessionId, fileName);
                let text = 'Preview unavailable.';
                if (result?.success && result.kind === 'text') {
                    const content = String(result.content || '');
                    text = content.length > 900 ? `${content.slice(0, 900)}...` : content;
                } else if (result?.success) {
                    text = `${result.kind || 'binary'} artifact (${result.size || 0} bytes)`;
                } else if (result?.error) {
                    text = result.error;
                }
                parentState.artifactPreviewByChild.set(childId, text);
                await renderArtifacts(card, sessionId, parentState, childId);
            });
        });
    }

    async function hydrateChildCard(panel, pluginRoot, card, child, parentState, agentId) {
        const childId = String(child?.id || card.dataset.childId || '');
        if (!childId) return;

        const providerEl = card.querySelector('[data-research-provider]');
        const modelEl = card.querySelector('[data-research-model]');
        const messagesHost = card.querySelector(`[data-research-messages="${childId}"]`);
        const form = card.querySelector('[data-research-send-form]');
        const input = card.querySelector(`[data-research-input="${childId}"]`);
        const artifactsBtn = card.querySelector('[data-research-artifacts-btn]');
        const refreshBtn = card.querySelector('[data-research-refresh-btn]');

        const globalConfig = await window.electronAPI.llm.getConfig();
        const providerValue = String(child.provider || providerEl?.dataset?.value || globalConfig?.provider || '');

        if (providerEl && providerEl.dataset.bound !== '1') {
            const providers = await getProviders();
            providerEl.innerHTML = providers.map(provider => {
                const selected = provider === providerValue ? ' selected' : '';
                return `<option value="${escapeHtml(provider)}"${selected}>${escapeHtml(provider)}</option>`;
            }).join('');
            if (!providerEl.value && providers.length > 0) {
                providerEl.value = providers[0];
            }
            providerEl.dataset.bound = '1';
            providerEl.addEventListener('change', async () => {
                const provider = providerEl.value;
                const models = await getModels(provider);
                modelEl.innerHTML = models.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
                if (models.length > 0) {
                    modelEl.value = models[0];
                }
                await persistChildPicker(panel, agentId, childId, card);
            });
        }

        if (modelEl && modelEl.dataset.bound !== '1') {
            const targetProvider = providerEl?.value || providerValue;
            const models = await getModels(targetProvider);
            const preferredModel = String(child.model || modelEl.dataset.value || globalConfig?.model || '');
            modelEl.innerHTML = models.map(model => {
                const selected = model === preferredModel ? ' selected' : '';
                return `<option value="${escapeHtml(model)}"${selected}>${escapeHtml(model)}</option>`;
            }).join('');
            if (!modelEl.value && models.length > 0) {
                modelEl.value = models[0];
            }
            modelEl.dataset.bound = '1';
            modelEl.addEventListener('change', async () => {
                await persistChildPicker(panel, agentId, childId, card);
            });
        }

        const existingSessionId = String(card.dataset.childSessionId || child.sessionId || '').trim();
        if (existingSessionId && messagesHost && messagesHost.dataset.loaded !== existingSessionId) {
            const messages = await loadChildMessages(existingSessionId);
            parentState.childMessages.set(childId, messages);
            renderMessagesInto(messagesHost, messages);
            messagesHost.dataset.loaded = existingSessionId;
        } else if (!existingSessionId && messagesHost && !messagesHost.textContent.trim()) {
            messagesHost.textContent = 'No messages yet.';
        }

        if (refreshBtn && refreshBtn.dataset.bound !== '1') {
            refreshBtn.dataset.bound = '1';
            refreshBtn.addEventListener('click', async () => {
                const sid = String(card.dataset.childSessionId || '').trim();
                if (!sid) return;
                const messages = await loadChildMessages(sid);
                parentState.childMessages.set(childId, messages);
                renderMessagesInto(messagesHost, messages);
            });
        }

        if (artifactsBtn && artifactsBtn.dataset.bound !== '1') {
            artifactsBtn.dataset.bound = '1';
            artifactsBtn.addEventListener('click', async () => {
                if (parentState.artifactsOpen.has(childId)) {
                    parentState.artifactsOpen.delete(childId);
                } else {
                    parentState.artifactsOpen.add(childId);
                }
                const sid = String(card.dataset.childSessionId || '').trim();
                await renderArtifacts(card, sid, parentState, childId);
            });
        }

        if (form && form.dataset.bound !== '1') {
            form.dataset.bound = '1';
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!input) return;
                const text = input.value.trim();
                if (!text) return;
                const currentParentSessionId = panel.activeTabId;
                const sendButton = form.querySelector('.research-child-send');
                const latestState = parsePluginState(pluginRoot);
                const runChildInsideAgent = latestState.runChildInsideAgent !== false;
                const runSubagentWithChatUi = latestState.runSubagentWithChatUi !== false;

                if (parentState.sendingByChild.has(childId)) {
                    return;
                }
                setSendingState(parentState, childId, true);
                setCardStatus(card, 'running');
                await runPluginAction(panel, agentId, 'touch-child', { childId, status: 'running' });

                try {
                    const sessionId = await ensureChildSession(panel, agentId, childId, card);
                    if (!sessionId) {
                        throw new Error('Failed to create child session');
                    }

                    await persistChildPicker(panel, agentId, childId, card);
                    const resolvedLlm = await applyProviderForSend(card);
                    if (resolvedLlm.provider && resolvedLlm.model) {
                        await runPluginAction(panel, agentId, 'set-child-llm', {
                            childId,
                            provider: resolvedLlm.provider,
                            model: resolvedLlm.model
                        });
                    }

                    if (!runChildInsideAgent && runSubagentWithChatUi && typeof panel.ensureSubagentChat === 'function') {
                        await panel.ensureSubagentChat({
                            childSessionId: sessionId,
                            child_session_id: sessionId,
                            agentName: child?.title || `Research Child ${childId}`,
                            agent_name: child?.title || `Research Child ${childId}`,
                            subagentMode: 'ui',
                            subagent_mode: 'ui',
                            __eventType: 'subagent:started'
                        }, { activate: true });
                    }

                    if (sendButton) sendButton.disabled = true;

                    await window.electronAPI.sendMessage(text, sessionId);
                    input.value = '';

                    if (runChildInsideAgent) {
                        const messages = await loadChildMessages(sessionId);
                        parentState.childMessages.set(childId, messages);
                        renderMessagesInto(messagesHost, messages);
                    }
                    parentState.artifactListByChild.delete(childId);

                    setCardStatus(card, 'done');
                    await runPluginAction(panel, agentId, 'touch-child', { childId, status: 'done' });

                    if (runChildInsideAgent && currentParentSessionId) {
                        await window.electronAPI.switchChatSession(currentParentSessionId);
                    }
                } catch (error) {
                    console.error('Research child send failed:', error);
                    setCardStatus(card, 'idle');
                    await runPluginAction(panel, agentId, 'touch-child', { childId, status: 'idle' });
                    if (window.mainPanel?.showNotification) {
                        window.mainPanel.showNotification(`Child send failed: ${error.message}`, 'error');
                    }
                } finally {
                    setSendingState(parentState, childId, false);
                    if (sendButton) sendButton.disabled = false;
                }
            });
        }
    }

    async function hydrate(panel, root, agentId) {
        if (!panel || !root || !agentId) return;
        const pluginRoot = getPluginRoot(root);
        if (!pluginRoot) return;

        const state = parsePluginState(pluginRoot);
        const parentSessionId = panel.activeTabId;
        const parentState = getOrCreateParentState(parentSessionId);

        const children = Array.isArray(state.children) ? state.children : [];
        const cardsById = new Map();
        pluginRoot.querySelectorAll('[data-child-id]').forEach(card => {
            const childId = String(card.dataset.childId || '');
            if (childId) cardsById.set(childId, card);
        });

        for (const child of children) {
            const card = cardsById.get(String(child.id || ''));
            if (!card) continue;
            await hydrateChildCard(panel, pluginRoot, card, child, parentState, agentId);
        }
    }

    window.researchOrchestratorUI = {
        hydrate,
        clear() {
            childStateByParent.clear();
            cachedModelsByProvider.clear();
        }
    };
})();
