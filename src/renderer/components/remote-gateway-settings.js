(function () {
    class RemoteGatewaySettings {
        constructor() {
            this.bound = false;
            this.pollTimer = null;
            this.elements = null;
            this.initializeWhenReady();
        }

        initializeWhenReady() {
            const bind = () => this.bind();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', bind);
            } else {
                bind();
            }
        }

        bind() {
            if (this.bound || !window.electronAPI?.remoteGateway) return;
            const elements = {
                url: document.getElementById('remote-gateway-url'),
                secret: document.getElementById('remote-gateway-secret'),
                status: document.getElementById('remote-gateway-status-text'),
                connect: document.getElementById('remote-gateway-connect-btn'),
                disconnect: document.getElementById('remote-gateway-disconnect-btn'),
                secretBtn: document.getElementById('remote-gateway-secret-btn'),
                deploy: document.getElementById('remote-gateway-deploy-btn'),
                agentSetup: document.getElementById('remote-gateway-agent-setup-btn'),
                setup: document.getElementById('remote-gateway-setup-btn'),
                manualToggle: document.getElementById('remote-gateway-manual-toggle-btn'),
                manualPanel: document.getElementById('remote-gateway-manual-panel'),
                modal: document.getElementById('remote-gateway-setup-modal'),
                setupHost: document.getElementById('remote-setup-host'),
                setupUser: document.getElementById('remote-setup-user'),
                setupSshPort: document.getElementById('remote-setup-ssh-port'),
                setupGatewayPort: document.getElementById('remote-setup-gateway-port'),
                setupDomain: document.getElementById('remote-setup-domain'),
                setupTargetDir: document.getElementById('remote-setup-target-dir'),
                setupUseTls: document.getElementById('remote-setup-use-tls'),
                setupOutput: document.getElementById('remote-gateway-setup-output'),
                setupCancel: document.getElementById('remote-setup-cancel-btn'),
                setupRun: document.getElementById('remote-setup-run-btn')
            };
            if (!elements.url || !elements.connect) return;
            this.bound = true;
            this.elements = elements;

            elements.connect.addEventListener('click', () => this.connect());
            elements.disconnect.addEventListener('click', () => this.disconnect());
            elements.secretBtn.addEventListener('click', () => this.generateSecret());
            elements.deploy.addEventListener('click', () => this.deploy());
            elements.agentSetup.addEventListener('click', () => this.agentSetup());
            elements.setup?.addEventListener('click', () => this.openSetupModal());
            elements.manualToggle?.addEventListener('click', () => this.toggleManualPanel());
            elements.setupCancel?.addEventListener('click', () => this.closeSetupModal());
            elements.modal?.addEventListener('click', (event) => {
                if (event.target === elements.modal) this.closeSetupModal();
            });
            elements.setupRun?.addEventListener('click', () => this.runSetup());

            this.refresh();
            this.pollTimer = setInterval(() => this.refresh(), 15000);
        }

        async refresh() {
            if (!this.elements) return;
            try {
                const status = await window.electronAPI.remoteGateway.getStatus();
                if (!this.elements.url.value && status.savedUrl) this.elements.url.value = status.savedUrl;
                this.renderStatus(status);
            } catch (error) {
                this.elements.status.textContent = error.message || 'Remote Gateway unavailable';
            }
        }

        renderStatus(status = {}) {
            const state = status.connected ? 'Connected' : (status.state || 'Disconnected');
            const detail = status.connected
                ? `${status.connectedClients || 0} remote clients, ${status.latencyMs || 0}ms`
                : (status.lastError || 'Not connected');
            this.elements.status.textContent = `${state}: ${detail}`;
            this.elements.connect.disabled = status.connected === true;
            this.elements.disconnect.disabled = status.connected !== true;
        }

        readConfig() {
            return {
                url: String(this.elements.url.value || '').trim(),
                secret: String(this.elements.secret.value || '').trim()
            };
        }

        async connect() {
            const config = this.readConfig();
            if (!config.url || !config.secret) {
                this.notify('Gateway URL and secret are required', 'error');
                return;
            }
            this.elements.connect.disabled = true;
            try {
                const status = await window.electronAPI.remoteGateway.connect(config);
                this.renderStatus(status);
                this.notify('Remote Gateway connected');
            } catch (error) {
                this.notify(error.message || 'Remote Gateway connection failed', 'error');
                await this.refresh();
            }
        }

        async disconnect() {
            this.elements.disconnect.disabled = true;
            try {
                const status = await window.electronAPI.remoteGateway.disconnect();
                this.renderStatus(status);
                this.notify('Remote Gateway disconnected');
            } catch (error) {
                this.notify(error.message || 'Remote Gateway disconnect failed', 'error');
            } finally {
                await this.refresh();
            }
        }

        async generateSecret() {
            try {
                const result = await window.electronAPI.remoteGateway.generateSecret();
                if (!result?.secret) throw new Error(result?.error || 'No secret returned');
                this.elements.secret.value = result.secret;
                this.notify('Remote Gateway secret generated');
            } catch (error) {
                this.notify(error.message || 'Secret generation failed', 'error');
            }
        }

        async deploy() {
            try {
                const result = await window.electronAPI.remoteGateway.deploy({});
                const message = result?.packagePath
                    ? `Gateway package: ${result.packagePath}`
                    : (result?.message || 'Gateway package ready');
                this.elements.status.textContent = message;
                this.notify('Remote Gateway package path shown');
            } catch (error) {
                this.notify(error.message || 'Deploy package lookup failed', 'error');
            }
        }

        openSetupModal() {
            if (!this.elements?.modal) return;
            this.elements.setupOutput.textContent = 'This will connect with ssh, install the gateway files, start the gateway process, save the URL/secret, then connect this desktop.';
            this.elements.modal.classList.remove('hidden');
            this.elements.setupHost?.focus();
        }

        closeSetupModal() {
            this.elements?.modal?.classList.add('hidden');
        }

        toggleManualPanel() {
            if (!this.elements?.manualPanel) return;
            const nextHidden = !this.elements.manualPanel.hidden;
            this.elements.manualPanel.hidden = nextHidden;
            if (this.elements.manualToggle) {
                this.elements.manualToggle.textContent = nextHidden ? 'Manual' : 'Hide Manual';
            }
        }

        readSetupConfig() {
            return {
                host: String(this.elements.setupHost?.value || '').trim(),
                user: String(this.elements.setupUser?.value || 'root').trim(),
                sshPort: Number.parseInt(this.elements.setupSshPort?.value, 10) || 22,
                gatewayPort: Number.parseInt(this.elements.setupGatewayPort?.value, 10) || 8791,
                domain: String(this.elements.setupDomain?.value || '').trim(),
                targetDir: String(this.elements.setupTargetDir?.value || '~/localagent-remote-gateway').trim(),
                secret: String(this.elements.secret?.value || '').trim(),
                useTls: this.elements.setupUseTls?.checked !== false,
                connectAfter: true
            };
        }

        async runSetup() {
            const config = this.readSetupConfig();
            if (!config.host || !config.user) {
                this.notify('VPS host and SSH user are required', 'error');
                return;
            }
            this.elements.setupRun.disabled = true;
            this.elements.setupOutput.textContent = `Connecting to ${config.user}@${config.host}:${config.sshPort}...\n`;
            try {
                const result = await window.electronAPI.remoteGateway.setup(config);
                if (result?.success === false) throw new Error(result.error || 'Remote Gateway setup failed');
                this.elements.url.value = result.url || this.elements.url.value;
                if (result.secret) this.elements.secret.value = result.secret;
                const lines = [
                    ...(result.steps || []),
                    result.output || '',
                    result.connection?.connected ? 'Desktop tunnel connected.' : (result.connection?.error ? `Desktop tunnel not connected: ${result.connection.error}` : '')
                ].filter(Boolean);
                this.elements.setupOutput.textContent = lines.join('\n');
                await this.refresh();
                this.notify(result.connection?.connected ? 'Remote Gateway is ready' : 'Remote Gateway installed');
            } catch (error) {
                this.elements.setupOutput.textContent += `\n${error.message || error}`;
                this.notify(error.message || 'Remote Gateway setup failed', 'error');
            } finally {
                this.elements.setupRun.disabled = false;
            }
        }

        async agentSetup() {
            const config = this.readConfig();
            const prompt = [
                'Help me set up LocalAgent Remote Gateway on my VPS.',
                config.url ? `Gateway URL: ${config.url}` : 'Gateway URL: not set yet.',
                'Use the deployable package at src/main/companion/remote-gateway and configure TLS through a reverse proxy.'
            ].join('\n');
            try {
                await window.electronAPI.sendMessage(prompt);
                this.notify('Remote Gateway setup prompt sent');
            } catch (error) {
                this.notify(error.message || 'Failed to start agent setup', 'error');
            }
        }

        notify(message, type = 'info') {
            window.mainPanel?.showNotification?.(message, type);
        }
    }

    window.remoteGatewaySettings = new RemoteGatewaySettings();
})();
