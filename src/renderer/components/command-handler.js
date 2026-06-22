/**
 * CommandHandler — Intercepts /commands from user input before they reach the AI.
 *
 * Commands are local actions (clear, stats, tools) or may call the backend
 * (compact, save, model, terminal).
 */
class CommandHandler {
    constructor(mainPanel) {
        this.mainPanel = mainPanel;
        this.commands = new Map();
        this._registerBuiltInCommands();
    }

    /**
     * Check if text is a /command.
     */
    isCommand(text) {
        return text.startsWith('/');
    }

    /**
     * Parse and execute a /command.
     * Returns { output: string, style: 'system'|'terminal' }
     */
    async execute(text) {
        const parts = text.trim().split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const cmd = this.commands.get(cmdName);
        if (!cmd) {
            return {
                output: `Unknown command: ${cmdName}\nType /help for available commands.`,
                style: 'system'
            };
        }

        try {
            return await cmd.execute(args);
        } catch (error) {
            return {
                output: `Error executing ${cmdName}: ${error.message}`,
                style: 'system'
            };
        }
    }

    /**
     * Get list of commands matching a prefix (for autocomplete).
     */
    getCompletions(prefix, limit = 10) {
        const normalized = typeof prefix === 'string' ? prefix.trim().toLowerCase() : '';
        const query = normalized.startsWith('/') ? normalized : `/${normalized}`;
        const isRootQuery = query === '/';
        const maxItems = Math.max(1, Number(limit) || 10);
        const matches = [];

        for (const [name, cmd] of this.commands) {
            if (isRootQuery || name.startsWith(query)) {
                matches.push({ name, description: cmd.description || '' });
            }
        }

        return matches.slice(0, maxItems);
    }

    /**
     * Return all commands in display order, optionally capped.
     */
    getAllCommands(limit = null) {
        const items = [];
        for (const [name, cmd] of this.commands) {
            items.push({ name, description: cmd.description || '' });
        }
        if (limit === null || limit === undefined) {
            return items;
        }
        const maxItems = Math.max(1, Number(limit) || 10);
        return items.slice(0, maxItems);
    }

    _registerBuiltInCommands() {
        // /help
        this.commands.set('/help', {
            description: 'Show all available commands',
            execute: async () => {
                const lines = ['📋 **Available Commands:**', ''];
                for (const [name, cmd] of this.commands) {
                    lines.push(`  ${name.padEnd(20)} ${cmd.description}`);
                }
                return { output: lines.join('\n'), style: 'system' };
            }
        });

        // /clear
        this.commands.set('/clear', {
            description: 'Clear current chat messages',
            execute: async () => {
                await this.mainPanel.clearCurrentChat();
                return { output: '🧹 Chat cleared.', style: 'system' };
            }
        });

        // /new and /newchat
        this.commands.set('/new', {
            description: 'Create a new chat tab',
            execute: async () => {
                await this.mainPanel.newChat();
                return { output: '🆕 New chat created.', style: 'system' };
            }
        });
        this.commands.set('/newchat', {
            description: 'Alias for /new',
            execute: async () => {
                await this.mainPanel.newChat();
                return { output: '🆕 New chat created.', style: 'system' };
            }
        });
        this.commands.set('/private', {
            description: 'Toggle current chat between memory/private mode',
            execute: async () => {
                if (!window.chatPrivacyMode?.toggleCurrentChatMode) {
                    return { output: 'Private mode toggle is unavailable in this build.', style: 'system' };
                }
                await window.chatPrivacyMode.toggleCurrentChatMode(this.mainPanel);
                return { output: 'Chat mode toggled.', style: 'system' };
            }
        });
        this.commands.set('/newprivate', {
            description: 'Open a brand-new private chat tab',
            execute: async () => {
                if (!window.mainPanelTabs?.newPrivateChat) {
                    return { output: 'Private chat is unavailable in this build.', style: 'system' };
                }
                await window.mainPanelTabs.newPrivateChat(this.mainPanel);
                return { output: 'New private chat created.', style: 'system' };
            }
        });

        this.commands.set('/refresh', {
            description: 'Reload the current UI window',
            execute: async () => {
                const result = await window.electronAPI.app.refresh();
                if (!result?.success) {
                    return { output: `Refresh failed: ${result?.error || 'unknown error'}`, style: 'system' };
                }
                return { output: '🔄 Refreshing UI...', style: 'system' };
            }
        });

        this.commands.set('/restart', {
            description: 'Restart the full application',
            execute: async () => {
                const result = await window.electronAPI.app.restart();
                if (!result?.success) {
                    return { output: `Restart failed: ${result?.error || 'unknown error'}`, style: 'system' };
                }
                return { output: '♻️ Restarting app...', style: 'system' };
            }
        });

        // /stop
        this.commands.set('/stop', {
            description: 'Stop current AI generation',
            execute: async () => {
                try {
                    await window.electronAPI.stopGeneration();
                    const sessionId = this.mainPanel.activeTabId;
                    const tab = sessionId ? this.mainPanel.chatTabs.get(sessionId) : null;
                    if (tab) {
                        tab.interruptionState = {
                            type: 'manual_stop',
                            at: new Date().toISOString(),
                            reason: 'Stopped by user'
                        };
                    }
                    this.mainPanel.isSending = false;
                    const sendBtn = document.getElementById('send-btn');
                    const stopBtn = document.getElementById('stop-btn');
                    if (sendBtn) sendBtn.classList.remove('hidden');
                    if (stopBtn) stopBtn.classList.add('hidden');
                    return { output: '⏹ Generation stopped.', style: 'system' };
                } catch (e) {
                    return { output: 'No active generation to stop.', style: 'system' };
                }
            }
        });

        const continueHandler = async () => {
            const sessionId = this.mainPanel.activeTabId;
            const tab = sessionId ? this.mainPanel.chatTabs.get(sessionId) : null;
            if (!sessionId || !tab) {
                return { output: 'No active chat tab to continue.', style: 'system' };
            }
            if (this.mainPanel.isSending || tab.isSending) {
                return { output: 'Generation is already running in this tab.', style: 'system' };
            }

            const state = tab.interruptionState || {};
            let hint = String(state.reason || '').trim();
            if (!hint) {
                try {
                    const conversations = await window.electronAPI.loadChatSession(sessionId);
                    const lastUser = [...conversations].reverse().find(message => message.role === 'user');
                    if (lastUser?.content) {
                        hint = `Resume and complete the response to the most recent user request: "${String(lastUser.content).slice(0, 240)}"`;
                    }
                } catch (error) {
                    // Fallback below.
                }
            }

            const passthrough = hint
                ? `Continue from the interruption and finish the pending response. Context: ${hint}`
                : 'Continue from where you left off and complete the pending response.';
            return { output: null, passthrough, style: 'system' };
        };

        this.commands.set('/continue', {
            description: 'Continue after interruption in current tab',
            execute: continueHandler
        });

        this.commands.set('/resume', {
            description: 'Alias for /continue',
            execute: continueHandler
        });

        // /stats
        this.commands.set('/stats', {
            description: 'Show token usage and conversation stats',
            execute: async () => {
                try {
                    const conversations = await window.electronAPI.getConversations(10000);
                    const sessions = await window.electronAPI.getChatSessions(null, 1000);
                    const usage = this.mainPanel.chatTabs.get(this.mainPanel.activeTabId)?.contextUsage || null;

                    const lines = ['📊 **Stats:**'];
                    lines.push(`  Sessions:     ${sessions?.length || 0}`);
                    lines.push(`  Messages:     ${conversations?.length || 0}`);
                    if (usage) {
                        lines.push(`  Tokens used:  ${usage.total_tokens || 'N/A'}`);
                        lines.push(`  Context max:  ${usage.contextLength || 'N/A'}`);
                    }
                    return { output: lines.join('\n'), style: 'system' };
                } catch (e) {
                    return { output: `Stats error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /tools [list|enable|disable <group>]
        this.commands.set('/tools', {
            description: 'List or toggle tool groups',
            execute: async (args) => {
                try {
                    const groups = await window.electronAPI.getToolGroups();

                    if (!args.length || args[0] === 'list') {
                        const lines = ['🔧 **Tool Groups:**'];
                        for (const g of groups) {
                            const status = g.active ? '✅' : '❌';
                            lines.push(`  ${status} ${g.id.padEnd(15)} ${g.name} — ${g.description}`);
                        }
                        return { output: lines.join('\n'), style: 'system' };
                    }

                    const action = args[0];
                    const groupId = args[1];
                    if (!groupId) return { output: `Usage: /tools ${action} <group_id>`, style: 'system' };

                    if (action === 'enable') {
                        await window.electronAPI.activateToolGroup(groupId);
                        return { output: `✅ Enabled tool group: ${groupId}`, style: 'system' };
                    } else if (action === 'disable') {
                        await window.electronAPI.deactivateToolGroup(groupId);
                        return { output: `❌ Disabled tool group: ${groupId}`, style: 'system' };
                    }

                    return { output: `Unknown action: ${action}. Use list, enable, or disable.`, style: 'system' };
                } catch (e) {
                    return { output: `Tools error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /plugin <name> — quick setup and open Plugin Studio
        this.commands.set('/plugin', {
            description: 'Quick setup plugin and open Plugin Studio (e.g. /plugin searxng)',
            execute: async (args) => {
                try {
                    const pluginName = (args[0] || '').trim();
                    if (!pluginName) {
                        await window.electronAPI.plugins.openStudio({});
                        return { output: 'Opened Plugin Studio.', style: 'system' };
                    }

                    const result = await window.electronAPI.plugins.quickSetup(pluginName);
                    if (!result?.success) {
                        return { output: `Plugin setup failed: ${result?.error || 'unknown error'}`, style: 'system' };
                    }

                    return {
                        output: `Plugin ready: ${result.pluginId} (enabled: ${result.enabled ? 'yes' : 'no'}).`,
                        style: 'system'
                    };
                } catch (e) {
                    return { output: `Plugin command error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /memory [list|read <type> [filename]]
        this.commands.set('/tasks', {
            description: 'Manage global task queue (/tasks list|run|defer|approve|cancel)',
            execute: async (args) => {
                try {
                    const action = String(args[0] || 'list').toLowerCase();
                    const sessionId = this.mainPanel.activeTabId || null;

                    if (action === 'list') {
                        const result = await window.electronAPI.tasks.list({ includeTerminal: false });
                        const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
                        if (!tasks.length) {
                            return { output: '🧾 No active global tasks.', style: 'system' };
                        }
                        const lines = [`🧾 **Global Tasks** (${tasks.length}):`];
                        for (const task of tasks.slice(0, 30)) {
                            const actionLabel = task.action && task.action !== 'none' ? ` | ${task.action}` : '';
                            lines.push(
                                `  ${task.id} [${task.status}] ${task.listener} ${task.requires_user_action ? 'ask-user' : 'auto'} ${actionLabel}`
                            );
                            lines.push(`    ${task.title}`);
                        }
                        if (tasks.length > 30) lines.push(`  ...and ${tasks.length - 30} more`);
                        return { output: lines.join('\n'), style: 'system' };
                    }

                    const taskId = String(args[1] || '').trim();
                    if (!taskId) {
                        return { output: 'Usage: /tasks <list|run|defer|approve|cancel> [task_id] [minutes]', style: 'system' };
                    }

                    if (action === 'run') {
                        const result = await window.electronAPI.tasks.run(taskId, {
                            actor: 'chat-user',
                            owner: 'chat',
                            sessionId
                        });
                        if (!result?.success) {
                            return { output: `Task run failed: ${result?.error || 'unknown error'}`, style: 'system' };
                        }
                        return { output: `▶ Task ${taskId} completed.`, style: 'system' };
                    }

                    if (action === 'defer') {
                        const minutes = Math.max(1, Number(args[2] || 5));
                        const result = await window.electronAPI.tasks.defer(taskId, minutes, {
                            actor: 'chat-user',
                            reason: `Deferred via command for ${minutes} minute(s)`
                        });
                        if (!result?.success) {
                            return { output: `Task defer failed: ${result?.error || 'unknown error'}`, style: 'system' };
                        }
                        return { output: `⏳ Task ${taskId} deferred for ${minutes} minute(s).`, style: 'system' };
                    }

                    if (action === 'approve') {
                        const result = await window.electronAPI.tasks.approve(taskId, { actor: 'chat-user' });
                        if (!result?.success) {
                            return { output: `Task approve failed: ${result?.error || 'unknown error'}`, style: 'system' };
                        }
                        return { output: `✅ Task ${taskId} approved.`, style: 'system' };
                    }

                    if (action === 'cancel') {
                        const result = await window.electronAPI.tasks.cancel(taskId, { actor: 'chat-user' });
                        if (!result?.success) {
                            return { output: `Task cancel failed: ${result?.error || 'unknown error'}`, style: 'system' };
                        }
                        return { output: `🛑 Task ${taskId} cancelled.`, style: 'system' };
                    }

                    return { output: 'Usage: /tasks <list|run|defer|approve|cancel> [task_id] [minutes]', style: 'system' };
                } catch (e) {
                    return { output: `Tasks error: ${e.message}`, style: 'system' };
                }
            }
        });
        this.commands.set('/task', {
            description: 'Alias for /tasks',
            execute: async (args) => this.commands.get('/tasks').execute(args)
        });

        // /memory [list|read <type> [filename]]
        this.commands.set('/memory', {
            description: 'View or list agent memory files',
            execute: async (args) => {
                try {
                    if (!args.length || args[0] === 'list') {
                        const types = ['daily', 'global', 'tasks', 'images'];
                        const lines = ['🧠 **Agent Memory:**'];
                        for (const type of types) {
                            const files = await window.electronAPI.agentMemory.list(type);
                            lines.push(`  ${type}/: ${files.length} file(s)`);
                            files.forEach(f => {
                                const lockIcon = f.locked ? '🔒' : '  ';
                                lines.push(`    ${lockIcon} ${f.filename}`);
                            });
                        }
                        return { output: lines.join('\n'), style: 'system' };
                    }

                    if (args[0] === 'read') {
                        const type = args[1] || 'daily';
                        const filename = args[2] || null;
                        const result = await window.electronAPI.agentMemory.read(type, filename);
                        if (!result.exists) return { output: `No ${type} memory found.`, style: 'system' };
                        return { output: `📄 **${type}** memory:\n\n${result.content}`, style: 'system' };
                    }

                    return { output: 'Usage: /memory [list|read <type> [filename]]', style: 'system' };
                } catch (e) {
                    return { output: `Memory error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /workspace [list|clean]
        this.commands.set('/workspace', {
            description: 'List or clean session workspace files',
            execute: async (args) => {
                try {
                    if (!args.length || args[0] === 'list') {
                        const result = await window.electronAPI.executeMCPTool('list_workspace', {});
                        if (result.error) return { output: `Workspace: ${result.error}`, style: 'system' };

                        if (!result.files || result.files.length === 0) {
                            return { output: '📂 Session workspace is empty.', style: 'system' };
                        }

                        const lines = [`📂 **Workspace** (${result.fileCount} files):`];
                        result.files.forEach(f => {
                            const sizeKB = (f.size / 1024).toFixed(1);
                            lines.push(`  ${f.name} (${sizeKB} KB)`);
                        });
                        return { output: lines.join('\n'), style: 'system' };
                    }

                    if (args[0] === 'clean') {
                        // TODO: implement clean via backend IPC
                        return { output: '🧹 Workspace will be auto-cleaned on session close.', style: 'system' };
                    }

                    return { output: 'Usage: /workspace [list|clean]', style: 'system' };
                } catch (e) {
                    return { output: `Workspace error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /model [name]
        this.commands.set('/model', {
            description: 'Show or switch current model (calls LLM)',
            execute: async (args) => {
                try {
                    const config = await window.electronAPI.llm.getConfig();

                    if (!args.length) {
                        const lines = ['🤖 **Current Model Config:**'];
                        lines.push(`  Provider: ${config.provider || 'N/A'}`);
                        lines.push(`  Model:    ${config.model || 'N/A'}`);
                        return { output: lines.join('\n'), style: 'system' };
                    }

                    // Switch model — send as chat to let AI handle it
                    const switchMsg = `Switch to model: ${args.join(' ')}`;
                    return { output: null, passthrough: switchMsg, style: 'system' };
                } catch (e) {
                    return { output: `Model error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /compact — calls LLM to summarize conversation
        this.commands.set('/compact', {
            description: 'Summarize conversation context (calls LLM)',
            execute: async () => {
                return {
                    output: null,
                    passthrough: 'Please compact and summarize our conversation so far into key points. Keep only the essential context and decisions. Remove redundant details.',
                    style: 'system'
                };
            }
        });

        // /save — save chat + trigger LLM memory creation
        this.commands.set('/save', {
            description: 'Save chat and create memories about recent conversation',
            execute: async () => {
                return {
                    output: null,
                    passthrough: 'Please save a summary of our current conversation to your daily memory. Include key decisions, important information, and any action items.',
                    style: 'system'
                };
            }
        });

        // /terminal <cmd> — run command and show output
        this.commands.set('/terminal', {
            description: 'Execute a terminal command directly',
            execute: async (args) => {
                if (!args.length) {
                    return { output: 'Usage: /terminal <command>', style: 'system' };
                }

                const command = args.join(' ');

                try {
                    const result = await window.electronAPI.executeMCPTool('run_command', {
                        command,
                        output_to_file: false
                    });
                    const commandResult = result?.result?.result || result?.result || result;

                    const lines = [`$ ${command}`];
                    if (commandResult.stdout) lines.push(commandResult.stdout);
                    if (commandResult.stderr) lines.push(`stderr: ${commandResult.stderr}`);
                    if (commandResult.output_mode === 'file') {
                        lines.push(`Output saved to: ${commandResult.file_path}`);
                        if (commandResult.summary) lines.push(commandResult.summary);
                    }
                    lines.push(`Exit code: ${commandResult.exitCode || 0}`);

                    return { output: lines.join('\n'), style: 'terminal' };
                } catch (e) {
                    return { output: `Terminal error: ${e.message}`, style: 'terminal' };
                }
            }
        });

        this.commands.set('/daemon', {
            description: 'Open chat with the Background Daemon agent',
            execute: async () => {
                try {
                    const agents = await window.electronAPI.agents.list();
                    let daemon = (agents || []).find(agent => String(agent.name || '').toLowerCase() === 'background daemon');
                    if (daemon?.type === 'pro') {
                        daemon = await window.electronAPI.agents.update(daemon.id, { type: 'daemon' });
                    }
                    if (!daemon) daemon = await window.electronAPI.agents.create({
                        name: 'Background Daemon',
                        type: 'daemon',
                        icon: '🧠',
                        description: 'Chats with the background memory daemon persona and maintenance rules',
                        system_prompt: 'You are the Background Memory Daemon in interactive chat mode. Inspect daemon state, memory jobs, knowledge, and skills. Be sharp and slim; update existing knowledge/skills before creating duplicates.'
                    });
                    const result = await window.electronAPI.agents.activate(daemon.id);
                    if (result?.sessionId && window.app?.mainPanel?.openAgentChat) {
                        await window.app.mainPanel.openAgentChat(daemon.id, result.sessionId, result.agent || daemon);
                        return { output: 'Opened Background Daemon chat.', style: 'system' };
                    }
                    return { output: 'Unable to open Background Daemon chat.', style: 'system' };
                } catch (e) {
                    return { output: `Daemon chat error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /daemonstart — start background daemons
        this.commands.set('/daemonstart', {
            description: 'Start background memory daemon and workflow scheduler',
            execute: async () => {
                try {
                    const memResult = await window.electronAPI.daemon.memoryStart();
                    const wfResult = await window.electronAPI.daemon.workflowStart();
                    const lines = ['🔄 **Background Daemons:**'];
                    lines.push(`  Memory Daemon: ${memResult.success ? '✅ Started' : '❌ ' + (memResult.error || 'Failed')}`);
                    lines.push(`  Workflow Scheduler: ${wfResult.success ? '✅ Started' : '❌ ' + (wfResult.error || 'Failed')}`);
                    return { output: lines.join('\n'), style: 'system' };
                } catch (e) {
                    return { output: `Daemon start error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /daemonstop — stop background daemons
        this.commands.set('/daemonstop', {
            description: 'Stop background memory daemon and workflow scheduler',
            execute: async () => {
                try {
                    await window.electronAPI.daemon.memoryStop();
                    await window.electronAPI.daemon.workflowStop();
                    return { output: '⏹ Background daemons stopped.', style: 'system' };
                } catch (e) {
                    return { output: `Daemon stop error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /daemonstatus — show daemon status
        this.commands.set('/daemonstatus', {
            description: 'Show background daemon status',
            execute: async () => {
                try {
                    const memStatus = await window.electronAPI.daemon.memoryStatus();
                    const wfStatus = await window.electronAPI.daemon.workflowStatus();

                    const lines = ['📊 **Daemon Status:**', ''];
                    lines.push('**Memory Daemon:**');
                    lines.push(`  Running: ${memStatus.running ? '✅ Yes' : '❌ No'}`);
                    if (memStatus.running) {
                        lines.push(`  Tick: #${memStatus.tickIndex}`);
                        lines.push(`  Tasks completed: ${memStatus.tasksCompleted || 0}`);
                        lines.push(`  Last task: ${memStatus.lastTask || 'none'}`);
                        if (memStatus.nextTickIn) {
                            lines.push(`  Next tick in: ${Math.round(memStatus.nextTickIn / 60000)} min`);
                        }
                    }

                    lines.push('');
                    lines.push('**Workflow Scheduler:**');
                    lines.push(`  Running: ${wfStatus.running ? '✅ Yes' : '❌ No'}`);
                    if (wfStatus.running) {
                        lines.push(`  Tick interval: ${wfStatus.tickInterval} min`);
                        lines.push(`  Scheduled workflows: ${wfStatus.scheduledWorkflows || 0}`);
                        lines.push(`  Due now: ${wfStatus.dueNow || 0}`);
                    }

                    return { output: lines.join('\n'), style: 'system' };
                } catch (e) {
                    return { output: `Status error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /daemonrun — trigger memory daemon tick immediately
        this.commands.set('/daemonrun', {
            description: 'Run one memory daemon tick immediately',
            execute: async () => {
                try {
                    const result = await window.electronAPI.daemon.memoryRunNow();
                    if (result?.success) {
                        return { output: '✅ Memory daemon manual tick completed.', style: 'system' };
                    }
                    return { output: `⚠️ Memory daemon manual tick not run: ${result?.error || 'unknown reason'}`, style: 'system' };
                } catch (e) {
                    return { output: `Daemon run error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /daemonpush — alias for /daemonrun
        this.commands.set('/daemonpush', {
            description: 'Alias for /daemonrun',
            execute: async () => {
                try {
                    const result = await window.electronAPI.daemon.memoryRunNow();
                    if (result?.success) {
                        return { output: '✅ Memory daemon manual tick completed.', style: 'system' };
                    }
                    return { output: `⚠️ Memory daemon manual tick not run: ${result?.error || 'unknown reason'}`, style: 'system' };
                } catch (e) {
                    return { output: `Daemon run error: ${e.message}`, style: 'system' };
                }
            }
        });

        // /loopstop — stop the agent loop (existing, separate from daemon)
        this.commands.set('/loopstop', {
            description: 'Stop the agent loop (automemory triggers)',
            execute: async () => {
                return { output: '⏹ Agent loop automemory paused. Use /daemonstop for background daemons.', style: 'system' };
            }
        });

        // /baseinit — first-time setup
        this.commands.set('/baseinit', {
            description: 'Run first-time agent setup (model, connectivity, daemons)',
            execute: async () => {
                try {
                    const check = await window.electronAPI.baseinit.check();
                    const prefix = check.completed
                        ? '🔄 **Re-running BaseInit** (already completed previously)\n\n'
                        : '🚀 **First-Time Setup (BaseInit)**\n\n';

                    const result = await window.electronAPI.baseinit.run();

                    if (!result.success) {
                        return { output: `❌ BaseInit failed: ${result.error}`, style: 'system' };
                    }

                    const r = result.report;
                    const lines = [prefix];

                    // Model
                    lines.push('**Model Configuration:**');
                    if (r.model.configured) {
                        lines.push(`  ✅ Provider: ${r.model.provider}, Model: ${r.model.model}`);
                    } else {
                        lines.push(`  ⚠️ No model configured — go to Settings to pick one`);
                    }

                    // Connectivity
                    lines.push('\n**Connectivity:**');
                    lines.push(`  Internet: ${r.connectivity.internet ? '✅' : '❌'}`);
                    if (r.connectivity.providers) {
                        for (const [prov, ok] of Object.entries(r.connectivity.providers)) {
                            lines.push(`  ${prov}: ${ok ? '✅' : '❌'}`);
                        }
                    }

                    // Capabilities
                    if (r.capabilities) {
                        lines.push('\n**Capabilities:**');
                        const c = r.capabilities;
                        lines.push(`  Agents: ${c.agents.pro.length} pro, ${c.agents.sub.length} sub`);
                        lines.push(`  Connectors: ${c.connectors.length}`);
                        lines.push(`  Workflows: ${c.workflows}`);
                        lines.push(`  Rules: ${c.rules.active} active / ${c.rules.total} total`);
                    }

                    // Memory health
                    if (r.memoryHealth) {
                        lines.push('\n**Memory Health:**');
                        lines.push(`  Status: ${r.memoryHealth.ok ? '✅ OK' : '⚠️ Issues found'}`);
                        if (r.memoryHealth.issues.length > 0) {
                            r.memoryHealth.issues.forEach(i => lines.push(`  - ${i}`));
                        }
                    }

                    lines.push('\n✅ Background daemons started. Agent is ready.');

                    return { output: lines.join('\n'), style: 'system' };
                } catch (e) {
                    return { output: `BaseInit error: ${e.message}`, style: 'system' };
                }
            }
        });
    }
}

// Export for use in main-panel
if (typeof module !== 'undefined') module.exports = CommandHandler;
