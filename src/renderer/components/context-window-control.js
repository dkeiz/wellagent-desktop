(() => {
  const state = {
    customActive: false,
    customValue: null,
    skipNextBlurSave: false
  };

  function formatContext(tokens) {
    const value = Number(tokens || 0);
    if (!Number.isFinite(value) || value <= 0) return 'Unknown';
    if (value >= 1000) {
      const compact = value % 1000 === 0 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1);
      return `${compact}K`;
    }
    return `${value}`;
  }

  function parseContextInput(raw) {
    const text = String(raw || '').trim().toLowerCase().replace(/,/g, '');
    if (!text) return null;
    const mult = text.endsWith('k') ? 1000 : 1;
    const numeric = Number(mult === 1000 ? text.slice(0, -1) : text);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.max(1024, Math.round(numeric * mult));
  }

  function setCustomVisual(customActive) {
    const slider = document.getElementById('context-slider');
    if (!slider) return;
    slider.classList.toggle('context-custom-mode', !!customActive);
  }

  function syncDisplayFromCustom() {
    const display = document.getElementById('context-display');
    const input = document.getElementById('context-custom-input');
    if (!display || !input || !state.customActive || !state.customValue) return;
    display.textContent = `${formatContext(state.customValue)} (${state.customValue.toLocaleString()} tokens)`;
    input.value = `${state.customValue}`;
  }

  function clearCustomMode() {
    state.customActive = false;
    state.customValue = null;
    setCustomVisual(false);
  }

  async function commitCustomValue() {
    const input = document.getElementById('context-custom-input');
    if (!input) return;
    const parsed = parseContextInput(input.value);
    if (!parsed) {
      if (state.customActive && state.customValue) input.value = `${state.customValue}`;
      return;
    }
    await window.electronAPI.setContextSetting(parsed);
    const panel = window.localAgentRendererShell?.getMainPanel?.() || window.mainPanel;
    if (panel) {
      panel._selectedContextSetting = parsed;
    }
    state.customActive = true;
    state.customValue = parsed;
    setCustomVisual(true);
    syncDisplayFromCustom();
  }

  function installMainPanelWrappers() {
    const shell = window.localAgentRendererShell;
    if (!shell || shell.__contextCustomWrapped) return false;
    shell.__contextCustomWrapped = true;

    shell.registerPanelMethodWrapper('applyContextProfile', 'context-window-control', (originalApplyContextProfile) => function wrappedApplyContextProfile(profile) {
      const result = originalApplyContextProfile(profile);
      const configurable = document.getElementById('context-window-configurable');
      if (configurable?.style.display !== 'none' && state.customActive) {
        setCustomVisual(true);
        syncDisplayFromCustom();
      }
      return result;
    });

    shell.registerPanelMethodWrapper('updateContextDisplay', 'context-window-control', (originalUpdateContextDisplay) => function wrappedUpdateContextDisplay(index) {
      if (state.customActive) return;
      return originalUpdateContextDisplay(index);
    });
    return true;
  }

  function bindEvents() {
    if (window.__contextWindowControlBound) return;
    const slider = document.getElementById('context-slider');
    const input = document.getElementById('context-custom-input');
    const displayLabel = document.getElementById('context-display-label');
    const display = document.getElementById('context-display');
    if (!slider || !input) return;

    slider.addEventListener('pointerdown', () => {
      if (state.customActive) clearCustomMode();
    });
    slider.addEventListener('input', () => {
      if (state.customActive) clearCustomMode();
    });
    slider.addEventListener('change', () => {
      if (state.customActive) clearCustomMode();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('blur', async () => {
      if (state.skipNextBlurSave) {
        state.skipNextBlurSave = false;
        return;
      }
      await commitCustomValue();
    });

    const suppressBlur = () => { state.skipNextBlurSave = true; };
    displayLabel?.addEventListener('pointerdown', suppressBlur);
    display?.addEventListener('pointerdown', suppressBlur);
    window.__contextWindowControlBound = true;
  }

  function init(attempt = 0) {
    const wrapped = installMainPanelWrappers();
    bindEvents();
    if (!wrapped && attempt < 20) {
      setTimeout(() => init(attempt + 1), 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
