(function installElectronApiFacade(global) {
  function cloneBridge(value) {
    if (typeof value === 'function') return value;
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneBridge);
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = cloneBridge(item);
    }
    return output;
  }

  const bridge = global.electronBridge || {};
  global.electronAPI = cloneBridge(bridge);
  global.localAgentDebug = Object.assign(
    {},
    global.localAgentDebug || {},
    global.electronAPI.debug || {}
  );
})(window);
