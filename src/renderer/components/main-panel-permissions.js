(function () {
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function ensurePermissionStyles() {
        if (document.getElementById('tool-permission-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'tool-permission-styles';
        style.textContent = `
            .tool-permission-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
            }

            .tool-permission-dialog {
                background: var(--card-bg);
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius);
                padding: 0;
                min-width: 400px;
                max-width: 90vw;
            }

            .permission-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-color);
            }

            .permission-header h3 {
                margin: 0;
                font-size: 1.2rem;
            }

            .close-btn {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0;
                opacity: 0.6;
            }

            .close-btn:hover {
                opacity: 1;
            }

            .permission-content {
                padding: 1.5rem;
            }

            .permission-content .tool-description {
                margin: 0.5rem 0 0 0;
                font-size: 0.9rem;
                color: var(--text-secondary);
            }

            .permission-actions {
                display: flex;
                gap: 0.5rem;
                padding: 1rem 1.5rem;
                border-top: 1px solid var(--border-color);
                justify-content: flex-end;
            }

            .permission-btn {
                padding: 0.5rem 1rem;
            }

            .tool-creation-dialog {
                min-width: 500px;
            }

            .tool-creation-dialog pre {
                max-height: 300px;
                overflow-y: auto;
            }
        `;
        document.head.appendChild(style);
    }

    function appendLabeledParagraph(container, label, value) {
        const paragraph = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        paragraph.appendChild(strong);
        paragraph.appendChild(document.createTextNode(value));
        container.appendChild(paragraph);
    }

    function buildPermissionHeader(title, onClose) {
        const header = document.createElement('div');
        header.className = 'permission-header';

        const heading = document.createElement('h3');
        heading.textContent = title;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', onClose);

        header.appendChild(heading);
        header.appendChild(closeBtn);
        return header;
    }

    function buildActionButton(label, className, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', handler);
        return button;
    }

    function closePermissionDialog(panel) {
        const overlay = document.querySelector('.tool-permission-overlay');
        if (overlay) {
            overlay.remove();
        }
        panel.currentPermissionRequest = null;
    }

    function showToolPermissionDialog(panel, request) {
        closePermissionDialog(panel);
        ensurePermissionStyles();

        const overlay = document.createElement('div');
        overlay.className = 'tool-permission-overlay';

        const dialog = document.createElement('div');
        const isCustomTool = request.toolName === 'create_tool';
        const isTerminalScope = request.permissionType === 'terminal_scope';
        dialog.className = isCustomTool
            ? 'tool-permission-dialog tool-creation-dialog'
            : 'tool-permission-dialog';

        if (isCustomTool) {
            const params = request.params || {};
            const content = document.createElement('div');
            content.className = 'permission-content';
            appendLabeledParagraph(content, 'Tool Name', params.name || 'Unknown');
            appendLabeledParagraph(content, 'Description', params.description || 'No description');

            const details = document.createElement('details');
            details.style.marginTop = '1rem';

            const summary = document.createElement('summary');
            summary.style.cursor = 'pointer';
            summary.style.fontWeight = '600';
            summary.textContent = 'View Code';

            const pre = document.createElement('pre');
            pre.style.background = '#f5f5f5';
            pre.style.padding = '0.75rem';
            pre.style.borderRadius = '4px';
            pre.style.overflowX = 'auto';
            pre.style.marginTop = '0.5rem';

            const code = document.createElement('code');
            code.textContent = params.code || '';
            pre.appendChild(code);
            details.appendChild(summary);
            details.appendChild(pre);
            content.appendChild(details);

            const actions = document.createElement('div');
            actions.className = 'permission-actions';
            actions.appendChild(buildActionButton('Deny', 'btn-secondary permission-btn', () => {
                denyToolCreation(panel);
            }));
            actions.appendChild(buildActionButton('Approve & Create', 'btn-success permission-btn', () => {
                approveToolCreation(panel);
            }));

            dialog.appendChild(buildPermissionHeader('🔧 Create New Tool', () => closePermissionDialog(panel)));
            dialog.appendChild(content);
            dialog.appendChild(actions);
        } else if (isTerminalScope) {
            const content = document.createElement('div');
            content.className = 'permission-content';

            const intro = document.createElement('p');
            intro.innerHTML = '<strong>System terminal access requested</strong>';
            const warning = document.createElement('p');
            warning.className = 'tool-description';
            warning.textContent = 'This command wants to run outside the execution workspace. System terminal access can search, read, or affect files across the machine depending on the command.';
            appendLabeledParagraph(content, 'Command', request.command || request.params?.command || '');
            appendLabeledParagraph(content, 'Working Directory', request.cwd || request.params?.cwd || '(default)');
            content.insertBefore(warning, content.firstChild);
            content.insertBefore(intro, content.firstChild);

            const actions = document.createElement('div');
            actions.className = 'permission-actions';
            actions.appendChild(buildActionButton('Deny', 'btn-secondary permission-btn', () => {
                denyToolPermission(panel);
            }));
            actions.appendChild(buildActionButton('Allow Once', 'btn-primary permission-btn', () => {
                allowToolOnce(panel, request.toolName);
            }));
            actions.appendChild(buildActionButton('Enable System Terminal', 'btn-success permission-btn', () => {
                enableTool(panel, request.toolName);
            }));

            dialog.appendChild(buildPermissionHeader('🔐 Terminal Scope Required', () => closePermissionDialog(panel)));
            dialog.appendChild(content);
            dialog.appendChild(actions);
        } else {
            const content = document.createElement('div');
            content.className = 'permission-content';

            const intro = document.createElement('p');
            intro.append('The AI wants to use ');
            const strong = document.createElement('strong');
            strong.textContent = request.toolName;
            intro.appendChild(strong);

            const description = document.createElement('p');
            description.className = 'tool-description';
            description.textContent = request.toolDefinition?.userDescription
                || request.toolDefinition?.description
                || 'No description';

            content.appendChild(intro);
            content.appendChild(description);

            const actions = document.createElement('div');
            actions.className = 'permission-actions';
            actions.appendChild(buildActionButton('Deny', 'btn-secondary permission-btn', () => {
                denyToolPermission(panel);
            }));
            actions.appendChild(buildActionButton('Allow Once', 'btn-primary permission-btn', () => {
                allowToolOnce(panel, request.toolName);
            }));
            actions.appendChild(buildActionButton('Enable Permanently', 'btn-success permission-btn', () => {
                enableTool(panel, request.toolName);
            }));

            dialog.appendChild(buildPermissionHeader('🔐 Tool Permission Required', () => closePermissionDialog(panel)));
            dialog.appendChild(content);
            dialog.appendChild(actions);
        }

        panel.currentPermissionRequest = request;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    async function handleToolExecution(panel, toolName, result, reqToolName, reqParams) {
        if (!result.success) {
            panel.addMessage('assistant', `Failed to execute ${toolName}: ${result.error}`);
            return;
        }

        const loadingId = panel.addMessage('assistant', '...');

        try {
            const interpreted = await window.electronAPI.interpretToolResult(
                reqToolName,
                reqParams,
                result.result
            );

            panel.removeMessage(loadingId);
            panel.addMessage('assistant', interpreted.content);
            panel.updateContextUsage(interpreted);
            if (panel.autoSpeak) {
                panel.speakText(interpreted.content);
            }
        } catch (error) {
            console.error('Failed to interpret tool result:', error);
            panel.removeMessage(loadingId);
            const resultStr = typeof result.result === 'object'
                ? JSON.stringify(result.result, null, 2)
                : String(result.result);
            panel.addMessage('assistant', `Tool ${toolName} result:\n${resultStr}`);
        }
    }

    async function approveToolCreation(panel) {
        try {
            const params = panel.currentPermissionRequest?.params || {};
            const result = await window.electronAPI.createCustomTool(params);
            if (result.success) {
                panel.addMessage(
                    'assistant',
                    `✅ Tool "${params.name}" created successfully! It's now available in the MCP tools list (disabled by default).`
                );
                if (window.sidebar && window.sidebar.loadMCPTools) {
                    await window.sidebar.loadMCPTools();
                }
                showNotification(`Tool "${params.name}" created`);
            } else {
                panel.addMessage('assistant', `❌ Failed to create tool: ${result.error}`);
                showNotification('Tool creation failed', 'error');
            }
            closePermissionDialog(panel);
        } catch (error) {
            console.error('Error creating tool:', error);
            panel.addMessage('assistant', `❌ Error creating tool: ${error.message}`);
            closePermissionDialog(panel);
        }
    }

    function denyToolCreation(panel) {
        panel.addMessage('assistant', 'Tool creation was denied.');
        closePermissionDialog(panel);
    }

    async function allowToolOnce(panel, toolName) {
        const reqToolName = panel.currentPermissionRequest?.toolName;
        const reqParams = panel.currentPermissionRequest?.params;
        const isTerminalScope = panel.currentPermissionRequest?.permissionType === 'terminal_scope';
        closePermissionDialog(panel);

        try {
            const result = await window.electronAPI.executeMCPToolOnce(reqToolName, reqParams, {
                allowOutsideExecutionRootOnce: isTerminalScope
            });
            await handleToolExecution(panel, toolName, result, reqToolName, reqParams);
        } catch (error) {
            console.error('Error allowing tool once:', error);
            panel.addMessage('assistant', `Error executing ${toolName}: ${error.message}`);
        }
    }

    async function enableTool(panel, toolName) {
        const reqToolName = panel.currentPermissionRequest?.toolName;
        const reqParams = panel.currentPermissionRequest?.params;
        const reqAgentId = panel.currentPermissionRequest?.agentId || null;
        const isTerminalScope = panel.currentPermissionRequest?.permissionType === 'terminal_scope';
        closePermissionDialog(panel);

        try {
            if (isTerminalScope) {
                if (reqAgentId) {
                    await window.electronAPI.permissions?.setAgentGroup?.(reqAgentId, 'terminal', 'system');
                } else {
                    await window.electronAPI.capability?.setTerminalMode?.('system');
                }
            } else {
                await window.electronAPI.setToolActive(reqToolName, true, reqAgentId ? { agentId: reqAgentId } : {});
            }

            if (window.sidebar && window.sidebar.loadMCPTools) {
                await window.sidebar.loadMCPTools();
            }

            showNotification(isTerminalScope ? '✅ System terminal enabled' : `✅ ${toolName} enabled permanently`);

            const result = await window.electronAPI.executeMCPToolOnce(reqToolName, reqParams);
            await handleToolExecution(panel, toolName, result, reqToolName, reqParams);
        } catch (error) {
            console.error('Error enabling tool:', error);
            panel.addMessage('assistant', `Error enabling ${toolName}: ${error.message}`);
        }
    }

    function denyToolPermission(panel) {
        panel.addMessage(
            'assistant',
            'I need permission to use that tool. You can enable it in the MCP settings if you\'d like.'
        );
        closePermissionDialog(panel);
    }

    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem;
            border-radius: var(--border-radius);
            color: white;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        const bgColor = type === 'success'
            ? '#28a745'
            : type === 'error'
                ? '#dc3545'
                : type === 'info'
                    ? '#17a2b8'
                    : '#6c757d';

        notification.style.backgroundColor = bgColor;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    const api = {
        allowToolOnce,
        approveToolCreation,
        closePermissionDialog,
        denyToolCreation,
        denyToolPermission,
        enableTool,
        escapeHtml,
        showNotification,
        showToolPermissionDialog
    };
    window.localAgentRendererShell?.installPermissionApi?.(api);
    window.mainPanelPermissions = api;
})();
