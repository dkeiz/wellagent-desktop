const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildRuntimePaths } = require('./runtime-paths');

/**
 * AgentMemory - Manages agent's persistent memory with security rules
 * 
 * Features:
 * - Append-only writing (no modifications to existing content)
 * - Auto-lock after configurable days (default 7)
 * - Hash verification for tamper detection
 */
class AgentMemory {
    constructor(basePath = null) {
        this.basePath = basePath || buildRuntimePaths().memoryBasePath;
        this.lockDays = 7;
        this.hashFile = path.join(this.basePath, '.hashes.json');
        this.hashes = this.loadHashes();
        this.ensureStructure();
    }

    ensureStructure() {
        const folders = ['daily', 'global', 'tasks', 'images'];
        folders.forEach(folder => {
            const folderPath = path.join(this.basePath, folder);
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }
        });
    }

    loadHashes() {
        try {
            if (fs.existsSync(this.hashFile)) {
                return JSON.parse(fs.readFileSync(this.hashFile, 'utf-8'));
            }
        } catch (error) {
            console.error('Failed to load memory hashes:', error);
        }
        return {};
    }

    saveHashes() {
        try {
            fs.writeFileSync(this.hashFile, JSON.stringify(this.hashes, null, 2));
        } catch (error) {
            console.error('Failed to save memory hashes:', error);
        }
    }

    computeHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    // Check if a file is locked (older than lockDays)
    isLocked(filePath) {
        try {
            const stats = fs.statSync(filePath);
            const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            return ageInDays > this.lockDays;
        } catch {
            return false;
        }
    }

    // Verify file integrity
    verifyIntegrity(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const currentHash = this.computeHash(content);
            const storedHash = this.hashes[filePath];

            if (!storedHash) {
                // First time seeing this file, store hash
                this.hashes[filePath] = currentHash;
                this.saveHashes();
                return { verified: true, firstCheck: true };
            }

            return { verified: currentHash === storedHash, tampered: currentHash !== storedHash };
        } catch (error) {
            return { verified: false, error: error.message };
        }
    }

    // Append content to a memory file (append-only)
    async append(type, content, filename = null) {
        const folder = path.join(this.basePath, type);

        // Determine filename
        let targetFile;
        if (type === 'daily') {
            const today = new Date().toISOString().split('T')[0];
            targetFile = path.join(folder, `${today}.md`);
        } else if (type === 'global') {
            targetFile = path.join(folder, filename || 'preferences.md');
        } else if (type === 'tasks') {
            targetFile = path.join(folder, filename || 'current.md');
        } else {
            throw new Error(`Unknown memory type: ${type}`);
        }

        // Check if locked
        if (this.isLocked(targetFile)) {
            throw new Error(`Memory file is locked (older than ${this.lockDays} days): ${targetFile}`);
        }

        // Verify integrity before appending
        if (fs.existsSync(targetFile)) {
            const integrity = this.verifyIntegrity(targetFile);
            if (integrity.tampered) {
                throw new Error(`Memory file has been tampered with: ${targetFile}`);
            }
        }

        // Append with timestamp
        const timestamp = new Date().toISOString();
        const entry = `\n\n---\n[${timestamp}]\n${content}`;

        fs.appendFileSync(targetFile, entry);

        // Update hash
        const newContent = fs.readFileSync(targetFile, 'utf-8');
        this.hashes[targetFile] = this.computeHash(newContent);
        this.saveHashes();

        return { success: true, file: targetFile };
    }

    // Read memory file
    async read(type, filename = null) {
        const folder = path.join(this.basePath, type);

        let targetFile;
        if (type === 'daily' && !filename) {
            const today = new Date().toISOString().split('T')[0];
            targetFile = path.join(folder, `${today}.md`);
        } else if (type === 'global' && !filename) {
            targetFile = path.join(folder, 'preferences.md');
        } else {
            targetFile = path.join(folder, filename);
        }

        if (!fs.existsSync(targetFile)) {
            return { content: null, exists: false };
        }

        const content = fs.readFileSync(targetFile, 'utf-8');
        const integrity = this.verifyIntegrity(targetFile);

        return {
            content,
            exists: true,
            locked: this.isLocked(targetFile),
            integrity: integrity.verified
        };
    }

    // List all memory files in a type
    async list(type) {
        const folder = path.join(this.basePath, type);

        if (!fs.existsSync(folder)) {
            return [];
        }

        const files = fs.readdirSync(folder)
            .filter(f => !f.startsWith('.'))
            .map(f => ({
                filename: f,
                path: path.join(folder, f),
                locked: this.isLocked(path.join(folder, f))
            }));

        return files;
    }

    // Save image to memory (for visual capture)
    async saveImage(imageBuffer, name = null) {
        const imagesFolder = path.join(this.basePath, 'images');
        const timestamp = Date.now();
        const filename = name || `capture_${timestamp}.png`;
        const targetFile = path.join(imagesFolder, filename);

        fs.writeFileSync(targetFile, imageBuffer);

        return { success: true, file: targetFile, filename };
    }

    // Get memory statistics
    getStats() {
        const stats = {
            daily: 0,
            global: 0,
            tasks: 0,
            images: 0,
            lockedFiles: 0
        };

        ['daily', 'global', 'tasks', 'images'].forEach(type => {
            const folder = path.join(this.basePath, type);
            if (fs.existsSync(folder)) {
                const files = fs.readdirSync(folder).filter(f => !f.startsWith('.'));
                stats[type] = files.length;
                files.forEach(f => {
                    if (this.isLocked(path.join(folder, f))) {
                        stats.lockedFiles++;
                    }
                });
            }
        });

        return stats;
    }
}

module.exports = AgentMemory;
