(function installRendererShell(global) {
    if (global.localAgentRendererShell) {
        return;
    }

    function createWrapperStore() {
        return new Map();
    }

    function applyWrappers(target, wrappers, baseFactory) {
        if (!target) return target;
        wrappers.forEach((factory) => {
            const next = factory(target, baseFactory);
            if (typeof next === 'function' || (next && typeof next === 'object')) {
                target = next;
            }
        });
        return target;
    }

    const shell = {
        _panel: null,
        _tabApi: null,
        _permissionApi: null,
        _panelMethodWrappers: new Map(),
        _tabMethodWrappers: new Map(),
        _bridgeWrappers: new Map(),
        _observers: new Map(),
        _eventListeners: new Map(),

        on(eventName, listener) {
            if (typeof listener !== 'function') return () => {};
            const listeners = this._eventListeners.get(eventName) || new Set();
            listeners.add(listener);
            this._eventListeners.set(eventName, listeners);
            return () => listeners.delete(listener);
        },

        emit(eventName, payload) {
            const listeners = this._eventListeners.get(eventName);
            if (!listeners) return;
            [...listeners].forEach((listener) => {
                try {
                    listener(payload);
                } catch (error) {
                    console.error(`[RendererShell] ${eventName} listener failed:`, error);
                }
            });
        },

        observeMainPanel(observerId, observer) {
            if (!observerId || typeof observer !== 'function') return;
            this._observers.set(observerId, observer);
            if (this._panel) {
                observer(this._panel);
            }
        },

        registerPanelMethodWrapper(methodName, wrapperId, factory) {
            if (!methodName || !wrapperId || typeof factory !== 'function') return;
            const wrappers = this._panelMethodWrappers.get(methodName) || createWrapperStore();
            wrappers.set(wrapperId, factory);
            this._panelMethodWrappers.set(methodName, wrappers);
            if (this._panel) {
                this._applyPanelMethodWrappers(this._panel, methodName);
            }
        },

        registerTabMethodWrapper(methodName, wrapperId, factory) {
            if (!methodName || !wrapperId || typeof factory !== 'function') return;
            const wrappers = this._tabMethodWrappers.get(methodName) || createWrapperStore();
            wrappers.set(wrapperId, factory);
            this._tabMethodWrappers.set(methodName, wrappers);
            if (this._tabApi) {
                this._applyTabMethodWrappers(this._tabApi, methodName);
            }
        },

        registerBridgeMethodWrapper(methodName, wrapperId, factory) {
            if (!methodName || !wrapperId || typeof factory !== 'function') return;
            const wrappers = this._bridgeWrappers.get(methodName) || createWrapperStore();
            wrappers.set(wrapperId, factory);
            this._bridgeWrappers.set(methodName, wrappers);
            this._applyBridgeMethodWrappers(methodName);
        },

        initializeMainPanel(panel) {
            this._panel = panel || null;
            if (!panel) return null;
            const methodNames = new Set([
                ...Object.keys(panel).filter(key => typeof panel[key] === 'function'),
                ...this._panelMethodWrappers.keys()
            ]);
            [...methodNames]
                .forEach(methodName => this._applyPanelMethodWrappers(panel, methodName));
            this._observers.forEach((observer) => observer(panel));
            return panel;
        },

        installTabApi(api) {
            this._tabApi = api || null;
            if (!api) return null;
            const methodNames = new Set([
                ...Object.keys(api).filter(key => typeof api[key] === 'function'),
                ...this._tabMethodWrappers.keys()
            ]);
            [...methodNames]
                .forEach(methodName => this._applyTabMethodWrappers(api, methodName));
            return api;
        },

        installPermissionApi(api) {
            this._permissionApi = api || null;
            return api;
        },

        getMainPanel() {
            return this._panel;
        },

        getTabApi() {
            return this._tabApi;
        },

        getPermissionApi() {
            return this._permissionApi;
        },

        _applyPanelMethodWrappers(panel, methodName) {
            const original = panel[methodName];
            if (typeof original !== 'function') return;
            if (!panel.__shellOriginalMethods) {
                Object.defineProperty(panel, '__shellOriginalMethods', {
                    value: new Map(),
                    enumerable: false
                });
            }
            if (!panel.__shellOriginalMethods.has(methodName)) {
                panel.__shellOriginalMethods.set(methodName, original);
            }
            const base = panel.__shellOriginalMethods.get(methodName);
            const wrappers = this._panelMethodWrappers.get(methodName);
            panel[methodName] = wrappers
                ? applyWrappers(base.bind(panel), wrappers, () => base.bind(panel))
                : base.bind(panel);
        },

        _applyTabMethodWrappers(api, methodName) {
            const original = api[methodName];
            if (typeof original !== 'function') return;
            if (!api.__shellOriginalMethods) {
                Object.defineProperty(api, '__shellOriginalMethods', {
                    value: new Map(),
                    enumerable: false
                });
            }
            if (!api.__shellOriginalMethods.has(methodName)) {
                api.__shellOriginalMethods.set(methodName, original);
            }
            const base = api.__shellOriginalMethods.get(methodName);
            const wrappers = this._tabMethodWrappers.get(methodName);
            api[methodName] = wrappers
                ? applyWrappers(base, wrappers, () => base)
                : base;
        },

        _applyBridgeMethodWrappers(methodName) {
            const bridge = global.electronAPI;
            if (!bridge || typeof bridge[methodName] !== 'function') return;
            if (!bridge.__shellOriginalMethods) {
                Object.defineProperty(bridge, '__shellOriginalMethods', {
                    value: new Map(),
                    enumerable: false
                });
            }
            if (!bridge.__shellOriginalMethods.has(methodName)) {
                bridge.__shellOriginalMethods.set(methodName, bridge[methodName]);
            }
            const base = bridge.__shellOriginalMethods.get(methodName);
            const wrappers = this._bridgeWrappers.get(methodName);
            bridge[methodName] = wrappers
                ? applyWrappers(base, wrappers, () => base)
                : base;
        }
    };

    global.localAgentRendererShell = shell;
})(window);
