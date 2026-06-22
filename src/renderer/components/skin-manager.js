class SkinManager {
    constructor() {
        this.storage = {
            enabled: 'skinSystemEnabled',
            activeSkin: 'activeSkinId',
            diagnostics: 'skinDiagnosticsHistory',
            skinThemes: 'skinThemePreferences',
            skinOrder: 'skinOrderPreference'
        };
        this.config = { skins: [] };
        this.contract = { requiredIds: [] };
        this.state = {
            enabled: false,
            skinId: 'default',
            loading: false,
            pendingApply: false,
            draggingSkinId: null,
            dragging: false
        };
        this.lastDiagnostics = null;
        this.themeObserver = null;
        this.themePreferences = {};
        this.silentMode = false;
    }
    async initialize() {
        this.bindElements();
        if (!this.elements.root) return;
        await this.loadConfigFiles();
        this.loadState();
        this.syncDevControlsVisibility();
        this.bindEvents();
        this.observeThemeChanges();
        await this.applySelectedSkin();
        this.render();
    }
    bindElements() {
        this.elements = {
            section: (typeof document.querySelector === 'function')
                ? document.querySelector('.skin-settings-section')
                : null,
            root: document.getElementById('skin-picker'),
            status: document.getElementById('skin-picker-status'),
            enabled: document.getElementById('skin-feature-enabled'),
            addBtn: document.getElementById('skin-add-btn'),
            removeBtn: document.getElementById('skin-remove-btn'),
            themes: document.getElementById('skin-theme-options'),
            runAutoTest: document.getElementById('run-skin-autotest-btn'),
            runDiagnostics: document.getElementById('run-skin-diagnostics-btn'),
            diagnosticsOutput: document.getElementById('skin-diagnostics-output'),
            legacyThemePicker: document.getElementById('theme-picker')
        };
    }
    async loadConfigFiles() {
        try {
            const [manifestRes, contractRes] = await Promise.all([
                fetch('skins/manifest.json'),
                fetch('skins/contract.json')
            ]);
            if (manifestRes.ok) this.config = await manifestRes.json();
            if (contractRes.ok) this.contract = await contractRes.json();
            this.applyStoredOrderPreference();
        } catch (error) {
            console.error('[SkinManager] Failed to load skin configs', error);
        }
    }
    applyStoredOrderPreference() {
        const order = this.readStoredJson(this.storage.skinOrder, []);
        if (!Array.isArray(order) || order.length === 0) {
            return;
        }
        const skins = Array.isArray(this.config.skins) ? this.config.skins.slice() : [];
        if (skins.length === 0) return;
        const map = new Map(skins.map((skin) => [skin.id, skin]));
        const ordered = [];
        for (const skinId of order) {
            if (!map.has(skinId)) continue;
            ordered.push(map.get(skinId));
            map.delete(skinId);
        }
        for (const skin of skins) {
            if (map.has(skin.id)) {
                ordered.push(skin);
            }
        }
        this.config.skins = ordered;
    }
    loadState() {
        this.state.enabled = this.readStoredBoolean(this.storage.enabled, false);
        this.state.skinId = localStorage.getItem(this.storage.activeSkin) || this.config.defaultSkinId || 'default';
        this.themePreferences = this.readStoredJson(this.storage.skinThemes, {});
        if (this.elements.enabled) {
            this.elements.enabled.checked = this.state.enabled;
        }
        this.persistCompanionUiState();
    }

    persistCompanionUiState() {
        const theme = this.getTheme();
        const skinTheme = this.themePreferences?.[this.state.skinId] || theme;
        const saveOps = [window.electronAPI?.saveSetting?.('ui.skin.enabled', String(this.state.enabled)), window.electronAPI?.saveSetting?.('ui.skin.id', this.state.skinId || 'default'), window.electronAPI?.saveSetting?.('ui.skin.theme', skinTheme), window.electronAPI?.saveSetting?.('ui.theme', theme)].filter(Boolean);
        Promise.allSettled(saveOps).finally(() => { Promise.resolve(window.electronAPI?.companion?.notifyStateChanged?.('ui', { keys: ['ui.skin.enabled', 'ui.skin.id', 'ui.skin.theme', 'ui.theme'] })).catch(() => {}); });
    }
    readStoredBoolean(key, fallback = false) {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        return value === 'true';
    }
    readStoredJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            console.warn(`[SkinManager] Failed to parse ${key}:`, error);
            return fallback;
        }
    }
    shouldShowAutoTestButton() {
        const forcedVisible = this.readStoredBoolean('skinDevTools', false);
        const argv = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : [];
        return forcedVisible || argv.includes('--skintest') || argv.includes('--testclient');
    }
    syncDevControlsVisibility() {
        if (!this.elements.runAutoTest) return;
        this.elements.runAutoTest.hidden = !this.shouldShowAutoTestButton();
    }
    bindEvents() {
        if (this.elements.enabled) {
            this.elements.enabled.addEventListener('change', async (e) => {
                this.state.enabled = e.target.checked;
                localStorage.setItem(this.storage.enabled, String(this.state.enabled));
                this.persistCompanionUiState();
                await this.applySelectedSkin();
                this.render();
            });
        }
        if (this.elements.root) {
            this.elements.root.addEventListener('click', async (e) => {
                const card = e.target.closest('.skin-card');
                if (!card) return;
                if (this.state.dragging) return;
                if (card.dataset.compatible !== 'true') {
                    this.setStatus(`"${card.dataset.skinName}" is layout-only and cannot be applied at runtime.`, 'warn');
                    return;
                }
                if (!this.state.enabled) {
                    this.state.enabled = true;
                    localStorage.setItem(this.storage.enabled, 'true');
                    if (this.elements.enabled) {
                        this.elements.enabled.checked = true;
                    }
                    this.setStatus('Skin system enabled automatically.', 'ok');
                }
                const skinId = card.dataset.skinId;
                this.state.skinId = skinId;
                localStorage.setItem(this.storage.activeSkin, skinId);
                this.persistCompanionUiState();
                this.setStatus(`Applying "${card.dataset.skinName}"...`, 'info');
                await this.applySelectedSkin();
                this.render();
            });
            this.elements.root.addEventListener('dragstart', (e) => {
                const card = e.target.closest('.skin-card');
                if (!card) return;
                this.state.draggingSkinId = card.dataset.skinId || null;
                this.state.dragging = true;
                card.classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', this.state.draggingSkinId || '');
                }
            });
            this.elements.root.addEventListener('dragover', (e) => {
                const target = e.target.closest('.skin-card');
                if (!target || !this.state.draggingSkinId) return;
                e.preventDefault();
                this.elements.root.querySelectorAll('.skin-card.drag-over').forEach((node) => node.classList.remove('drag-over'));
                target.classList.add('drag-over');
            });
            this.elements.root.addEventListener('dragleave', (e) => {
                const card = e.target.closest('.skin-card');
                if (card) {
                    card.classList.remove('drag-over');
                }
            });
            this.elements.root.addEventListener('drop', async (e) => {
                const target = e.target.closest('.skin-card');
                const sourceId = this.state.draggingSkinId;
                if (!target || !sourceId) return;
                e.preventDefault();
                const targetId = target.dataset.skinId || '';
                this.clearDragClasses();
                await this.reorderSkins(sourceId, targetId);
            });
            this.elements.root.addEventListener('dragend', () => {
                this.clearDragClasses();
            });
        }
        if (this.elements.section) {
            this.elements.section.addEventListener('dragenter', (e) => {
                if (!this.hasFilePayload(e)) return;
                e.preventDefault();
                this.elements.section.classList.add('skin-drop-active');
                this.setStatus('Drop skin folder here to import.', 'info');
            });
            this.elements.section.addEventListener('dragover', (e) => {
                if (!this.hasFilePayload(e)) return;
                e.preventDefault();
            });
            this.elements.section.addEventListener('dragleave', (e) => {
                if (!this.elements.section) return;
                if (e.target === this.elements.section) {
                    this.elements.section.classList.remove('skin-drop-active');
                }
            });
            this.elements.section.addEventListener('drop', async (e) => {
                if (!this.hasFilePayload(e)) return;
                e.preventDefault();
                this.elements.section.classList.remove('skin-drop-active');
                await this.handleDroppedSkin(e);
            });
        }
        if (this.elements.addBtn) {
            this.elements.addBtn.addEventListener('click', async () => {
                await this.handleAddSkin();
            });
        }
        if (this.elements.removeBtn) {
            this.elements.removeBtn.addEventListener('click', async () => {
                await this.handleRemoveSkin();
            });
        }
        if (this.elements.themes) {
            this.elements.themes.addEventListener('click', (e) => {
                const btn = e.target.closest('.skin-theme-pill');
                if (!btn || !this.state.enabled) return;
                this.setTheme(btn.dataset.themeId);
            });
        }
        if (this.elements.runDiagnostics) {
            this.elements.runDiagnostics.addEventListener('click', () => {
                const report = this.runDiagnostics();
                if (!this.elements.diagnosticsOutput) return;
                this.elements.diagnosticsOutput.classList.add('visible');
                this.elements.diagnosticsOutput.textContent = JSON.stringify(report, null, 2);
            });
        }
        if (this.elements.runAutoTest) {
            this.elements.runAutoTest.addEventListener('click', async () => {
                const result = await this.runAutoTest();
                if (!this.elements.diagnosticsOutput) return;
                this.elements.diagnosticsOutput.classList.add('visible');
                this.elements.diagnosticsOutput.textContent = JSON.stringify(result, null, 2);
            });
        }
    }
    observeThemeChanges() {
        if (this.themeObserver) return;
        this.themeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'data-theme') {
                    this.onThemeChanged().catch((error) => { this.logDiagnostic('warn', `Theme observer apply failed: ${error.message}`); this.setStatus(`Theme apply issue: ${error.message}`, 'warn'); });
                }
            }
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    async onThemeChanged() {
        const currentTheme = this.getTheme();
        document.documentElement.setAttribute('data-skin-theme-token', currentTheme);
        if (!this.state.enabled) return;
        if (this.state.loading) { this.state.pendingApply = true; return; }
        const skin = this.getSkin(this.state.skinId);
        if (!skin || skin.id === 'default') return;
        const supported = skin.supportedThemes || [];
        if (!supported.includes(currentTheme)) {
            const fallback = skin.defaultTheme || supported[0] || 'dark';
            if (currentTheme !== fallback) {
                this.logDiagnostic('warn', `Theme "${currentTheme}" not supported by ${skin.id}; switched to "${fallback}"`);
                this.setTheme(fallback);
            }
            return;
        }
        await this.loadThemeStylesheet(skin.id, currentTheme); this.renderThemePills();
    }
    getTheme() {
        return document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
    }
    setTheme(themeId) {
        document.documentElement.setAttribute('data-theme', themeId);
        document.documentElement.setAttribute('data-skin-theme-token', themeId);
        localStorage.setItem('theme', themeId);
        if (this.state.enabled && this.state.skinId) {
            this.themePreferences[this.state.skinId] = themeId;
            localStorage.setItem(this.storage.skinThemes, JSON.stringify(this.themePreferences));
        }
        this.persistCompanionUiState();
        document.querySelectorAll('.theme-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.theme === themeId);
        });
        this.renderThemePills();
    }
    getSkin(id) {
        return (this.config.skins || []).find((skin) => skin.id === id);
    }
    clearDragClasses() {
        this.state.draggingSkinId = null;
        this.state.dragging = false;
        if (!this.elements.root) return;
        this.elements.root.querySelectorAll('.skin-card.drag-over, .skin-card.dragging').forEach((node) => {
            node.classList.remove('drag-over', 'dragging');
        });
    }
    async reorderSkins(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }
        const skins = (this.config.skins || []).slice();
        const sourceIndex = skins.findIndex((skin) => skin.id === sourceId);
        const targetIndex = skins.findIndex((skin) => skin.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) {
            return;
        }
        const [moved] = skins.splice(sourceIndex, 1);
        skins.splice(targetIndex, 0, moved);
        this.config.skins = skins;
        await this.persistSkinManifest('Skin order updated.');
        this.render();
    }
    async handleAddSkin() {
        if (typeof document === 'undefined') return;
        const input = document.createElement('input');
        input.type = 'file';
        input.setAttribute('webkitdirectory', 'true');
        input.setAttribute('directory', 'true');
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', async () => {
            try {
                const files = Array.from(input.files || []);
                if (files.length === 0) {
                    this.setStatus('Skin import canceled.', 'info');
                    return;
                }
                const folderPath = this.resolveSelectedFolderPath(files);
                if (!folderPath) {
                    this.setStatus('Unable to read selected folder path.', 'error');
                    return;
                }
                await this.importSkinFolder(folderPath);
            } finally {
                input.remove();
            }
        }, { once: true });
        input.click();
    }
    async handleRemoveSkin() {
        const skin = this.getSkin(this.state.skinId);
        if (!skin) {
            this.setStatus('No skin selected.', 'warn');
            return;
        }
        if (skin.id === (this.config.defaultSkinId || 'default')) {
            this.setStatus('Default skin cannot be removed.', 'warn');
            return;
        }
        const accepted = window.confirm(`Remove skin "${skin.name}"? This deletes its folder from skins.`);
        if (!accepted) {
            this.setStatus('Skin removal canceled.', 'info');
            return;
        }
        await this.removeSkinById(skin.id);
    }
    resolveSelectedFolderPath(files) {
        if (!files.length) return null;
        const first = files[0];
        const fullPath = first.path || '';
        const relative = first.webkitRelativePath || '';
        if (!fullPath) return null;
        if (!relative || typeof require !== 'function') {
            return typeof require === 'function'
                ? require('path').dirname(fullPath)
                : null;
        }
        const nodePath = require('path');
        const rootPart = relative.split('/')[0];
        return nodePath.join(nodePath.dirname(fullPath), rootPart);
    }
    hasFilePayload(event) {
        const types = event?.dataTransfer?.types;
        if (!types) return false;
        return Array.from(types).includes('Files');
    }
    resolveDropFolderPath(dataTransfer) {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) return null;
        const files = Array.from(dataTransfer?.files || []);
        if (!files.length) return null;
        for (const file of files) {
            const rawPath = String(file.path || '').trim();
            if (!rawPath) continue;
            try {
                const stat = nodeFs.statSync(rawPath);
                if (stat.isDirectory()) return rawPath;
                if (stat.isFile()) return nodePath.dirname(rawPath);
            } catch (_) {
                // Continue probing other dropped entries.
            }
        }
        return null;
    }
    getNodeFs() {
        return typeof require === 'function' ? require('fs') : null;
    }
    getNodePath() {
        return typeof require === 'function' ? require('path') : null;
    }
    getSkinsRootDir() {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodePath || !nodeFs) return null;
        const candidates = [];
        if (typeof __dirname === 'string' && __dirname) {
            // Runtime packaging can place this file in different folders.
            candidates.push(nodePath.resolve(__dirname, '../skins'));
            candidates.push(nodePath.resolve(__dirname, 'skins'));
        }
        if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
            candidates.push(nodePath.resolve(process.cwd(), 'src', 'renderer', 'skins'));
            candidates.push(nodePath.resolve(process.cwd(), 'src', 'skins'));
        }
        for (const dir of candidates) {
            try {
                if (!nodeFs.existsSync(dir)) continue;
                const manifestPath = nodePath.join(dir, 'manifest.json');
                const contractPath = nodePath.join(dir, 'contract.json');
                if (nodeFs.existsSync(manifestPath) || nodeFs.existsSync(contractPath)) {
                    return dir;
                }
            } catch (_) {
                // Keep probing.
            }
        }
        for (const dir of candidates) {
            try {
                if (nodeFs.existsSync(dir)) return dir;
            } catch (_) {
                // Keep probing.
            }
        }
        return candidates[0] || null;
    }
    toSkinTitle(id) {
        return String(id || '')
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Imported Skin';
    }
    slugifySkinId(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || `skin-${Date.now()}`;
    }
    ensureUniqueSkinId(baseId) {
        const existing = new Set((this.config.skins || []).map((skin) => skin.id));
        if (!existing.has(baseId)) return baseId;
        let index = 2;
        while (existing.has(`${baseId}-${index}`)) index++;
        return `${baseId}-${index}`;
    }
    detectThemesFromFolder(skinDir) {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) return ['light', 'solar', 'dark'];
        const themesDir = nodePath.join(skinDir, 'themes');
        if (!nodeFs.existsSync(themesDir)) return ['light', 'solar', 'dark'];
        const themes = nodeFs.readdirSync(themesDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
            .map((entry) => entry.name.replace(/\.css$/i, ''))
            .filter(Boolean);
        return themes.length ? themes : ['light', 'solar', 'dark'];
    }
    async importSkinFolder(sourceDir) {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) {
            this.setStatus('Skin import is unavailable in this runtime.', 'error');
            return;
        }
        const source = nodePath.resolve(String(sourceDir || ''));
        const skinCss = nodePath.join(source, 'skin.css');
        if (!nodeFs.existsSync(skinCss)) {
            this.setStatus('Selected folder must include skin.css.', 'error');
            return;
        }
        const skinsRoot = this.getSkinsRootDir();
        if (!skinsRoot) {
            this.setStatus('Cannot resolve skins directory.', 'error');
            return;
        }
        let meta = {};
        const metaPath = nodePath.join(source, 'skin.json');
        if (nodeFs.existsSync(metaPath)) {
            try {
                meta = JSON.parse(nodeFs.readFileSync(metaPath, 'utf-8'));
            } catch (error) {
                this.setStatus(`Invalid skin.json: ${error.message}`, 'error');
                return;
            }
        }
        const folderName = nodePath.basename(source);
        const candidateId = this.slugifySkinId(meta.id || folderName);
        const skinId = this.ensureUniqueSkinId(candidateId);
        const targetDir = nodePath.join(skinsRoot, skinId);
        if (nodeFs.existsSync(targetDir)) {
            this.setStatus(`Skin folder already exists: ${skinId}`, 'error');
            return;
        }
        nodeFs.cpSync(source, targetDir, { recursive: true });
        const supportedThemes = Array.isArray(meta.supportedThemes) && meta.supportedThemes.length
            ? meta.supportedThemes.map((theme) => String(theme))
            : this.detectThemesFromFolder(targetDir);
        const defaultTheme = supportedThemes.includes(meta.defaultTheme)
            ? meta.defaultTheme
            : (supportedThemes[0] || 'light');
        const entry = {
            id: skinId,
            name: String(meta.name || this.toSkinTitle(skinId)),
            compatible: meta.compatible !== false,
            description: String(meta.description || 'Imported custom skin.'),
            supportedThemes,
            defaultTheme,
            themeLabels: (meta.themeLabels && typeof meta.themeLabels === 'object')
                ? meta.themeLabels
                : Object.fromEntries(supportedThemes.map((theme) => [theme, this.toSkinTitle(theme)])),
            preview: (meta.preview && typeof meta.preview === 'object')
                ? meta.preview
                : {
                    base: '#202020',
                    sidebar: '#2a2a2a',
                    accent: '#3b82f6'
                }
        };
        this.config.skins = [...(this.config.skins || []), entry];
        await this.persistSkinManifest(`Skin "${entry.name}" added.`);
        this.state.skinId = entry.id;
        localStorage.setItem(this.storage.activeSkin, this.state.skinId);
        if (!this.state.enabled) {
            this.state.enabled = true;
            localStorage.setItem(this.storage.enabled, 'true');
            if (this.elements.enabled) this.elements.enabled.checked = true;
        }
        await this.applySelectedSkin();
        this.render();
    }
    validateSkinFolder(sourceDir) {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) {
            return { ok: false, reason: 'Skin import is unavailable in this runtime.' };
        }
        const source = nodePath.resolve(String(sourceDir || ''));
        if (!nodeFs.existsSync(source)) {
            return { ok: false, reason: 'Dropped path does not exist.' };
        }
        const sourceStat = nodeFs.statSync(source);
        if (!sourceStat.isDirectory()) {
            return { ok: false, reason: 'Drop a folder or a file inside a skin folder.' };
        }
        const skinCssPath = nodePath.join(source, 'skin.css');
        if (!nodeFs.existsSync(skinCssPath)) {
            return { ok: false, reason: 'skin.css is required in the root of the skin folder.' };
        }
        const skinCssStat = nodeFs.statSync(skinCssPath);
        if (skinCssStat.size > 1024 * 1024) {
            return { ok: false, reason: 'skin.css is too large (>1MB).' };
        }
        const metaPath = nodePath.join(source, 'skin.json');
        let meta = null;
        if (nodeFs.existsSync(metaPath)) {
            try {
                meta = JSON.parse(nodeFs.readFileSync(metaPath, 'utf-8'));
            } catch (error) {
                return { ok: false, reason: `skin.json is invalid JSON: ${error.message}` };
            }
            if (meta && typeof meta !== 'object') {
                return { ok: false, reason: 'skin.json must be an object.' };
            }
            if (meta?.id && typeof meta.id !== 'string') {
                return { ok: false, reason: 'skin.json.id must be a string when present.' };
            }
            if (meta?.name && typeof meta.name !== 'string') {
                return { ok: false, reason: 'skin.json.name must be a string when present.' };
            }
        }
        const themes = this.detectThemesFromFolder(source);
        return {
            ok: true,
            folderName: nodePath.basename(source),
            meta,
            themeCount: themes.length
        };
    }
    async handleDroppedSkin(event) {
        const folderPath = this.resolveDropFolderPath(event?.dataTransfer);
        if (!folderPath) {
            this.setStatus('No valid file/folder path found in drop payload.', 'warn');
            return;
        }
        const verdict = this.validateSkinFolder(folderPath);
        if (!verdict.ok) {
            this.setStatus(`Rejected dropped skin: ${verdict.reason}`, 'error');
            return;
        }
        const proposedName = verdict.meta?.name || verdict.folderName;
        const proceed = window.confirm(
            `Import skin "${proposedName}"?\n` +
            `Folder: ${folderPath}\n` +
            `Checks passed: skin.css present, JSON valid, themes detected (${verdict.themeCount}).`
        );
        if (!proceed) {
            this.setStatus('Skin import canceled.', 'info');
            return;
        }
        await this.importSkinFolder(folderPath);
    }
    async removeSkinById(skinId) {
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) {
            this.setStatus('Skin removal is unavailable in this runtime.', 'error');
            return;
        }
        const target = this.getSkin(skinId);
        if (!target) {
            this.setStatus(`Skin "${skinId}" not found.`, 'warn');
            return;
        }
        const skinsRoot = this.getSkinsRootDir();
        const skinDir = nodePath.join(skinsRoot, skinId);
        if (nodeFs.existsSync(skinDir)) {
            nodeFs.rmSync(skinDir, { recursive: true, force: true });
        }
        this.config.skins = (this.config.skins || []).filter((skin) => skin.id !== skinId);
        if (this.state.skinId === skinId) {
            this.state.skinId = this.config.defaultSkinId || 'default';
            localStorage.setItem(this.storage.activeSkin, this.state.skinId);
            await this.applySelectedSkin();
        }
        await this.persistSkinManifest(`Skin "${target.name}" removed.`);
        this.render();
    }
    async persistSkinManifest(successMessage = 'Skin manifest updated.') {
        const skins = Array.isArray(this.config.skins) ? this.config.skins : [];
        localStorage.setItem(this.storage.skinOrder, JSON.stringify(skins.map((skin) => skin.id)));
        const nodeFs = this.getNodeFs();
        const nodePath = this.getNodePath();
        if (!nodeFs || !nodePath) {
            this.setStatus(`${successMessage} Saved in this browser profile.`, 'ok');
            return;
        }
        try {
            const skinsRoot = this.getSkinsRootDir();
            if (!skinsRoot) {
                this.setStatus(`${successMessage} Cannot resolve skins directory.`, 'warn');
                return;
            }
            nodeFs.mkdirSync(skinsRoot, { recursive: true });
            const manifestPath = nodePath.join(skinsRoot, 'manifest.json');
            const payload = {
                version: Number(this.config.version) || 1,
                defaultSkinId: this.config.defaultSkinId || 'default',
                skins
            };
            nodeFs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
            this.setStatus(successMessage, 'ok');
        } catch (error) {
            this.setStatus(`${successMessage} Manifest write failed: ${error.message}`, 'warn');
        }
    }
    async applySelectedSkin() {
        if (this.state.loading) {
            this.state.pendingApply = true;
            return;
        }
        this.state.loading = true;
        this.state.pendingApply = false;
        try {
            if (!this.state.enabled) {
                await this.disableSkinSystem();
                return;
            }
            const selected = this.getSkin(this.state.skinId) || this.getSkin(this.config.defaultSkinId || 'default');
            if (!selected) return;
            if (!selected.compatible) {
                this.setStatus(`"${selected.name}" is a layout prototype and not runtime-compatible.`);
                this.state.skinId = this.config.defaultSkinId || 'default';
                localStorage.setItem(this.storage.activeSkin, this.state.skinId);
            }
            const finalSkin = this.getSkin(this.state.skinId);
            await this.applySkin(finalSkin);
        } finally {
            this.state.loading = false;
            if (this.state.pendingApply) {
                this.state.pendingApply = false;
                await this.applySelectedSkin();
            }
        }
    }
    async applySkin(skin) {
        if (!skin) return;
        if (skin.id === 'default') {
            this.clearSkinStyles();
            document.documentElement.setAttribute('data-active-skin', 'default');
            document.documentElement.setAttribute('data-skin-contract-token', 'default');
            document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
            this.setStatus('Default skin active. Existing theme system remains unchanged.', 'ok');
            this.runDiagnostics();
            return;
        }
        const currentTheme = this.getTheme();
        const supported = skin.supportedThemes || [];
        const preferredTheme = this.themePreferences[skin.id];
        const themeCandidate = preferredTheme || currentTheme;
        const theme = supported.includes(themeCandidate) ? themeCandidate : (skin.defaultTheme || supported[0] || 'dark');
        if (theme !== currentTheme) this.setTheme(theme);
        try {
            await this.loadStylesheet('active-skin-link', `skins/${skin.id}/skin.css`);
            document.documentElement.setAttribute('data-active-skin', skin.id);
            document.documentElement.setAttribute('data-skin-contract-token', skin.id);
            await this.loadThemeStylesheet(skin.id, theme);
            document.documentElement.setAttribute('data-skin-theme-token', theme);
            this.setStatus('', 'info');
            this.logDiagnostic('info', `Applied skin "${skin.id}" with theme "${theme}"`);
        } catch (error) {
            this.clearSkinStyles();
            document.documentElement.setAttribute('data-active-skin', 'default');
            document.documentElement.setAttribute('data-skin-contract-token', 'default');
            document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
            this.state.skinId = this.config.defaultSkinId || 'default';
            localStorage.setItem(this.storage.activeSkin, this.state.skinId);
            this.setStatus(`Failed to load skin. Reverted to default. ${error.message}`, 'error');
            this.logDiagnostic('error', `Skin load failed: ${error.message}`);
        }
        this.runDiagnostics();
    }
    async loadThemeStylesheet(skinId, themeId) {
        await this.loadStylesheet('active-skin-theme-link', `skins/${skinId}/themes/${themeId}.css`);
    }
    loadStylesheet(linkId, href) {
        this._stylesheetInflight = this._stylesheetInflight || new Map();
        const active = this._stylesheetInflight.get(linkId);
        if (active && active.sourceHref === href) return active.promise;
        this._stylesheetVersion = (this._stylesheetVersion || 0) + 1;
        const nextHref = `${href}${href.includes('?') ? '&' : '?'}v=${this._stylesheetVersion}`;
        const current = document.getElementById(linkId);
        let promise;
        let trackedPromise;
        promise = new Promise((resolve, reject) => {
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = nextHref;
            const isCurrent = () => this._stylesheetInflight.get(linkId)?.promise === trackedPromise;
            const cleanup = () => { clearTimeout(timer); clearInterval(poll); link.removeEventListener('load', done); link.removeEventListener('error', fail); };
            const done = () => { cleanup(); if (!isCurrent()) { link.remove(); resolve(); return; } if (current && current !== link) current.remove(); link.id = linkId; link.dataset.loadedHref = nextHref; link.dataset.sourceHref = href; resolve(); };
            const fail = () => { cleanup(); link.remove(); if (!isCurrent()) { resolve(); return; } reject(new Error(`Unable to load ${href}`)); };
            const poll = setInterval(() => { if (link.sheet) done(); }, 60);
            const timer = setTimeout(() => { cleanup(); link.remove(); if (!isCurrent()) { resolve(); return; } reject(new Error(`Timed out loading ${href}`)); }, 4500);
            link.addEventListener('load', done, { once: true }); link.addEventListener('error', fail, { once: true });
            document.head.appendChild(link);
        });
        trackedPromise = promise.finally(() => { if (this._stylesheetInflight.get(linkId)?.promise === trackedPromise) this._stylesheetInflight.delete(linkId); });
        this._stylesheetInflight.set(linkId, { href: nextHref, sourceHref: href, promise: trackedPromise });
        return trackedPromise;
    }
    clearSkinStyles() {
        ['active-skin-link', 'active-skin-theme-link'].forEach((id) => {
            const node = document.getElementById(id);
            if (node) node.remove();
        });
    }
    async disableSkinSystem() {
        this.clearSkinStyles();
        document.documentElement.setAttribute('data-active-skin', 'default');
        document.documentElement.setAttribute('data-skin-contract-token', 'default');
        document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
        this.setStatus('Skin system disabled. Current default UI is untouched.', 'info');
        this.runDiagnostics();
    }
    setStatus(text, level = 'info') {
        if (this.silentMode) return;
        if (this.elements.status) {
            this.elements.status.textContent = text;
            this.elements.status.classList.remove('ok', 'warn', 'error', 'info');
            this.elements.status.classList.add(level);
        }
    }
    render() {
        if (!this.state.enabled) {
            this.setStatus('Skin system is OFF. Click a compatible skin to enable and apply instantly.', 'info');
        }
        this.renderActionButtons();
        this.renderSkinCards();
        this.renderThemePills();
    }
    renderActionButtons() {
        if (this.elements.addBtn) {
            this.elements.addBtn.disabled = false;
        }
        if (!this.elements.removeBtn) return;
        const skin = this.getSkin(this.state.skinId);
        const isDefault = !skin || skin.id === (this.config.defaultSkinId || 'default');
        this.elements.removeBtn.disabled = isDefault;
        this.elements.removeBtn.title = isDefault
            ? 'Default skin cannot be removed'
            : `Remove "${skin.name}"`;
    }
    renderSkinCards() {
        if (!this.elements.root) return;
        const skins = this.config.skins || [];
        this.elements.root.innerHTML = skins.map((skin) => {
            const isActive = this.state.skinId === skin.id;
            const compatibilityClass = skin.compatible ? 'ok' : 'no';
            const compatibleText = skin.compatible ? 'compatible' : 'layout-only';
            const cardClass = `skin-card${isActive ? ' active' : ''}${skin.compatible ? '' : ' incompatible'}`;
            const preview = skin.preview || {};
            const compatibleTitle = skin.compatible ? 'Ready for runtime apply' : 'Not runtime-compatible yet';
            const description = String(skin.description || '').trim();
            return `
                <button
                    class="${cardClass}"
                    type="button"
                    draggable="true"
                    data-skin-id="${skin.id}"
                    data-skin-name="${skin.name}"
                    data-compatible="${skin.compatible}"
                    title="${description ? `${description} • ` : ''}${compatibleTitle} (drag to reorder)">
                    <div class="skin-preview" style="background:${preview.base || 'var(--card-bg)'};--preview-sidebar:${preview.sidebar || 'rgba(0,0,0,0.04)'};--preview-accent:${preview.accent || '#999'};"></div>
                    <div class="skin-card-header">
                        <span class="skin-name">${skin.name}</span>
                        <span class="skin-compat ${compatibilityClass}">${compatibleText}</span>
                    </div>
                </button>
            `;
        }).join('');
    }
    renderThemePills() {
        if (!this.elements.themes) return;
        const skin = this.getSkin(this.state.skinId) || this.getSkin(this.config.defaultSkinId || 'default');
        if (!skin) return;
        const theme = this.getTheme();
        const themes = skin.supportedThemes || ['light', 'solar', 'dark'];
        this.elements.themes.innerHTML = themes.map((themeId) => {
            const active = themeId === theme ? ' active' : '';
            const label = this.getThemeLabel(skin, themeId);
            const disabled = this.state.enabled ? '' : ' disabled';
            return `<button type="button" class="skin-theme-pill${active}" data-theme-id="${themeId}"${disabled}>${label}</button>`;
        }).join('');
    }
    getThemeLabel(skin, themeId) {
        return (skin.themeLabels && skin.themeLabels[themeId]) || themeId;
    }
    runDiagnostics() {
        const activeSkin = document.documentElement.getAttribute('data-active-skin') || 'default';
        const expectedIds = this.contract.requiredIds || [];
        const missingIds = expectedIds.filter((id) => !document.getElementById(id));
        const rootStyles = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
        const requiredThemeTokens = Array.isArray(this.contract.requiredThemeTokens) ? this.contract.requiredThemeTokens : [];
        const requiredUiTokens = Array.isArray(this.contract.requiredUiTokens) ? this.contract.requiredUiTokens : [];
        const requiredAliasTokens = Array.isArray(this.contract.requiredAliasTokens) ? this.contract.requiredAliasTokens : [];
        const missingTokenList = (tokens = []) => (!rootStyles
            ? []
            : tokens.filter((token) => token && !rootStyles.getPropertyValue(token).trim()));
        const missingThemeTokens = missingTokenList(requiredThemeTokens);
        const missingUiTokens = missingTokenList(requiredUiTokens);
        const missingAliasTokens = missingTokenList(requiredAliasTokens);
        const skinToken = document.documentElement.getAttribute('data-skin-contract-token')
            || (rootStyles ? rootStyles.getPropertyValue('--skin-contract-id').trim() : '');
        const themeToken = document.documentElement.getAttribute('data-skin-theme-token')
            || (rootStyles ? rootStyles.getPropertyValue('--skin-theme-id').trim() : '');
        const hasRuntimeLinks = !!document.getElementById('active-skin-link') === !!document.getElementById('active-skin-theme-link');
        const currentTheme = this.getTheme();
        const report = {
            ts: new Date().toISOString(),
            featureEnabled: this.state.enabled,
            activeSkin,
            dataTheme: currentTheme,
            tokens: {
                skinContractId: skinToken || null,
                skinThemeId: themeToken || null
            },
            checks: {
                missingRequiredDomIds: missingIds,
                missingRequiredThemeTokens: missingThemeTokens,
                missingRequiredUiTokens: missingUiTokens,
                missingRequiredAliasTokens: missingAliasTokens,
                runtimeStylesheetPairConsistent: hasRuntimeLinks
            }
        };
        const tokenMatches = activeSkin === 'default'
            ? (skinToken === 'default')
            : (skinToken === activeSkin && themeToken === currentTheme);
        report.ok = missingIds.length === 0
            && missingThemeTokens.length === 0
            && missingUiTokens.length === 0
            && missingAliasTokens.length === 0
            && hasRuntimeLinks
            && tokenMatches;
        this.lastDiagnostics = report;
        this.persistDiagnostics(report);
        if (this.elements.diagnosticsOutput && this.elements.diagnosticsOutput.classList.contains('visible')) {
            this.elements.diagnosticsOutput.textContent = JSON.stringify(report, null, 2);
        }
        if (this.state.enabled && !report.ok) {
            this.setStatus('Skin diagnostics found issues. See diagnostics output.', 'warn');
        }
        return report;
    }
    persistDiagnostics(report) {
        this.logDiagnostic(report.ok ? 'info' : 'warn', `Skin diagnostics ${report.ok ? 'passed' : 'reported issues'}`);
    }
    logDiagnostic(level, message) {
        const entry = {
            ts: new Date().toISOString(),
            level,
            message
        };
        console[level === 'error' ? 'error' : 'log']('[SkinManager]', message);
        const history = JSON.parse(localStorage.getItem(this.storage.diagnostics) || '[]');
        history.push(entry);
        while (history.length > 50) history.shift();
        localStorage.setItem(this.storage.diagnostics, JSON.stringify(history));
        window.__skinDiagnostics = history;
    }
    async runAutoTest() {
        const startedAt = new Date().toISOString();
        const previousState = {
            enabled: this.state.enabled,
            skinId: this.state.skinId,
            theme: this.getTheme()
        };
        const compatibleSkins = (this.config.skins || []).filter((skin) => skin.compatible && skin.id !== 'default');
        const cases = [];
        this.silentMode = true;
        try {
            this.state.enabled = true;
            localStorage.setItem(this.storage.enabled, 'true');
            if (this.elements.enabled) this.elements.enabled.checked = true;
            for (const skin of compatibleSkins) {
                const themes = skin.supportedThemes || ['light', 'solar', 'dark'];
                for (const theme of themes) {
                    this.state.skinId = skin.id;
                    localStorage.setItem(this.storage.activeSkin, skin.id);
                    this.setTheme(theme);
                    await this.applySelectedSkin();
                    const report = this.runDiagnostics();
                    cases.push({
                        skin: skin.id,
                        theme,
                        ok: report.ok,
                        tokens: report.tokens,
                        checks: report.checks
                    });
                }
            }
        } finally {
            this.silentMode = false;
            this.state.enabled = previousState.enabled;
            if (this.elements.enabled) this.elements.enabled.checked = previousState.enabled;
            localStorage.setItem(this.storage.enabled, String(previousState.enabled));
            this.state.skinId = previousState.skinId;
            localStorage.setItem(this.storage.activeSkin, previousState.skinId);
            this.setTheme(previousState.theme);
            await this.applySelectedSkin();
            this.render();
        }
        const failed = cases.filter((item) => !item.ok);
        const summary = {
            ts: startedAt,
            tested: cases.length,
            passed: cases.length - failed.length,
            failed: failed.length,
            failures: failed,
            cases
        };
        this.setStatus(
            failed.length ? `Auto test failed in ${failed.length}/${cases.length} cases.` : `Auto test passed (${cases.length} cases).`,
            failed.length ? 'warn' : 'ok'
        );
        return summary;
    }
}
window.skinManager = new SkinManager();
document.addEventListener('DOMContentLoaded', () => {
    window.skinManager.initialize().catch((error) => {
        console.error('[SkinManager] Initialization failed', error);
    });
});
