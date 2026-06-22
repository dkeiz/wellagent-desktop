const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { decryptSecret, encryptSecret } = require('./secure-secret-store');
const { resolveDbPath } = require('./database-paths');
const { runDatabaseMigrations } = require('./database-migrations');
const { migrateRemoteGatewaySecret, migrateSecretSettingsToCredentials } = require('./settings-security');
class DatabaseWrapper {
    constructor(options = {}) {
        this.dbPath = resolveDbPath(options);
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
    }
    async init() {
        try {
            await this.createTables();
            await this.migratePlaintextAPIKeys();
            await migrateSecretSettingsToCredentials(this);
            await migrateRemoteGatewaySecret(this);
            await this.seedDefaultRules();
            console.log('Database initialized');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        }
    }
    async seedDefaultRules() {
        const existing = this.get('SELECT id FROM prompt_rules WHERE name = ?', ['Enforce Tool Usage']);
        if (!existing) {
            this.run(
                'INSERT INTO prompt_rules (name, content, active, type) VALUES (?, ?, ?, ?)',
                [
                    'Enforce Tool Usage',
                    'CRITICAL: You MUST use available tools for factual queries (time, date, weather, calendar, calculations). NEVER guess or use cached knowledge when a tool exists. Always call the appropriate tool first.',
                    0,
                    'system'
                ]
            );
        }
    }
    async createTables() {
        return runDatabaseMigrations(this.db);
    }
    async migratePlaintextAPIKeys() {
        const rows = this.all(
            "SELECT key, value FROM settings WHERE key LIKE 'llm.%.apiKey' AND value IS NOT NULL AND value != ''"
        );
        for (const row of rows) {
            const match = /^llm\.([^.]+)\.apiKey$/.exec(row.key);
            if (!match) continue;
            await this.setAPIKey(match[1], row.value);
        }
    }
    run(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const info = stmt.run(...params);
        return { id: info.lastInsertRowid, changes: info.changes };
    }
    get(sql, params = []) {
        const stmt = this.db.prepare(sql);
        return stmt.get(...params);
    }
    all(sql, params = []) {
        const stmt = this.db.prepare(sql);
        return stmt.all(...params);
    }
    _mapConversationRow(row) {
        if (!row) return row;
        let metadata = row.metadata ?? null;
        if (typeof metadata === 'string' && metadata.trim()) {
            try {
                metadata = JSON.parse(metadata);
            } catch (_) {
                metadata = row.metadata;
            }
        }
        return {
            ...row,
            metadata: metadata || null
        };
    }
    _mapSubagentRun(row) {
        if (!row) return null;
        let resultPayload = null;
        let artifacts = [];
        try {
            resultPayload = row.result_payload ? JSON.parse(row.result_payload) : null;
        } catch (error) {
            resultPayload = null;
        }
        try {
            artifacts = row.artifacts_json ? JSON.parse(row.artifacts_json) : [];
        } catch (error) {
            artifacts = [];
        }
        let runtimePolicyGrants = {};
        try {
            runtimePolicyGrants = row.runtime_policy_grants_json ? JSON.parse(row.runtime_policy_grants_json) : {};
        } catch (error) {
            runtimePolicyGrants = {};
        }
        return {
            ...row,
            result_payload: resultPayload,
            artifacts,
            artifacts_json: artifacts,
            runtime_policy_profile: row.runtime_policy_profile || 'strict-subagent',
            runtime_policy_grants: runtimePolicyGrants,
            runtime_policy_grants_json: runtimePolicyGrants
        };
    }
    close() {
        this.db.close();
        console.log('Database connection closed');
    }
    async getCalendarEvents() {
        return this.all('SELECT * FROM calendar_events ORDER BY start_time');
    }
    async addCalendarEvent(event) {
        const { title, start_time, duration_minutes = 60, description = '' } = event;
        const result = this.run(
            'INSERT INTO calendar_events (title, start_time, duration_minutes, description) VALUES (?, ?, ?, ?)',
            [title, start_time, duration_minutes, description]
        );
        return { ...event, id: result.id };
    }
    async updateCalendarEvent(id, event) {
        const { title, start_time, duration_minutes, description } = event;
        this.run(
            'UPDATE calendar_events SET title = ?, start_time = ?, duration_minutes = ?, description = ? WHERE id = ?',
            [title, start_time, duration_minutes, description, id]
        );
        return { id, ...event };
    }
    async deleteCalendarEvent(id) {
        this.run('DELETE FROM calendar_events WHERE id = ?', [id]);
        return { id };
    }
    async getTodos(sessionId = null) {
        const sid = sessionId === null || sessionId === undefined ? '' : String(sessionId).trim();
        if (sid) {
            return this.all('SELECT * FROM todos WHERE session_id = ? ORDER BY priority DESC, created_at', [sid]);
        }
        return this.all('SELECT * FROM todos ORDER BY priority DESC, created_at');
    }
    async addTodo(todo, sessionId = null) {
        const { task, priority = 1, due_date = null } = todo;
        const sid = sessionId === null || sessionId === undefined ? String(todo.session_id || '').trim() : String(sessionId).trim();
        const result = this.run(
            'INSERT INTO todos (task, priority, due_date, session_id) VALUES (?, ?, ?, ?)',
            [task, priority, due_date, sid || null]
        );
        return { ...todo, session_id: sid || null, id: result.id };
    }
    async updateTodo(id, todo, sessionId = null) {
        const { task, completed, priority, due_date } = todo;
        const completedValue = completed === true ? 1 : (completed === false ? 0 : completed);
        const sid = sessionId === null || sessionId === undefined ? '' : String(sessionId).trim();
        const result = sid
            ? this.run('UPDATE todos SET task = ?, completed = ?, priority = ?, due_date = ? WHERE id = ? AND session_id = ?', [task, completedValue, priority, due_date, id, sid])
            : this.run('UPDATE todos SET task = ?, completed = ?, priority = ?, due_date = ? WHERE id = ?', [task, completedValue, priority, due_date, id]);
        return { id, ...todo, session_id: sid || todo.session_id || null, changes: result.changes };
    }
    async deleteTodo(id, sessionId = null) {
        const sid = sessionId === null || sessionId === undefined ? '' : String(sessionId).trim();
        const result = sid
            ? this.run('DELETE FROM todos WHERE id = ? AND session_id = ?', [id, sid])
            : this.run('DELETE FROM todos WHERE id = ?', [id]);
        return { id, session_id: sid || null, changes: result.changes };
    }
    async getConversations(limit = 100, sessionId = null) {
        const normalizedLimit = Math.max(1, parseInt(limit, 10) || 100);
        if (sessionId) {
            return this.all(
                'SELECT * FROM (SELECT * FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
                [sessionId, normalizedLimit]
            ).map((row) => this._mapConversationRow(row));
        }
        const session = await this.getCurrentSession();
        if (!session) {
            console.log('No current session found');
            return [];
        }
        return this.all(
            'SELECT * FROM (SELECT * FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
            [session.id, normalizedLimit]
        ).map((row) => this._mapConversationRow(row));
    }
    async addConversation(message, sessionId = null) {
        const { role, content, metadata } = message;
        const sid = sessionId || (await this.getCurrentSession()).id;
        const metaStr = metadata ? JSON.stringify(metadata) : null;
        this.run(
            'INSERT INTO conversations (session_id, role, content, metadata) VALUES (?, ?, ?, ?)',
            [sid, role, content, metaStr]
        );
        this.run('UPDATE chat_sessions SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [sid]);
        return message;
    }
    async clearConversations() {
        const session = await this.getCurrentSession();
        await this.clearChatSession(session.id);
        return { cleared: true };
    }
    async clearChatSession(sessionId) {
        this.run('DELETE FROM conversations WHERE session_id = ?', [sessionId]);
        this.run('UPDATE chat_sessions SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
        return { cleared: true, sessionId };
    }
    async deleteAllConversations() {
        this.run('DELETE FROM conversations');
        this.run('DELETE FROM chat_sessions');
        this.run("DELETE FROM settings WHERE key = 'current_session_id'");
        console.log('All conversations deleted for privacy');
        return { deleted: true, message: 'All conversation history cleared' };
    }
    async getPromptRules() {
        return this.all('SELECT * FROM prompt_rules ORDER BY created_at DESC');
    }
    async getActivePromptRules() {
        return this.all('SELECT * FROM prompt_rules WHERE active = 1 ORDER BY created_at');
    }
    async addPromptRule(rule) {
        const { name, content, type = 'rule' } = rule;
        const result = this.run(
            'INSERT INTO prompt_rules (name, content, type) VALUES (?, ?, ?)',
            [name, content, type]
        );
        const inserted = this.get('SELECT * FROM prompt_rules WHERE id = ?', [result.id]);
        return {
            ...inserted,
            active: inserted?.active === 1 || inserted?.active === true
        };
    }
    async updatePromptRule(id, rule) {
        const { name, content, active } = rule;
        this.run(
            'UPDATE prompt_rules SET name = ?, content = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, content, active ? 1 : 0, id]
        );
        return { id, ...rule };
    }
    async togglePromptRule(id, active) {
        this.run(
            'UPDATE prompt_rules SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [active ? 1 : 0, id]
        );
        return { id, active };
    }
    async deletePromptRule(id) {
        this.run('DELETE FROM prompt_rules WHERE id = ?', [id]);
        return { id };
    }
    async createChatSession(title = null) {
        const result = this.run(
            'INSERT INTO chat_sessions (title) VALUES (?)',
            [title || `Chat ${new Date().toLocaleString()}`]
        );
        await this.setSetting('current_session_id', result.id.toString());
        console.log('Created and switched to new session:', result.id);
        return { id: result.id, title };
    }
    async getChatSessions(date = null, limit = 6) {
        if (date) {
            return this.all(`
                SELECT cs.*, 
                       COUNT(c.id) as message_count,
                       (SELECT content FROM conversations WHERE session_id = cs.id AND role = 'user' ORDER BY timestamp LIMIT 1) as first_message
                FROM chat_sessions cs
                LEFT JOIN conversations c ON cs.id = c.session_id
                WHERE DATE(cs.created_at) = DATE(?) AND cs.agent_id IS NULL
                GROUP BY cs.id
                HAVING message_count > 0
                ORDER BY cs.last_message_at DESC
            `, [date]);
        }
        return this.all(`
            SELECT cs.*, 
                   COUNT(c.id) as message_count,
                   (SELECT content FROM conversations WHERE session_id = cs.id AND role = 'user' ORDER BY timestamp LIMIT 1) as first_message
            FROM chat_sessions cs
            LEFT JOIN conversations c ON cs.id = c.session_id
            WHERE cs.agent_id IS NULL
            GROUP BY cs.id
            HAVING message_count > 0
            ORDER BY cs.last_message_at DESC
            LIMIT ?
        `, [limit]);
    }
    async loadChatSession(sessionId, options = {}) {
        const includeHidden = options?.includeHidden === true;
        const rows = this.all('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp', [sessionId])
            .map((row) => this._mapConversationRow(row));
        if (includeHidden) {
            return rows;
        }

        return rows.filter((row) => {
            if (!row?.metadata) return true;
            return row.metadata?.hidden_from_ui !== true;
        });
    }
    async deleteChatSession(sessionId) {
        this.run('DELETE FROM conversations WHERE session_id = ?', [sessionId]);
        this.run('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
        return { success: true };
    }
    async getCurrentSession() {
        const currentId = await this.getSetting('current_session_id');
        if (currentId) {
            const session = this.get('SELECT * FROM chat_sessions WHERE id = ?', [parseInt(currentId)]);
            if (session) {
                console.log('Found current session:', session.id);
                return session;
            }
        }
        const session = this.get(`
            SELECT cs.* FROM chat_sessions cs
            INNER JOIN conversations c ON cs.id = c.session_id
            WHERE cs.agent_id IS NULL
            GROUP BY cs.id
            ORDER BY cs.last_message_at DESC
            LIMIT 1
        `);
        if (!session) {
            console.log('No sessions found, creating new one');
            return await this.createChatSession();
        }
        console.log('Using most recent session:', session.id);
        await this.setSetting('current_session_id', session.id.toString());
        return session;
    }
    async setCurrentSession(sessionId) {
        const sid = String(sessionId || '').trim();
        if (!sid) throw new Error('sessionId is required');
        const session = this.get('SELECT id FROM chat_sessions WHERE id = ?', [sid]);
        if (!session) throw new Error(`Chat session not found: ${sid}`);
        await this.setSetting('current_session_id', String(session.id));
        return { sessionId: session.id };
    }
    async getSetting(key) {
        try {
            const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
            return row ? row.value : null;
        } catch (error) {
            console.error(`Error getting setting '${key}':`, error);
            return null;
        }
    }
    getSettingSync(key) {
        // Some companion auth checks happen inside synchronous socket upgrade
        // paths; keep this as a small sync mirror of getSetting().
        try {
            const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
            return row ? row.value : null;
        } catch (error) {
            console.error(`Error getting setting '${key}':`, error);
            return null;
        }
    }
    async setSetting(key, value) {
        this.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, value]
        );
        return { key, value };
    }
    async saveSetting(key, value) {
        return this.setSetting(key, value);
    }
    async deleteSetting(key) {
        this.run('DELETE FROM settings WHERE key = ?', [key]);
        return { key };
    }
    async getAllSettings() {
        const rows = this.all('SELECT key, value FROM settings');
        return rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
    }
    async getConfig() {
        const provider = await this.getSetting('llm.provider');
        const model = await this.getSetting('llm.model');
        const config = { provider, model };
        if (provider) {
            const apiKey = await this.getAPIKey(provider) || await this.getSetting(`llm.${provider}.apiKey`);
            const url = await this.getSetting(`llm.${provider}.url`);
            const useOAuth = await this.getSetting(`llm.${provider}.useOAuth`);
            if (apiKey) config.apiKey = apiKey;
            if (url) config.url = url;
            if (useOAuth === 'true') config.useOAuth = true;
        }
        return config;
    }
    async getAPIKey(provider) {
        const normalizedProvider = String(provider || '').trim().toLowerCase();
        if (!normalizedProvider) return null;
        const row = this.get('SELECT key, encrypted FROM api_keys WHERE provider = ?', [normalizedProvider]);
        if (!row) return null;
        try {
            return decryptSecret(row.key, Boolean(row.encrypted));
        } catch (error) {
            console.error(`Error decrypting API key for '${normalizedProvider}':`, error.message);
            return null;
        }
    }
    async setAPIKey(provider, key) {
        const normalizedProvider = String(provider || '').trim().toLowerCase();
        const secret = String(key || '').trim();
        if (!normalizedProvider) {
            throw new Error('Provider is required');
        }
        if (!secret) {
            this.run('DELETE FROM api_keys WHERE provider = ?', [normalizedProvider]);
            await this.saveSetting(`llm.${normalizedProvider}.apiKey`, '');
            return { provider: normalizedProvider, encrypted: false };
        }
        const encrypted = encryptSecret(secret);
        this.run(
            'INSERT OR REPLACE INTO api_keys (provider, key, encrypted) VALUES (?, ?, ?)',
            [normalizedProvider, encrypted.value, encrypted.encrypted ? 1 : 0]
        );
        await this.saveSetting(`llm.${normalizedProvider}.apiKey`, '');
        return { provider: normalizedProvider, encrypted: encrypted.encrypted };
    }
    async getAPIKeyInfo(provider) {
        const normalizedProvider = String(provider || '').trim().toLowerCase();
        if (!normalizedProvider) {
            return { configured: false, encrypted: false };
        }
        const row = this.get('SELECT encrypted FROM api_keys WHERE provider = ?', [normalizedProvider]);
        return {
            configured: Boolean(row),
            encrypted: Boolean(row?.encrypted)
        };
    }
    _credentialProviderName(name) {
        const normalized = String(name || '').trim().toLowerCase();
        if (!normalized) throw new Error('Credential name is required');
        return `credential:${normalized}`;
    }
    async getCredential(name) {
        return this.getAPIKey(this._credentialProviderName(name));
    }
    async setCredential(name, value) {
        const provider = this._credentialProviderName(name);
        const secret = String(value || '');
        if (!secret) {
            this.run('DELETE FROM api_keys WHERE provider = ?', [provider]);
            return { name, encrypted: false };
        }
        const encrypted = encryptSecret(secret);
        this.run(
            'INSERT OR REPLACE INTO api_keys (provider, key, encrypted) VALUES (?, ?, ?)',
            [provider, encrypted.value, encrypted.encrypted ? 1 : 0]
        );
        return { name, encrypted: encrypted.encrypted };
    }
    async deleteCredential(name) {
        this.run('DELETE FROM api_keys WHERE provider = ?', [this._credentialProviderName(name)]);
        return { name };
    }
    async getCredentialInfo(name) {
        const row = this.get('SELECT encrypted FROM api_keys WHERE provider = ?', [this._credentialProviderName(name)]);
        return {
            configured: Boolean(row),
            encrypted: Boolean(row?.encrypted)
        };
    }
    async setActiveModel(provider, model) {
        await this.setSetting(`active_model_${provider}`, model);
        return { provider, model };
    }
    async getToolStates() {
        const rows = this.all(`SELECT key, value FROM settings WHERE key LIKE 'tool.%.active'`);
        const states = {};
        rows.forEach(row => {
            const toolName = row.key.replace('tool.', '').replace('.active', '');
            states[toolName] = { active: row.value === 'true' };
        });
        return states;
    }
    async setToolActive(toolName, active) {
        const key = `tool.${toolName}.active`;
        const value = active ? 'true' : 'false';
        await this.setSetting(key, value);
        return { toolName, active };
    }
    async getCustomTools() {
        return this.all('SELECT * FROM custom_tools ORDER BY created_at DESC');
    }
    async getCustomTool(name) {
        return this.get('SELECT * FROM custom_tools WHERE name = ?', [name]);
    }
    async addCustomTool(tool) {
        const { name, description, code, input_schema } = tool;
        const result = this.run(
            'INSERT INTO custom_tools (name, description, code, input_schema) VALUES (?, ?, ?, ?)',
            [name, description, code, JSON.stringify(input_schema || {})]
        );
        return { id: result.id, ...tool };
    }
    async updateCustomTool(existingName, updates = {}) {
        const current = await this.getCustomTool(existingName);
        if (!current) {
            throw new Error(`Custom tool "${existingName}" not found`);
        }
        const nextName = String(updates.name ?? current.name).trim();
        const nextDescription = String(updates.description ?? current.description).trim();
        const nextCode = String(updates.code ?? current.code);
        const nextInputSchema = JSON.stringify(updates.input_schema ?? JSON.parse(current.input_schema || '{}'));
        if (!nextName) throw new Error('Tool name is required');
        if (!nextDescription) throw new Error('Tool description is required');
        if (!nextCode.trim()) throw new Error('Tool code is required');
        if (nextName !== current.name) {
            const conflict = await this.getCustomTool(nextName);
            if (conflict) throw new Error(`Tool name "${nextName}" already exists`);
        }
        this.run(
            'UPDATE custom_tools SET name = ?, description = ?, code = ?, input_schema = ? WHERE name = ?',
            [nextName, nextDescription, nextCode, nextInputSchema, existingName]
        );
        if (nextName !== existingName) {
            const oldKey = `tool.${existingName}.active`;
            const newKey = `tool.${nextName}.active`;
            const active = await this.getSetting(oldKey);
            if (active !== null && active !== undefined) {
                await this.setSetting(newKey, active);
                this.run('DELETE FROM settings WHERE key = ?', [oldKey]);
            }
        }
        return this.getCustomTool(nextName);
    }
    async deleteCustomTool(name) {
        this.run('DELETE FROM custom_tools WHERE name = ?', [name]);
        return { name };
    }
    async upsertScheduledTimer(timer) {
        const now = new Date().toISOString();
        this.run(
            `INSERT INTO scheduled_timers (
                timer_id, context_key, context_json, status, due_at, interval_ms,
                remaining_ms, repeat, message, updated_at, paused_at, fired_at, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(timer_id, context_key) DO UPDATE SET
                context_json = excluded.context_json,
                status = excluded.status,
                due_at = excluded.due_at,
                interval_ms = excluded.interval_ms,
                remaining_ms = excluded.remaining_ms,
                repeat = excluded.repeat,
                message = excluded.message,
                updated_at = excluded.updated_at,
                paused_at = excluded.paused_at,
                fired_at = excluded.fired_at,
                last_error = excluded.last_error`,
            [
                timer.timer_id,
                timer.context_key,
                JSON.stringify(timer.context || {}),
                timer.status || 'active',
                timer.due_at || null,
                Number(timer.interval_ms) || 0,
                timer.remaining_ms ?? null,
                timer.repeat ? 1 : 0,
                timer.message || '',
                now,
                timer.paused_at || null,
                timer.fired_at || null,
                timer.last_error || null
            ]
        );
        return this.getScheduledTimer(timer.timer_id, timer.context_key);
    }
    async getScheduledTimer(timerId, contextKey) {
        return this.get(
            'SELECT * FROM scheduled_timers WHERE timer_id = ? AND context_key = ?',
            [timerId, contextKey]
        );
    }
    async listScheduledTimers(contextKey = null) {
        if (contextKey) {
            return this.all(
                'SELECT * FROM scheduled_timers WHERE context_key = ? AND status IN (?, ?) ORDER BY due_at',
                [contextKey, 'active', 'paused']
            );
        }
        return this.all(
            'SELECT * FROM scheduled_timers WHERE status IN (?, ?) ORDER BY due_at',
            ['active', 'paused']
        );
    }
    async getDueScheduledTimers(nowIso) {
        return this.all(
            'SELECT * FROM scheduled_timers WHERE status = ? AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at',
            ['active', nowIso]
        );
    }
    async updateScheduledTimerState(timerId, contextKey, updates = {}) {
        const allowed = ['status', 'due_at', 'remaining_ms', 'paused_at', 'fired_at', 'last_error'];
        const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
        if (entries.length === 0) return this.getScheduledTimer(timerId, contextKey);
        const sets = entries.map(([key]) => `${key} = ?`).join(', ');
        const values = entries.map(([, value]) => value);
        this.run(
            `UPDATE scheduled_timers SET ${sets}, updated_at = ? WHERE timer_id = ? AND context_key = ?`,
            [...values, new Date().toISOString(), timerId, contextKey]
        );
        return this.getScheduledTimer(timerId, contextKey);
    }
    async getWorkflows() {
        return this.all('SELECT * FROM workflows ORDER BY success_count DESC, last_used DESC');
    }
    async addWorkflow(workflow) {
        const { name, description, trigger_pattern, tool_chain, embedding, visual_data } = workflow;
        const result = this.run(
            'INSERT INTO workflows (name, description, trigger_pattern, tool_chain, embedding, visual_data) VALUES (?, ?, ?, ?, ?, ?)',
            [name, description, trigger_pattern, JSON.stringify(tool_chain),
                embedding ? JSON.stringify(embedding) : null,
                visual_data ? JSON.stringify(visual_data) : null]
        );
        return { id: result.id, ...workflow };
    }
    async updateWorkflowStats(id, success) {
        if (success) {
            this.run('UPDATE workflows SET success_count = success_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        } else {
            this.run('UPDATE workflows SET failure_count = failure_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        }
    }
    async findWorkflowByTrigger(pattern) {
        return this.get('SELECT * FROM workflows WHERE trigger_pattern LIKE ?', [`%${pattern}%`]);
    }
    async getWorkflowById(id) {
        return this.get('SELECT * FROM workflows WHERE id = ?', [id]);
    }
    async deleteWorkflow(id) {
        this.run('DELETE FROM workflows WHERE id = ?', [id]);
        return { id };
    }
    async updateWorkflowEmbedding(id, embedding) {
        this.run('UPDATE workflows SET embedding = ? WHERE id = ?', [JSON.stringify(embedding), id]);
        return { id, embedding };
    }
    _mapAgentRow(row) {
        return row ? { ...row, visibleInSidebar: row.visible_in_sidebar !== 0 } : row;
    }
    async getAgents(type = null) {
        if (type) {
            return this.all('SELECT * FROM agents WHERE type = ? ORDER BY name', [type]).map(row => this._mapAgentRow(row));
        }
        return this.all('SELECT * FROM agents ORDER BY type, name').map(row => this._mapAgentRow(row));
    }
    async getAgent(id) {
        return this._mapAgentRow(this.get('SELECT * FROM agents WHERE id = ?', [id]));
    }
    async addAgent(agent) {
        const { name, type = 'pro', icon = '🤖', system_prompt, description, config, folder_path } = agent;
        const result = this.run(
            'INSERT INTO agents (name, type, icon, system_prompt, description, config, folder_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, type, icon, system_prompt || '', description || '', config ? JSON.stringify(config) : null, folder_path || '']
        );
        return { ...agent, id: result.id, status: 'idle', visibleInSidebar: true };
    }
    async updateAgent(id, data) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            if (['name', 'type', 'icon', 'system_prompt', 'description', 'status', 'config', 'folder_path', 'visible_in_sidebar'].includes(key)) {
                fields.push(`${key} = ?`);
                values.push(key === 'config' && typeof value === 'object' ? JSON.stringify(value) : (key === 'visible_in_sidebar' ? (value ? 1 : 0) : value));
            }
        }
        if (fields.length === 0) return { id };
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        this.run(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`, values);
        return { id, ...data };
    }
    async deleteAgent(id) {
        const sessions = this.all('SELECT id FROM chat_sessions WHERE agent_id = ?', [id]);
        for (const session of sessions) {
            this.run('DELETE FROM conversations WHERE session_id = ?', [session.id]);
        }
        this.run('DELETE FROM chat_sessions WHERE agent_id = ?', [id]);
        this.run('DELETE FROM subagent_runs WHERE subagent_id = ?', [id]);
        this.run('DELETE FROM agent_tool_states WHERE agent_id = ?', [id]);
        this.run('DELETE FROM agents WHERE id = ?', [id]);
        return { id, deletedSessions: sessions.length };
    }
    async getAgentSession(agentId) {
        return this.get(`
            SELECT cs.* FROM chat_sessions cs
            WHERE cs.agent_id = ?
            ORDER BY cs.last_message_at DESC
            LIMIT 1
        `, [agentId]);
    }
    async createAgentSession(agentId, title = null) {
        const agent = await this.getAgent(agentId);
        const sessionTitle = title || (agent ? `${agent.name}` : `Agent Chat`);
        const result = this.run(
            'INSERT INTO chat_sessions (title, agent_id) VALUES (?, ?)',
            [sessionTitle, agentId]
        );
        return { id: result.id, title: sessionTitle, agent_id: agentId };
    }
    async createSubagentRun(run) {
        const {
            parentSessionId = null,
            childSessionId,
            subagentId,
            task,
            contractType = 'task_complete',
            expectedOutput = '',
            runtimePolicyProfile = 'strict-subagent',
            runtimePolicyGrants = {}
        } = run;
        const result = this.run(
            `INSERT INTO subagent_runs (
                parent_session_id,
                child_session_id,
                subagent_id,
                task,
                contract_type,
                expected_output,
                runtime_policy_profile,
                runtime_policy_grants_json,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
            [
                parentSessionId,
                childSessionId,
                subagentId,
                task,
                contractType,
                expectedOutput,
                runtimePolicyProfile || 'strict-subagent',
                JSON.stringify(runtimePolicyGrants && typeof runtimePolicyGrants === 'object' ? runtimePolicyGrants : {})
            ]
        );
        return this.getSubagentRun(result.id);
    }
    async completeSubagentRun(id, result) {
        const {
            status = 'completed',
            summary = '',
            payload = null,
            artifacts = []
        } = result;
        this.run(
            `UPDATE subagent_runs
             SET status = ?, result_summary = ?, result_payload = ?, artifacts_json = ?, error = NULL, completed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                status,
                summary,
                payload ? JSON.stringify(payload) : null,
                JSON.stringify(artifacts || []),
                id
            ]
        );
        return this.getSubagentRun(id);
    }
    async failSubagentRun(id, error) {
        this.run(
            `UPDATE subagent_runs
             SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [String(error || 'Unknown error'), id]
        );
        return this.getSubagentRun(id);
    }
    async getSubagentRun(id) {
        const row = this.get('SELECT * FROM subagent_runs WHERE id = ?', [id]);
        return this._mapSubagentRun(row);
    }
    async listSubagentRuns(filters = {}) {
        const {
            parentSessionId = null,
            subagentId = null,
            limit = 20
        } = filters;
        const clauses = [];
        const params = [];
        if (parentSessionId !== null && parentSessionId !== undefined) {
            clauses.push('parent_session_id = ?');
            params.push(parentSessionId);
        }
        if (subagentId !== null && subagentId !== undefined) {
            clauses.push('subagent_id = ?');
            params.push(subagentId);
        }
        params.push(Math.max(1, Number(limit) || 20));
        const where = clauses.length > 0
            ? `WHERE ${clauses.join(' AND ')}`
            : '';
        const rows = this.all(
            `SELECT * FROM subagent_runs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
            params
        );
        return rows.map(row => this._mapSubagentRun(row));
    }
    _mapMemoryJob(row) {
        if (!row) return null;
        let payload = null;
        try {
            payload = row.payload_json ? JSON.parse(row.payload_json) : null;
        } catch (error) {
            payload = null;
        }
        return {
            ...row,
            payload
        };
    }
    async enqueueMemoryJob({ jobType, sessionId, payload = null, nextRunAt = null }) {
        const type = String(jobType || '').trim();
        const sid = String(sessionId || '').trim();
        if (!type || !sid) {
            throw new Error('enqueueMemoryJob requires jobType and sessionId');
        }
        const existing = this.get(
            `SELECT * FROM memory_jobs
             WHERE job_type = ? AND session_id = ? AND status IN ('pending', 'running')
             ORDER BY id DESC LIMIT 1`,
            [type, sid]
        );
        if (existing) {
            return this._mapMemoryJob(existing);
        }
        const dueAt = nextRunAt || new Date().toISOString();
        const result = this.run(
            `INSERT INTO memory_jobs
             (job_type, session_id, status, attempts, next_run_at, payload_json)
             VALUES (?, ?, 'pending', 0, ?, ?)`,
            [type, sid, dueAt, payload ? JSON.stringify(payload) : null]
        );
        return this.getMemoryJob(result.id);
    }
    async getMemoryJob(jobId) {
        const row = this.get('SELECT * FROM memory_jobs WHERE id = ?', [jobId]);
        return this._mapMemoryJob(row);
    }
    async claimNextMemoryJob(jobType, workerId = 'memory-daemon') {
        const type = String(jobType || '').trim();
        if (!type) {
            throw new Error('claimNextMemoryJob requires jobType');
        }
        const claim = this.db.transaction(() => {
            const row = this.get(
                `SELECT * FROM memory_jobs
                 WHERE job_type = ? AND status = 'pending' AND datetime(next_run_at) <= datetime('now')
                 ORDER BY datetime(next_run_at) ASC, id ASC
                 LIMIT 1`,
                [type]
            );
            if (!row) {
                return null;
            }
            this.run(
                `UPDATE memory_jobs
                 SET status = 'running',
                     locked_at = CURRENT_TIMESTAMP,
                     locked_by = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [String(workerId || 'memory-daemon'), row.id]
            );
            return row.id;
        });
        const jobId = claim();
        if (!jobId) return null;
        return this.getMemoryJob(jobId);
    }
    async completeMemoryJob(jobId, { summary = '', payload = null } = {}) {
        this.run(
            `UPDATE memory_jobs
             SET status = 'done',
                 result_summary = ?,
                 payload_json = ?,
                 last_error = NULL,
                 locked_at = NULL,
                 locked_by = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [String(summary || ''), payload ? JSON.stringify(payload) : null, jobId]
        );
        return this.getMemoryJob(jobId);
    }
    async markDaemonSessionInspected(sessionId, { inspector = 'memory-daemon', jobId = null, notes = '' } = {}) {
        const sid = String(sessionId || '').trim();
        if (!sid) {
            throw new Error('markDaemonSessionInspected requires sessionId');
        }
        this.run(
            `INSERT INTO daemon_session_inspections (session_id, inspector, inspected_at, job_id, notes)
             VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                inspector = excluded.inspector,
                inspected_at = CURRENT_TIMESTAMP,
                job_id = excluded.job_id,
                notes = excluded.notes`,
            [sid, String(inspector || 'memory-daemon'), jobId, String(notes || '')]
        );
        return this.getDaemonSessionInspection(sid);
    }
    getDaemonSessionInspection(sessionId) {
        return this.get('SELECT * FROM daemon_session_inspections WHERE session_id = ?', [String(sessionId || '')]);
    }
    getDaemonSessionInspectionStats() {
        return this.get('SELECT COUNT(*) as count, MAX(inspected_at) as lastInspectedAt FROM daemon_session_inspections') || { count: 0 };
    }
    async failMemoryJob(jobId, error, options = {}) {
        const maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
        const retryDelaySeconds = Math.max(1, Number(options.retryDelaySeconds) || 300);
        const row = this.get('SELECT attempts FROM memory_jobs WHERE id = ?', [jobId]);
        if (!row) {
            return null;
        }
        const attempts = Number(row.attempts || 0) + 1;
        const shouldRetry = attempts < maxAttempts;
        if (shouldRetry) {
            const retryIso = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
            this.run(
                `UPDATE memory_jobs
                 SET status = 'pending',
                     attempts = ?,
                     next_run_at = ?,
                     last_error = ?,
                     locked_at = NULL,
                     locked_by = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [attempts, retryIso, String(error || 'Unknown error'), jobId]
            );
        } else {
            this.run(
                `UPDATE memory_jobs
                 SET status = 'failed',
                     attempts = ?,
                     last_error = ?,
                     locked_at = NULL,
                     locked_by = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [attempts, String(error || 'Unknown error'), jobId]
            );
        }
        return this.getMemoryJob(jobId);
    }
    async resetStaleRunningMemoryJobs({ maxAgeMinutes = 30, jobType = null } = {}) {
        const age = Math.max(1, Number(maxAgeMinutes) || 30);
        if (jobType) {
            this.run(
                `UPDATE memory_jobs
                 SET status = 'pending',
                     locked_at = NULL,
                     locked_by = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE status = 'running'
                   AND job_type = ?
                   AND datetime(locked_at) < datetime('now', ?)`,
                [String(jobType), `-${age} minutes`]
            );
            return;
        }
        this.run(
            `UPDATE memory_jobs
             SET status = 'pending',
                 locked_at = NULL,
                 locked_by = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'running'
               AND datetime(locked_at) < datetime('now', ?)`,
            [`-${age} minutes`]
        );
    }
}
module.exports = DatabaseWrapper;
