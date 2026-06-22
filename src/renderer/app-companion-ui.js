(function installAppCompanionUi(global) {
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString();
    }

    function getDefaultCompanionScope(app, presetId) {
        const preset = (app.companionPermissionPresets || []).find((entry) => entry.id === presetId);
        if (preset?.scope) {
            return { ...preset.scope };
        }

        return {
            preset: presetId,
            mediaUpload: presetId !== 'read-only',
            settingsWrite: presetId === 'full' || presetId === 'standard',
            agentManagement: presetId === 'full',
            daemonControl: presetId === 'full' || presetId === 'standard'
        };
    }

    function renderCompanionDevices(app, elements, devices = []) {
        if (!elements?.devicesList || !elements?.devicesEmpty) return;

        if (!devices.length) {
            elements.devicesList.innerHTML = '';
            elements.devicesEmpty.hidden = false;
            return;
        }

        elements.devicesEmpty.hidden = true;
        const optionsHtml = (app.companionPermissionPresets || [])
            .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)
            .join('');

        elements.devicesList.innerHTML = devices.map((device) => {
            const preset = device?.permissions?.preset || 'standard';
            const title = escapeHtml(device.deviceName || device.deviceId || 'Unknown Device');
            const deviceId = escapeHtml(device.deviceId || '');
            const platform = escapeHtml(device.platform || 'unknown');
            const pairedAt = escapeHtml(formatDateTime(device.pairedAt));
            const lastSeenAt = escapeHtml(formatDateTime(device.lastSeenAt));
            const statusClass = device.connected ? 'online' : 'offline';
            const statusLabel = device.connected ? 'Online' : 'Offline';
            const summaryTitle = escapeHtml(`ID: ${device.deviceId || ''}\nPaired: ${formatDateTime(device.pairedAt)}\nLast seen: ${formatDateTime(device.lastSeenAt)}`);

            return `
                <div class="companion-device-row" title="${summaryTitle}">
                    <div class="companion-device-summary">
                        <strong>${title}</strong>
                        <span>${platform}</span>
                    </div>
                    <span class="companion-status-badge ${statusClass}">${statusLabel}</span>
                    <div class="companion-device-actions">
                        <select class="companion-device-preset" data-device-id="${deviceId}">
                            ${optionsHtml}
                        </select>
                        <button class="danger-btn compact-btn companion-remove-device-btn" data-device-id="${deviceId}">Remove</button>
                    </div>
                </div>
            `;
        }).join('');

        for (const select of elements.devicesList.querySelectorAll('.companion-device-preset')) {
            const deviceId = select.dataset.deviceId;
            const device = devices.find((entry) => String(entry.deviceId) === String(deviceId));
            if (!device) continue;
            select.value = device?.permissions?.preset || 'standard';
        }
    }

    function formatCompanionAndroidHttpsStatus(tls = {}) {
        if (!tls?.enabled) return 'Off';
        if (tls?.running) return `Ready :${tls.securePort || '—'}`;
        if (tls?.ready) return `Configured :${tls.securePort || '—'}`;
        if (tls?.supported === false) return 'Unsupported';
        return 'Setup needed';
    }

    function renderCompanionState(app, elements, status = {}, pairing = null, devices = []) {
        if (!elements) return;

        const enabled = status?.enabled === true;
        const running = status?.running === true;
        const tls = status?.androidBrowserHttps || {};
        elements.enabled.checked = enabled;
        elements.host.value = status?.host || elements.host.value || '0.0.0.0';
        elements.port.value = `${status?.port || Number.parseInt(elements.port.value, 10) || 8790}`;
        if (elements.androidHttpsEnabled) {
            elements.androidHttpsEnabled.checked = tls.enabled === true;
            elements.androidHttpsEnabled.disabled = tls.supported === false && tls.enabled !== true;
        }
        if (elements.androidHttpsStatus) {
            elements.androidHttpsStatus.textContent = formatCompanionAndroidHttpsStatus(tls);
        }
        if (elements.androidHttpsSetupBtn) {
            elements.androidHttpsSetupBtn.disabled = tls.supported === false;
        }
        if (elements.androidHttpsNote) {
            const tlsNote = tls.enabled
                ? (tls.warning || (tls.preferredSecureUrl
                    ? `Bootstrap link stays on HTTP. Secure companion runs on ${tls.preferredSecureUrl}.`
                    : 'Bootstrap link stays on HTTP. Run HTTPS setup before using browser mic on Android.'))
                : 'Enable this to generate a local CA and use a secure companion page for Android browser microphone access.';
            elements.androidHttpsNote.textContent = tlsNote;
        }
        let statusText = 'Disabled';
        if (enabled && running) {
            statusText = `${status.host}:${status.port}`;
        } else if (enabled) {
            statusText = 'Saved';
        }

        elements.statusText.textContent = statusText;
        elements.deviceCount.textContent = `${status?.pairedDevices ?? devices.length ?? 0} paired`;
        elements.connectedCount.textContent = `${status?.connectedDevices ?? 0} connected`;

        const hasPairing = Boolean(pairing?.code);
        elements.browserUrl.value = running ? (status?.preferredBrowserUrl || '') : '';
        elements.pairingUrl.value = hasPairing ? (pairing?.preferredBrowserUrl || '') : '';
        elements.nativeAppUrl.value = hasPairing ? (pairing?.nativeAppUrl || '') : '';
        elements.copyLinkBtn.disabled = !elements.browserUrl.value;
        elements.copyPairingLinkBtn.disabled = !elements.pairingUrl.value;
        elements.showAppQrBtn.hidden = !elements.nativeAppUrl.value;
        elements.showAppQrBtn.disabled = !elements.nativeAppUrl.value;
        elements.showWebQrBtn.hidden = !elements.pairingUrl.value;
        elements.showWebQrBtn.disabled = !elements.pairingUrl.value;
        if (elements.showDownloadQrBtn) {
            elements.showDownloadQrBtn.hidden = !elements.browserUrl.value;
            elements.showDownloadQrBtn.disabled = !elements.browserUrl.value;
        }

        if (hasPairing) {
            elements.pairingCode.textContent = pairing.code;
            elements.pairingExpiry.textContent = formatDateTime(pairing.expiresAt);
            elements.cancelPairingBtn.hidden = false;
            elements.copyPairingLinkBtn.hidden = false;
        } else {
            elements.pairingCode.textContent = '—';
            elements.pairingExpiry.textContent = 'No active code';
            elements.cancelPairingBtn.hidden = true;
            elements.copyPairingLinkBtn.hidden = true;
        }

        const warning = pairing?.warning || status?.warning || '';
        elements.warning.hidden = !warning;
        elements.warning.textContent = warning ? 'Notice' : '';
        elements.warning.title = warning;

        elements.toggleAdvancedBtn.textContent = app.companionAdvancedOpen ? 'Hide Advanced' : 'Advanced';
        elements.advancedPanel.hidden = !app.companionAdvancedOpen;

        renderCompanionDevices(app, elements, devices);
        for (const select of elements.devicesList.querySelectorAll('.companion-device-preset')) {
            select.disabled = !running;
        }
    }

    global.LocalAgentAppCompanionUi = {
        escapeHtml,
        formatDateTime,
        formatCompanionAndroidHttpsStatus,
        getDefaultCompanionScope,
        renderCompanionDevices,
        renderCompanionState
    };
})(window);
