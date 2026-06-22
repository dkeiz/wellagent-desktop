(function () {
    function providerLabel(provider, providerProfileMap) { return providerProfileMap[provider]?.label || (provider.charAt(0).toUpperCase() + provider.slice(1)); }

    function prettyChannelLabel(value) {
        const labels = {
            none: 'not exposed',
            inline: 'inline',
            separate: 'separate'
        };
        return labels[value] || value || 'unknown';
    }

    function visibilityOptionsFor(reasoningCaps) {
        const supportedModes = Array.isArray(reasoningCaps?.visibilityModes) && reasoningCaps.visibilityModes.length
            ? reasoningCaps.visibilityModes
            : ['show', 'min', 'hide'];
        const labels = {
            show: 'Expanded',
            min: 'Collapsed',
            hide: 'Hidden'
        };

        return supportedModes.map(value => ({
            value,
            label: labels[value] || value
        }));
    }

    function setCurrentConfigLabel(configDisplay, configText, config) {
        if (!configDisplay || !configText) return;

        if (!config?.provider) {
            configDisplay.classList?.add?.('initially-hidden');
            return;
        }

        configDisplay.classList?.remove?.('initially-hidden');
        const providerName = config.providerLabel || config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
        configText.textContent = config.model
            ? `Provider: ${providerName}, Model: "${config.model}"`
            : `Provider: ${providerName}`;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function providerFieldId(fieldId) {
        return `provider-field-${fieldId}`;
    }

    function normalizeParamString(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function renderGenericProviderSettings(profile, connection = {}) {
        const fields = Array.isArray(profile?.settings?.connectionFields)
            ? profile.settings.connectionFields
            : [];

        const fieldMarkup = fields.map(field => {
            const isSecret = field.id === 'apiKey' || field.type === 'password';
            const isTextArea = field.type === 'textarea';
            const configured = Boolean(connection[`${field.id}Configured`] || (field.id === 'apiKey' && connection.apiKeyConfigured));
            const value = isSecret ? '' : (connection[field.id] ?? field.defaultValue ?? '');
            const placeholder = configured
                ? 'Configured - enter a new value to replace'
                : (field.placeholder || '');
            const helpMarkup = field.helpText
                ? `<div class="config-help">${escapeHtml(field.helpText)}</div>`
                : '';
            const statusMarkup = configured
                ? `<div class="config-help">Secret is saved securely and hidden here.</div>`
                : '';

            return `
                <div class="config-field">
                    <label for="${providerFieldId(field.id)}">${escapeHtml(field.label)}</label>
                    ${isTextArea
                    ? `<textarea id="${providerFieldId(field.id)}" rows="${Number(field.rows) > 0 ? Number(field.rows) : 3}" data-secret-field="${isSecret ? 'true' : 'false'}" data-configured="${configured ? 'true' : 'false'}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
                    : `<input
                        type="${field.type === 'password' ? 'password' : 'text'}"
                        id="${providerFieldId(field.id)}"
                        data-secret-field="${isSecret ? 'true' : 'false'}"
                        data-configured="${configured ? 'true' : 'false'}"
                        placeholder="${escapeHtml(placeholder)}"
                        value="${escapeHtml(value)}"
                    >`
                }
                    ${helpMarkup}
                    ${statusMarkup}
                </div>
            `;
        }).join('');

        const noteMarkup = Array.isArray(profile?.notes) && profile.notes.length
            ? `<div class="api-provider-notes">${profile.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}</div>`
            : '';

        return `
            <div class="api-provider-settings-block">
                ${fieldMarkup}
                ${noteMarkup}
            </div>
        `;
    }

    function renderOpenAIProviderSettings(profile, connection = {}, config = {}) {
        const transport = config.transport || 'codex-cli';
        const apiSettings = renderGenericProviderSettings(profile, connection);
        const sandbox = config.codexSandbox || 'read-only';
        const searchChecked = config.codexSearch ? 'checked' : '';

        return `
            <div class="api-provider-settings-block">
                <div class="config-field">
                    <label>OpenAI access</label>
                    <div class="config-inline-row">
                        <label class="config-checkbox"><input type="radio" name="openai-transport" value="codex-cli" ${transport !== 'api-key' ? 'checked' : ''}> <span>Codex subscription</span></label>
                        <label class="config-checkbox"><input type="radio" name="openai-transport" value="api-key" ${transport === 'api-key' ? 'checked' : ''}> <span>API key</span></label>
                    </div>
                </div>
                <div id="openai-codex-settings" class="api-subsection">
                    <div class="api-action-row">
                        <button type="button" id="openai-codex-login" class="secondary-btn">Sign in</button>
                        <button type="button" id="openai-codex-check" class="secondary-btn">Check</button>
                    </div>
                    <div id="openai-codex-status" class="config-help api-status-text"></div>
                    <details class="api-advanced-settings">
                        <summary>Advanced</summary>
                        <div class="api-settings-grid">
                            <div class="api-field">
                                <label for="openai-codex-sandbox">Sandbox</label>
                                <select id="openai-codex-sandbox">
                                    <option value="read-only" ${sandbox === 'read-only' ? 'selected' : ''}>read-only</option>
                                    <option value="workspace-write" ${sandbox === 'workspace-write' ? 'selected' : ''}>workspace-write</option>
                                </select>
                            </div>
                            <label class="api-toggle-row">
                                <span class="api-toggle-copy">
                                    <span class="api-toggle-title">Web search</span>
                                    <span class="api-toggle-help">Passes --search to Codex CLI.</span>
                                </span>
                                <input type="checkbox" id="openai-codex-search" ${searchChecked}>
                            </label>
                        </div>
                    </details>
                </div>
                <div id="openai-api-settings" class="api-subsection">
                    ${apiSettings}
                </div>
            </div>
        `;
    }

    function parseRequestOverridesValue(baseRuntimeConfig = {}, strict = false) {
        const input = document.getElementById('model-request-overrides');
        if (!input) {
            return {
                value: baseRuntimeConfig.requestOverrides || {},
                valid: true
            };
        }

        const raw = input.value.trim();
        if (!raw) {
            delete input.dataset.invalid;
            return { value: {}, valid: true };
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Overrides must be a JSON object');
            }
            delete input.dataset.invalid;
            return { value: parsed, valid: true };
        } catch (error) {
            input.dataset.invalid = 'true';
            if (strict) {
                throw new Error('Request overrides must be a valid JSON object');
            }
            return {
                value: baseRuntimeConfig.requestOverrides || {},
                valid: false
            };
        }
    }

    function renderModelSettings(capabilitiesContainer, container, section, profile) {
        if (!capabilitiesContainer || !container || !section) return;

        if (!profile?.spec?.model) {
            section.classList?.add?.('initially-hidden');
            capabilitiesContainer.textContent = '';
            container.innerHTML = '';
            return;
        }

        const { spec, runtimeConfig } = profile;
        const reasoningCaps = spec.capabilities?.reasoning || {};
        const streamingCaps = spec.capabilities?.streaming || {};
        const routingCaps = spec.capabilities?.providerRouting || {};
        const contextCaps = spec.capabilities?.contextWindow || {};
        const modalityCaps = spec.capabilities?.modalities || {};
        const requestOverrideCaps = spec.capabilities?.requestOverrides || {};
        const concurrencyCaps = spec.capabilities?.concurrency || {};
        const visibilityOptions = visibilityOptionsFor(reasoningCaps);
        const effortOptions = Array.isArray(reasoningCaps.effortLevels) ? reasoningCaps.effortLevels : [];
        const reasoningChecked = runtimeConfig.reasoning?.enabled ? 'checked' : '';
        const reasoningControlAvailable = reasoningCaps.supported && reasoningCaps.toggle;
        const reasoningToggleDisabled = reasoningControlAvailable ? '' : 'disabled';
        const requireParamsChecked = runtimeConfig.providerRouting?.requireParameters ? 'checked' : '';
        const concurrencyChecked = runtimeConfig.concurrency?.allowParallel ? 'checked' : '';
        const requestOverridesValue = runtimeConfig.requestOverrides && Object.keys(runtimeConfig.requestOverrides).length
            ? JSON.stringify(runtimeConfig.requestOverrides, null, 2)
            : '';
        const reasoningHelpText = reasoningCaps.supported
            ? (reasoningCaps.toggle
                ? 'Uses the mapped provider/model controls for this family.'
                : 'This model family is treated as fixed reasoning.')
            : 'No explicit reasoning control is mapped for this model yet.';
        const capabilityParts = [];

        section.classList?.remove?.('initially-hidden');
        if (reasoningCaps.supported) {
            capabilityParts.push('Reasoning supported');
        }
        if (effortOptions.length) {
            capabilityParts.push(`Effort: ${effortOptions.join(', ')}`);
        }
        if (reasoningCaps.maxTokens) {
            capabilityParts.push('Thinking budget supported');
        }
        if (streamingCaps.text) {
            capabilityParts.push('Text streaming available');
        }
        if (streamingCaps.reasoning && streamingCaps.reasoning !== 'none') {
            capabilityParts.push(`Thinking output: ${prettyChannelLabel(streamingCaps.reasoning)}`);
        }
        if (contextCaps.supported && runtimeConfig.contextWindow?.value) {
            capabilityParts.push(contextCaps.configurable
                ? 'Context size configurable'
                : `Context: ${runtimeConfig.contextWindow.value.toLocaleString()} tokens`);
        }
        if (modalityCaps.vision) {
            capabilityParts.push('Vision input available');
        }
        if (requestOverrideCaps.supported) {
            capabilityParts.push('Advanced request overrides');
        }
        if (concurrencyCaps.supported) {
            capabilityParts.push('Parallel inference configurable');
        }
        if (spec.notes?.length) {
            capabilityParts.push(spec.notes[0]);
        }
        capabilitiesContainer.textContent = capabilityParts.join(' | ');

        container.innerHTML = `
            <div class="api-model-settings">
                <label class="api-toggle-row ${reasoningControlAvailable ? '' : 'is-disabled'}">
                    <span class="api-toggle-copy">
                        <span class="api-toggle-title">Enable reasoning / thinking</span>
                        <span class="api-toggle-help">${reasoningHelpText}</span>
                    </span>
                    <input type="checkbox" id="model-reasoning-enabled" ${reasoningChecked} ${reasoningToggleDisabled}>
                </label>
                <div class="api-settings-grid">
                    <div class="api-field">
                        <label>Thinking visibility</label>
                        <div class="api-pill-picker" role="radiogroup" aria-label="Thinking visibility">
                            ${visibilityOptions.map(option => `
                            <label class="api-pill-option">
                                <input type="radio" name="model-reasoning-visibility" value="${option.value}" ${runtimeConfig.reasoning?.visibility === option.value ? 'checked' : ''}>
                                <span>${option.label}</span>
                            </label>`).join('')}
                        </div>
                    </div>
                    ${effortOptions.length ? `
                    <div class="api-field">
                        <label for="model-reasoning-effort">Reasoning effort</label>
                        <select id="model-reasoning-effort">
                            ${effortOptions.map(level => `<option value="${level}" ${runtimeConfig.reasoning?.effort === level ? 'selected' : ''}>${level}</option>`).join('')}
                        </select>
                    </div>` : ''}
                    ${reasoningCaps.maxTokens ? `
                    <div class="api-field">
                        <label for="model-reasoning-budget">Thinking budget</label>
                        <input type="number" id="model-reasoning-budget" min="1" step="1" value="${runtimeConfig.reasoning?.maxTokens || ''}" placeholder="e.g. 2048">
                    </div>` : ''}
                    ${contextCaps.supported && contextCaps.configurable ? `
                    <div class="api-field">
                        <label for="model-context-window">Context length</label>
                        <input type="number" id="model-context-window" min="${contextCaps.min || 1}" max="${contextCaps.max || 262144}" step="1" value="${runtimeConfig.contextWindow?.value || ''}" placeholder="e.g. 8192">
                    </div>` : ''}
                    ${requestOverrideCaps.supported ? `
                    <div class="api-field api-field-wide">
                        <label for="model-request-overrides">Request overrides (JSON)</label>
                        <textarea id="model-request-overrides" rows="5" placeholder='{"top_k": 40}'>${escapeHtml(requestOverridesValue)}</textarea>
                        <div class="config-help">Merged into the request body after the app's standard parameters.</div>
                    </div>` : ''}
                </div>
                ${routingCaps.requireParameters ? `
                <label class="api-toggle-row">
                    <span class="api-toggle-copy">
                        <span class="api-toggle-title">Require backend support for selected parameters</span>
                        <span class="api-toggle-help">Useful for OpenRouter so routed backends actually support reasoning settings.</span>
                    </span>
                    <input type="checkbox" id="model-require-params" ${requireParamsChecked}>
                </label>` : ''}
                ${concurrencyCaps.supported ? `<label class="api-toggle-row"><span class="api-toggle-copy"><span class="api-toggle-title">Allow parallel requests for this provider</span><span class="api-toggle-help">When enabled, same-provider calls may run concurrently if concurrency_mode is set to parallel.</span></span><input type="checkbox" id="model-concurrency-allow" ${concurrencyChecked}></label>` : ''}
            </div>
        `;
    }

    function collectRuntimeConfig(baseRuntimeConfig = {}, strict = false) {
        const selectedVisibility = document.querySelector('input[name="model-reasoning-visibility"]:checked');
        const legacyVisibilitySelect = document.getElementById('model-reasoning-visibility');
        const requestOverrides = parseRequestOverridesValue(baseRuntimeConfig, strict);

        return {
            reasoning: {
                enabled: document.getElementById('model-reasoning-enabled')
                    ? Boolean(document.getElementById('model-reasoning-enabled')?.checked)
                    : Boolean(baseRuntimeConfig.reasoning?.enabled),
                visibility: selectedVisibility?.value || legacyVisibilitySelect?.value || baseRuntimeConfig.reasoning?.visibility || 'show',
                effort: document.getElementById('model-reasoning-effort')?.value || baseRuntimeConfig.reasoning?.effort || null,
                maxTokens: document.getElementById('model-reasoning-budget')?.value || baseRuntimeConfig.reasoning?.maxTokens || null
            },
            streaming: {
                text: Boolean(baseRuntimeConfig.streaming?.text),
                reasoning: Boolean(baseRuntimeConfig.streaming?.reasoning)
            },
            providerRouting: {
                requireParameters: document.getElementById('model-require-params')
                    ? Boolean(document.getElementById('model-require-params')?.checked)
                    : Boolean(baseRuntimeConfig.providerRouting?.requireParameters)
            },
            concurrency: {
                allowParallel: document.getElementById('model-concurrency-allow') ? Boolean(document.getElementById('model-concurrency-allow')?.checked) : Boolean(baseRuntimeConfig.concurrency?.allowParallel)
            },
            contextWindow: {
                value: document.getElementById('model-context-window')?.value || baseRuntimeConfig.contextWindow?.value || null
            },
            requestOverrides: requestOverrides.value
        };
    }


    window.ApiProviderSettingsHelpers = {
        providerLabel,
        prettyChannelLabel,
        visibilityOptionsFor,
        setCurrentConfigLabel,
        escapeHtml,
        providerFieldId,
        normalizeParamString,
        renderGenericProviderSettings,
        renderOpenAIProviderSettings,
        parseRequestOverridesValue,
        renderModelSettings,
        collectRuntimeConfig
    };
})();
