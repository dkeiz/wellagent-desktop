(function installMainPanelChatActions(global) {
    function attachFile(panel) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (event) => handleFileDrop(panel, event.target.files);
        input.click();
    }

    async function handleFileDrop(panel, files) {
        for (const file of files) {
            const filePath = file.path || file.name;
            const ext = file.name.split('.').pop().toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
            const isAudio = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext);
            panel.addMessageWithAttachment('user', 'Analyze this file', {
                name: file.name,
                type: isImage ? 'image' : isAudio ? 'audio' : 'document'
            });
            const loadingId = panel.addMessage('assistant', '...');
            try {
                const result = await window.electronAPI.handleFileDrop(filePath);
                panel.removeMessage(loadingId);
                if (result.success) {
                    panel.addMessage('assistant', result.response.content);
                    panel.updateContextUsage(result.response);
                    if (panel.autoSpeak) panel.speakText(result.response.content);
                }
            } catch (error) {
                panel.removeMessage(loadingId);
                panel.showNotification(`Error processing ${file.name}`, 'error');
            }
        }
    }

    function showAttachedFile(fileName) {
        const container = document.querySelector('.input-container');
        const fileDiv = document.createElement('div');
        fileDiv.className = 'attached-file';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `📎 ${fileName}`;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-file';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove attachment';
        removeBtn.addEventListener('click', () => fileDiv.remove());
        fileDiv.appendChild(nameSpan);
        fileDiv.appendChild(removeBtn);
        container.insertBefore(fileDiv, container.firstChild);
    }

    async function sendMessage(panel) {
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const message = messageInput.value.trim();
        if (panel.activeTabId === 'subagent-manager' || panel.activeTabId === 'superagent-manager') {
            panel.showNotification('Manager tabs are view-only. Open a chat tab to send messages.', 'info');
            return;
        }
        if (!message && panel.attachedFiles.length === 0) return;
        if (panel.commandHandler.isCommand(message)) {
            messageInput.value = '';
            panel.addMessage('user', message);
            const result = await panel.commandHandler.execute(message);
            if (result.passthrough) {
                messageInput.value = result.passthrough;
                return sendMessage(panel);
            }
            if (result.output) {
                panel.addMessage('system', result.output, result.style);
            }
            return;
        }
        const sessionId = panel.activeTabId;
        const tab = panel.chatTabs.get(sessionId);
        if (message) panel.addMessage('user', message);
        messageInput.value = '';
        panel.attachedFiles = [];
        document.querySelectorAll('.attached-file').forEach((element) => element.remove());
        messageInput.focus();
        if (sendBtn) sendBtn.classList.add('hidden');
        if (stopBtn) stopBtn.classList.remove('hidden');
        panel.isSending = true;
        if (tab) {
            tab.isSending = true;
            panel.renderTabs();
        }
        if (tab && (tab.title.startsWith('Chat ') || !tab.title)) {
            tab.title = message.substring(0, 30) + (message.length > 30 ? '…' : '');
            panel.renderTabs();
        }
        const loadingId = panel.addMessage('assistant', '...');
        window.electronAPI.sendMessage(message, sessionId)
            .then(async (response) => {
                if (tab) tab.contextUsage = null;
                if (panel.activeTabId === sessionId) {
                    panel.removeMessage(loadingId);
                    if (!response.stopped && !response.needsPermission) {
                        panel.addMessage('assistant', response.content);
                        await panel.calculateContextUsage(sessionId);
                        if (panel.autoSpeak) panel.speakText(response.content);
                    }
                }
            })
            .catch((error) => {
                console.error('Error sending message:', error);
                if (panel.activeTabId === sessionId) {
                    panel.removeMessage(loadingId);
                    panel.addMessage('system', `Error: ${error.message}`);
                }
            })
            .finally(() => {
                if (sendBtn) sendBtn.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
                panel.isSending = false;
                if (tab) {
                    tab.isSending = false;
                    panel.renderTabs();
                }
            });
    }

    global.LocalAgentMainPanelChatActions = {
        attachFile,
        handleFileDrop,
        sendMessage,
        showAttachedFile
    };
})(window);
