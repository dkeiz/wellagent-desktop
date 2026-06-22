/**
 * Tool Chain Controller
 * 
 * Manages multi-step tool execution with auto-continuation.
 * When LLM calls a tool and gets a result, this controller decides
 * whether to continue (if LLM just echoed the result) or stop.
 */

const { stripToolPatterns: stripToolText } = require('./ipc/shared-utils');
const { isPrivateSessionId } = require('./private-session-store');

class ToolChainController {
    constructor(dispatcher, mcpServer, db) {
        this.dispatcher = dispatcher;
        this.mcpServer = mcpServer;
        this.db = db;
        this.maxChainSteps = Number.POSITIVE_INFINITY;
        this.currentChain = []; // Track current tool chain for workflow learning
        this.stopped = false; // For aborting chains
        this.stoppedRuns = new Set(); // Run-scoped aborts for delegated subagents
        this.workflowManager = null; // Set via setWorkflowManager()
        this.autoCapture = false; // Toggle via setAutoCapture()
        this.nonDedupeTools = new Set([
            'subagent',
            'run_subagent'
        ]);
    }

    /**
     * Set the workflow manager for auto-capture
     */
    setWorkflowManager(wm) {
        this.workflowManager = wm;
    }

    /**
     * Toggle auto-capture of successful tool chains as workflows
     */
    setAutoCapture(enabled) {
        this.autoCapture = enabled;
        console.log(`[Chain] Auto-capture ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Stop the current chain
     */
    stopChain(runId = null) {
        const scopedRunId = String(runId || '').trim();
        if (scopedRunId) {
            this.stoppedRuns.add(scopedRunId);
            console.log(`[Chain] Chain stopped by user for run ${scopedRunId}`);
            return;
        }
        this.stopped = true;
        console.log('[Chain] Chain stopped by user');
    }

    _isStopped(options = {}) {
        const scopedRunId = String(options.subagentRunId || '').trim();
        return this.stopped || (scopedRunId && this.stoppedRuns.has(scopedRunId));
    }

    async _emitTrace(trace, hookName, payload) {
        if (!trace || typeof trace[hookName] !== 'function') {
            return;
        }

        try {
            await trace[hookName](payload);
        } catch (error) {
            console.error(`[Chain] Trace hook ${hookName} failed:`, error.message);
        }
    }

    /**
     * Strip TOOL: patterns from text (brace-depth aware)
     */
    stripToolPatterns(text) {
        return stripToolText(text);
    }

    _decodeXmlEntities(text) {
        return String(text || '')
            .replace(/&quot;/gi, '"')
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');
    }

    _coerceInvokeParamValue(rawValue) {
        const value = this._decodeXmlEntities(rawValue).trim();
        if (!value) return '';

        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            try {
                return JSON.parse(value);
            } catch (_) {
                return value;
            }
        }

        if (/^-?\d+(\.\d+)?$/.test(value)) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        if (/^(true|false)$/i.test(value)) {
            return value.toLowerCase() === 'true';
        }

        if (/^null$/i.test(value)) {
            return null;
        }

        return value;
    }

    _normalizeInvokeToolCalls(text) {
        const source = String(text || '');
        const invokePattern = /<invoke\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
        const toolLines = [];
        let match;

        while ((match = invokePattern.exec(source)) !== null) {
            const toolName = String(match[1] || '').trim();
            if (!toolName) continue;

            const params = {};
            const body = String(match[2] || '');
            const paramPattern = /<parameter\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/gi;
            let paramMatch;
            while ((paramMatch = paramPattern.exec(body)) !== null) {
                const key = String(paramMatch[1] || '').trim();
                if (!key) continue;
                params[key] = this._coerceInvokeParamValue(paramMatch[2] || '');
            }

            toolLines.push(`TOOL:${toolName}${JSON.stringify(params)}`);
        }

        if (toolLines.length === 0) {
            return source;
        }

        return `${source}\n${toolLines.join('\n')}`;
    }

    _shouldSkipDuplicate(call) {
        if (!call || !call.toolName) {
            return false;
        }
        if (this.nonDedupeTools.has(call.toolName)) {
            return false;
        }

        const dedupeKey = `${call.toolName}:${JSON.stringify(call.params)}`;
        const alreadyExecuted = Array.from(this.executedToolCalls.values())
            .some(prev => `${prev.toolName}:${JSON.stringify(prev.params)}` === dedupeKey);
        return alreadyExecuted;
    }

    _buildToolResultsMessage(toolContext, originalUserMessage) {
        return `<tool_results>\n${toolContext}\n</tool_results>\n\n<original_user_question>${originalUserMessage}</original_user_question>\nThe tool results above were auto-generated by the backend. Based on these results, provide a natural, helpful answer to the original user question shown above. Do NOT call these same tools again.`;
    }

    _buildDispatchOptions(options = {}, completionTools = new Set()) {
        const dispatchOptions = {
            mode: options.mode || 'chat',
            sessionId: options.sessionId,
            agentId: options.agentId
        };
        const passthroughKeys = [
            'provider',
            'model',
            'modelSpec',
            'runtimeConfig',
            'thinkingMode',
            'temperature',
            'max_tokens',
            'concurrencyMode',
            'concurrency_mode',
            'runtimePolicyProfile',
            'runtime_policy_profile',
            'runtimePolicyGrants',
            'runtime_policy_grants',
            'policyProfile',
            'principal',
            'subagentRunId',
            'includeTools',
            'includeRules',
            'includeEnv',
            'skipMemoryOnStart',
            'skipLock',
            'preemptible'
        ];

        for (const key of passthroughKeys) {
            if (options[key] !== undefined) {
                dispatchOptions[key] = options[key];
            }
        }
        if (completionTools.size > 0) {
            dispatchOptions.completionTools = Array.from(completionTools);
        }
        return dispatchOptions;
    }

    _buildToolExecutionContext(options = {}) {
        const context = {
            sessionId: options.sessionId,
            source: options.mode === 'chat' ? 'chat-llm' : (options.mode || 'unknown'),
            agentId: options.agentId || null,
            subagentRunId: options.subagentRunId || null
        };
        const runtimePolicyProfile = options.runtimePolicyProfile
            || options.runtime_policy_profile
            || options.policyProfile
            || null;
        const runtimePolicyGrants = options.runtimePolicyGrants
            || options.runtime_policy_grants
            || null;
        if (runtimePolicyProfile) context.runtimePolicyProfile = runtimePolicyProfile;
        if (runtimePolicyGrants) context.runtimePolicyGrants = runtimePolicyGrants;
        if (options.principal) context.principal = options.principal;
        return context;
    }

    /**
     * Execute a message with tool chaining support
     * @param {string} message - User message
     * @param {Array} conversationHistory - Previous conversation
     * @param {Object} options - Additional options
     * @returns {Object} Final response with chain info
     */
    async executeWithChaining(message, conversationHistory = [], options = {}) {
        this.currentChain = [];
        this.stopped = false; // Reset global stop flag for new chain
        this.executedToolCalls = new Map(); // Track executed tool calls by ID
        const isPrivateMode = options.private === true || isPrivateSessionId(options.sessionId);
        const completionTools = new Set(options.completionTools || []);
        const trace = isPrivateMode ? null : (options.trace || null);
        let stepCount = 0;
        let currentMessage = message;
        let originalUserMessage = message; // Keep reference to user's actual question
        let workingHistory = [...conversationHistory];
        let finalResponse = null;
        let lastLLMResponse = null; // Track last response for fallback

        const maxSteps = await this._resolveMaxChainSteps(options);

        while (stepCount < maxSteps) {
            // Check if chain was stopped by user
            if (this._isStopped(options)) {
                console.log('[Chain] Chain stopped by user');
                break;
            }

            stepCount++;
            console.log(`[Chain] Step ${stepCount}: Processing message`);

            // Send message to LLM via dispatcher.
            // On continuation steps, currentMessage is null — tool results are in workingHistory.
            const dispatchOptions = this._buildDispatchOptions(options, completionTools);

            const response = await this.dispatcher.dispatch(currentMessage, workingHistory, dispatchOptions);
            if (this._isStopped(options)) {
                console.log('[Chain] Chain stopped by user');
                break;
            }
            lastLLMResponse = response;

            // Parse tool calls from response
            const normalizedContent = this._normalizeInvokeToolCalls(response.content);
            const toolCalls = this.mcpServer.parseToolCall(normalizedContent);
            await this._emitTrace(trace, 'onAssistantMessage', {
                step: stepCount,
                content: response.content,
                toolCalls
            });

            if (toolCalls.length === 0) {
                // No tool calls - this is the final answer
                // Clean any leftover TOOL: patterns from content
                finalResponse = {
                    ...response,
                    content: this.stripToolPatterns(response.content) || response.content
                };
                break;
            }

            // Execute tool calls
            const toolResults = [];
            let attemptedThisStep = false;
            for (const call of toolCalls) {
                try {
                    if (this._isStopped(options)) {
                        console.log('[Chain] Chain stopped by user');
                        break;
                    }
                    // Check for duplicate tool call
                    if (this._shouldSkipDuplicate(call)) {
                        console.log(`[Chain] Skipping duplicate tool call: ${call.toolName}`);
                        continue;
                    }
                    attemptedThisStep = true;
                    await this._emitTrace(trace, 'onToolQueued', {
                        step: stepCount,
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        params: call.params
                    });

                    // Pass tool call ID to executeTool
                    const result = await this.mcpServer.executeTool(
                        call.toolName,
                        call.params,
                        call.toolCallId,  // Pass the unique ID
                        {
                            context: this._buildToolExecutionContext(options)
                        }
                    );

                    if (completionTools.has(call.toolName)) {
                        finalResponse = {
                            content: this.stripToolPatterns(response.content) || response.content,
                            reasoning: response.reasoning || '',
                            model: response.model,
                            usage: response.usage,
                            chainComplete: true,
                            completionTool: call.toolName,
                            completionResult: result.result,
                            renderContext: response.renderContext
                        };
                        break;
                    }

                    // Check if it's the special end_answer tool
                    if (call.toolName === 'end_answer') {
                        finalResponse = {
                            content: result.result?.answer || this.stripToolPatterns(response.content) || response.content,
                            reasoning: response.reasoning || '',
                            model: response.model,
                            usage: response.usage,
                            chainComplete: true,
                            renderContext: response.renderContext
                        };
                        break;
                    }

                    // Check for permission requirement
                    if (result && result.needsPermission) {
                        // Return the LLM's text (stripped of TOOL: calls) with permission info
                        finalResponse = {
                            content: this.stripToolPatterns(response.content) || response.content,
                            reasoning: response.reasoning || '',
                            model: response.model,
                            needsPermission: true,
                            permissionRequest: result,
                            renderContext: response.renderContext
                        };
                        break;
                    }
                    // Track this execution
                    this.executedToolCalls.set(call.toolCallId, {
                        toolName: call.toolName,
                        params: call.params,
                        success: true,
                        result: result.result,
                        timestamp: result.timestamp
                    });

                    toolResults.push({
                        toolCallId: call.toolCallId,  // Include unique ID
                        tool: call.toolName,
                        params: call.params,
                        timestamp: result.timestamp,  // Include timestamp
                        success: true,
                        result: result.result  // Unwrap the actual result
                    });
                    await this._emitTrace(trace, 'onToolResult', {
                        step: stepCount,
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        params: call.params,
                        success: true,
                        result: result.result,
                        timestamp: result.timestamp
                    });

                    if (!isPrivateMode) {
                        // Add to current chain for workflow learning
                        this.currentChain.push({
                            tool: call.toolName,
                            params: call.params,
                            result: result.result
                        });
                    }

                } catch (error) {
                    this.executedToolCalls.set(call.toolCallId, {
                        toolName: call.toolName,
                        params: call.params,
                        success: false,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                    toolResults.push({
                        toolCallId: call.toolCallId,
                        tool: call.toolName,
                        params: call.params,
                        success: false,
                        error: error.message
                    });
                    await this._emitTrace(trace, 'onToolResult', {
                        step: stepCount,
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        params: call.params,
                        success: false,
                        error: error.message
                    });
                }
            }

            // If we got a final response (end_answer or permission needed), break
            if (finalResponse) break;
            if (!attemptedThisStep) {
                finalResponse = {
                    ...response,
                    content: this.stripToolPatterns(response.content) || response.content
                };
                break;
            }

            // Build tool results context with tracking metadata
            const toolContext = toolResults.map(r => {
                if (r.success) {
                    return `[Tool Call ID: ${r.toolCallId}]
Tool: "${r.tool}"
Timestamp: ${r.timestamp}
Result: ${JSON.stringify(r.result)}

✓ This tool was successfully executed. Do NOT call it again with the same parameters.`;
                } else {
                    return `[Tool Call ID: ${r.toolCallId}]
Tool: "${r.tool}"
Error: ${r.error}`;
                }
            }).join('\n\n---\n\n');

            const toolResultsMessage = this._buildToolResultsMessage(toolContext, originalUserMessage);

            // Add LLM's response (with tool calls) to history as assistant turn
            workingHistory.push({ role: 'assistant', content: response.content });
            // Add tool results as a structured block — use <tool_results> tags
            // so the model can distinguish them from real user messages.
            // Include original question so model doesn't lose track.
            workingHistory.push({
                role: 'user',
                content: toolResultsMessage
            });
            await this._emitTrace(trace, 'onSyntheticUserMessage', {
                step: stepCount,
                content: toolResultsMessage,
                kind: 'tool_results'
            });

            // CRITICAL FIX: Set to null so sendMessage doesn't add another empty user message
            currentMessage = null;
        }

        // Handle case where loop ended without finalResponse (maxSteps exceeded)
        if (!finalResponse && lastLLMResponse) {
            console.log('[Chain] Max steps reached, using last response');
            finalResponse = {
                ...lastLLMResponse,
                content: this.stripToolPatterns(lastLLMResponse.content) || 'I ran into an issue processing your request. Please try again.',
                chainExhausted: true,
                maxChainSteps: maxSteps,
                reasoning: lastLLMResponse.reasoning || '',
                renderContext: lastLLMResponse.renderContext
            };
        }

        // Safety: ensure we always return something
        if (!finalResponse) {
            finalResponse = {
                content: 'Sorry, I was unable to process your request. Please try again.',
                model: 'unknown',
                usage: { total_tokens: 0 },
                reasoning: '',
                renderContext: null
            };
        }

        // Add chain metadata to response
        finalResponse.chain = {
            steps: stepCount,
            tools: isPrivateMode ? [] : this.currentChain.map(c => c.tool),
            private: isPrivateMode
        };

        const scopedRunId = String(options.subagentRunId || '').trim();
        if (scopedRunId) {
            this.stoppedRuns.delete(scopedRunId);
        }

        // Auto-capture successful chains as workflows (2+ unique tools)
        if (!isPrivateMode && this.autoCapture && this.workflowManager && this.currentChain.length >= 2 && !finalResponse.chainExhausted) {
            try {
                const originalMsg = options._originalMessage || message || '';
                await this.workflowManager.captureWorkflow(originalMsg, this.currentChain);
                console.log(`[Chain] Auto-captured workflow from ${this.currentChain.length}-step chain`);
            } catch (err) {
                console.error('[Chain] Auto-capture failed:', err.message);
            }
        }

        return finalResponse;
    }

    async _resolveMaxChainSteps(options = {}) {
        const fromOptions = Number(options.maxChainSteps);
        if (Number.isFinite(fromOptions) && fromOptions > 0) {
            return Math.max(1, Math.floor(fromOptions));
        }

        if (this.db && typeof this.db.getSetting === 'function') {
            try {
                const setting = await this.db.getSetting('tool_chain_max_steps');
                const parsed = Number(setting);
                if (Number.isFinite(parsed) && parsed > 0) {
                    return Math.max(1, Math.floor(parsed));
                }
            } catch (error) {
                // Fall through to default.
            }
        }

        return this.maxChainSteps;
    }

    /**
     * Get the current tool chain (for workflow learning)
     */
    getCurrentChain() {
        return this.currentChain;
    }

    /**
     * Clear the current chain
     */
    clearChain() {
        this.currentChain = [];
    }
}

module.exports = ToolChainController;
