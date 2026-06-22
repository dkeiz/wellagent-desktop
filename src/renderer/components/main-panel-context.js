(function installMainPanelContext(global) {
    function updateContextDisplay(panel, presets, labels, index) {
        const idx = parseInt(index, 10);
        const contextDisplay = document.getElementById('context-display');
        if (!contextDisplay) return;
        const tokens = presets[idx] || 8192;
        const label = labels[idx] || '8K';
        contextDisplay.textContent = `${label} (${tokens.toLocaleString()} tokens)`;
    }

    async function saveContextSize(panel, presets, labels, index) {
        try {
            const value = presets[parseInt(index, 10)] || 8192;
            await window.electronAPI.setContextSetting(value);
            panel._selectedContextSetting = value;
            if (panel._apiContextProfile) {
                panel.applyContextProfile(panel._apiContextProfile);
            }
            panel.showNotification(`Context: ${labels[parseInt(index, 10)] || '8K'}`);
        } catch (error) {
            console.error('Save error:', error);
            panel.showNotification(`Save failed: ${error.message}`, 'error');
        }
    }

    async function initThinkingSettings(panel) {
        try {
            const { mode, showThinking } = await window.electronAPI.llm.getThinkingMode();
            const thinkToggle = document.getElementById('thinking-toggle');
            const visGroup = document.getElementById('thinking-visibility-group');
            const visRadios = document.querySelectorAll('input[name="think-vis"]');
            let savedVis;
            try {
                savedVis = await window.electronAPI.getSettingValue('llm.thinkingVisibility');
            } catch (error) {
            }
            panel._thinkingVisibility = savedVis || (showThinking ? 'show' : 'hide');
            if (thinkToggle) {
                thinkToggle.checked = mode === 'think';
                thinkToggle.addEventListener('change', async (event) => {
                    const enabled = event.target.checked;
                    await window.electronAPI.llm.setThinkingMode(enabled ? 'think' : 'off');
                    if (visGroup) visGroup.style.display = enabled ? 'flex' : 'none';
                    panel.showNotification(`Thinking: ${enabled ? 'ON' : 'OFF'}`);
                });
            }
            if (visGroup) {
                visGroup.style.display = mode === 'think' ? 'flex' : 'none';
            }
            visRadios.forEach((radio) => {
                radio.checked = radio.value === panel._thinkingVisibility;
                radio.addEventListener('change', async (event) => {
                    panel._thinkingVisibility = event.target.value;
                    await window.electronAPI.saveSetting('llm.thinkingVisibility', event.target.value);
                    await window.electronAPI.llm.setShowThinking(event.target.value !== 'hide');
                });
            });
        } catch (error) {
            console.error('Failed to init thinking settings:', error);
            panel._thinkingVisibility = 'show';
        }
    }

    function initContextSettings(panel, presets, labels, getPresetIndex) {
        const contextSlider = document.getElementById('context-slider');
        const contextDisplay = document.getElementById('context-display');
        if (!contextSlider || !contextDisplay) {
            console.warn('Context slider elements not found');
            return;
        }
        if (contextSlider.dataset.bound !== 'true') {
            contextSlider.dataset.bound = 'true';
            contextSlider.addEventListener('input', (event) => panel.updateContextDisplay(event.target.value));
            contextSlider.addEventListener('change', (event) => panel.saveContextSize(event.target.value));
        }
        console.log('✓ Context slider found, initializing...');
        panel.loadSelectedContextSetting()
            .then((contextValue) => {
                const bestIdx = getPresetIndex(contextValue);
                contextSlider.value = bestIdx;
                updateContextDisplay(panel, presets, labels, bestIdx);
                return window.electronAPI.llm.getConfig();
            })
            .then((config) => {
                if (config?.modelSpec && config?.runtimeConfig) {
                    panel.applyContextProfile({
                        spec: config.modelSpec,
                        runtimeConfig: config.runtimeConfig
                    });
                }
            })
            .catch((error) => {
                console.error('✗ Error loading context setting:', error);
            });
        initThinkingSettings(panel);
    }

    global.LocalAgentMainPanelContext = {
        initContextSettings,
        initThinkingSettings,
        saveContextSize,
        updateContextDisplay
    };
})(window);
