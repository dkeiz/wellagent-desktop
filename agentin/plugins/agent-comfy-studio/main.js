const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

function getBaseUrl(context) {
    return String(context.getConfig('comfyui_url') || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}

function httpRequest(baseUrl, method, urlPath, body = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: { 'Accept': 'application/json' },
            timeout
        };
        if (body) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = lib.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                const contentType = String(res.headers['content-type'] || '');
                if (contentType.includes('application/json') || contentType.includes('text/')) {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(raw.toString('utf-8')), raw });
                    } catch (_) {
                        resolve({ status: res.statusCode, data: raw.toString('utf-8'), raw });
                    }
                } else {
                    resolve({ status: res.statusCode, data: null, raw });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

function fetchBinary(baseUrl, urlPath, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.get(url.href, { timeout }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode,
                data: Buffer.concat(chunks),
                contentType: res.headers['content-type'] || ''
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Workflow Builder ────────────────────────────────────────────────────────

function buildTxt2ImgWorkflow(params) {
    const checkpoint = params.model || params.checkpoint || 'v1-5-pruned-emaonly.safetensors';
    const positive = params.prompt || params.positive || 'beautiful landscape, masterpiece';
    const negative = params.negative || params.negative_prompt || 'low quality, blurry, deformed, ugly';
    const width = Number(params.width) || 512;
    const height = Number(params.height) || 512;
    const steps = Number(params.steps) || 20;
    const cfg = Number(params.cfg) || Number(params.cfg_scale) || 7;
    const sampler = params.sampler || 'euler';
    const scheduler = params.scheduler || 'normal';
    const requestedSeed = params.seed != null ? Number(params.seed) : -1;
    const seed = Number.isFinite(requestedSeed) && requestedSeed >= 0
        ? requestedSeed
        : Math.floor(Math.random() * 2147483647);
    const batchSize = Number(params.batch_size) || 1;
    const loras = Array.isArray(params.loras) ? params.loras : [];

    const workflow = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": checkpoint }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": { "width": width, "height": height, "batch_size": batchSize }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": positive, "clip": ["4", 1] }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": negative, "clip": ["4", 1] }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }
        }
    };

    // Wire LoRAs between checkpoint and KSampler/CLIP
    if (loras.length > 0) {
        let prevModelOutput = ["4", 0];
        let prevClipOutput = ["4", 1];
        loras.forEach((lora, i) => {
            const nodeId = String(100 + i);
            workflow[nodeId] = {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": lora.name || lora,
                    "strength_model": Number(lora.strength_model ?? lora.strength ?? 0.7),
                    "strength_clip": Number(lora.strength_clip ?? lora.strength ?? 0.7),
                    "model": prevModelOutput,
                    "clip": prevClipOutput
                }
            };
            prevModelOutput = [nodeId, 0];
            prevClipOutput = [nodeId, 1];
        });
        // Rewire KSampler and CLIP nodes
        workflow["3"].inputs.model = prevModelOutput;
        workflow["6"].inputs.clip = prevClipOutput;
        workflow["7"].inputs.clip = prevClipOutput;
    }

    return {
        workflow,
        params: { checkpoint, positive, negative, width, height, steps, cfg, sampler, scheduler, seed, batchSize, loras }
    };
}

// ─── PNG Metadata Extraction ─────────────────────────────────────────────────

function extractPngMetadata(filePath) {
    const buffer = fs.readFileSync(filePath);
    const metadata = {};
    // PNG signature check
    if (buffer.length < 8 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
        return { error: 'Not a valid PNG file' };
    }
    let offset = 8;
    while (offset < buffer.length - 4) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'tEXt' || type === 'iTXt') {
            const chunkData = buffer.slice(offset + 8, offset + 8 + length);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
                const key = chunkData.toString('ascii', 0, nullIdx);
                let value;
                if (type === 'iTXt') {
                    // iTXt has compression flag, method, lang, translated keyword before text
                    let pos = nullIdx + 1;
                    const compressionFlag = chunkData[pos]; pos++;
                    pos++; // compression method
                    const langEnd = chunkData.indexOf(0, pos); pos = langEnd + 1;
                    const transEnd = chunkData.indexOf(0, pos); pos = transEnd + 1;
                    value = chunkData.toString('utf-8', pos);
                } else {
                    value = chunkData.toString('utf-8', nullIdx + 1);
                }
                if (key === 'prompt' || key === 'workflow' || key === 'parameters') {
                    try { metadata[key] = JSON.parse(value); }
                    catch (_) { metadata[key] = value; }
                }
            }
        }
        offset += 12 + length; // 4 (length) + 4 (type) + length + 4 (CRC)
    }
    return metadata;
}

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleStatus(params, context) {
    const base = getBaseUrl(context);
    try {
        const res = await httpRequest(base, 'GET', '/system_stats');
        const queue = await httpRequest(base, 'GET', '/queue');
        return {
            success: true,
            server: base,
            connected: true,
            system: res.data,
            queue: {
                running: queue.data?.queue_running?.length || 0,
                pending: queue.data?.queue_pending?.length || 0
            }
        };
    } catch (e) {
        return {
            success: false,
            server: base,
            connected: false,
            error: `Cannot connect to ComfyUI at ${base}: ${e.message}`,
            hint: 'Make sure ComfyUI is running. Start it with: python main.py --listen'
        };
    }
}

async function handleModels(params, context) {
    const base = getBaseUrl(context);
    const filter = String(params.filter || params.type || '').toLowerCase();
    try {
        const res = await httpRequest(base, 'GET', '/object_info', null, 60000);
        const info = res.data || {};
        const result = {};

        // Checkpoints
        const ckptNode = info.CheckpointLoaderSimple;
        if (ckptNode?.input?.required?.ckpt_name?.[0]) {
            result.checkpoints = ckptNode.input.required.ckpt_name[0];
        }

        // LoRAs
        const loraNode = info.LoraLoader;
        if (loraNode?.input?.required?.lora_name?.[0]) {
            result.loras = loraNode.input.required.lora_name[0];
        }

        // Samplers
        const ksamplerNode = info.KSampler;
        if (ksamplerNode?.input?.required?.sampler_name?.[0]) {
            result.samplers = ksamplerNode.input.required.sampler_name[0];
        }
        if (ksamplerNode?.input?.required?.scheduler?.[0]) {
            result.schedulers = ksamplerNode.input.required.scheduler[0];
        }

        // VAE
        const vaeNode = info.VAELoader;
        if (vaeNode?.input?.required?.vae_name?.[0]) {
            result.vaes = vaeNode.input.required.vae_name[0];
        }

        // Filter if requested
        if (filter && result[filter]) {
            return { success: true, type: filter, items: result[filter], count: result[filter].length };
        }

        return {
            success: true,
            checkpoints: result.checkpoints?.length || 0,
            loras: result.loras?.length || 0,
            samplers: result.samplers || [],
            schedulers: result.schedulers || [],
            details: {
                checkpoints: (result.checkpoints || []).slice(0, 50),
                loras: (result.loras || []).slice(0, 50)
            }
        };
    } catch (e) {
        return { success: false, error: `Failed to fetch models: ${e.message}` };
    }
}

async function handleGenerate(params, context) {
    const base = getBaseUrl(context);
    const workflow = params.workflow;
    if (!workflow || typeof workflow !== 'object') {
        return { error: 'workflow is required — use build_workflow tool first, or provide a raw ComfyUI workflow graph' };
    }

    try {
        // Submit prompt
        const submitRes = await httpRequest(base, 'POST', '/prompt', { prompt: workflow });
        const promptId = submitRes.data?.prompt_id;
        if (!promptId) {
            return { success: false, error: 'Failed to queue prompt', response: submitRes.data };
        }

        // Poll for completion
        const maxPollMs = Number(params.timeout) || 300000; // 5 min default
        const pollIntervalMs = 2000;
        const startTime = Date.now();
        let result = null;

        while (Date.now() - startTime < maxPollMs) {
            await sleep(pollIntervalMs);
            const historyRes = await httpRequest(base, 'GET', `/history/${promptId}`);
            const entry = historyRes.data?.[promptId];
            if (entry) {
                if (entry.status?.completed || entry.outputs) {
                    result = entry;
                    break;
                }
                if (entry.status?.status_str === 'error') {
                    return { success: false, error: 'Generation failed', details: entry.status };
                }
            }
        }

        if (!result) {
            return { success: false, error: `Generation timed out after ${maxPollMs / 1000}s`, promptId };
        }

        // Extract output images
        const outputs = [];
        for (const [nodeId, nodeOutput] of Object.entries(result.outputs || {})) {
            if (nodeOutput.images) {
                for (const img of nodeOutput.images) {
                    outputs.push({
                        filename: img.filename,
                        subfolder: img.subfolder || '',
                        type: img.type || 'output',
                        viewUrl: `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`
                    });
                }
            }
        }

        return {
            success: true,
            promptId,
            outputs,
            message: `Generated ${outputs.length} image(s)`,
            hint: outputs.length > 0
                ? `Use view_image tool with filename "${outputs[0].filename}" to fetch the image`
                : 'No output images found'
        };
    } catch (e) {
        return { success: false, error: `Generation failed: ${e.message}` };
    }
}

async function handleViewImage(params, context) {
    const base = getBaseUrl(context);
    const filename = String(params.filename || '');
    const subfolder = String(params.subfolder || '');
    const type = String(params.type || 'output');
    if (!filename) return { error: 'filename is required' };

    try {
        const urlPath = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
        const res = await fetchBinary(base, urlPath);
        if (res.status !== 200) {
            return { success: false, error: `Image not found (${res.status})` };
        }

        // Save to agent outputs if output path provided
        if (params.save_to) {
            const savePath = String(params.save_to);
            const dir = path.dirname(savePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(savePath, res.data);
            return { success: true, savedTo: savePath, size: res.data.length, contentType: res.contentType };
        }

        return {
            success: true,
            filename,
            size: res.data.length,
            contentType: res.contentType,
            base64: res.data.toString('base64').slice(0, 500) + '...',
            message: `Image fetched (${Math.round(res.data.length / 1024)}KB). Provide save_to path to save it.`
        };
    } catch (e) {
        return { success: false, error: `Failed to fetch image: ${e.message}` };
    }
}

function handleExtractPrompt(params) {
    const filePath = String(params.file_path || params.path || '');
    if (!filePath) return { error: 'file_path is required' };
    if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

    const metadata = extractPngMetadata(filePath);
    if (metadata.error) return { success: false, error: metadata.error };

    const hasData = Object.keys(metadata).length > 0;
    return {
        success: true,
        hasMetadata: hasData,
        metadata: hasData ? metadata : null,
        message: hasData
            ? `Found metadata keys: ${Object.keys(metadata).join(', ')}`
            : 'No ComfyUI metadata found in this PNG'
    };
}

function handleBuildWorkflow(params) {
    const built = buildTxt2ImgWorkflow(params);
    return {
        success: true,
        workflow: built.workflow,
        params: built.params,
        message: `Workflow built: ${built.params.checkpoint} | ${built.params.width}×${built.params.height} | ${built.params.steps} steps | seed ${built.params.seed}`,
        hint: 'Pass the workflow object to the generate tool to start generation'
    };
}

async function handleQueue(params, context) {
    const base = getBaseUrl(context);
    const action = String(params.action || 'view').toLowerCase();

    try {
        if (action === 'view') {
            const res = await httpRequest(base, 'GET', '/queue');
            return {
                success: true,
                running: res.data?.queue_running?.length || 0,
                pending: res.data?.queue_pending?.length || 0,
                details: {
                    running: (res.data?.queue_running || []).map(item => ({
                        promptId: item[1],
                        number: item[0]
                    })),
                    pending: (res.data?.queue_pending || []).map(item => ({
                        promptId: item[1],
                        number: item[0]
                    }))
                }
            };
        }

        if (action === 'clear') {
            await httpRequest(base, 'POST', '/queue', { clear: true });
            return { success: true, message: 'Queue cleared' };
        }

        if (action === 'cancel') {
            const promptId = params.prompt_id;
            if (promptId) {
                await httpRequest(base, 'POST', '/queue', { delete: [promptId] });
                return { success: true, message: `Cancelled prompt ${promptId}` };
            }
            // Cancel current
            await httpRequest(base, 'POST', '/interrupt');
            return { success: true, message: 'Interrupted current generation' };
        }

        return { error: `Unknown action: ${action}. Use: view, clear, cancel` };
    } catch (e) {
        return { success: false, error: `Queue operation failed: ${e.message}` };
    }
}

// ─── ChatUI Panel ────────────────────────────────────────────────────────────

let lastStatus = null;
let lastModels = null;
const recentGenerationsByAgent = new Map();

function getRecentKey(agentInfo = {}) {
    return String(agentInfo?.id || agentInfo?.slug || 'default');
}

function rememberGeneration(agentInfo, items) {
    const key = getRecentKey(agentInfo);
    const existing = recentGenerationsByAgent.get(key) || [];
    recentGenerationsByAgent.set(key, [...items, ...existing].slice(0, 8));
}

function getRecentGenerations(agentInfo) {
    return recentGenerationsByAgent.get(getRecentKey(agentInfo)) || [];
}

async function copyOutputsToAgentGallery(outputs, context, agentInfo) {
    const base = getBaseUrl(context);
    const gallery = [];
    const outDir = agentInfo?.folderPath ? path.join(agentInfo.folderPath, 'outputs', 'comfyui') : '';
    if (outDir) ensureDir(outDir);
    for (const output of outputs || []) {
        const urlPath = output.viewUrl || `/view?filename=${encodeURIComponent(output.filename)}&subfolder=${encodeURIComponent(output.subfolder || '')}&type=${encodeURIComponent(output.type || 'output')}`;
        const image = await fetchBinary(base, urlPath, 30000);
        if (image.status !== 200 || !image.data.length) continue;
        const contentType = String(image.contentType || 'image/png').split(';')[0] || 'image/png';
        const safeName = String(output.filename || `comfy-${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '_');
        const savedTo = outDir ? path.join(outDir, `${Date.now()}-${safeName}`) : '';
        if (savedTo) fs.writeFileSync(savedTo, image.data);
        gallery.push({
            filename: output.filename,
            savedTo,
            dataUri: `data:${contentType};base64,${image.data.toString('base64')}`,
            createdAt: new Date().toISOString()
        });
    }
    return gallery;
}

function ensureDir(dirPath) {
    if (!dirPath || fs.existsSync(dirPath)) return;
    fs.mkdirSync(dirPath, { recursive: true });
}

function renderPanel(agentInfo) {
    const connected = lastStatus?.connected === true;
    const statusDot = connected ? '🟢' : '🔴';
    const statusText = connected
        ? `Connected — ${lastStatus.queue?.running || 0} running, ${lastStatus.queue?.pending || 0} pending`
        : 'Not connected';
    const serverUrl = lastStatus?.server || 'http://127.0.0.1:8188';
    const checkpoints = lastModels?.details?.checkpoints || [];
    const modelOptions = checkpoints.length
        ? checkpoints.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
        : '<option value="">Discover models first</option>';
    const recent = getRecentGenerations(agentInfo);
    const galleryHtml = recent.length
        ? `<div class="comfy-gallery">${recent.map(item => `<figure class="comfy-thumb">
            <img src="${escapeHtml(item.dataUri)}" alt="${escapeHtml(item.filename)}">
            <figcaption title="${escapeHtml(item.savedTo || item.filename)}">${escapeHtml(item.filename)}</figcaption>
        </figure>`).join('')}</div>`
        : '';

    return `<section class="comfy-shell">
        <div class="comfy-topbar">
            <strong>🎨 ComfyUI Studio</strong>
            <span class="comfy-status">${statusDot} ${escapeHtml(statusText)}</span>
            <span class="comfy-server-url">${escapeHtml(serverUrl)}</span>
            <button type="button" class="comfy-refresh-btn" data-agent-ui-action="refresh-status" title="Refresh status">↻</button>
            <button type="button" class="comfy-refresh-btn" data-agent-ui-action="load-models" title="Discover models">Models</button>
        </div>
        <form class="comfy-quick-section" data-agent-ui-action="quick-generate">
            <label class="comfy-field comfy-field-wide">
                <span>Prompt</span>
                <textarea name="prompt" rows="2" placeholder="cinematic portrait, warm light, highly detailed"></textarea>
            </label>
            <label class="comfy-field comfy-field-wide">
                <span>Negative</span>
                <input name="negative" value="low quality, blurry, deformed, watermark">
            </label>
            <label class="comfy-field comfy-field-wide">
                <span>Model</span>
                <select name="model">${modelOptions}</select>
            </label>
            <label class="comfy-field"><span>Width</span><input name="width" type="number" value="512" min="64" step="64"></label>
            <label class="comfy-field"><span>Height</span><input name="height" type="number" value="512" min="64" step="64"></label>
            <label class="comfy-field"><span>Steps</span><input name="steps" type="number" value="20" min="1" max="80"></label>
            <label class="comfy-field"><span>CFG</span><input name="cfg" type="number" value="7" min="1" max="30" step="0.5"></label>
            <button type="submit" class="comfy-generate-btn" ${connected ? '' : 'disabled'}>Generate</button>
        </form>
        ${galleryHtml}
    </section>`;
}

const css = `
.comfy-shell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
    padding: 8px 10px;
    margin-bottom: 6px;
}
.comfy-topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    flex-wrap: wrap;
}
.comfy-status {
    font-size: 12px;
    color: var(--text-secondary);
    margin-left: auto;
}
.comfy-server-url {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: monospace;
    padding: 1px 6px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.comfy-refresh-btn {
    min-height: 24px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
    padding: 0 7px;
}
.comfy-refresh-btn:hover {
    background: rgba(127,127,127,0.1);
}
.comfy-quick-section {
    display: grid;
    grid-template-columns: minmax(220px, 1.4fr) minmax(180px, 1fr) repeat(4, minmax(64px, 0.35fr)) auto;
    align-items: end;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 7px;
}
.comfy-field {
    display: grid;
    gap: 2px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    min-width: 0;
}
.comfy-field input,
.comfy-field select,
.comfy-field textarea {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--input-bg, var(--bg-primary));
    color: var(--text-primary);
    padding: 4px 7px;
    font: inherit;
    min-height: 28px;
}
.comfy-field textarea {
    min-height: 48px;
    resize: vertical;
}
.comfy-field-wide {
    min-width: 0;
}
.comfy-quick-section > .comfy-field-wide:nth-of-type(3) {
    grid-column: span 2;
}
.comfy-generate-btn {
    min-height: 28px;
    border: 1px solid var(--accent, #6c5ce7);
    border-radius: 4px;
    background: var(--accent, #6c5ce7);
    color: #fff;
    cursor: pointer;
    padding: 0 14px;
    white-space: nowrap;
}
.comfy-generate-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
.comfy-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
    gap: 6px;
}
.comfy-thumb {
    margin: 0;
    min-width: 0;
}
.comfy-thumb img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--border-color);
}
.comfy-thumb figcaption,
.comfy-empty {
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
@media (max-width: 960px) {
    .comfy-quick-section {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .comfy-field-wide,
    .comfy-quick-section > .comfy-field-wide:nth-of-type(3) {
        grid-column: span 4;
    }
    .comfy-generate-btn {
        grid-column: span 4;
    }
}
`;

// ─── Plugin Exports ──────────────────────────────────────────────────────────

module.exports = {
    onEnable(context) {
        // ── status tool ──
        context.registerHandler('status', {
            description: 'Check ComfyUI server health, VRAM usage, and queue status.',
            inputSchema: { type: 'object', properties: {}, required: [] }
        }, async (params) => {
            const result = await handleStatus(params, context);
            lastStatus = result;
            return result;
        });

        // ── models tool ──
        context.registerHandler('models', {
            description: 'List available ComfyUI models (checkpoints, LoRAs, samplers, schedulers, VAEs). Use filter to show only one type.',
            inputSchema: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Filter: checkpoints | loras | samplers | schedulers | vaes' },
                    type: { type: 'string', description: 'Alias for filter' }
                }
            }
        }, async (params) => handleModels(params, context));

        // ── generate tool ──
        context.registerHandler('generate', {
            description: 'Submit a ComfyUI workflow graph for image generation. Polls until complete and returns output image filenames. Use build_workflow to create the workflow first.',
            inputSchema: {
                type: 'object',
                properties: {
                    workflow: { type: 'object', description: 'ComfyUI workflow graph JSON (output from build_workflow)' },
                    timeout: { type: 'number', description: 'Max wait time in milliseconds (default: 300000 = 5min)' }
                },
                required: ['workflow']
            }
        }, async (params) => handleGenerate(params, context));

        // ── view_image tool ──
        context.registerHandler('view_image', {
            description: 'Fetch a generated image from ComfyUI by filename. Optionally save to a local path.',
            inputSchema: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Image filename from generate output' },
                    subfolder: { type: 'string', description: 'Subfolder (usually empty)' },
                    type: { type: 'string', description: 'Image type: output | input | temp (default: output)' },
                    save_to: { type: 'string', description: 'Local file path to save the image to' }
                },
                required: ['filename']
            }
        }, async (params) => handleViewImage(params, context));

        // ── extract_prompt tool ──
        context.registerHandler('extract_prompt', {
            description: 'Extract embedded ComfyUI workflow/prompt metadata from a PNG file.',
            inputSchema: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Path to PNG file' },
                    path: { type: 'string', description: 'Alias for file_path' }
                },
                required: ['file_path']
            }
        }, (params) => handleExtractPrompt(params));

        // ── build_workflow tool ──
        context.registerHandler('build_workflow', {
            description: 'Build a standard txt2img ComfyUI workflow from simplified parameters. Returns workflow JSON ready for the generate tool.',
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Positive prompt text' },
                    positive: { type: 'string', description: 'Alias for prompt' },
                    negative: { type: 'string', description: 'Negative prompt text' },
                    negative_prompt: { type: 'string', description: 'Alias for negative' },
                    model: { type: 'string', description: 'Checkpoint model filename' },
                    checkpoint: { type: 'string', description: 'Alias for model' },
                    width: { type: 'number', description: 'Image width (default: 512)' },
                    height: { type: 'number', description: 'Image height (default: 512)' },
                    steps: { type: 'number', description: 'Sampling steps (default: 20)' },
                    cfg: { type: 'number', description: 'CFG scale (default: 7)' },
                    cfg_scale: { type: 'number', description: 'Alias for cfg' },
                    sampler: { type: 'string', description: 'Sampler name (default: euler)' },
                    scheduler: { type: 'string', description: 'Scheduler (default: normal)' },
                    seed: { type: 'number', description: 'Random seed (-1 for random)' },
                    batch_size: { type: 'number', description: 'Batch size (default: 1)' },
                    loras: {
                        type: 'array',
                        description: 'Array of LoRA objects: [{name, strength_model?, strength_clip?}]',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                strength: { type: 'number' },
                                strength_model: { type: 'number' },
                                strength_clip: { type: 'number' }
                            }
                        }
                    }
                }
            }
        }, (params) => handleBuildWorkflow(params));

        // ── queue tool ──
        context.registerHandler('queue', {
            description: 'View, clear, or cancel items in the ComfyUI generation queue.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'view | clear | cancel', enum: ['view', 'clear', 'cancel'] },
                    prompt_id: { type: 'string', description: 'Prompt ID to cancel (for action:"cancel")' }
                },
                required: ['action']
            }
        }, async (params) => handleQueue(params, context));

        // ── ChatUI ──
        context.registerChatUI({
            title: 'ComfyUI Studio',
            renderPanel,
            css,
            actions: {
                refresh({ agentInfo }) {
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                async 'refresh-status'({ agentInfo }) {
                    lastStatus = await handleStatus({}, context);
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                async 'load-models'({ agentInfo }) {
                    lastModels = await handleModels({}, context);
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                async 'quick-generate'({ agentInfo, payload }) {
                    lastStatus = await handleStatus({}, context);
                    if (!lastStatus.connected) {
                        return { success: true, html: renderPanel(agentInfo), css };
                    }
                    const workflowResult = handleBuildWorkflow({
                        prompt: payload.prompt,
                        negative: payload.negative,
                        model: payload.model,
                        width: payload.width,
                        height: payload.height,
                        steps: payload.steps,
                        cfg: payload.cfg,
                        seed: -1
                    });
                    const generation = await handleGenerate({ workflow: workflowResult.workflow }, context);
                    if (generation.success && generation.outputs?.length) {
                        const gallery = await copyOutputsToAgentGallery(generation.outputs, context, agentInfo);
                        rememberGeneration(agentInfo, gallery);
                    }
                    return { success: true, html: renderPanel(agentInfo), css };
                }
            },
            onTabActivated(agentInfo, payload, pluginContext) {
                pluginContext.log(`ComfyUI Studio UI active for ${agentInfo.name}`);
            }
        });

        // Check status on enable
        handleStatus({}, context).then(s => { lastStatus = s; }).catch(() => {});

        context.log('ComfyUI Studio registered');
    },

    onDisable(context) {
        lastStatus = null;
        context.log('ComfyUI Studio disabled');
    }
};
