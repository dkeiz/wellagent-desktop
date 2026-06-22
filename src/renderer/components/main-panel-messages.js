(function installMainPanelMessages(global) {
    function openLightbox(panel, src) {
        panel._closeLightbox?.();
        const overlay = document.createElement('div');
        const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
        const close = () => {
            document.removeEventListener('keydown', onKeyDown);
            if (panel._closeLightbox === close) panel._closeLightbox = null;
            overlay.remove();
        };
        overlay.id = 'image-lightbox';
        overlay.className = 'image-lightbox';
        overlay.addEventListener('click', close);
        const image = document.createElement('img');
        image.src = src;
        image.alt = 'Enlarged image';
        image.addEventListener('click', (event) => event.stopPropagation());
        overlay.appendChild(image);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKeyDown);
        panel._closeLightbox = close;
    }

    function addMessage(panel, role, content, style) {
        const messagesContainer = document.getElementById('messages-container');
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;
        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}${style === 'terminal' ? ' terminal-output' : ''}`;
        const shouldFollow = !panel._suspendMessageAutoscroll && shouldAutoScroll(panel, role === 'user' || content === '...');
        renderMessageBody(panel, messageDiv, role, content, style);
        messageWrapper.appendChild(messageDiv);
        if (role === 'assistant' && content !== '...') {
            const speakIcon = document.createElement('button');
            speakIcon.className = 'message-speak-btn';
            speakIcon.textContent = '🔊';
            speakIcon.title = 'Speak this message';
            speakIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                panel.speakText(content);
            });
            messageWrapper.appendChild(speakIcon);
        }
        messagesContainer.appendChild(messageWrapper);
        if (shouldFollow) {
            scrollMessagesToLatest(panel, true);
        } else if (!panel._suspendMessageAutoscroll) {
            storeActiveTabScrollState(panel);
        }
        return messageId;
    }

    function addMessageWithAttachment(panel, role, content, attachment) {
        const messagesContainer = document.getElementById('messages-container');
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;
        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}`;
        const shouldFollow = !panel._suspendMessageAutoscroll && shouldAutoScroll(panel, true);
        if (attachment.type === 'image' && attachment.path) {
            const image = document.createElement('img');
            image.src = `file://${attachment.path}`;
            image.className = 'chat-image';
            image.alt = attachment.name || 'Attached image';
            image.title = 'Click to enlarge';
            image.dataset.lightboxSrc = image.src;
            const text = document.createElement('span');
            text.textContent = content;
            messageDiv.appendChild(image);
            messageDiv.appendChild(document.createElement('br'));
            messageDiv.appendChild(text);
        } else {
            const icons = { image: '🖼️', audio: '🎵', document: '📄' };
            const icon = document.createElement('span');
            icon.className = 'attachment-icon';
            icon.title = attachment.name || 'Attachment';
            icon.textContent = icons[attachment.type] || '📎';
            const text = document.createElement('span');
            text.textContent = content;
            messageDiv.appendChild(icon);
            messageDiv.appendChild(document.createTextNode(' '));
            messageDiv.appendChild(text);
        }
        messageWrapper.appendChild(messageDiv);
        messagesContainer.appendChild(messageWrapper);
        if (shouldFollow) {
            scrollMessagesToLatest(panel, true);
        } else if (!panel._suspendMessageAutoscroll) {
            storeActiveTabScrollState(panel);
        }
        return messageId;
    }

    function removeMessage(messageId) {
        const messageDiv = document.getElementById(messageId);
        if (messageDiv) {
            const wrapper = messageDiv.closest('.message-wrapper');
            (wrapper || messageDiv).remove();
        }
    }

    function renderMessageBody(panel, messageDiv, role, content, style) {
        if (style === 'terminal') {
            messageDiv.classList.add('terminal-output');
        }
        if (role === 'assistant' && content === '...') {
            messageDiv.classList.add('loading');
            messageDiv.textContent = content;
            return;
        }
        messageDiv.classList.remove('loading');
        if (window.messageFormatter) {
            window.messageFormatter.renderInto(messageDiv, {
                role,
                content,
                style,
                thinkingVisibility: panel._thinkingVisibility || 'show'
            });
            return;
        }
        messageDiv.textContent = String(content || '');
    }

    function getMessagesContainer() {
        return document.getElementById('messages-container');
    }

    function isNearBottom(container) {
        if (!container) return true;
        const distance = container.scrollHeight - (container.scrollTop + container.clientHeight);
        return distance <= 48;
    }

    function shouldAutoScroll(panel, force = false) {
        if (force) return true;
        const tab = panel.activeTabId ? panel.chatTabs.get(panel.activeTabId) : null;
        if (tab && tab.followOutput === false) {
            return false;
        }
        return isNearBottom(getMessagesContainer());
    }

    function storeActiveTabScrollState(panel) {
        if (!panel.activeTabId || !panel.chatTabs.has(panel.activeTabId)) {
            return;
        }
        const container = getMessagesContainer();
        if (!container) {
            return;
        }
        const tab = panel.chatTabs.get(panel.activeTabId);
        tab.scrollTop = container.scrollTop;
        tab.followOutput = isNearBottom(container);
    }

    function scrollMessagesToLatest(panel, force = false) {
        if (panel._suspendMessageAutoscroll) {
            return;
        }
        const container = getMessagesContainer();
        if (!container) {
            return;
        }
        if (!force && !shouldAutoScroll(panel, false)) {
            storeActiveTabScrollState(panel);
            return;
        }
        container.scrollTop = container.scrollHeight;
        storeActiveTabScrollState(panel);
    }

    function shouldIgnorePagingTarget(target) {
        if (!target) return false;
        const tagName = target.tagName ? target.tagName.toLowerCase() : '';
        return tagName === 'input'
            || tagName === 'textarea'
            || tagName === 'select'
            || target.isContentEditable === true;
    }

    function pageDownMessages(panel) {
        const container = getMessagesContainer();
        if (!container) {
            return;
        }
        const increment = Math.max(container.clientHeight - 72, 120);
        container.scrollTop = Math.min(container.scrollTop + increment, container.scrollHeight);
        if (isNearBottom(container)) {
            container.scrollTop = container.scrollHeight;
        }
        storeActiveTabScrollState(panel);
    }

    global.LocalAgentMainPanelMessages = {
        addMessage,
        addMessageWithAttachment,
        getMessagesContainer,
        isNearBottom,
        openLightbox,
        pageDownMessages,
        removeMessage,
        renderMessageBody,
        scrollMessagesToLatest,
        shouldAutoScroll,
        shouldIgnorePagingTarget,
        storeActiveTabScrollState
    };
})(window);
