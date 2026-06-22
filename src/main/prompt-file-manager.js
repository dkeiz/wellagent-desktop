const fs = require('fs');
const path = require('path');
const { buildRuntimePaths } = require('./runtime-paths');
let app;
try { app = require('electron').app; } catch (_) { app = null; }

/**
 * PromptFileManager - Bidirectional sync between files and database for prompts/rules
 * 
 * File structure:
 *   agentin/prompts/
 *   ├── system.md              # Main system prompt
 *   └── rules/
 *       ├── 001-rule-name.md   # Individual rule files
 *       └── ...
 * 
 * Rule file format:
 *   ---
 *   name: Rule Name
 *   active: true
 *   priority: 1
 *   ---
 *   Rule content here...
 */
class PromptFileManager {
    constructor(db, basePath = null) {
        this.db = db;
        this.basePath = basePath || buildRuntimePaths().promptBasePath;
        this.systemPromptPath = path.join(this.basePath, 'system.md');
        this.rulesPath = path.join(this.basePath, 'rules');
        this.watchers = [];
        this.syncInProgress = false;
    }

    /**
     * Initialize the file structure and sync
     */
    async initialize() {
        // Ensure directories exist
        this.ensureDirectories();

        // Initial sync: prefer files if they exist, otherwise create from DB
        await this.syncFromFiles();

        // Start watching for changes
        this.startWatching();

        console.log('[PromptFileManager] Initialized at:', this.basePath);
    }

    ensureDirectories() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
        if (!fs.existsSync(this.rulesPath)) {
            fs.mkdirSync(this.rulesPath, { recursive: true });
        }
    }

    /**
     * Load system prompt from file, create from DB if doesn't exist
     */
    async loadSystemPrompt() {
        if (fs.existsSync(this.systemPromptPath)) {
            return fs.readFileSync(this.systemPromptPath, 'utf-8');
        }

        // Create from DB content
        const dbPrompt = await this.db.getSetting('system_prompt');
        const defaultPrompt = dbPrompt || 'You are a helpful AI assistant with access to various tools and functions.';

        await this.saveSystemPromptToFile(defaultPrompt);
        return defaultPrompt;
    }

    /**
     * Save system prompt to file and optionally to DB
     */
    async saveSystemPrompt(content, syncToDb = true) {
        await this.saveSystemPromptToFile(content);
        if (syncToDb) {
            await this.db.setSetting('system_prompt', content);
        }
    }

    async saveSystemPromptToFile(content) {
        fs.writeFileSync(this.systemPromptPath, content, 'utf-8');
    }

    /**
     * Parse YAML frontmatter from rule file
     */
    parseRuleFrontmatter(content) {
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
        const match = content.match(frontmatterRegex);

        if (!match) {
            return { metadata: {}, content: content.trim() };
        }

        const yamlSection = match[1];
        const ruleContent = match[2].trim();

        // Simple YAML parsing (key: value)
        const metadata = {};
        yamlSection.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();

                // Parse booleans and numbers
                if (value === 'true') value = true;
                else if (value === 'false') value = false;
                else if (!isNaN(value) && value !== '') value = Number(value);

                metadata[key] = value;
            }
        });

        return { metadata, content: ruleContent };
    }

    normalizeRuleActive(value, defaultValue = true) {
        if (value === undefined || value === null || value === '') {
            return Boolean(defaultValue);
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            return value !== 0;
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(normalized)) {
                return true;
            }
            if (['false', '0', 'no', 'off'].includes(normalized)) {
                return false;
            }
        }

        return Boolean(value);
    }

    /**
     * Generate YAML frontmatter for rule file
     */
    generateRuleFile(name, content, active = true, priority = 1) {
        const normalizedActive = this.normalizeRuleActive(active, true);
        const normalizedPriority = Number.isFinite(Number(priority)) ? Number(priority) : 1;
        return `---
name: ${name}
active: ${normalizedActive ? 'true' : 'false'}
priority: ${normalizedPriority}
---
${content}`;
    }

    /**
     * Get safe filename from rule name
     */
    getSafeFilename(name, priority = 1) {
        const safeName = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const paddedPriority = String(priority).padStart(3, '0');
        return `${paddedPriority}-${safeName}.md`;
    }

    /**
     * Load all rules from files
     */
    async loadRulesFromFiles() {
        const rules = [];

        if (!fs.existsSync(this.rulesPath)) {
            return rules;
        }

        const files = fs.readdirSync(this.rulesPath).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = path.join(this.rulesPath, file);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const { metadata, content } = this.parseRuleFrontmatter(fileContent);

            rules.push({
                filename: file,
                name: metadata.name || file.replace('.md', ''),
                content: content,
                active: this.normalizeRuleActive(metadata.active, true),
                priority: metadata.priority || 1,
                type: metadata.type || 'rule'
            });
        }

        return rules.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Save a rule to file
     */
    async saveRuleToFile(name, content, active = true, priority = 1, existingFilename = null) {
        const filename = existingFilename || this.getSafeFilename(name, priority);
        const filePath = path.join(this.rulesPath, filename);
        const fileContent = this.generateRuleFile(name, content, active, priority);

        fs.writeFileSync(filePath, fileContent, 'utf-8');
        return filename;
    }

    /**
     * Delete a rule file
     */
    deleteRuleFile(filename) {
        const filePath = path.join(this.rulesPath, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }

    /**
     * Sync files → DB (files are source of truth)
     */
    async syncFromFiles() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            // Sync system prompt
            const systemPrompt = await this.loadSystemPrompt();
            await this.db.setSetting('system_prompt', systemPrompt);

            // Sync rules
            const fileRules = await this.loadRulesFromFiles();
            const dbRules = await this.db.getPromptRules();

            // Create map of DB rules by name
            const dbRuleMap = new Map(dbRules.map(r => [r.name, r]));

            for (const fileRule of fileRules) {
                const existingRule = dbRuleMap.get(fileRule.name);

                if (existingRule) {
                    // Update existing rule
                    await this.db.updatePromptRule(existingRule.id, {
                        name: fileRule.name,
                        content: fileRule.content,
                        active: fileRule.active
                    });
                    dbRuleMap.delete(fileRule.name);
                } else {
                    // Create new rule
                    await this.db.addPromptRule({
                        name: fileRule.name,
                        content: fileRule.content,
                        type: fileRule.type
                    });
                    if (fileRule.active) {
                        const newRule = await this.db.get(
                            'SELECT id FROM prompt_rules WHERE name = ?',
                            [fileRule.name]
                        );
                        if (newRule) {
                            await this.db.togglePromptRule(newRule.id, true);
                        }
                    }
                }
            }

            console.log('[PromptFileManager] Synced from files:', fileRules.length, 'rules');
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Sync DB → files (DB is source of truth)
     */
    async syncToFiles() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            // Sync system prompt
            const dbPrompt = await this.db.getSetting('system_prompt');
            if (dbPrompt) {
                await this.saveSystemPromptToFile(dbPrompt);
            }

            // Sync rules
            const dbRules = await this.db.getPromptRules();

            // Clear existing rule files
            if (fs.existsSync(this.rulesPath)) {
                const existingFiles = fs.readdirSync(this.rulesPath).filter(f => f.endsWith('.md'));
                for (const file of existingFiles) {
                    fs.unlinkSync(path.join(this.rulesPath, file));
                }
            }

            // Write all DB rules to files
            for (let i = 0; i < dbRules.length; i++) {
                const rule = dbRules[i];
                await this.saveRuleToFile(
                    rule.name,
                    rule.content,
                    rule.active,
                    i + 1
                );
            }

            console.log('[PromptFileManager] Synced to files:', dbRules.length, 'rules');
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Start watching for file changes
     */
    startWatching() {
        // Debounce to avoid multiple syncs
        let debounceTimer = null;
        const debounceSync = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.syncFromFiles(), 500);
        };

        // Watch system.md
        if (fs.existsSync(this.systemPromptPath)) {
            const systemWatcher = fs.watch(this.systemPromptPath, debounceSync);
            this.watchers.push(systemWatcher);
        }

        // Watch rules directory
        if (fs.existsSync(this.rulesPath)) {
            const rulesWatcher = fs.watch(this.rulesPath, debounceSync);
            this.watchers.push(rulesWatcher);
        }
    }

    /**
     * Stop watching files
     */
    stopWatching() {
        this.watchers.forEach(w => w.close());
        this.watchers = [];
    }

    /**
     * Get paths for external access
     */
    getPaths() {
        return {
            base: this.basePath,
            systemPrompt: this.systemPromptPath,
            rules: this.rulesPath
        };
    }
}

module.exports = PromptFileManager;
