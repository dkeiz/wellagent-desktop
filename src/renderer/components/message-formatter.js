class MessageFormatter {
    renderInto(messageDiv, options = {}) {
        if (!messageDiv) return;

        const {
            role = 'assistant',
            content = '',
            style = null,
            thinkingVisibility = 'show'
        } = options;

        if (style === 'terminal') {
            messageDiv.textContent = String(content || '');
            return;
        }

        if (role === 'assistant') {
            messageDiv.innerHTML = this.renderAssistantContent(this.stripEmotionDirectives(content), thinkingVisibility);
            this.hydrateDynamicContent(messageDiv);
            return;
        }

        messageDiv.innerHTML = this.renderMarkdown(String(content || ''), {
            allowImages: role !== 'system'
        });
        this.hydrateDynamicContent(messageDiv);
    }

    renderAssistantContent(text, thinkingVisibility = 'show') {
        const content = String(text || '');
        const fragments = [];
        const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
        let match;
        let lastIndex = 0;

        while ((match = thinkRegex.exec(content)) !== null) {
            const before = content.slice(lastIndex, match.index).trim();
            if (before) {
                fragments.push(this.renderMarkdown(before, { allowImages: true }));
            }

            if (thinkingVisibility !== 'hide') {
                const summary = thinkingVisibility === 'show' ? '💭 Thinking' : '💭 Thinking...';
                const openAttr = thinkingVisibility === 'show' ? ' open' : '';
                fragments.push(
                    `<details class="thinking-block"${openAttr}>`
                    + `<summary>${this.escapeHtml(summary)}</summary>`
                    + `<div class="thinking-content">${this.renderPlainText(match[1].trim())}</div>`
                    + `</details>`
                );
            }

            lastIndex = match.index + match[0].length;
        }

        const remaining = content.slice(lastIndex).trim();
        if (remaining) {
            fragments.push(this.renderMarkdown(remaining, { allowImages: true }));
        }

        if (fragments.length === 0) {
            return this.renderMarkdown(content, { allowImages: true });
        }

        return fragments.join('');
    }

    stripEmotionDirectives(text) {
        if (window.PixelEmotionProtocol?.stripEmotionDirectives) {
            return window.PixelEmotionProtocol.stripEmotionDirectives(text);
        }
        return String(text || '').replace(/<!--\s*(?:emotion|mood)\s*(?::|=)\s*["']?[a-z][a-z0-9_-]*["']?\s*-->/gi, '').trim();
    }

    renderMarkdown(text, options = {}) {
        const placeholders = [];
        const stash = (html) => {
            const token = `@@FMT${placeholders.length}@@`;
            placeholders.push({ token, html });
            return token;
        };

        let content = String(text || '');
        const allowImages = options.allowImages === true;

        content = content.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = String(lang || '').toLowerCase();
            if (['chart', 'chart-json', 'agent-chart'].includes(language)) {
                return stash(
                    `<div class="agent-chart-host" data-agent-chart="${this.escapeAttribute(code.trim())}"></div>`
                );
            }
            return stash(
                `<pre><code class="language-${this.escapeAttribute(lang || 'text')}">`
                + `${this.escapeHtml(code.trim())}</code></pre>`
            );
        });

        if (allowImages) {
            content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
                const safeUrl = this.sanitizeUrl(url, { allowFile: true, allowDataImage: true });
                if (!safeUrl) {
                    return this.escapeHtml(match);
                }
                return stash(
                    `<img src="${this.escapeAttribute(safeUrl)}" alt="${this.escapeAttribute(alt || '')}"`
                    + ` class="chat-image" data-lightbox-src="${this.escapeAttribute(safeUrl)}" title="Click to enlarge">`
                );
            });
        }

        content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
            const safeUrl = this.sanitizeUrl(url, { allowFile: true, allowDataImage: false });
            if (!safeUrl) {
                return this.escapeHtml(label);
            }
            const viewerButton = this.isContentViewerUrl(safeUrl)
                ? `<button class="msg-open-in-viewer" data-url="${this.escapeAttribute(safeUrl)}" title="Open in content viewer">📄</button>`
                : '';
            return stash(
                `<a href="${this.escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">`
                + `${this.escapeHtml(label)}</a>`
                + viewerButton
            );
        });

        if (allowImages) {
            // Auto-render plain image URLs even when the model does not emit Markdown image syntax.
            content = content.replace(/(^|[\s(])((?:https?:\/\/|file:\/\/)[^\s<>"')]+)(?=[$\s),.!?;:])/gim, (match, prefix, url) => {
                if (!this._isLikelyImageUrl(url)) {
                    return match;
                }

                const safeUrl = this.sanitizeUrl(url, { allowFile: true, allowDataImage: true });
                if (!safeUrl) {
                    return match;
                }

                return `${prefix}${stash(
                    `<img src="${this.escapeAttribute(safeUrl)}" alt="Image"`
                    + ` class="chat-image" data-lightbox-src="${this.escapeAttribute(safeUrl)}" title="Click to enlarge">`
                )}`;
            });
        }

        content = content.replace(/`([^`]+)`/g, (match, code) => {
            return stash(`<code>${this.escapeHtml(code)}</code>`);
        });

        content = this.escapeHtml(content);
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        content = this.renderBlocks(content);

        placeholders.forEach(({ token, html }) => {
            content = content.split(token).join(html);
        });

        return content;
    }

    renderBlocks(text) {
        const lines = String(text || '').split('\n');
        const blocks = [];
        let paragraph = [];
        let listItems = [];
        let listTag = null;
        let quoteLines = [];

        const flushParagraph = () => {
            if (paragraph.length === 0) return;
            blocks.push(`<p>${paragraph.join('<br>')}</p>`);
            paragraph = [];
        };

        const flushList = () => {
            if (!listTag || listItems.length === 0) return;
            blocks.push(`<${listTag}>${listItems.join('')}</${listTag}>`);
            listItems = [];
            listTag = null;
        };

        const flushQuote = () => {
            if (quoteLines.length === 0) return;
            blocks.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`);
            quoteLines = [];
        };

        const flushAll = () => {
            flushParagraph();
            flushList();
            flushQuote();
        };

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            const trimmed = line.trim();

            if (!trimmed) {
                flushAll();
                continue;
            }

            if (/^@@FMT\d+@@$/.test(trimmed)) {
                flushAll();
                blocks.push(trimmed);
                continue;
            }

            const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
            if (headingMatch) {
                flushAll();
                const level = headingMatch[1].length;
                blocks.push(`<h${level}>${headingMatch[2]}</h${level}>`);
                continue;
            }

            const quoteMatch = trimmed.match(/^&gt;\s?(.*)$/);
            if (quoteMatch) {
                flushParagraph();
                flushList();
                quoteLines.push(quoteMatch[1]);
                continue;
            }

            const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
            if (unorderedMatch) {
                flushParagraph();
                flushQuote();
                if (listTag && listTag !== 'ul') flushList();
                listTag = 'ul';
                listItems.push(`<li>${unorderedMatch[1]}</li>`);
                continue;
            }

            const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
            if (orderedMatch) {
                flushParagraph();
                flushQuote();
                if (listTag && listTag !== 'ol') flushList();
                listTag = 'ol';
                listItems.push(`<li>${orderedMatch[1]}</li>`);
                continue;
            }

            flushList();
            flushQuote();
            paragraph.push(trimmed);
        }

        flushAll();
        return blocks.join('');
    }

    renderPlainText(text) {
        return this.escapeHtml(String(text || '')).replace(/\n/g, '<br>');
    }

    hydrateDynamicContent(root) {
        if (window.agentChartRenderer?.hydrate) {
            window.agentChartRenderer.hydrate(root);
        }
    }

    _isLikelyImageUrl(url) {
        const clean = String(url || '').trim();
        if (!clean) return false;

        // Common image extensions with optional query/hash.
        return /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(clean);
    }

    sanitizeUrl(url, options = {}) {
        const value = String(url || '').trim();
        if (!value) return null;

        if (options.allowDataImage && /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) {
            return value;
        }

        if (options.allowFile && value.startsWith('file://')) {
            return value;
        }

        try {
            const parsed = new URL(value);
            const protocol = parsed.protocol.toLowerCase();
            const allowed = ['http:', 'https:', 'mailto:'];
            if (options.allowFile) {
                allowed.push('file:');
            }
            if (!allowed.includes(protocol)) {
                return null;
            }
            return parsed.toString();
        } catch (error) {
            return null;
        }
    }

    isContentViewerUrl(url) {
        const value = String(url || '').trim();
        if (value.startsWith('file://')) return true;
        try {
            const protocol = new URL(value).protocol.toLowerCase();
            return protocol === 'http:' || protocol === 'https:';
        } catch {
            return false;
        }
    }

    escapeAttribute(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }
}

window.MessageFormatter = MessageFormatter;
window.messageFormatter = window.messageFormatter || new MessageFormatter();
