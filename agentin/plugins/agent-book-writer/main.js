const fs = require('fs');
const path = require('path');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function slug(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || `item-${Date.now()}`;
}

function readJson(filePath, fallback = null) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (_) {}
    return fallback;
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function listJsonFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const data = readJson(path.join(dirPath, f));
            return data ? { ...data, _file: f } : null;
        })
        .filter(Boolean);
}

// ─── State ───────────────────────────────────────────────────────────────────

const projectState = new Map();

function getStateFile(agentInfo) {
    return agentInfo?.folderPath ? path.join(agentInfo.folderPath, 'tasks', 'book-writer-state.json') : '';
}

function getState(agentInfo) {
    const key = String(agentInfo?.id || agentInfo?.slug || 'default');
    if (!projectState.has(key)) {
        const stateFile = getStateFile(agentInfo);
        const saved = stateFile ? readJson(stateFile, null) : null;
        projectState.set(key, { activeProject: saved?.activeProject || 'default' });
    }
    return projectState.get(key);
}

function persistState(agentInfo) {
    const stateFile = getStateFile(agentInfo);
    if (!stateFile) return;
    writeJson(stateFile, getState(agentInfo));
}

function resolveProjectPaths(agentInfo) {
    const state = getState(agentInfo);
    const home = agentInfo?.folderPath || '';
    const project = state.activeProject || 'default';
    const elementsDir = path.join(home, 'tasks', 'elements', project);
    const outlinesDir = path.join(home, 'tasks', 'outlines');
    const outputsDir = path.join(home, 'outputs', project);
    const chaptersDir = path.join(outputsDir, 'chapters');
    return { home, project, elementsDir, outlinesDir, outputsDir, chaptersDir };
}

// ─── Tool Implementations ────────────────────────────────────────────────────

function handleProject(params, agentInfo) {
    const action = String(params.action || 'list').toLowerCase();
    const state = getState(agentInfo);
    const home = agentInfo?.folderPath || '';
    const projectsRoot = path.join(home, 'tasks', 'elements');
    ensureDir(projectsRoot);

    if (action === 'create') {
        const name = String(params.name || '').trim();
        if (!name) return { error: 'Project name is required' };
        const projectSlug = slug(name);
        const projectDir = path.join(projectsRoot, projectSlug);
        ensureDir(projectDir);
        ensureDir(path.join(home, 'outputs', projectSlug, 'chapters'));
        const meta = { name, slug: projectSlug, createdAt: new Date().toISOString() };
        writeJson(path.join(projectDir, '_project.json'), meta);
        state.activeProject = projectSlug;
        persistState(agentInfo);
        return { success: true, project: meta, message: `Created and switched to project "${name}"` };
    }

    if (action === 'switch') {
        const target = slug(params.name || params.project || '');
        if (!target) return { error: 'Project name is required' };
        if (!fs.existsSync(path.join(projectsRoot, target))) {
            return { error: `Project "${target}" not found` };
        }
        state.activeProject = target;
        persistState(agentInfo);
        return { success: true, activeProject: target };
    }

    if (action === 'list') {
        const projects = [];
        if (fs.existsSync(projectsRoot)) {
            for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readJson(path.join(projectsRoot, entry.name, '_project.json'), { name: entry.name, slug: entry.name });
                const elemCount = listJsonFiles(path.join(projectsRoot, entry.name)).filter(e => !e._file?.startsWith('_')).length;
                projects.push({ ...meta, elementCount: elemCount, active: entry.name === state.activeProject });
            }
        }
        if (projects.length === 0) {
            ensureDir(path.join(projectsRoot, 'default'));
            projects.push({ name: 'default', slug: 'default', elementCount: 0, active: true });
        }
        projects.forEach(project => { project.active = project.slug === state.activeProject; });
        return { success: true, projects, activeProject: state.activeProject };
    }

    return { error: `Unknown action: ${action}. Use: create, switch, list` };
}

function handleElement(params, agentInfo) {
    const action = String(params.action || 'list').toLowerCase();
    const paths = resolveProjectPaths(agentInfo);
    ensureDir(paths.elementsDir);

    if (action === 'create') {
        const type = String(params.type || 'note').toLowerCase();
        const name = String(params.name || '').trim();
        const content = String(params.content || '').trim();
        if (!name) return { error: 'Element name is required' };
        const elemSlug = slug(name);
        const element = {
            id: elemSlug,
            type,
            name,
            content,
            tags: Array.isArray(params.tags) ? params.tags : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        writeJson(path.join(paths.elementsDir, `${elemSlug}.json`), element);
        return { success: true, element, message: `Created ${type} "${name}"` };
    }

    if (action === 'update') {
        const id = slug(params.id || params.name || '');
        const filePath = path.join(paths.elementsDir, `${id}.json`);
        const existing = readJson(filePath);
        if (!existing) return { error: `Element "${id}" not found` };
        if (params.name) existing.name = params.name;
        if (params.content) existing.content = params.content;
        if (params.type) existing.type = params.type;
        if (params.tags) existing.tags = params.tags;
        existing.updatedAt = new Date().toISOString();
        writeJson(filePath, existing);
        return { success: true, element: existing };
    }

    if (action === 'get') {
        const id = slug(params.id || params.name || '');
        const element = readJson(path.join(paths.elementsDir, `${id}.json`));
        if (!element) return { error: `Element "${id}" not found` };
        return { success: true, element };
    }

    if (action === 'delete') {
        const id = slug(params.id || params.name || '');
        const filePath = path.join(paths.elementsDir, `${id}.json`);
        if (!fs.existsSync(filePath)) return { error: `Element "${id}" not found` };
        fs.unlinkSync(filePath);
        return { success: true, message: `Deleted element "${id}"` };
    }

    if (action === 'list') {
        const typeFilter = params.type ? String(params.type).toLowerCase() : null;
        let elements = listJsonFiles(paths.elementsDir).filter(e => !e._file?.startsWith('_'));
        if (typeFilter) {
            elements = elements.filter(e => e.type === typeFilter);
        }
        return {
            success: true,
            project: paths.project,
            count: elements.length,
            elements: elements.map(e => ({ id: e.id, type: e.type, name: e.name, tags: e.tags || [] }))
        };
    }

    return { error: `Unknown action: ${action}. Use: create, update, get, delete, list` };
}

function handleOutline(params, agentInfo) {
    const action = String(params.action || 'get').toLowerCase();
    const paths = resolveProjectPaths(agentInfo);
    ensureDir(paths.outlinesDir);
    const outlineFile = path.join(paths.outlinesDir, `${paths.project}.json`);

    if (action === 'create' || action === 'set') {
        const title = String(params.title || 'Untitled Book');
        const chapters = Array.isArray(params.chapters) ? params.chapters : [];
        const outline = {
            title,
            project: paths.project,
            chapters: chapters.map((ch, i) => ({
                number: i + 1,
                title: ch.title || `Chapter ${i + 1}`,
                summary: ch.summary || '',
                characters: ch.characters || [],
                locations: ch.locations || [],
                plotPoints: ch.plotPoints || ch.plot_points || [],
                status: ch.status || 'planned',
                notes: ch.notes || ''
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        writeJson(outlineFile, outline);
        return { success: true, outline, message: `Outline created with ${outline.chapters.length} chapter(s)` };
    }

    if (action === 'add_chapter') {
        const outline = readJson(outlineFile);
        if (!outline) return { error: 'No outline exists. Create one first with action:"create"' };
        const number = outline.chapters.length + 1;
        const chapter = {
            number,
            title: params.title || `Chapter ${number}`,
            summary: params.summary || '',
            characters: params.characters || [],
            locations: params.locations || [],
            plotPoints: params.plotPoints || params.plot_points || [],
            status: 'planned',
            notes: params.notes || ''
        };
        outline.chapters.push(chapter);
        outline.updatedAt = new Date().toISOString();
        writeJson(outlineFile, outline);
        return { success: true, chapter, totalChapters: outline.chapters.length };
    }

    if (action === 'update_chapter') {
        const outline = readJson(outlineFile);
        if (!outline) return { error: 'No outline exists' };
        const num = Number(params.number || params.chapter_number);
        const ch = outline.chapters.find(c => c.number === num);
        if (!ch) return { error: `Chapter ${num} not found in outline` };
        if (params.title) ch.title = params.title;
        if (params.summary) ch.summary = params.summary;
        if (params.characters) ch.characters = params.characters;
        if (params.locations) ch.locations = params.locations;
        if (params.plotPoints || params.plot_points) ch.plotPoints = params.plotPoints || params.plot_points;
        if (params.status) ch.status = params.status;
        if (params.notes) ch.notes = params.notes;
        outline.updatedAt = new Date().toISOString();
        writeJson(outlineFile, outline);
        return { success: true, chapter: ch };
    }

    if (action === 'reorder') {
        const outline = readJson(outlineFile);
        if (!outline) return { error: 'No outline exists' };
        const order = params.order; // array of chapter numbers in new order
        if (!Array.isArray(order)) return { error: 'order must be an array of chapter numbers' };
        const byNum = new Map(outline.chapters.map(c => [c.number, c]));
        const reordered = [];
        for (const num of order) {
            const ch = byNum.get(num);
            if (ch) reordered.push(ch);
        }
        // Add any chapters not in the order array at the end
        for (const ch of outline.chapters) {
            if (!reordered.includes(ch)) reordered.push(ch);
        }
        reordered.forEach((ch, i) => { ch.number = i + 1; });
        outline.chapters = reordered;
        outline.updatedAt = new Date().toISOString();
        writeJson(outlineFile, outline);
        return { success: true, chapters: outline.chapters.map(c => ({ number: c.number, title: c.title })) };
    }

    if (action === 'get') {
        const outline = readJson(outlineFile);
        if (!outline) return { error: 'No outline exists for this project. Create one with action:"create"' };
        return { success: true, outline };
    }

    return { error: `Unknown action: ${action}. Use: create, set, add_chapter, update_chapter, reorder, get` };
}

function handleGenerate(params, agentInfo) {
    const paths = resolveProjectPaths(agentInfo);
    const outlineFile = path.join(paths.outlinesDir, `${paths.project}.json`);
    const outline = readJson(outlineFile);
    if (!outline) return { error: 'No outline exists. Create an outline first.' };

    const requestedChapterNum = Number(params.chapter_number || params.number);
    const chapterDef = Number.isFinite(requestedChapterNum)
        ? outline.chapters.find(c => c.number === requestedChapterNum)
        : outline.chapters.find(c => !['draft', 'complete', 'final'].includes(String(c.status || 'planned'))) || outline.chapters[0];
    if (!chapterDef) return { error: Number.isFinite(requestedChapterNum) ? `Chapter ${requestedChapterNum} not found in outline` : 'No chapters found in outline' };
    const chapterNum = chapterDef.number;

    // Load relevant elements as context
    const elements = listJsonFiles(paths.elementsDir).filter(e => !e._file?.startsWith('_'));
    const relevantChars = elements.filter(e =>
        e.type === 'character' &&
        (chapterDef.characters || []).some(c =>
            String(c).toLowerCase() === String(e.name || e.id).toLowerCase()
        )
    );
    const relevantLocations = elements.filter(e =>
        e.type === 'location' &&
        (chapterDef.locations || []).some(l =>
            String(l).toLowerCase() === String(e.name || e.id).toLowerCase()
        )
    );
    const themes = elements.filter(e => e.type === 'theme' || e.type === 'worldbuilding');

    // Build the generation context for the LLM
    const context = {
        bookTitle: outline.title,
        chapter: chapterDef,
        characters: relevantChars.map(c => ({ name: c.name, details: c.content })),
        locations: relevantLocations.map(l => ({ name: l.name, details: l.content })),
        themes: themes.map(t => ({ name: t.name, details: t.content })),
        previousChapter: chapterNum > 1
            ? outline.chapters.find(c => c.number === chapterNum - 1)
            : null,
        nextChapter: outline.chapters.find(c => c.number === chapterNum + 1) || null,
        userInstructions: params.instructions || ''
    };

    // Save chapter file path for the LLM to write to
    ensureDir(paths.chaptersDir);
    const chapterFile = path.join(paths.chaptersDir, `chapter-${String(chapterNum).padStart(2, '0')}.md`);
    if (!fs.existsSync(chapterFile)) {
        const scaffold = [
            `# ${chapterDef.title}`,
            '',
            `<!-- Chapter ${chapterNum} scaffold generated ${new Date().toISOString()} -->`,
            '',
            `Summary: ${chapterDef.summary || 'Add chapter summary.'}`,
            '',
            '## Draft',
            '',
            ''
        ].join('\n');
        fs.writeFileSync(chapterFile, scaffold, 'utf-8');
    }

    // Mark chapter as in-progress
    chapterDef.status = 'in_progress';
    outline.updatedAt = new Date().toISOString();
    writeJson(outlineFile, outline);

    return {
        success: true,
        message: `Chapter ${chapterNum} scaffold is ready. Continue the draft in the output file below.`,
        outputPath: chapterFile,
        context,
        instruction: `Write Chapter ${chapterNum}: "${chapterDef.title}" using the provided context. Save the full chapter text to: ${chapterFile}. After writing, update the chapter status to "draft" using the outline tool.`
    };
}

function handleCompile(params, agentInfo) {
    const paths = resolveProjectPaths(agentInfo);
    const outlineFile = path.join(paths.outlinesDir, `${paths.project}.json`);
    const outline = readJson(outlineFile);

    ensureDir(paths.chaptersDir);
    const chapterFiles = fs.existsSync(paths.chaptersDir)
        ? fs.readdirSync(paths.chaptersDir)
            .filter(f => f.endsWith('.md'))
            .sort()
        : [];

    if (chapterFiles.length === 0) {
        return { error: 'No chapters found to compile. Generate chapters first.' };
    }

    const bookTitle = outline?.title || paths.project;
    let manuscript = `# ${bookTitle}\n\n`;
    manuscript += `*Compiled on ${new Date().toLocaleDateString()}*\n\n`;
    manuscript += `---\n\n## Table of Contents\n\n`;

    const chapters = [];
    for (const file of chapterFiles) {
        const content = fs.readFileSync(path.join(paths.chaptersDir, file), 'utf-8');
        const match = content.match(/^#\s+(.+)/m);
        const title = match ? match[1] : file.replace(/\.md$/, '');
        chapters.push({ file, title, content });
        manuscript += `- ${title}\n`;
    }

    manuscript += `\n---\n\n`;

    for (const ch of chapters) {
        manuscript += ch.content;
        manuscript += `\n\n---\n\n`;
    }

    const outputFile = path.join(paths.outputsDir, `${slug(bookTitle)}-manuscript.md`);
    fs.writeFileSync(outputFile, manuscript, 'utf-8');

    return {
        success: true,
        message: `Compiled ${chapters.length} chapter(s) into manuscript`,
        outputPath: outputFile,
        chapters: chapters.map(c => c.title),
        wordCount: manuscript.split(/\s+/).length
    };
}

function handleStatus(params, agentInfo) {
    const paths = resolveProjectPaths(agentInfo);
    const outlineFile = path.join(paths.outlinesDir, `${paths.project}.json`);
    const outline = readJson(outlineFile);

    const elements = listJsonFiles(paths.elementsDir).filter(e => !e._file?.startsWith('_'));
    const byType = {};
    for (const el of elements) {
        const t = el.type || 'other';
        byType[t] = (byType[t] || 0) + 1;
    }

    const chapterFiles = fs.existsSync(paths.chaptersDir)
        ? fs.readdirSync(paths.chaptersDir).filter(f => f.endsWith('.md'))
        : [];

    let totalWords = 0;
    for (const f of chapterFiles) {
        const content = fs.readFileSync(path.join(paths.chaptersDir, f), 'utf-8');
        totalWords += content.split(/\s+/).length;
    }

    const outlineChapters = outline?.chapters || [];
    const planned = outlineChapters.filter(c => c.status === 'planned').length;
    const inProgress = outlineChapters.filter(c => c.status === 'in_progress').length;
    const drafted = outlineChapters.filter(c => c.status === 'draft').length;
    const complete = outlineChapters.filter(c => c.status === 'complete' || c.status === 'final').length;

    return {
        success: true,
        project: paths.project,
        bookTitle: outline?.title || 'No outline yet',
        elements: { total: elements.length, byType },
        outline: {
            exists: Boolean(outline),
            totalChapters: outlineChapters.length,
            planned,
            inProgress,
            drafted,
            complete
        },
        manuscript: {
            chaptersWritten: chapterFiles.length,
            totalWords
        }
    };
}

// ─── ChatUI Panel ────────────────────────────────────────────────────────────

function renderPanel(agentInfo) {
    const paths = resolveProjectPaths(agentInfo);
    const status = handleStatus({}, agentInfo);
    const s = status;
    let nextChapter = null;
    if (s.outline?.exists) {
        const outlineFile = path.join(paths.outlinesDir, `${paths.project}.json`);
        const outline = readJson(outlineFile);
        nextChapter = (outline?.chapters || []).find(ch => !['draft', 'complete', 'final'].includes(String(ch.status || 'planned')))
            || (outline?.chapters || [])[0]
            || null;
    }
    const progress = s.outline?.totalChapters > 0
        ? Math.round(((s.outline.drafted + s.outline.complete) / s.outline.totalChapters) * 100)
        : 0;
    const outlineSummary = s.outline?.exists
        ? `${s.outline.totalChapters} chapters${nextChapter ? `, next: ${nextChapter.number}. ${nextChapter.title}` : ''}`
        : 'No outline yet. Send premise, genre, characters, and target length.';

    return `<section class="bw-compact">
        <div class="bw-mainline">
            <strong>📖 Book Writer</strong>
            <span class="bw-title">${escapeHtml(s.bookTitle)}</span>
            <span class="bw-project-badge">${escapeHtml(s.project)}</span>
        </div>
        <div class="bw-metrics">
            <span>${s.elements?.total || 0} elements</span>
            <span>${s.outline?.totalChapters || 0} chapters</span>
            <span>${(s.manuscript?.totalWords || 0).toLocaleString()} words</span>
            <span>${progress}%</span>
        </div>
        <div class="bw-summary">${escapeHtml(outlineSummary)}</div>
        <form class="bw-project-form" data-agent-ui-action="create-project">
            <input name="name" placeholder="New project">
            <button type="submit">New</button>
            <button type="button" data-agent-ui-action="generate-next"${s.outline?.exists ? '' : ' disabled'}>Draft Next</button>
            <button type="button" data-agent-ui-action="compile-book"${(s.manuscript?.chaptersWritten || 0) > 0 ? '' : ' disabled'}>Compile</button>
        </form>
    </section>`;
}

const css = `
.bw-compact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 7px 10px;
    margin-bottom: 6px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
    font-size: var(--text-sm);
}
.bw-mainline {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: min(100%, 320px);
    flex: 1 1 320px;
}
.bw-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.bw-project-badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    flex: 0 0 auto;
}
.bw-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.bw-metrics span {
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 1px 7px;
    background: var(--bg-secondary);
}
.bw-summary {
    flex: 1 1 100%;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.bw-project-form {
    display: flex;
    gap: 5px;
    align-items: center;
    flex: 1 1 460px;
    min-width: min(100%, 360px);
}
.bw-project-form input {
    min-width: 130px;
    flex: 1 1 170px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--input-bg, var(--bg-primary));
    color: var(--text-primary);
}
.bw-project-form button {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    height: 28px;
    cursor: pointer;
    padding: 0 8px;
    white-space: nowrap;
}
.bw-project-form button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    color: var(--text-secondary);
}
@media (max-width: 760px) {
    .bw-project-form,
    .bw-mainline {
        flex-basis: 100%;
    }
    .bw-summary {
        white-space: normal;
    }
}
`;

// ─── Plugin Exports ──────────────────────────────────────────────────────────

module.exports = {
    onEnable(context) {
        // ── project tool ──
        context.registerHandler('project', {
            description: 'Manage book projects. Actions: create (name), switch (name), list',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'create | switch | list', enum: ['create', 'switch', 'list'] },
                    name: { type: 'string', description: 'Project name (for create/switch)' }
                },
                required: ['action']
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleProject(params, agentInfo);
        });

        // ── element tool ──
        context.registerHandler('element', {
            description: 'CRUD book elements: characters, locations, plot_points, themes, worldbuilding, notes, inspirations. Actions: create, update, get, delete, list',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'create | update | get | delete | list', enum: ['create', 'update', 'get', 'delete', 'list'] },
                    type: { type: 'string', description: 'Element type: character, location, plot_point, theme, worldbuilding, note, inspiration' },
                    name: { type: 'string', description: 'Element name' },
                    id: { type: 'string', description: 'Element ID (for update/get/delete)' },
                    content: { type: 'string', description: 'Element content / description' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' }
                },
                required: ['action']
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleElement(params, agentInfo);
        });

        // ── outline tool ──
        context.registerHandler('outline', {
            description: 'Manage the book chapter outline. Actions: create/set (title, chapters[]), add_chapter, update_chapter (number), reorder (order[]), get',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'create | set | add_chapter | update_chapter | reorder | get', enum: ['create', 'set', 'add_chapter', 'update_chapter', 'reorder', 'get'] },
                    title: { type: 'string', description: 'Book title (for create) or chapter title (for add/update)' },
                    chapters: { type: 'array', description: 'Array of chapter objects for bulk create' },
                    number: { type: 'number', description: 'Chapter number (for update_chapter)' },
                    chapter_number: { type: 'number', description: 'Chapter number (alias)' },
                    summary: { type: 'string', description: 'Chapter summary' },
                    characters: { type: 'array', items: { type: 'string' }, description: 'Characters in this chapter' },
                    locations: { type: 'array', items: { type: 'string' }, description: 'Locations in this chapter' },
                    plotPoints: { type: 'array', items: { type: 'string' }, description: 'Plot points to resolve' },
                    plot_points: { type: 'array', items: { type: 'string' }, description: 'Plot points alias' },
                    status: { type: 'string', description: 'Chapter status: planned, in_progress, draft, complete, final' },
                    notes: { type: 'string', description: 'Additional notes' },
                    order: { type: 'array', items: { type: 'number' }, description: 'New chapter order (array of numbers)' }
                },
                required: ['action']
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleOutline(params, agentInfo);
        });

        // ── generate tool ──
        context.registerHandler('generate', {
            description: 'Prepare context for generating a chapter from the outline. Returns writing instructions and element context. Write the chapter using write_file to the provided outputPath.',
            inputSchema: {
                type: 'object',
                properties: {
                    chapter_number: { type: 'number', description: 'Chapter number to generate' },
                    number: { type: 'number', description: 'Chapter number alias' },
                    instructions: { type: 'string', description: 'Additional writing instructions for this chapter' }
                },
                required: []
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleGenerate(params, agentInfo);
        });

        // ── compile tool ──
        context.registerHandler('compile', {
            description: 'Compile all written chapters into a single manuscript file.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleCompile(params, agentInfo);
        });

        // ── status tool ──
        context.registerHandler('status', {
            description: 'Show current book project status: element counts, outline progress, word count.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        }, (params) => {
            const agentInfo = params._agentInfo || {};
            return handleStatus(params, agentInfo);
        });

        // ── ChatUI ──
        context.registerChatUI({
            title: 'Book Writer',
            renderPanel,
            css,
            actions: {
                refresh({ agentInfo }) {
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                'create-project'({ agentInfo, payload }) {
                    const name = String(payload?.name || '').trim();
                    if (name) handleProject({ action: 'create', name }, agentInfo);
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                'generate-next'({ agentInfo }) {
                    handleGenerate({}, agentInfo);
                    return { success: true, html: renderPanel(agentInfo), css };
                },
                'compile-book'({ agentInfo }) {
                    handleCompile({}, agentInfo);
                    return { success: true, html: renderPanel(agentInfo), css };
                }
            },
            onTabActivated(agentInfo, payload, pluginContext) {
                pluginContext.log(`Book writer UI active for ${agentInfo.name}`);
            }
        });

        context.log('Book Writer Studio registered');
    },

    onDisable(context) {
        projectState.clear();
        context.log('Book Writer Studio disabled');
    }
};
