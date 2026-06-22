const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { stripToolPatterns } = require('./ipc/shared-utils');
const { isPrivateSessionId } = require('./private-session-store');
const { buildRuntimePaths } = require('./runtime-paths');

/**
 * AgentLoop - Manages autonomous agent behaviors
 * 
 * Three triggers:
 * 1. Session Start  — load memory context into session
 * 2. Idle (AutoMemory) — after idle_seconds of silence, create memory entry
 * 3. Chat Close     — summarize session on close/switch
 * 
 * AutoMemory is OFF by default per session. User enables via automemory tool.
 */
class AgentLoop extends EventEmitter {
    constructor(dispatcher, agentMemory, db, sessionWorkspace = null, options = {}) {
        super();
        this.dispatcher = dispatcher;
        this.agentMemory = agentMemory;
        this.db = db;
        this.sessionWorkspace = sessionWorkspace;

        // Per-session state: sessionId -> { autoMemory, idleSeconds, idleTimer, memorySaved, memoryLoaded, lastActivity, messageCount }
        this.sessions = new Map();

        // Template paths
        const runtimePaths = options.runtimePaths || buildRuntimePaths(options);
        const basePath = options.templateBasePath || runtimePaths.promptTemplatesDir;
        this.templates = {
            start: path.join(basePath, 'memory-start.md'),
            idle: path.join(basePath, 'memory-idle.md'),
            close: path.join(basePath, 'memory-close.md')
        };
        this.userProfilePath = options.userProfilePath || runtimePaths.userProfilePath;
        this.taskQueueService = options.taskQueueService || null;
    }

    // ==================== Session Management ====================

    /**
     * Initialize or get session state
     */
    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                autoMemory: false,
                idleSeconds: 60,
                idleTimer: null,
                memorySaved: false,
                memoryLoaded: false,
                lastActivity: Date.now(),
                messageCount: 0
            });
        }
        return this.sessions.get(sessionId);
    }

    /**
     * Record user activity — resets idle timer
     */
    recordActivity(sessionId) {
        const session = this.getSession(sessionId);
        session.lastActivity = Date.now();
        session.messageCount++;

        // Reset idle timer if autoMemory is on
        if (session.autoMemory) {
            this._resetIdleTimer(sessionId);
        }
    }

    /**
     * Clean up session (on close)
     */
    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        this.sessions.delete(sessionId);
    }

    // ==================== AutoMemory Tool ====================

    /**
     * Toggle autoMemory for a session (called by automemory MCP tool)
     */
    setAutoMemory(sessionId, enabled, idleSeconds = 60) {
        const session = this.getSession(sessionId);
        session.autoMemory = enabled;
        session.idleSeconds = idleSeconds;

        if (enabled) {
            this._resetIdleTimer(sessionId);
            console.log(`[AgentLoop] AutoMemory enabled for session ${sessionId} (idle: ${idleSeconds}s)`);
        } else {
            if (session.idleTimer) {
                clearTimeout(session.idleTimer);
                session.idleTimer = null;
            }
            console.log(`[AgentLoop] AutoMemory disabled for session ${sessionId}`);
        }

        this.emit('automemory-changed', { sessionId, enabled, idleSeconds });
        return { enabled, idleSeconds };
    }

    // ==================== Trigger 1: Memory on Start ====================

    /**
     * Load memory context for a session start.
     * Returns the memory context string to inject.
     */
    async loadMemoryContext(sessionId) {
        const session = this.getSession(sessionId);
        if (session.memoryLoaded) {
            return null; // Already loaded for this session
        }

        try {
            // Read today's daily memory
            const dailyResult = await this.agentMemory.read('daily');
            const dailyContent = dailyResult.content || 'No entries yet today.';

            // Read global preferences
            const globalResult = await this.agentMemory.read('global', 'preferences.md');
            const globalContent = globalResult.content || 'No preferences saved.';

            // Read user info
            let userAbout = 'No user info stored.';
            try {
                if (fs.existsSync(this.userProfilePath)) {
                    userAbout = fs.readFileSync(this.userProfilePath, 'utf-8').trim() || userAbout;
                }
            } catch (e) { /* ignore */ }

            // Load template
            let template = this._loadTemplate('start');

            // Fill placeholders
            const context = template
                .replace('{daily_memory}', dailyContent)
                .replace('{global_preferences}', globalContent)
                .replace('{user_about}', userAbout);

            session.memoryLoaded = true;
            console.log(`[AgentLoop] Memory context loaded for session ${sessionId}`);

            this.emit('memory-loaded', { sessionId });
            return context;

        } catch (error) {
            console.error(`[AgentLoop] Failed to load memory context:`, error.message);
            return null;
        }
    }

    // ==================== Trigger 2: Idle Memory ====================

    _resetIdleTimer(sessionId) {
        const session = this.getSession(sessionId);

        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }

        session.idleTimer = setTimeout(async () => {
            await this._onIdle(sessionId);
        }, session.idleSeconds * 1000);
        if (typeof session.idleTimer.unref === 'function') {
            session.idleTimer.unref();
        }
    }

    async _onIdle(sessionId) {
        const session = this.getSession(sessionId);

        // Guard: need autoMemory enabled, enough messages, not already saved
        if (!session.autoMemory || session.messageCount < 6 || session.memorySaved) {
            return;
        }

        console.log(`[AgentLoop] Idle trigger fired for session ${sessionId}`);

        try {
            // Get recent conversation for context
            const conversations = await this.db.getConversations(20, sessionId);
            if (!conversations || conversations.length < 6) return;

            const conversationText = conversations
                .map(c => `${c.role}: ${c.content}`)
                .join('\n')
                .substring(0, 3000); // Limit context size

            // Load idle template
            const template = this._loadTemplate('idle');
            const prompt = `${template}\n\nConversation:\n${conversationText}`;

            // Internal LLM call via dispatcher (mode=internal: no tools, no rules)
            const response = await this.dispatcher.dispatch(prompt, [], { mode: 'internal' });

            if (response && response.content) {
                // Strip any tool calls from the response
                const cleanContent = this._stripToolCalls(response.content);

                // Append to daily memory
                await this.agentMemory.append('daily', `[AutoMemory - Session ${sessionId}]\n${cleanContent}`);
                session.memorySaved = true;

                console.log(`[AgentLoop] Idle memory saved for session ${sessionId}`);
                this.emit('memory-saved', { sessionId, type: 'idle' });
            }
        } catch (error) {
            console.error(`[AgentLoop] Idle memory failed:`, error.message);
        }
    }

    // ==================== Trigger 3: Chat Close ====================

    async _enqueueCloseSummaryJob(sessionId) {
        if (isPrivateSessionId(sessionId)) {
            return;
        }
        if (this.taskQueueService && typeof this.taskQueueService.createOrReuseTask === 'function') {
            try {
                await this.taskQueueService.createOrReuseTask({
                    listener: 'daemon',
                    status: 'pending',
                    requires_user_action: false,
                    priority: 'normal',
                    dedupe: `daemon:summarize_session:${sessionId}`,
                    action: 'daemon.enqueue_memory_job',
                    payload: {
                        jobType: 'summarize_session',
                        sessionId,
                        source: 'session_close',
                        enqueued_at: new Date().toISOString()
                    },
                    title: `Summarize closed session ${sessionId}`,
                    by: 'agent-loop'
                }, { actor: 'agent-loop' });
                return;
            } catch (error) {
                console.error(`[AgentLoop] Failed to enqueue global task for session ${sessionId}:`, error.message);
            }
        }

        if (!this.db || typeof this.db.enqueueMemoryJob !== 'function') {
            return;
        }
        try {
            await this.db.enqueueMemoryJob({
                jobType: 'summarize_session',
                sessionId,
                payload: {
                    source: 'session_close',
                    enqueued_at: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error(`[AgentLoop] Failed to enqueue summary job for session ${sessionId}:`, error.message);
        }
    }

    /**
     * Summarize and save memory when a chat closes
     */
    async onSessionClose(sessionId) {
        if (isPrivateSessionId(sessionId)) {
            this.removeSession(sessionId);
            return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.memorySaved || session.messageCount < 4) {
            this.removeSession(sessionId);
            return;
        }

        console.log(`[AgentLoop] Chat close trigger fired for session ${sessionId} (queueing summary job)`);
        await this._enqueueCloseSummaryJob(sessionId);

        this.removeSession(sessionId);
    }

    /**
     * Save all active sessions (called on app quit)
     */
    async onAppQuit() {
        console.log('[AgentLoop] App quit — skipping close summaries for fast shutdown');
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            const session = this.sessions.get(sessionId);
            if (session && !session.memorySaved && session.messageCount >= 4) {
                await this._enqueueCloseSummaryJob(sessionId);
            }
            this.removeSession(sessionId);
        }
    }

    // ==================== Helpers ====================

    _loadTemplate(name) {
        const templatePath = this.templates[name];
        try {
            if (fs.existsSync(templatePath)) {
                return fs.readFileSync(templatePath, 'utf-8');
            }
        } catch (e) { /* ignore */ }

        // Fallback defaults
        const fallbacks = {
            start: 'Review your memory for context.',
            idle: 'Summarize this conversation for your daily memory. Be concise (3-5 bullet points).',
            close: 'Summarize this conversation for your daily memory. Be concise (3-5 bullet points).'
        };
        return fallbacks[name] || '';
    }

    _stripToolCalls(text) {
        return stripToolPatterns(text);
    }
}

module.exports = AgentLoop;
