(function () {
    function isFileTarget(target) {
        const value = String(target || '').trim();
        return value.startsWith('file://')
            || /^[a-zA-Z]:[\\/]/.test(value)
            || value.startsWith('\\\\')
            || value.startsWith('/');
    }

    function isContentViewerTarget(target) {
        if (isFileTarget(target)) return true;
        try {
            const protocol = new URL(target).protocol.toLowerCase();
            return protocol === 'http:' || protocol === 'https:';
        } catch {
            return false;
        }
    }

    function openContentViewerTarget(target) {
        if (!target || !window.contentViewer) return false;
        const value = String(target).trim();
        if (!isContentViewerTarget(value)) return false;

        if (isFileTarget(value) && typeof window.contentViewer.openFile === 'function') {
            window.contentViewer.openFile(value);
        } else if (typeof window.contentViewer.openUrl === 'function') {
            window.contentViewer.openUrl(value);
        } else {
            return false;
        }
        return true;
    }

    if (typeof MainPanel !== 'undefined') {
        MainPanel.prototype._openContentViewerTarget = openContentViewerTarget;
        MainPanel.prototype._isContentViewerTarget = isContentViewerTarget;
        MainPanel.prototype._isFileTarget = isFileTarget;
    }

    window.MainPanelContentViewerLinks = {
        isFileTarget,
        isContentViewerTarget,
        openContentViewerTarget
    };
})();
