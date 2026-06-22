(function installContentViewerUtils(global) {
    function isFileTarget(value) {
        const clean = String(value || '').trim();
        return clean.startsWith('file://')
            || /^[a-zA-Z]:[\\/]/.test(clean)
            || clean.startsWith('\\\\')
            || clean.startsWith('/');
    }

    function filePathFromTarget(value) {
        const clean = String(value || '').trim();
        if (!clean.startsWith('file://')) return clean;

        try {
            const parsed = new URL(clean);
            const decodedPath = decodeURIComponent(parsed.pathname || '');
            if (parsed.hostname && parsed.hostname !== 'localhost') {
                return `\\\\${parsed.hostname}${decodedPath.replace(/\//g, '\\')}`;
            }
            return decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
        } catch {
            return clean.replace(/^file:\/+/, '');
        }
    }

    function fileUrlFromPath(value) {
        const clean = String(value || '').trim();
        if (!clean || clean.startsWith('file://')) return clean;

        const normalized = clean.replace(/\\/g, '/');
        if (/^[a-zA-Z]:\//.test(normalized)) {
            return `file:///${normalized}`;
        }
        if (normalized.startsWith('//')) {
            return `file://${normalized.slice(2)}`;
        }
        if (normalized.startsWith('/')) {
            return `file://${normalized}`;
        }
        return `file:///${normalized}`;
    }

    function attr(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function esc(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    function basicMarkdown(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    global.LocalAgentContentViewerUtils = {
        attr,
        basicMarkdown,
        esc,
        filePathFromTarget,
        fileUrlFromPath,
        isFileTarget
    };
})(window);
