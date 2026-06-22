(function () {
    const {
        providerLabel,
        setCurrentConfigLabel,
        providerFieldId,
        normalizeParamString,
        renderGenericProviderSettings,
        renderOpenAIProviderSettings,
        renderModelSettings,
        collectRuntimeConfig
    } = window.ApiProviderSettingsHelpers || {};

    window.initializeApiProviderSettings = async function (mainPanel) {
        const llmProviderSelect = document.getElementById('llm-provider-select');
        const llmModelSelect = document.getElementById('llm-model-select');
        const llmModelLabel = document.querySelector('label[for="llm-model-select"]');
        const llmModelRow = llmModelSelect?.closest('.api-inline-action-row');
        const refreshModelsButton = document.getElementById('refresh-provider-models-btn');
        const testSelectedModelButton = document.getElementById('test-selected-model-btn');
        const selectedModelStatus = document.getElementById('selected-model-status');
        const providerDiscoveryStatus = document.getElementById('provider-discovery-status');
        const providerSettingsContainer = document.getElementById('provider-settings-container');
        const llmConfigSaveButton = document.getElementById('llm-config-save-button');
        const modelSettingsSection = document.getElementById('llm-model-settings-section');
        const modelCapabilitiesContainer = document.getElementById('llm-model-capabilities');
        const modelConfigContainer = document.getElementById('llm-model-config-container');
        const llmSettingsContainer = document.querySelector('#api-tab .llm-settings');
        const globalConcurrencyToggle = document.getElementById('global-concurrency-enabled');
        const currentConfigDisplay = document.getElementById('current-config-display');
        const currentConfigText = document.getElementById('current-config-text');
        const chatProviderSelect = document.getElementById('chat-provider-select');
        const chatModelSelect = document.getElementById('chat-model-select');

        if (!llmProviderSelect || !llmModelSelect) return;

        let currentConfig = null;
        let currentModelProfile = null;
        let providerProfileMap = {};
        let syncModelsToChat = null;
        let modelProfileRequestId = 0;
        const modelClusterDefaultAnchor = document.createElement('div');
        const modelClusterLocalAnchor = document.createElement('div');
        modelClusterDefaultAnchor.className = 'initially-hidden';
        modelClusterLocalAnchor.className = 'initially-hidden';
        const getProviderProfile = (provider) => providerProfileMap[provider] || null;

        if (providerDiscoveryStatus?.parentNode && llmModelLabel && llmModelRow) {
            providerDiscoveryStatus.parentNode.insertBefore(modelClusterDefaultAnchor, llmModelLabel);
            providerDiscoveryStatus.parentNode.insertBefore(modelClusterLocalAnchor, providerSettingsContainer.nextSibling);
        }

        const moveModelCluster = (anchor) => {
            if (!anchor || !llmModelLabel || !llmModelRow) return;
            const nodes = [llmModelLabel, llmModelRow, selectedModelStatus, providerDiscoveryStatus];
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const node = nodes[i];
                if (node?.parentNode) {
                    anchor.parentNode.insertBefore(node, anchor.nextSibling);
                }
            }
        };

        const applyProviderFieldOrderLayout = (provider) => {
            if (provider === 'local-openai') {
                moveModelCluster(modelClusterLocalAnchor);
            } else {
                moveModelCluster(modelClusterDefaultAnchor);
            }
        };

        const toggleCustomModelSection = (provider) => {
            const customSection = document.getElementById('custom-model-section');
            const customLabel = customSection?.querySelector('label[for="custom-model-input"]');
            const customInput = document.getElementById('custom-model-input');
            const profile = getProviderProfile(provider);
            if (!customSection) return;

            const enabled = Boolean(profile?.settings?.supportsCustomModel) && provider !== 'lmstudio' && provider !== 'local-openai';
            customSection.classList?.toggle?.('initially-hidden', !enabled);
            if (customLabel) {
                customLabel.textContent = profile?.settings?.customModelLabel || 'Custom Model';
            }
            if (customInput) {
                customInput.placeholder = profile?.settings?.customModelPlaceholder || 'Type model name...';
            }
        };

        const updateModelActionControls = (provider) => {
            if (!testSelectedModelButton) return;
            const showSelectedTest = provider === 'local-openai';
            testSelectedModelButton.classList?.toggle?.('initially-hidden', !showSelectedTest);
            if (selectedModelStatus && !showSelectedTest) {
                selectedModelStatus.textContent = '';
            }
        };

        const applyProviderScrollLayout = (provider) => {
            if (!llmSettingsContainer) return;
            llmSettingsContainer.classList?.toggle?.('provider-scroll-enabled', provider === 'lmstudio');
        };

        const buildProviderConfig = (provider, { includeModel = true, strict = false } = {}) => {
            const config = { provider };
            if (globalConcurrencyToggle) config.concurrencyEnabled = Boolean(globalConcurrencyToggle.checked);
            const profile = getProviderProfile(provider);
            const model = llmModelSelect.value;

            if (provider === 'openai') {
                config.transport = document.querySelector('input[name="openai-transport"]:checked')?.value || 'codex-cli';
                config.codexSandbox = document.getElementById('openai-codex-sandbox')?.value || 'read-only';
                config.codexSearch = Boolean(document.getElementById('openai-codex-search')?.checked);
            }

            if (profile?.settings?.connectionFields?.length) {
                config.connection = {};
                profile.settings.connectionFields.forEach(field => {
                    const input = document.getElementById(providerFieldId(field.id));
                    if (!input) return;
                    const rawValue = input.value || '';
                    const value = (field.id === 'modelParams' || field.id === 'serverParams')
                        ? normalizeParamString(rawValue)
                        : rawValue.trim();
                    if ((field.id === 'apiKey' || field.type === 'password') && !value) {
                        return;
                    }
                    config.connection[field.id] = value;
                    if (field.id === 'apiKey' && value) config.apiKey = value;
                    if (field.id === 'url' && value) config.url = value;
                });
            }

            if (provider === 'qwen') {
                const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                config.mode = mode;
                config.useOAuth = mode === 'oauth';
                if (mode === 'api') {
                    const apiKey = document.getElementById('qwen-key')?.value?.trim();
                    if (apiKey) config.apiKey = apiKey;
                }
            }

            if (includeModel && !isPlaceholderModel(model)) {
                config.model = model;
            }

            if (config.model && currentModelProfile?.spec?.model === config.model) {
                config.runtimeConfig = collectRuntimeConfig(currentModelProfile.runtimeConfig, strict);
            }

            return config;
        };

        const applyVisibilityToMainPanel = (runtimeConfig) => {
            if (mainPanel) {
                mainPanel._thinkingVisibility = runtimeConfig?.reasoning?.visibility || 'show';
            }
        };

        const isPlaceholderModel = (model) => {
            return !model
                || model === 'Select a Model...'
                || model === 'Select a provider first'
                || model === 'No models found'
                || model === 'Failed to load models';
        };

        const resolveValidModel = (select, preferredModel = '') => {
            const normalized = String(preferredModel || '').trim();
            const options = Array.from(select?.options || []);
            if (!options.length) return '';
            if (normalized && options.some(option => option.value === normalized && !option.disabled)) {
                return normalized;
            }
            const firstUsable = options.find(option => !option.disabled && !isPlaceholderModel(option.value));
            return firstUsable?.value || '';
        };

        const persistConfig = async (config, notificationMessage = null) => {
            await window.electronAPI.llm.saveConfig(config);
            currentConfig = await window.electronAPI.llm.getConfig();
            if (globalConcurrencyToggle) globalConcurrencyToggle.checked = Boolean(currentConfig?.concurrencyEnabled);
            applyVisibilityToMainPanel(currentConfig?.runtimeConfig || config.runtimeConfig);
            setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
            if (notificationMessage) {
                mainPanel.showNotification(notificationMessage, 'info');
            }
            return currentConfig;
        };

        const loadModelProfile = async (provider, model) => {
            const requestId = ++modelProfileRequestId;
            if (!provider || !model || model === 'Select a Model...' || model === 'No models found') {
                currentModelProfile = null;
                renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
                mainPanel?.applyContextProfile?.(null);
                return null;
            }

            const profile = await window.electronAPI.llm.getModelProfile(provider, model);
            if (requestId !== modelProfileRequestId) {
                return currentModelProfile;
            }
            currentModelProfile = profile;
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, currentModelProfile);
            applyVisibilityToMainPanel(currentModelProfile?.runtimeConfig);
            mainPanel?.applyContextProfile?.(currentModelProfile);
            return currentModelProfile;
        };

        const loadModelsForProvider = async (provider, forceRefresh = false, preferredModel = null) => {
            if (!provider || provider === 'Select a Provider...') {
                llmModelSelect.innerHTML = '<option>Select a provider first</option>';
                if (providerDiscoveryStatus) providerDiscoveryStatus.textContent = '';
                await loadModelProfile(null, null);
                return [];
            }

            currentModelProfile = null;
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
            mainPanel?.applyContextProfile?.(null);
            llmModelSelect.innerHTML = '<option disabled>Loading models...</option>';
            if (providerDiscoveryStatus) {
                providerDiscoveryStatus.textContent = forceRefresh ? 'Refreshing model list...' : '';
            }

            try {
                let models = await window.electronAPI.llm.getModels(provider, forceRefresh);
                if (provider === 'lmstudio' && (!Array.isArray(models) || models.length === 0)) {
                    const rawUrl = document.getElementById(providerFieldId('url'))?.value?.trim() || 'http://localhost:1234';
                    const normalizeLmstudioModelsUrl = (baseUrl) => {
                        try {
                            const u = new URL(baseUrl);
                            if (u.hostname === 'localhost') {
                                u.hostname = '127.0.0.1';
                            }
                            const pathname = (u.pathname || '/').replace(/\/+$/, '') || '/';
                            const hasV1 = pathname === '/v1' || pathname.endsWith('/v1');
                            const basePath = hasV1 ? pathname : `${pathname === '/' ? '' : pathname}/v1`;
                            u.pathname = `${basePath}/models`;
                            return u.toString();
                        } catch (_) {
                            const stripped = String(baseUrl || '').replace(/\/+$/, '');
                            return `${stripped}/v1/models`;
                        }
                    };

                    try {
                        const response = await fetch(normalizeLmstudioModelsUrl(rawUrl));
                        if (response.ok) {
                            const payload = await response.json();
                            const rawModels = Array.isArray(payload?.data)
                                ? payload.data
                                : (Array.isArray(payload?.models) ? payload.models : []);
                            models = rawModels
                                .map(model => typeof model === 'string' ? model.trim() : String(model?.id || model?.name || '').trim())
                                .filter(Boolean);
                        }
                    } catch (_) {
                        // Keep empty list if direct fallback also fails.
                    }
                }
                llmModelSelect.innerHTML = '<option disabled selected>Select a Model...</option>';

                if (models && models.length > 0) {
                    models.forEach(modelName => {
                        const option = document.createElement('option');
                        option.value = modelName;
                        option.textContent = modelName;
                        llmModelSelect.appendChild(option);
                    });

                    const targetModel = preferredModel
                        || (currentConfig?.provider === provider ? currentConfig?.model : null)
                        || null;
                    if (targetModel && Array.from(llmModelSelect.options).some(o => o.value === targetModel)) {
                        llmModelSelect.value = targetModel;
                    }
                } else {
                    llmModelSelect.innerHTML = '<option disabled>No models found</option>';
                }

                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = models?.length
                        ? `Found ${models.length} model${models.length === 1 ? '' : 's'}.`
                        : (provider === 'local-openai'
                            ? 'No models discovered. Set --model in Model Params, then click Test Model.'
                            : 'No models discovered. You can still enter a manual model ID below.');
                }
                await loadModelProfile(provider, llmModelSelect.value);
                return models || [];
            } catch (error) {
                console.error('Failed to load models:', error);
                llmModelSelect.innerHTML = '<option>Failed to load models</option>';
                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = `Discovery failed: ${error.message}`;
                }
                await loadModelProfile(null, null);
                return [];
            }
        };

        const updateProviderSettings = async (provider) => {
            providerSettingsContainer.innerHTML = '';
            currentConfig = await window.electronAPI.llm.getConfig();
            const profile = getProviderProfile(provider);
            const savedConnection = await window.electronAPI.llm.getProviderConnectionConfig(provider);

            if (provider === 'qwen') {
                providerSettingsContainer.innerHTML = `
                    <div class="config-field">
                        <label>Qwen Access Mode</label>
                        <div class="config-inline-row">
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="cli" checked> <span>CLI</span></label>
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="api"> <span>API</span></label>
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="oauth"> <span>OAuth</span></label>
                        </div>
                    </div>
                    <div id="qwen-cli-settings" class="config-help">CLI mode runs the local qwen command.</div>
                    <div id="qwen-api-settings" class="api-subsection initially-hidden">
                        <div class="config-field">
                            <label for="qwen-key">API Key</label>
                            <input type="password" id="qwen-key" placeholder="sk-...">
                        </div>
                        <div class="api-action-row">
                            <button type="button" id="verify-api-key" class="secondary-btn">Verify Key</button>
                        </div>
                        <div id="qwen-api-status" class="config-help api-status-text"></div>
                    </div>
                    <div id="qwen-oauth-settings" class="api-subsection initially-hidden">
                        <div class="api-action-row">
                            <button type="button" id="qwen-fetch-oauth" class="secondary-btn">Load OAuth Credentials</button>
                        </div>
                        <div id="qwen-oauth-status" class="config-help api-status-text"></div>
                    </div>
                `;
            } else if (provider === 'openai' && profile) {
                providerSettingsContainer.innerHTML = renderOpenAIProviderSettings(profile, savedConnection, currentConfig);
            } else if (profile) {
                providerSettingsContainer.innerHTML = renderGenericProviderSettings(profile, savedConnection);
            }

            toggleCustomModelSection(provider);

            if (provider === 'qwen') {
                const applyQwenMode = async (mode, preferredModel = null, refresh = false) => {
                    const cliSettings = document.getElementById('qwen-cli-settings');
                    const apiSettings = document.getElementById('qwen-api-settings');
                    const oauthSettings = document.getElementById('qwen-oauth-settings');

                    if (cliSettings) cliSettings.style.display = mode === 'cli' ? 'block' : 'none';
                    if (apiSettings) apiSettings.style.display = mode === 'api' ? 'block' : 'none';
                    if (oauthSettings) oauthSettings.style.display = mode === 'oauth' ? 'block' : 'none';

                    await loadModelsForProvider('qwen', refresh || mode === 'oauth', preferredModel);
                };

                const savedMode = await window.electronAPI.getSettingValue('llm.qwen.mode');
                const savedUseOAuth = await window.electronAPI.getSettingValue('llm.qwen.useOAuth');
                const qwenConfigured = Boolean(currentConfig?.apiKeyConfigured);
                const mode = currentConfig?.provider === provider
                    ? (currentConfig.mode || (currentConfig.useOAuth ? 'oauth' : 'cli'))
                    : (savedMode || (savedUseOAuth === 'true' ? 'oauth' : 'cli'));
                const modeRadio = document.querySelector(`input[name="qwen-mode"][value="${mode}"]`);
                if (modeRadio) modeRadio.checked = true;

                const qwenKeyInput = document.getElementById('qwen-key');
                if (qwenKeyInput && qwenConfigured) {
                    qwenKeyInput.placeholder = 'Configured - enter a new value to replace';
                }

                const oauthStatus = document.getElementById('qwen-oauth-status');
                if (oauthStatus && (currentConfig?.useOAuth || savedUseOAuth === 'true')) {
                    oauthStatus.textContent = 'OAuth credentials configured';
                }

                document.querySelectorAll('input[name="qwen-mode"]').forEach(radio => {
                    radio.addEventListener('change', async (e) => {
                        await applyQwenMode(e.target.value, llmModelSelect.value, e.target.value === 'oauth');
                    });
                });

                const fetchBtn = document.getElementById('qwen-fetch-oauth');
                if (fetchBtn) {
                    fetchBtn.addEventListener('click', async () => {
                        try {
                            await window.electronAPI.llm.fetchQwenOAuth();
                            if (oauthStatus) oauthStatus.textContent = 'OAuth credentials loaded';
                            mainPanel.showNotification('OAuth credentials loaded');
                            await applyQwenMode('oauth', llmModelSelect.value, true);
                        } catch (error) {
                            if (oauthStatus) oauthStatus.textContent = 'Failed to load credentials';
                            mainPanel.showNotification('Failed to load OAuth credentials', 'error');
                        }
                    });
                }

                const verifyBtn = document.getElementById('verify-api-key');
                if (verifyBtn) {
                    verifyBtn.addEventListener('click', async () => {
                        const apiKey = document.getElementById('qwen-key')?.value?.trim();
                        const statusDiv = document.getElementById('qwen-api-status');

                        if (!apiKey) {
                            if (statusDiv) statusDiv.textContent = 'Enter an API key first.';
                            return;
                        }

                        verifyBtn.disabled = true;
                        verifyBtn.textContent = 'Verifying...';
                        if (statusDiv) statusDiv.textContent = '';

                        try {
                            const result = await window.electronAPI.verifyQwenKey(apiKey);
                            if (statusDiv) {
                                statusDiv.textContent = result.success
                                    ? `Verified. Found ${result.modelCount} models.`
                                    : result.error;
                            }
                        } catch (error) {
                            if (statusDiv) statusDiv.textContent = `Verification failed: ${error.message}`;
                        } finally {
                            verifyBtn.disabled = false;
                            verifyBtn.textContent = 'Verify Key';
                        }
                    });
                }

                await applyQwenMode(mode, currentConfig?.model, mode === 'oauth');
            } else if (provider === 'openai') {
                const applyOpenAITransport = async (transport, preferredModel = null, refresh = false) => {
                    const codexSettings = document.getElementById('openai-codex-settings');
                    const apiSettings = document.getElementById('openai-api-settings');
                    if (codexSettings) codexSettings.style.display = transport === 'api-key' ? 'none' : 'block';
                    if (apiSettings) apiSettings.style.display = transport === 'api-key' ? 'block' : 'none';
                    await window.electronAPI.llm.saveConfig(buildProviderConfig('openai', { includeModel: false }));
                    await loadModelsForProvider('openai', refresh, preferredModel);
                };

                const refreshCodexStatus = async () => {
                    const statusDiv = document.getElementById('openai-codex-status');
                    if (!statusDiv) return;
                    statusDiv.textContent = 'Checking Codex CLI...';
                    try {
                        const status = await window.electronAPI.llm.getCodexStatus();
                        statusDiv.textContent = status.installed
                            ? `Codex CLI detected${status.version ? ` (${status.version})` : ''}${status.path ? ` at ${status.path}` : ''}${status.version ? '' : status.error ? `, but could not run it yet: ${status.error}` : ''}.`
                            : `Codex CLI not found${status.error ? `: ${status.error}` : '.'}`;
                    } catch (error) {
                        statusDiv.textContent = `Codex check failed: ${error.message}`;
                    }
                };

                const transport = currentConfig?.transport || 'codex-cli';
                const transportRadio = document.querySelector(`input[name="openai-transport"][value="${transport}"]`);
                if (transportRadio) transportRadio.checked = true;
                document.querySelectorAll('input[name="openai-transport"]').forEach(radio => {
                    radio.addEventListener('change', async (e) => {
                        await applyOpenAITransport(e.target.value, llmModelSelect.value, e.target.value === 'api-key');
                    });
                });

                document.getElementById('openai-codex-check')?.addEventListener('click', refreshCodexStatus);
                document.getElementById('openai-codex-login')?.addEventListener('click', async () => {
                    const statusDiv = document.getElementById('openai-codex-status');
                    try {
                        await window.electronAPI.llm.launchCodexLogin();
                        if (statusDiv) statusDiv.textContent = 'Codex login launched.';
                    } catch (error) {
                        if (statusDiv) statusDiv.textContent = `Could not launch login: ${error.message}`;
                    }
                });

                await applyOpenAITransport(transport, currentConfig?.model, false);
                await refreshCodexStatus();
            } else if (providerDiscoveryStatus) {
                providerDiscoveryStatus.textContent = profile?.settings?.supportsModelDiscovery
                    ? ''
                    : 'This provider does not expose model discovery.';
            }
        };

        const saveQuickSelection = async () => {
            const provider = chatProviderSelect?.value;
            const model = chatModelSelect?.value;

            if (!provider || isPlaceholderModel(model)) {
                return;
            }

            const config = buildProviderConfig(provider, { includeModel: false });
            config.model = model;

            await persistConfig(config, `Switched to ${model}`);
        };

        const autoPersistApiSelection = async () => {
            const provider = llmProviderSelect?.value;
            if (!provider || provider === 'Select a Provider...') return;

            const model = llmModelSelect?.value;
            const hasModel = !isPlaceholderModel(model);
            const config = buildProviderConfig(provider, { includeModel: hasModel, strict: false });
            await persistConfig(config);
        };

        const updateDraftConfigLabel = () => {
            const provider = llmProviderSelect?.value;
            const model = llmModelSelect?.value;
            if (!provider || provider === 'Select a Provider...') {
                return;
            }
            setCurrentConfigLabel(currentConfigDisplay, currentConfigText, {
                provider,
                providerLabel: providerLabel(provider, providerProfileMap),
                model: isPlaceholderModel(model) ? null : model
            });
        };

        if (modelConfigContainer) {
            const syncModelConfigState = () => {
                if (!currentModelProfile) return;
                try {
                    applyVisibilityToMainPanel(collectRuntimeConfig(currentModelProfile.runtimeConfig));
                } catch (_) {
                    // Leave current preview state unchanged until JSON is valid again.
                }
            };
            modelConfigContainer.addEventListener('input', syncModelConfigState);
            modelConfigContainer.addEventListener('change', syncModelConfigState);
        }

        llmProviderSelect.addEventListener('change', async (event) => {
            const provider = event.target.value;
            applyProviderScrollLayout(provider);
            await updateProviderSettings(provider);
            applyProviderFieldOrderLayout(provider);
            updateModelActionControls(provider);
            if (provider !== 'qwen') {
                await loadModelsForProvider(provider, false, null);
            }
            const resolvedModel = resolveValidModel(llmModelSelect, llmModelSelect.value);
            if (resolvedModel) {
                llmModelSelect.value = resolvedModel;
                await loadModelProfile(provider, resolvedModel);
            }
            syncModelsToChat?.();
            toggleCustomModelSection(provider);
            updateDraftConfigLabel();
            await autoPersistApiSelection();

            if (chatProviderSelect) {
                chatProviderSelect.value = provider;
            }
        });

        llmModelSelect.addEventListener('change', async () => {
            const provider = llmProviderSelect.value;
            const model = llmModelSelect.value;
            await loadModelProfile(provider, model);
            updateDraftConfigLabel();
            await autoPersistApiSelection();
            if (chatModelSelect) {
                chatModelSelect.value = model;
            }
        });

        const testModelBtn = document.getElementById('test-custom-model-btn');
        if (testModelBtn) {
            testModelBtn.addEventListener('click', async () => {
                const customInput = document.getElementById('custom-model-input');
                const statusDiv = document.getElementById('custom-model-status');
                const manualModel = customInput?.value?.trim() || '';
                const selectedModel = llmModelSelect?.value || '';
                const modelName = manualModel || (isPlaceholderModel(selectedModel) ? '' : selectedModel);

                if (!modelName) {
                    if (statusDiv) statusDiv.textContent = 'Pick a model or enter a model name';
                    return;
                }

                testModelBtn.disabled = true;
                testModelBtn.textContent = 'Testing...';
                if (statusDiv) statusDiv.textContent = '';

                try {
                    const provider = llmProviderSelect.value || 'ollama';
                    const result = await window.electronAPI.llm.testModel(provider, modelName);
                    if (!result.success) throw new Error(result.error);

                    if (!Array.from(llmModelSelect.options).some(o => o.value === modelName)) {
                        const option = document.createElement('option');
                        option.value = modelName;
                        option.textContent = modelName;
                        llmModelSelect.appendChild(option);
                    }

                    llmModelSelect.value = modelName;
                    await loadModelProfile(provider, modelName);
                    syncModelsToChat?.();
                    if (chatProviderSelect) {
                        chatProviderSelect.value = provider;
                    }
                    if (chatModelSelect && Array.from(chatModelSelect.options).some(o => o.value === modelName)) {
                        chatModelSelect.value = modelName;
                    }

                    currentConfig = await window.electronAPI.llm.getConfig();
                    setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
                    applyVisibilityToMainPanel(currentConfig?.runtimeConfig);
                    const autoSaved = currentConfig?.provider === provider && currentConfig?.model === modelName;
                    if (statusDiv) {
                        statusDiv.textContent = autoSaved
                            ? `Model responds as ${result.model}. Added to the list and remembered as workable.`
                            : `Model responds as ${result.model}`;
                    }
                    if (autoSaved) {
                        mainPanel.showNotification(`Remembered workable model ${modelName}`, 'info');
                    }
                } catch (error) {
                    if (statusDiv) statusDiv.textContent = `Test failed: ${error.message}`;
                } finally {
                    testModelBtn.disabled = false;
                    testModelBtn.textContent = 'Test Model';
                }
            });
        }

        if (testSelectedModelButton) {
            testSelectedModelButton.addEventListener('click', async () => {
                const provider = llmProviderSelect.value;
                if (provider !== 'local-openai') return;

                const extractModelFromParams = () => {
                    const raw = document.getElementById(providerFieldId('modelParams'))?.value || '';
                    const normalized = String(raw).replace(/\s+/g, ' ').trim();
                    if (!normalized) return '';
                    const match = normalized.match(/(?:^|\s)--(?:model|model-id|model_id)\s+("[^"]+"|'[^']+'|\S+)/i)
                        || normalized.match(/(?:^|\s)--(?:model|model-id|model_id)=("[^"]+"|'[^']+'|\S+)/i);
                    if (!match?.[1]) return '';
                    return String(match[1]).replace(/^['"]|['"]$/g, '').trim();
                };

                let modelName = llmModelSelect.value;
                if (isPlaceholderModel(modelName)) {
                    modelName = extractModelFromParams();
                }

                if (!modelName) {
                    if (selectedModelStatus) selectedModelStatus.textContent = 'Pick a model or set --model in Model Params first.';
                    return;
                }

                testSelectedModelButton.disabled = true;
                testSelectedModelButton.textContent = 'Testing...';
                if (selectedModelStatus) selectedModelStatus.textContent = '';

                try {
                    const result = await window.electronAPI.llm.testModel(provider, modelName);
                    if (!result.success) throw new Error(result.error);

                    if (!Array.from(llmModelSelect.options).some(o => o.value === modelName)) {
                        const option = document.createElement('option');
                        option.value = modelName;
                        option.textContent = modelName;
                        llmModelSelect.appendChild(option);
                    }

                    llmModelSelect.value = modelName;
                    await loadModelProfile(provider, modelName);
                    await autoPersistApiSelection();
                    syncModelsToChat?.();
                    if (chatProviderSelect) chatProviderSelect.value = provider;
                    if (chatModelSelect && Array.from(chatModelSelect.options).some(o => o.value === modelName)) {
                        chatModelSelect.value = modelName;
                    }

                    if (selectedModelStatus) {
                        selectedModelStatus.textContent = `Model responds as ${result.model}.`;
                    }
                } catch (error) {
                    if (selectedModelStatus) selectedModelStatus.textContent = `Test failed: ${error.message}`;
                } finally {
                    testSelectedModelButton.disabled = false;
                    testSelectedModelButton.textContent = 'Test Model';
                }
            });
        }

        if (refreshModelsButton) {
            refreshModelsButton.addEventListener('click', async () => {
                const provider = llmProviderSelect.value;
                if (!provider || provider === 'Select a Provider...') {
                    return;
                }

                refreshModelsButton.disabled = true;
                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = 'Saving connection details and refreshing models...';
                }

                try {
                    const config = buildProviderConfig(provider, { includeModel: false });
                    await window.electronAPI.llm.saveConfig(config);
                    await loadModelsForProvider(provider, true, llmModelSelect.value);
                    syncModelsToChat?.();
                } catch (error) {
                    if (providerDiscoveryStatus) {
                        providerDiscoveryStatus.textContent = `Discovery failed: ${error.message}`;
                    }
                } finally {
                    refreshModelsButton.disabled = false;
                }
            });
        }

        llmConfigSaveButton.addEventListener('click', async () => {
            const provider = llmProviderSelect.value;

            if (!provider || provider === 'Select a Provider...') {
                alert('Please select a provider');
                return;
            }

            const profile = getProviderProfile(provider);
            if (provider === 'qwen') {
                const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                if (mode === 'api' && !document.getElementById('qwen-key')?.value?.trim()) {
                    alert('Please enter Qwen API key');
                    return;
                }
            } else if (profile?.settings?.connectionFields?.length) {
                const missing = profile.settings.connectionFields.find(field => {
                    const input = document.getElementById(providerFieldId(field.id));
                    if (!field.required || !input) return false;
                    if ((field.id === 'apiKey' || field.type === 'password') && input.dataset.configured === 'true') {
                        return false;
                    }
                    return !input.value?.trim();
                });
                if (missing) {
                    alert(`Please enter ${missing.label}`);
                    return;
                }
            }

            try {
                const config = buildProviderConfig(provider, { includeModel: true, strict: true });
                await window.electronAPI.llm.saveConfig(config);
                currentConfig = await window.electronAPI.llm.getConfig();
                setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
                if (config.model) {
                    await loadModelProfile(config.provider, config.model);
                }
                if (profile?.settings?.supportsModelDiscovery || provider === 'qwen') {
                    await loadModelsForProvider(provider, true, config.model || llmModelSelect.value);
                    syncModelsToChat?.();
                }
                applyVisibilityToMainPanel(currentConfig?.runtimeConfig || config.runtimeConfig);
                mainPanel.showNotification('Configuration saved!');
            } catch (error) {
                alert(error.message || 'Failed to save configuration');
            }
        });

        const providerProfiles = await window.electronAPI.llm.getProviderProfiles();
        providerProfileMap = (providerProfiles?.providers || []).reduce((acc, provider) => {
            acc[provider.id] = provider;
            return acc;
        }, {});

        const providers = await window.electronAPI.getProviders();
        const availableProviders = Array.isArray(providers)
            ? providers.filter(provider => String(provider || '').trim())
            : [];
        const knownProviderSet = new Set(availableProviders);
        llmProviderSelect.innerHTML = '<option disabled selected>Select a Provider...</option>';
        availableProviders.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider;
            option.textContent = providerLabel(provider, providerProfileMap);
            llmProviderSelect.appendChild(option);
        });

        currentConfig = await window.electronAPI.llm.getConfig();
        if (globalConcurrencyToggle) globalConcurrencyToggle.checked = Boolean(currentConfig?.concurrencyEnabled);
        setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);

        const initialProvider = knownProviderSet.has(currentConfig?.provider)
            ? currentConfig.provider
            : (availableProviders[0] || '');
        const initialModel = initialProvider && currentConfig?.provider === initialProvider
            ? currentConfig?.model
            : '';

        if (initialProvider) {
            applyProviderScrollLayout(initialProvider);
            llmProviderSelect.value = initialProvider;
            await updateProviderSettings(initialProvider);
            applyProviderFieldOrderLayout(initialProvider);
            updateModelActionControls(initialProvider);
            if (initialProvider !== 'qwen') {
                await loadModelsForProvider(initialProvider, false, initialModel);
            }
            const resolvedInitialModel = resolveValidModel(llmModelSelect, initialModel);
            if (resolvedInitialModel) {
                llmModelSelect.value = resolvedInitialModel;
                await loadModelProfile(initialProvider, resolvedInitialModel);
            }
            toggleCustomModelSection(initialProvider);
        } else {
            applyProviderScrollLayout(null);
            applyProviderFieldOrderLayout(null);
            updateModelActionControls(null);
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
        }

        if (chatProviderSelect && chatModelSelect) {
            chatProviderSelect.innerHTML = '';
            availableProviders.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = providerLabel(provider, providerProfileMap);
                chatProviderSelect.appendChild(option);
            });

            if (initialProvider) {
                chatProviderSelect.value = initialProvider;
            }

            syncModelsToChat = () => {
                const preferredChatModel = chatModelSelect.value || llmModelSelect.value;
                chatModelSelect.innerHTML = '';
                Array.from(llmModelSelect.options).forEach(opt => {
                    const cloned = document.createElement('option');
                    cloned.value = opt.value;
                    cloned.textContent = opt.textContent;
                    cloned.disabled = opt.disabled;
                    chatModelSelect.appendChild(cloned);
                });
                const resolvedChatModel = resolveValidModel(chatModelSelect, preferredChatModel);
                if (resolvedChatModel) {
                    chatModelSelect.value = resolvedChatModel;
                }
            };

            syncModelsToChat();

            chatProviderSelect.addEventListener('change', async (e) => {
                llmProviderSelect.value = e.target.value;
                await updateProviderSettings(e.target.value);
                if (e.target.value !== 'qwen') {
                    await loadModelsForProvider(e.target.value, false, null);
                }
                syncModelsToChat();
                if (chatModelSelect) {
                    const firstUsable = Array.from(chatModelSelect.options)
                        .find(opt => !opt.disabled && !isPlaceholderModel(opt.value));
                    if (firstUsable) {
                        chatModelSelect.value = firstUsable.value;
                        llmModelSelect.value = firstUsable.value;
                        await loadModelProfile(llmProviderSelect.value, firstUsable.value);
                    }
                }
                await saveQuickSelection();
            });

            chatModelSelect.addEventListener('change', async (e) => {
                llmModelSelect.value = e.target.value;
                await loadModelProfile(llmProviderSelect.value, e.target.value);
                await saveQuickSelection();
            });

            const modelObserver = new MutationObserver(() => {
                syncModelsToChat();
            });
            modelObserver.observe(llmModelSelect, { childList: true });
        }
    };
})();
