(function (root) {
    const PLUGIN_ID = 'telegram-relay';
    const DEFAULT_TEST_MESSAGE = 'LocalAgent MTProto ping.';
    const SECRET_REDACTION = 'configured';

    function getSelectedPlugin(panel) {
        return panel && typeof panel.getSelectedPlugin === 'function'
            ? panel.getSelectedPlugin()
            : null;
    }

    function getState(panel) {
        if (!panel._telegramStudioState) {
            panel._telegramStudioState = {
                loginCode: '',
                password: '',
                proxyAddress: '',
                testPeer: '',
                testMessage: DEFAULT_TEST_MESSAGE
            };
        }
        return panel._telegramStudioState;
    }

    function boolFromConfig(value, fallback = false) {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
    }

    function getConfigValue(panel, key, fallback = '') {
        const raw = panel?.selectedDetail?.config?.[key];
        return raw == null ? fallback : raw;
    }

    function isRedactedSecret(value) {
        return String(value || '') === SECRET_REDACTION;
    }

    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (textContent != null) element.textContent = textContent;
        return element;
    }

    function createButton(label, onClick) {
        const button = createElement('button', 'compact-btn', label);
        button.type = 'button';
        button.addEventListener('click', onClick);
        return button;
    }

    function createOption(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }

    function openExternal(url) {
        const target = String(url || '').trim();
        if (!target) return;
        root.electronAPI?.shell?.openExternal?.(target).catch((error) => {
            console.error('[TelegramPluginStudio] Failed to open external URL:', error);
        });
    }

    function createSection(titleText, subtitle = '') {
        const section = createElement('section', 'plugin-studio-telegram-section');
        const header = createElement('div', 'plugin-studio-telegram-section-header');
        header.appendChild(createElement('div', 'plugin-studio-telegram-section-title', titleText));
        if (subtitle) {
            header.appendChild(createElement('div', 'plugin-studio-telegram-section-sub', subtitle));
        }
        section.appendChild(header);
        return section;
    }

    function createGrid() {
        return createElement('div', 'plugin-studio-telegram-grid');
    }

    function createPersistedField(panel, key, labelText, type, options = {}) {
        const field = createElement('label', 'plugin-studio-field');
        field.appendChild(createElement('span', 'plugin-studio-tts-field-label', labelText));

        const input = panel.createConfigInput(type, options);
        input.dataset.key = key;
        input.dataset.type = type;
        if (type === 'select') {
            input.replaceChildren();
            (options.options || []).forEach((option) => {
                if (typeof option === 'object') {
                    input.appendChild(createOption(String(option.value ?? ''), String(option.label ?? option.value ?? '')));
                } else {
                    input.appendChild(createOption(String(option), String(option)));
                }
            });
        }

        const raw = getConfigValue(panel, key, options.defaultValue ?? '');
        if (input.type === 'checkbox') {
            input.checked = boolFromConfig(raw, options.defaultValue === true);
        } else {
            input.value = raw == null ? '' : String(raw);
        }
        if (options.placeholder) input.placeholder = options.placeholder;
        field.appendChild(input);

        if (options.description) {
            field.appendChild(panel.createFieldDescription(options.description));
        }

        return field;
    }

    function createEphemeralField(panel, stateKey, labelText, type, options = {}) {
        const state = getState(panel);
        const field = createElement('label', 'plugin-studio-field');
        field.appendChild(createElement('span', 'plugin-studio-tts-field-label', labelText));

        const input = type === 'textarea'
            ? document.createElement('textarea')
            : document.createElement('input');
        if (type !== 'textarea') {
            input.type = type || 'text';
        }
        input.value = state[stateKey] || '';
        if (options.placeholder) input.placeholder = options.placeholder;
        input.addEventListener('input', () => {
            state[stateKey] = input.value;
        });
        field.appendChild(input);

        if (options.description) {
            field.appendChild(panel.createFieldDescription(options.description));
        }

        return field;
    }

    async function saveCurrentConfig(panel) {
        const plugin = getSelectedPlugin(panel);
        if (!plugin) return { success: false, error: 'Plugin is not selected' };
        return panel.saveCurrentConfig(plugin);
    }

    async function runPluginAction(panel, action, params = {}, options = {}) {
        const plugin = getSelectedPlugin(panel);
        if (!plugin) {
            panel.setResult({ success: false, error: 'Plugin is not selected' });
            return { success: false, error: 'Plugin is not selected' };
        }

        if (options.saveFirst !== false) {
            const saved = await saveCurrentConfig(panel);
            if (!saved?.success) {
                panel.setResult(saved?.error || 'Save failed');
                return saved;
            }
        }

        const response = await root.electronAPI.plugins.runAction(plugin.id, action, params);
        panel.setResult(response);
        if (response?.success === false) {
            return response;
        }

        if (options.reloadAfter !== false) {
            await panel.loadSelectedDetail();
            await api.render(panel);
        }
        return response;
    }

    function renderSummary(panel) {
        const toolbar = createElement('section', 'plugin-studio-telegram-toolbar');
        const chips = createElement('div', 'plugin-studio-telegram-chips');
        const classicEnabled = boolFromConfig(getConfigValue(panel, 'telegramReadingEnabled'), false);
        const mtprotoEnabled = boolFromConfig(getConfigValue(panel, 'mtprotoEnabled'), false);
        const hasSession = Boolean(String(getConfigValue(panel, 'sessionString', '')).trim());
        const proxyType = String(getConfigValue(panel, 'proxyType', 'none') || 'none');
        const lastAuthUser = String(getConfigValue(panel, 'mtprotoLastAuthUser', '') || '').trim();

        [
            `Classic relay: ${classicEnabled ? 'on' : 'off'}`,
            `MTProto: ${mtprotoEnabled ? 'on' : 'off'}`,
            `Session: ${hasSession ? 'saved' : 'none'}`,
            `Proxy: ${proxyType}`,
            lastAuthUser ? `Auth: ${lastAuthUser}` : ''
        ].filter(Boolean).forEach((text) => {
            chips.appendChild(createElement('span', 'plugin-studio-telegram-chip', text));
        });

        toolbar.appendChild(chips);
        return toolbar;
    }

    function renderRelaySection(panel) {
        const section = createSection('Classic Bot Relay', 'Existing Bot API polling remains here.');
        const grid = createGrid();
        grid.appendChild(createPersistedField(panel, 'botToken', 'Bot token', 'password', {
            description: 'Telegram bot token from @BotFather.'
        }));
        grid.appendChild(createPersistedField(panel, 'ownerChatId', 'Owner chat ID', 'string', {
            description: 'Auto-bound on first private chat if empty.'
        }));
        grid.appendChild(createPersistedField(panel, 'telegramReadingEnabled', 'Polling enabled', 'boolean', {
            description: 'Turn the classic Telegram bot relay on or off.'
        }));
        grid.appendChild(createPersistedField(panel, 'duplicateTelegramChat', 'Duplicate to local chat', 'boolean', {
            description: 'Show Telegram traffic in the desktop chat timeline.'
        }));
        section.appendChild(grid);
        return section;
    }

    function renderMtprotoSection(panel) {
        const section = createSection('MTProto Transport', 'Direct account or bot session for individual messaging.');
        const grid = createGrid();
        grid.appendChild(createPersistedField(panel, 'mtprotoEnabled', 'MTProto enabled', 'boolean', {
            description: 'Required for direct send and MTProto testing.'
        }));
        grid.appendChild(createPersistedField(panel, 'mtprotoMode', 'Mode', 'select', {
            options: [
                { value: 'user', label: 'User session' },
                { value: 'bot', label: 'Bot session' }
            ],
            description: 'User session is the direct individual-user path. Bot session keeps MTProto bot auth available too.'
        }));
        grid.appendChild(createPersistedField(panel, 'apiId', 'API ID', 'string', {
            description: 'Get this from https://my.telegram.org/apps'
        }));
        grid.appendChild(createPersistedField(panel, 'apiHash', 'API hash', 'password', {
            description: 'Get this from https://my.telegram.org/apps'
        }));
        grid.appendChild(createPersistedField(panel, 'phoneNumber', 'Phone number', 'string', {
            placeholder: '+15551234567',
            description: 'Used for MTProto user login.'
        }));
        grid.appendChild(createPersistedField(panel, 'defaultPeer', 'Default peer', 'string', {
            placeholder: '@username or phone',
            description: 'Fallback target for direct MTProto send.'
        }));
        grid.appendChild(createPersistedField(panel, 'sessionString', 'Saved session', 'textarea', {
            description: 'You can paste an existing session string or create one with the login actions below.'
        }));
        section.appendChild(grid);
        return section;
    }

    function renderProxySection(panel) {
        const section = createSection('Proxy', 'Fast path: get a public MTProto endpoint from mtproto.ru and paste one address here. Advanced keys still live in plugin config.');
        const grid = createGrid();
        grid.appendChild(createPersistedField(panel, 'proxyType', 'Proxy type', 'select', {
            options: [
                { value: 'none', label: 'None' },
                { value: 'socks5', label: 'SOCKS5' },
                { value: 'mtproxy', label: 'MTProxy' }
            ]
        }));
        grid.appendChild(createPersistedField(panel, 'proxyTimeoutSec', 'Timeout sec', 'number'));
        section.appendChild(grid);

        const state = getState(panel);
        if (!state.proxyAddress) {
            const proxyType = String(getConfigValue(panel, 'proxyType', 'none') || 'none');
            const host = String(getConfigValue(panel, 'proxyHost', '') || '').trim();
            const port = String(getConfigValue(panel, 'proxyPort', '') || '').trim();
            const secret = String(getConfigValue(panel, 'proxySecret', '') || '').trim();
            if (proxyType === 'mtproxy' && host && port && secret && !isRedactedSecret(secret)) {
                state.proxyAddress = `${host}:${port}:${secret}`;
            } else if (proxyType === 'socks5' && host && port) {
                state.proxyAddress = `${host}:${port}`;
            }
        }

        const linkRow = createElement('div', 'plugin-studio-telegram-inline-actions');
        linkRow.appendChild(createEphemeralField(panel, 'proxyAddress', 'Proxy address', 'text', {
            placeholder: 'host:port:secret or tg://proxy?...'
        }));
        const buttons = createElement('div', 'plugin-studio-telegram-actions');
        buttons.appendChild(createButton('Get MTProxy', async () => {
            openExternal('https://mtproto.ru/');
        }));
        buttons.appendChild(createButton('Apply Address', async () => {
            const currentState = getState(panel);
            await runPluginAction(panel, 'apply-proxy-link', {
                link: currentState.proxyAddress
            }, { saveFirst: false });
        }));
        buttons.appendChild(createButton('Disable Proxy', async () => {
            state.proxyAddress = '';
            await runPluginAction(panel, 'clear-proxy', {}, { saveFirst: false });
        }));
        linkRow.appendChild(buttons);
        section.appendChild(linkRow);
        return section;
    }

    function renderActionSection(panel) {
        const section = createSection('Actions', 'Login, test, and send through the MTProto transport.');
        const grid = createGrid();
        grid.appendChild(createEphemeralField(panel, 'loginCode', 'Login code', 'text', {
            placeholder: 'Telegram code'
        }));
        grid.appendChild(createEphemeralField(panel, 'password', '2FA password', 'password', {
            placeholder: 'Only needed if Telegram asks for it'
        }));
        grid.appendChild(createEphemeralField(panel, 'testPeer', 'Test peer', 'text', {
            placeholder: 'Uses default peer if empty'
        }));
        grid.appendChild(createEphemeralField(panel, 'testMessage', 'Test message', 'textarea', {
            placeholder: DEFAULT_TEST_MESSAGE
        }));
        section.appendChild(grid);

        const actions = createElement('div', 'plugin-studio-telegram-actions');
        actions.appendChild(createButton('Send Code', async () => {
            await runPluginAction(panel, 'mtproto-request-code');
        }));
        actions.appendChild(createButton('Finish Login', async () => {
            const state = getState(panel);
            await runPluginAction(panel, 'mtproto-login', {
                phoneCode: state.loginCode,
                password: state.password
            });
        }));
        actions.appendChild(createButton('Bot Login', async () => {
            await runPluginAction(panel, 'mtproto-login-bot');
        }));
        actions.appendChild(createButton('Clear Session', async () => {
            await runPluginAction(panel, 'mtproto-clear-session', {}, { saveFirst: false });
        }));
        actions.appendChild(createButton('Test', async () => {
            await runPluginAction(panel, 'mtproto-test');
        }));
        actions.appendChild(createButton('Send Test', async () => {
            const state = getState(panel);
            await runPluginAction(panel, 'mtproto-send', {
                peer: state.testPeer,
                message: state.testMessage || DEFAULT_TEST_MESSAGE
            });
        }));
        section.appendChild(actions);

        return section;
    }

    const api = {
        canHandle(panel) {
            return getSelectedPlugin(panel)?.id === PLUGIN_ID;
        },

        async render(panel) {
            panel.form.replaceChildren();
            panel.form.classList.remove('plugin-studio-form-tts');
            panel.form.classList.add('plugin-studio-form-telegram');
            panel.discoverBtn.hidden = false;
            panel.discoverBtn.textContent = 'Status';
            panel.saveBtn.hidden = false;

            panel.form.appendChild(renderSummary(panel));
            panel.form.appendChild(renderRelaySection(panel));
            panel.form.appendChild(renderMtprotoSection(panel));
            panel.form.appendChild(renderProxySection(panel));
            panel.form.appendChild(renderActionSection(panel));
        }
    };

    root.LocalAgentPluginTelegramStudio = api;
})(window);
