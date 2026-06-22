class WorkflowEditor {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.selectedNode = null;
        this.draggingNode = null;
        this.connectingFrom = null;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.nodeIdCounter = 0;
        this.toolGroups = [];
        this.tools = [];
        this.providers = [];
        this.currentWorkflowId = null;
        this.canvas = null;
        this.canvasContainer = null;
        this.connectionsLayer = null;
        this.nodePalette = null;
        this.connectingPointer = null;
        this.connectMoved = false;
        this.init();
    }
    async init() {
        this.canvas = document.getElementById('workflow-canvas');
        this.canvasContainer = document.getElementById('workflow-canvas-container');
        this.connectionsLayer = document.getElementById('workflow-connections');
        this.nodePalette = document.getElementById('node-palette');
        if (!this.canvas) return;
        await this.loadTools();
        this.setupEventListeners();
        this.renderNodePalette();
        await this.loadSavedWorkflows();
        window.electronAPI?.onWorkflowUpdate?.(() => {
            this.loadSavedWorkflows();
        });
    }
    async loadTools() {
        try {
            this.tools = await window.electronAPI.getMCPTools?.() || [];
            this.toolGroups = await window.electronAPI.getToolGroups?.() || [];
            this.providers = await window.electronAPI.getProviders?.() || [];
        } catch (error) {
            console.error('Failed to load tools:', error);
        }
    }
    setupEventListeners() {
        document.getElementById('add-node-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.nodePalette?.classList.toggle('visible');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.add-node-dropdown')) {
                this.nodePalette?.classList.remove('visible');
            }
        });
        document.getElementById('new-workflow-btn')?.addEventListener('click', () => this.newWorkflow());
        document.getElementById('save-workflow-btn')?.addEventListener('click', () => this.saveWorkflow());
        document.getElementById('run-workflow-btn')?.addEventListener('click', () => this.runWorkflow());
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        document.getElementById('collapse-workflows-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('saved-workflows-panel');
            const btn = document.getElementById('collapse-workflows-btn');
            const isCollapsed = Boolean(panel?.classList.toggle('collapsed'));
            btn?.setAttribute('aria-expanded', String(!isCollapsed));
        });
        document.getElementById('compact-workflows-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('saved-workflows-panel');
            const btn = document.getElementById('compact-workflows-btn');
            panel?.classList.toggle('compact');
            if (btn) btn.textContent = panel?.classList.contains('compact') ? '▦' : '▤';
        });
        this.canvas?.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        document.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.connectingFrom) return;
            this.connectingFrom = null;
            this.connectingPointer = null;
            this.connectMoved = false;
            this.canvasContainer?.classList.remove('workflow-interacting');
            this.renderConnections();
        });
    }
    renderNodePalette() {
        if (!this.nodePalette) return;
        const groupedTools = new Map();
        const toolToGroup = new Map();
        this.toolGroups.forEach(group => {
            groupedTools.set(group.id, { ...group, tools: [] });
            group.tools.forEach(toolName => toolToGroup.set(toolName, group.id));
        });
        this.tools.forEach(tool => {
            const groupId = toolToGroup.get(tool.name);
            if (groupId && groupedTools.has(groupId)) {
                groupedTools.get(groupId).tools.push(tool);
            }
        });
        let html = `
            <div class="palette-group">
                <div class="palette-group-header">Agentic</div>
                <div class="palette-group-items">
                    <div class="palette-item agent-palette-item" data-node-type="agent" title="Add an agent step that transforms previous output into the next step input">
                        Agent Activity
                    </div>
                </div>
            </div>
        `;
        for (const [groupId, group] of groupedTools) {
            if (group.tools.length === 0) continue;
            html += `
                <div class="palette-group">
                    <div class="palette-group-header">${group.icon} ${group.name}</div>
                    <div class="palette-group-items">
                        ${group.tools.map(tool => `
                            <div class="palette-item" data-tool="${tool.name}" title="${tool.description}">
                                ${tool.name}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        this.nodePalette.innerHTML = html;
        this.nodePalette.querySelectorAll('.palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const nodeType = item.dataset.nodeType;
                if (nodeType === 'agent') {
                    this.addAgentNode();
                } else {
                    const toolName = item.dataset.tool;
                    this.addNode(toolName);
                }
                this.nodePalette.classList.remove('visible');
            });
        });
    }
    addNode(toolName, x = null, y = null, presetParams = null) {
        const tool = this.tools.find(t => t.name === toolName);
        const id = `node-${++this.nodeIdCounter}`;
        const nodeX = x ?? 100 + (this.nodes.size * 220);
        const nodeY = y ?? 150;
        let inputSchema = tool?.inputSchema || null;
        if (!inputSchema && presetParams && Object.keys(presetParams).length > 0) {
            inputSchema = {
                type: 'object',
                properties: Object.fromEntries(
                    Object.keys(presetParams).map(k => [k, { type: 'string', description: k }])
                )
            };
        }
        const node = {
            id,
            type: 'tool',
            tool: toolName,
            x: nodeX,
            y: nodeY,
            params: presetParams ? { ...presetParams } : {},
            inputSchema,
            description: tool?.description || toolName
        };
        this.nodes.set(id, node);
        this.renderNode(node);
        return node;
    }
    addAgentNode(x = null, y = null, preset = null) {
        const id = preset?.id || `node-${++this.nodeIdCounter}`;
        const node = {
            id,
            type: 'agent',
            agent: preset?.agent || 'workflow-agent',
            name: preset?.name || 'Agent Activity',
            goal: preset?.goal || 'Transform the previous step output into JSON for the next step.',
            input: preset?.input || '{{previous.output}}',
            required_output: preset?.required_output || { next_params: 'object' },
            final: preset?.final === true,
            prompt: preset?.prompt || '',
            llm: preset?.llm || {
                provider: preset?.provider || '',
                model: preset?.model || '',
                on_error: preset?.on_model_error || 'default'
            },
            x: x ?? 100 + (this.nodes.size * 220),
            y: y ?? 150,
            description: 'Workflow-local agent activity'
        };
        this.nodes.set(id, node);
        this.renderNode(node);
        return node;
    }
    renameNodeId(node, newId) {
        if (!node || !newId || node.id === newId) return node;
        const oldId = node.id;
        const nodeEl = document.getElementById(oldId);
        this.nodes.delete(oldId);
        node.id = newId;
        this.nodes.set(newId, node);
        if (nodeEl) {
            nodeEl.id = newId;
            nodeEl.querySelectorAll('[data-node]').forEach(el => {
                el.dataset.node = newId;
            });
        }
        this.connections = this.connections.map(conn => ({
            from: conn.from === oldId ? newId : conn.from,
            to: conn.to === oldId ? newId : conn.to
        }));
        return node;
    }
    renderNode(node) {
        const nodeEl = document.createElement('div');
        nodeEl.className = `workflow-node ${node.type === 'agent' ? 'agent-node' : 'tool-node'}`;
        nodeEl.id = node.id;
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
        if (node.type === 'agent') {
            this.renderAgentNode(node, nodeEl);
            this.canvas.appendChild(nodeEl);
            return;
        }
        const params = node.inputSchema?.properties || {};
        const paramKeys = Object.keys(params).slice(0, 3); // Show first 3 params
        nodeEl.innerHTML = `
            <div class="node-header" data-node="${node.id}">
                <span class="node-title">${node.tool}</span>
                <button class="node-delete-btn" data-node="${node.id}" title="Delete">×</button>
            </div>
            <div class="node-body">
                ${paramKeys.map(key => `
                    <div class="node-param">
                        <label>${key}</label>
                        <input type="text" class="node-param-input" 
                               data-node="${node.id}" 
                               data-param="${key}"
                               placeholder="${params[key].description || key}"
                               value="${node.params[key] || ''}">
                    </div>
                `).join('')}
                ${Object.keys(params).length > 3 ? `<div class="node-param-more">+${Object.keys(params).length - 3} more</div>` : ''}
            </div>
            <div class="node-connectors">
                <div class="node-connector input" data-node="${node.id}" data-type="input" title="Input"></div>
                <div class="node-connector output" data-node="${node.id}" data-type="output" title="Output"></div>
            </div>
        `;
        nodeEl.querySelector('.node-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteNode(node.id);
        });
        nodeEl.querySelector('.node-header').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startDragging(node.id, e);
        });
        nodeEl.querySelectorAll('.node-param-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const nodeId = e.target.dataset.node;
                const paramName = e.target.dataset.param;
                const n = this.nodes.get(nodeId);
                if (n) {
                    n.params[paramName] = e.target.value;
                }
            });
        });
        this.bindNodeConnectors(nodeEl);
        this.canvas.appendChild(nodeEl);
    }
    renderAgentNode(node, nodeEl) {
        const requiredOutput = JSON.stringify(node.required_output || { next_params: 'object' }, null, 2);
        nodeEl.innerHTML = `
            <div class="node-header" data-node="${node.id}">
                <span class="node-title">Agent: ${node.name || node.agent || 'Activity'}</span>
                <button class="node-delete-btn" data-node="${node.id}" title="Delete">×</button>
            </div>
            <div class="node-body">
                <div class="node-param">
                    <label>agent</label>
                    <input type="text" class="node-agent-input" data-node="${node.id}" data-field="agent"
                           placeholder="workflow-agent" value="${node.agent || ''}">
                </div>
                <div class="node-param">
                    <label>goal</label>
                    <textarea class="node-agent-input node-agent-textarea" data-node="${node.id}" data-field="goal"
                              placeholder="What should this agent decide?">${node.goal || ''}</textarea>
                </div>
                <details class="node-agent-advanced">
                    <summary>Advanced</summary>
                    <div class="node-param">
                        <label>input</label>
                        <input type="text" class="node-agent-input" data-node="${node.id}" data-field="input"
                               placeholder="{{previous.output}}" value="${node.input || '{{previous.output}}'}">
                    </div>
                    <div class="node-param">
                        <label>required output JSON</label>
                        <textarea class="node-agent-input node-agent-textarea node-json-textarea" data-node="${node.id}" data-field="required_output"
                                  placeholder='{"next_params":"object"}'>${requiredOutput}</textarea>
                    </div>
                    <label class="node-agent-final">
                        <input type="checkbox" class="node-agent-input" data-node="${node.id}" data-field="final" ${node.final ? 'checked' : ''}>
                        Final output
                    </label>
                    <div class="node-agent-model-grid">
                        <div class="node-param">
                            <label>provider</label>
                            <select class="node-agent-llm-input" data-node="${node.id}" data-llm-field="provider">
                                ${this.renderProviderOptions(node.llm?.provider || '')}
                            </select>
                        </div>
                        <div class="node-param">
                            <label>model</label>
                            <select class="node-agent-llm-input" data-node="${node.id}" data-llm-field="model">
                                ${this.renderModelOptions(node.llm?.model || '')}
                            </select>
                        </div>
                    </div>
                    <div class="node-param">
                        <label>on model error</label>
                        <select class="node-agent-llm-input" data-node="${node.id}" data-llm-field="on_error">
                            <option value="default" ${(node.llm?.on_error || 'default') === 'default' ? 'selected' : ''}>Fallback to default</option>
                            <option value="error" ${node.llm?.on_error === 'error' ? 'selected' : ''}>Stop workflow</option>
                        </select>
                    </div>
                </details>
            </div>
            <div class="node-connectors">
                <div class="node-connector input" data-node="${node.id}" data-type="input" title="Input"></div>
                <div class="node-connector output" data-node="${node.id}" data-type="output" title="Output"></div>
            </div>
        `;
        nodeEl.querySelector('.node-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteNode(node.id);
        });
        nodeEl.querySelector('.node-header').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startDragging(node.id, e);
        });
        nodeEl.querySelectorAll('.node-agent-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const n = this.nodes.get(e.target.dataset.node);
                if (!n) return;
                const field = e.target.dataset.field;
                if (field === 'final') {
                    n.final = e.target.checked;
                    return;
                }
                if (field === 'required_output') {
                    try {
                        n.required_output = JSON.parse(e.target.value || '{}');
                    } catch (_) {
                        window.mainPanel?.showNotification('Required output must be valid JSON', 'error');
                    }
                    return;
                }
                n[field] = e.target.value;
            });
        });
        this.bindNodeConnectors(nodeEl);
        nodeEl.querySelectorAll('.node-agent-llm-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const n = this.nodes.get(e.target.dataset.node);
                if (!n) return;
                n.llm = n.llm || {};
                n.llm[e.target.dataset.llmField] = e.target.value;
                if (e.target.dataset.llmField === 'provider') {
                    n.llm.model = '';
                    this.populateAgentModelOptions(nodeEl, n).catch(error => {
                        console.warn('Failed to load workflow agent models:', error);
                    });
                }
            });
        });
        this.populateAgentModelOptions(nodeEl, node).catch(error => {
            console.warn('Failed to load workflow agent models:', error);
        });
    }
    renderProviderOptions(selectedProvider) {
        const providers = [''].concat(Array.isArray(this.providers) ? this.providers : []);
        const unique = Array.from(new Set(providers.map(provider => String(provider || '').trim())));
        return unique.map(provider => {
            const label = provider || 'Default';
            const selected = provider === selectedProvider ? 'selected' : '';
            return `<option value="${provider}" ${selected}>${label}</option>`;
        }).join('');
    }
    renderModelOptions(selectedModel, models = []) {
        const options = [''].concat(models || []);
        if (selectedModel && !options.includes(selectedModel)) options.push(selectedModel);
        return Array.from(new Set(options)).map(model => {
            const label = model || 'Default';
            const selected = model === selectedModel ? 'selected' : '';
            return `<option value="${model}" ${selected}>${label}</option>`;
        }).join('');
    }
    async populateAgentModelOptions(nodeEl, node) {
        const modelSelect = nodeEl.querySelector('[data-llm-field="model"]');
        if (!modelSelect) return;
        const provider = String(node.llm?.provider || '').trim();
        const selected = String(node.llm?.model || '').trim();
        if (!provider || !window.electronAPI?.llm?.getModels) {
            modelSelect.innerHTML = this.renderModelOptions(selected);
            return;
        }
        const models = await window.electronAPI.llm.getModels(provider, false);
        modelSelect.innerHTML = this.renderModelOptions(selected, Array.isArray(models) ? models : []);
    }
    bindNodeConnectors(nodeEl) {
        nodeEl.querySelectorAll('.node-connector').forEach(connector => {
            connector.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nodeId = e.target.dataset.node;
                const type = e.target.dataset.type;
                if (type === 'output') {
                    this.startConnecting(nodeId, e);
                    return;
                }
                if (type === 'input' && this.connectingFrom) {
                    this.finishConnecting(nodeId);
                }
            });
        });
    }
    deleteNode(nodeId) {
        const nodeEl = document.getElementById(nodeId);
        if (nodeEl) nodeEl.remove();
        this.nodes.delete(nodeId);
        this.connections = this.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
        this.renderConnections();
    }
    startDragging(nodeId, e) {
        this.draggingNode = {
            id: nodeId,
            startX: e.clientX,
            startY: e.clientY,
            nodeStartX: this.nodes.get(nodeId)?.x || 0,
            nodeStartY: this.nodes.get(nodeId)?.y || 0
        };
        window.getSelection?.().removeAllRanges?.();
        this.canvasContainer?.classList.add('workflow-interacting');
    }
    startConnecting(nodeId, e) {
        this.connectingFrom = nodeId;
        this.connectMoved = false;
        const rect = this.canvas?.getBoundingClientRect?.();
        if (rect) this.connectingPointer = { x: (e.clientX - rect.left) / this.zoom, y: (e.clientY - rect.top) / this.zoom };
        window.getSelection?.().removeAllRanges?.();
        this.canvasContainer?.classList.add('workflow-interacting');
        this.renderConnections();
    }
    finishConnecting(toNodeId) {
        if (this.connectingFrom && this.connectingFrom !== toNodeId) {
            const exists = this.connections.some(c =>
                c.from === this.connectingFrom && c.to === toNodeId
            );
            if (!exists) {
                this.connections.push({ from: this.connectingFrom, to: toNodeId });
            }
        }
        this.connectingFrom = null;
        this.connectingPointer = null;
        this.connectMoved = false;
        this.canvasContainer?.classList.remove('workflow-interacting');
        this.renderConnections();
    }
    onCanvasMouseDown(e) {
        if (e.target === this.canvas) {
            this.selectedNode = null;
            if (this.connectingFrom) {
                this.connectingFrom = null;
                this.connectingPointer = null;
                this.connectMoved = false;
                this.canvasContainer?.classList.remove('workflow-interacting');
                this.renderConnections();
            }
        }
    }
    onCanvasMouseMove(e) {
        if (this.draggingNode) {
            e.preventDefault?.();
            const dx = (e.clientX - this.draggingNode.startX) / this.zoom;
            const dy = (e.clientY - this.draggingNode.startY) / this.zoom;
            const node = this.nodes.get(this.draggingNode.id);
            if (node) {
                node.x = this.draggingNode.nodeStartX + dx;
                node.y = this.draggingNode.nodeStartY + dy;
                const nodeEl = document.getElementById(this.draggingNode.id);
                if (nodeEl) {
                    nodeEl.style.left = `${node.x}px`;
                    nodeEl.style.top = `${node.y}px`;
                }
                this.renderConnections();
            }
            return;
        }
        if (this.connectingFrom && this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            this.connectingPointer = { x: (e.clientX - rect.left) / this.zoom, y: (e.clientY - rect.top) / this.zoom };
            this.connectMoved = true;
            this.renderConnections();
        }
    }
    onCanvasMouseUp(e) {
        if (this.draggingNode) {
            this.draggingNode = null;
            if (!this.connectingFrom) this.canvasContainer?.classList.remove('workflow-interacting');
            return;
        }
        if (!this.connectingFrom) {
            this.canvasContainer?.classList.remove('workflow-interacting');
            return;
        }
        const direct = e.target?.closest?.('.node-connector.input');
        const hover = direct || document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node-connector.input');
        if (hover?.dataset?.node) {
            this.finishConnecting(hover.dataset.node);
            return;
        }
        if (this.connectMoved) {
            this.connectingFrom = null;
            this.connectingPointer = null;
            this.connectMoved = false;
            this.canvasContainer?.classList.remove('workflow-interacting');
            this.renderConnections();
        }
    }
    renderConnections() {
        if (!this.connectionsLayer) return;
        let svg = '';
        this.connections.forEach(conn => {
            const fromNode = this.nodes.get(conn.from);
            const toNode = this.nodes.get(conn.to);
            if (!fromNode || !toNode) return;
            const fromEl = document.getElementById(fromNode.id);
            const toEl = document.getElementById(toNode.id);
            const fromWidth = fromEl?.offsetWidth || (fromNode.type === 'agent' ? 240 : 200);
            const fromHeight = fromEl?.offsetHeight || 80;
            const toHeight = toEl?.offsetHeight || 80;
            const fromX = fromNode.x + fromWidth;
            const fromY = fromNode.y + (fromHeight / 2);
            const toX = toNode.x;
            const toY = toNode.y + (toHeight / 2);
            const cx1 = fromX + 50;
            const cy1 = fromY;
            const cx2 = toX - 50;
            const cy2 = toY;
            svg += `<path d="M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}" 
                          class="connection-line" stroke="#4ade80" stroke-width="2" fill="none"/>`;
        });
        if (this.connectingFrom && this.connectingPointer) {
            const fromNode = this.nodes.get(this.connectingFrom);
            const fromEl = fromNode ? document.getElementById(fromNode.id) : null;
            if (fromNode) {
                const fromWidth = fromEl?.offsetWidth || (fromNode.type === 'agent' ? 240 : 200);
                const fromHeight = fromEl?.offsetHeight || 80;
                const fromX = fromNode.x + fromWidth;
                const fromY = fromNode.y + (fromHeight / 2);
                const toX = this.connectingPointer.x;
                const toY = this.connectingPointer.y;
                const cx1 = fromX + 50;
                const cx2 = toX - 50;
                svg += `<path d="M ${fromX} ${fromY} C ${cx1} ${fromY}, ${cx2} ${toY}, ${toX} ${toY}" class="connection-line connection-line-preview" stroke="#60a5fa" stroke-width="2" stroke-dasharray="6 4" fill="none"/>`;
            }
        }
        this.connectionsLayer.innerHTML = svg;
    }
    setZoom(level) {
        this.zoom = Math.max(0.5, Math.min(2, level));
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
        this.canvas.style.transform = `scale(${this.zoom})`;
    }
    newWorkflow() {
        document.getElementById('workflow-name-input').value = '';
        this.nodes.clear();
        this.connections = [];
        this.connectingFrom = null;
        this.connectingPointer = null;
        this.connectMoved = false;
        this.canvas.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.canvasContainer?.classList.remove('workflow-interacting');
        this.nodeIdCounter = 0;
        this.currentWorkflowId = null;
    }
    serializeNode(node) {
        if (node.type === 'agent') {
            return {
                type: 'agent',
                id: node.id,
                agent: node.agent || node.name || 'workflow-agent',
                name: node.name || node.agent || 'Agent Activity',
                goal: node.goal || '',
                input: node.input || '{{previous.output}}',
                required_output: node.required_output || { next_params: 'object' },
                final: node.final === true,
                prompt: node.prompt || '',
                llm: this.compactLlmOverride(node.llm)
            };
        }
        return {
            type: 'tool',
            id: node.id,
            tool: node.tool,
            params: node.params || {},
            params_from: node.params_from
        };
    }
    getWorkflowLabel(node) {
        return node.type === 'agent'
            ? `agent:${node.agent || node.name || node.id}`
            : node.tool;
    }
    compactLlmOverride(llm = {}) {
        const compact = {};
        if (llm.provider) compact.provider = llm.provider;
        if (llm.model) compact.model = llm.model;
        if (llm.on_error && llm.on_error !== 'default') compact.on_error = llm.on_error;
        return Object.keys(compact).length > 0 ? compact : undefined;
    }
    async saveWorkflow({ silent = false } = {}) {
        const name = document.getElementById('workflow-name-input')?.value.trim();
        if (!name) {
            window.mainPanel?.showNotification('Please enter a workflow name', 'error');
            return;
        }
        if (this.nodes.size === 0) {
            window.mainPanel?.showNotification('Add at least one node', 'error');
            return;
        }
        const toolChain = this.getExecutionOrder().map(nodeId => {
            const node = this.nodes.get(nodeId);
            return this.serializeNode(node);
        });
        const workflow = {
            name,
            description: `Visual workflow: ${Array.from(this.nodes.values()).map(n => this.getWorkflowLabel(n)).join(' -> ')}`,
            tool_chain: toolChain,
            visual_data: {
                nodes: Array.from(this.nodes.values()),
                connections: this.connections
            }
        };
        try {
            const result = this.currentWorkflowId && window.electronAPI.updateWorkflow
                ? await window.electronAPI.updateWorkflow(this.currentWorkflowId, workflow)
                : await window.electronAPI.saveWorkflow(workflow);
            if (result?.workflow?.id) this.currentWorkflowId = result.workflow.id;
            if (!silent) {
                window.mainPanel?.showNotification('Workflow saved!');
                await this.loadSavedWorkflows();
            }
            return result?.workflow || null;
        } catch (error) {
            console.error('Failed to save workflow:', error);
            if (!silent) window.mainPanel?.showNotification('Failed to save workflow', 'error');
            return null;
        }
    }
    getExecutionOrder() {
        const inDegree = new Map();
        const adjacency = new Map();
        for (const [id] of this.nodes) {
            inDegree.set(id, 0);
            adjacency.set(id, []);
        }
        this.connections.forEach(conn => {
            adjacency.get(conn.from)?.push(conn.to);
            inDegree.set(conn.to, (inDegree.get(conn.to) || 0) + 1);
        });
        const queue = [];
        for (const [id, degree] of inDegree) {
            if (degree === 0) queue.push(id);
        }
        const order = [];
        while (queue.length > 0) {
            const current = queue.shift();
            order.push(current);
            for (const neighbor of adjacency.get(current) || []) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            }
        }
        return order;
    }
    async runWorkflow() {
        const toolChain = this.getExecutionOrder().map(nodeId => {
            const node = this.nodes.get(nodeId);
            return { ...this.serializeNode(node), nodeId };
        });
        if (toolChain.length === 0) {
            window.mainPanel?.showNotification('No nodes to execute', 'error');
            return;
        }
        window.sidebar?.switchTab?.('chat');
        const workflowName = document.getElementById('workflow-name-input')?.value || 'Unnamed Workflow';
        window.mainPanel?.addMessage('system', `▶️ **Running workflow: ${workflowName}** (${toolChain.length} steps)`);
        if (toolChain.some(step => step.type === 'agent')) {
            const saved = await this.saveWorkflow({ silent: true });
            if (!saved?.id) {
                window.mainPanel?.addMessage('system', '❌ Agent workflows must be saved before running.');
                return;
            }
            const result = await window.electronAPI.runWorkflow(saved.id);
            if (result.results) {
                for (const r of result.results) {
                    const label = r.tool || r.agent || r.id;
                    const previewSource = r.output !== undefined ? r.output : r.result;
                    const preview = typeof previewSource === 'object'
                        ? JSON.stringify(previewSource, null, 2).slice(0, 500)
                        : String(previewSource || '').slice(0, 500);
                    window.mainPanel?.addMessage('system', `${r.success ? '✅' : '❌'} **${label}**\n\`\`\`\n${preview || r.error || ''}\n\`\`\``);
                }
            }
            window.mainPanel?.addMessage('system', result.success
                ? `🎉 **Workflow "${workflowName}" completed successfully!**`
                : `⚠️ **Workflow "${workflowName}" stopped due to error**`);
            await this.loadSavedWorkflows();
            return;
        }
        let allSuccess = true;
        for (const step of toolChain) {
            try {
                const nodeEl = document.getElementById(step.nodeId);
                if (nodeEl) nodeEl.classList.add('executing');
                const result = await window.electronAPI.executeMCPTool(step.tool, step.params);
                if (nodeEl) {
                    nodeEl.classList.remove('executing');
                    nodeEl.classList.add('executed');
                    setTimeout(() => nodeEl.classList.remove('executed'), 3000);
                }
                const preview = typeof result === 'object' ? JSON.stringify(result, null, 2).slice(0, 500) : String(result).slice(0, 500);
                window.mainPanel?.addMessage('system', `✅ **${step.tool}**\n\`\`\`\n${preview}\n\`\`\``);
            } catch (error) {
                allSuccess = false;
                const nodeEl = document.getElementById(step.nodeId);
                if (nodeEl) {
                    nodeEl.classList.remove('executing');
                    nodeEl.classList.add('error');
                }
                window.mainPanel?.addMessage('system', `❌ **${step.tool}** failed: ${error.message}`);
                break;
            }
        }
        window.mainPanel?.addMessage('system', allSuccess
            ? `🎉 **Workflow "${workflowName}" completed successfully!**`
            : `⚠️ **Workflow "${workflowName}" stopped due to error**`);
    }
    async loadSavedWorkflows() {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];
            const tabListEl = document.getElementById('workflows-list');
            if (tabListEl) {
                if (workflows.length === 0) {
                    tabListEl.innerHTML = '<div class="no-workflows">No saved workflows yet.<br><small>Create one using the canvas above, or ask the AI to create one.</small></div>';
                } else {
                    this._renderWorkflowList(tabListEl, workflows, true);
                }
            }
            const sidebarListEl = document.getElementById('saved-workflows-list');
            if (sidebarListEl) {
                const recentWorkflows = workflows
                    .filter(w => w.last_used || (w.success_count || 0) + (w.failure_count || 0) > 0)
                    .slice(0, 5);
                if (recentWorkflows.length === 0) {
                    sidebarListEl.innerHTML = '<div class="no-workflows" style="font-size:0.75rem;padding:0.5rem;">No active workflows</div>';
                } else {
                    this._renderWorkflowList(sidebarListEl, recentWorkflows, false);
                }
            }
        } catch (error) {
            console.error('Failed to load workflows:', error);
        }
    }
    /**
     * Render workflow items into a container
     * @param {HTMLElement} container - target element
     * @param {Array} workflows - workflow objects
     * @param {boolean} fullControls - show all buttons (tab panel) vs compact (sidebar)
     */
    _renderWorkflowList(container, workflows, fullControls) {
        container.innerHTML = workflows.map(w => {
            let tools = [];
            try { tools = typeof w.tool_chain === 'string' ? JSON.parse(w.tool_chain) : (w.tool_chain || []); } catch(e) {}
            const toolNames = tools.map(s => s.tool || `agent:${s.agent || s.id || s.name || 'step'}`).join(' → ');
            const stats = (w.success_count || 0) + (w.failure_count || 0);
            const successRate = stats > 0 ? Math.round(((w.success_count || 0) / stats) * 100) : null;
            const actionBtns = fullControls
                ? `<button class="load-workflow-btn icon-btn" data-id="${w.id}" title="Load into editor">📂</button>
                   <button class="copy-workflow-btn icon-btn" data-id="${w.id}" title="Copy workflow">📋</button>
                   <button class="run-saved-workflow-btn icon-btn" data-id="${w.id}" title="Run workflow">▶️</button>
                   <button class="delete-workflow-btn icon-btn" data-id="${w.id}" title="Delete">🗑️</button>`
                : `<button class="run-saved-workflow-btn icon-btn" data-id="${w.id}" title="Run workflow">▶️</button>`;
            return `
            <div class="saved-workflow-item" data-id="${w.id}" title="${w.description || ''}">
                <div class="workflow-item-info">
                    <span class="workflow-item-name">🔄 ${w.name}</span>
                    <span class="workflow-item-tools">${toolNames || 'No tools'}</span>
                    ${stats > 0 ? `<span class="workflow-item-stats">${stats} runs${successRate !== null ? ` • ${successRate}% success` : ''}</span>` : ''}
                </div>
                <div class="workflow-item-actions">
                    ${actionBtns}
                </div>
            </div>
        `}).join('');
        if (fullControls) {
            container.querySelectorAll('.load-workflow-btn').forEach(btn => {
                btn.addEventListener('click', () => this.loadWorkflow(btn.dataset.id));
            });
            container.querySelectorAll('.copy-workflow-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await window.electronAPI.copyWorkflow(parseInt(btn.dataset.id));
                        window.mainPanel?.showNotification('Workflow copied!');
                        await this.loadSavedWorkflows();
                    } catch (error) {
                        console.error('Failed to copy workflow:', error);
                        window.mainPanel?.showNotification('Failed to copy workflow', 'error');
                    }
                });
            });
            container.querySelectorAll('.delete-workflow-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Delete this workflow?')) {
                        await window.electronAPI.deleteWorkflow(parseInt(btn.dataset.id));
                        await this.loadSavedWorkflows();
                    }
                });
            });
        }
        container.querySelectorAll('.run-saved-workflow-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    btn.textContent = '⏳';
                    const wfId = parseInt(btn.dataset.id);
                    window.sidebar?.switchTab?.('chat');
                    const wfItem = btn.closest('.saved-workflow-item');
                    const wfName = wfItem?.querySelector('.workflow-item-name')?.textContent?.replace('🔄 ', '') || `Workflow #${wfId}`;
                    window.mainPanel?.addMessage('system', `▶️ **Running workflow: ${wfName}**`);
                    const result = await window.electronAPI.runWorkflow(wfId);
                    btn.textContent = '▶️';
                    if (result.results) {
                        for (const r of result.results) {
                            if (r.success) {
                                const preview = typeof r.result === 'object' ? JSON.stringify(r.result, null, 2).slice(0, 500) : String(r.result || '').slice(0, 500);
                                window.mainPanel?.addMessage('system', `✅ **${r.tool || r.agent || r.id}**\n\`\`\`\n${preview}\n\`\`\``);
                            } else {
                                window.mainPanel?.addMessage('system', `❌ **${r.tool}** failed: ${r.error}`);
                            }
                        }
                    }
                    window.mainPanel?.addMessage('system', result.success
                        ? `🎉 **Workflow "${wfName}" completed!**`
                        : `⚠️ **Workflow "${wfName}" failed**`);
                    await this.loadSavedWorkflows();
                } catch (error) {
                    btn.textContent = '▶️';
                    console.error('Failed to run workflow:', error);
                    window.mainPanel?.addMessage('system', `❌ Workflow execution error: ${error.message}`);
                }
            });
        });
    }
    async loadWorkflow(workflowId) {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];
            const workflow = workflows.find(w => w.id == workflowId);
            if (!workflow) return;
            this.newWorkflow();
            this.currentWorkflowId = workflow.id;
            document.getElementById('workflow-name-input').value = workflow.name;
            if (workflow.visual_data) {
                const visualData = typeof workflow.visual_data === 'string'
                    ? JSON.parse(workflow.visual_data)
                    : workflow.visual_data;
                visualData.nodes?.forEach(node => {
                    if (node.type === 'agent') {
                        this.addAgentNode(node.x, node.y, node);
                    } else {
                        const newNode = this.addNode(node.tool, node.x, node.y);
                        if (newNode && node.params) {
                            newNode.params = node.params;
                        }
                        if (newNode && node.id) this.renameNodeId(newNode, node.id);
                    }
                });
                this.connections = visualData.connections || [];
                this.renderConnections();
            } else {
                const toolChain = typeof workflow.tool_chain === 'string'
                    ? JSON.parse(workflow.tool_chain)
                    : workflow.tool_chain;
                toolChain.forEach((step, idx) => {
                    if (String(step.type || '').toLowerCase() === 'agent' || !step.tool) {
                        this.addAgentNode(100 + idx * 220, 150, step);
                    } else {
                        const node = this.addNode(step.tool, 100 + idx * 220, 150, step.params || {});
                        if (node) {
                            if (step.id) this.renameNodeId(node, step.id);
                            node.params_from = step.params_from;
                        }
                    }
                });
                const nodeIds = Array.from(this.nodes.keys());
                for (let i = 0; i < nodeIds.length - 1; i++) {
                    this.connections.push({ from: nodeIds[i], to: nodeIds[i + 1] });
                }
                this.renderConnections();
            }
            this.nodeIdCounter = Math.max(
                this.nodeIdCounter,
                ...Array.from(this.nodes.keys()).map(id => {
                    const match = String(id).match(/^node-(\d+)$/);
                    return match ? Number(match[1]) : 0;
                })
            );
            window.mainPanel?.showNotification('Workflow loaded');
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
    }
}
window.WorkflowEditor = WorkflowEditor;
