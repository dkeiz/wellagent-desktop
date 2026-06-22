const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEED_MANIFEST_FILE = '.localagent-seed-manifest.json';

function getUserDataPath(options = {}) {
  return options.userDataPath
    || options.app?.getPath?.('userData')
    || null;
}

function isPackagedRuntime(options = {}) {
  return options.isPackaged === true || options.app?.isPackaged === true;
}

function resolveBundledAgentinRoot(options = {}) {
  if (options.bundledAgentinRoot) {
    return options.bundledAgentinRoot;
  }

  const packagedCandidates = [];
  if (process.resourcesPath) {
    // Standard packaged location when included in resources.
    packagedCandidates.push(path.join(process.resourcesPath, 'agentin'));
    // electron-builder `extraFiles` commonly lands next to the executable.
    packagedCandidates.push(path.join(path.dirname(process.resourcesPath), 'agentin'));
  }

  for (const candidate of packagedCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(__dirname, '../../agentin');
}

function resolveDefaultAgentinRoot(options = {}) {
  if (options.agentinRoot) {
    return options.agentinRoot;
  }

  const userDataPath = getUserDataPath(options);
  if (isPackagedRuntime(options) && userDataPath) {
    return path.join(userDataPath, 'agentin');
  }

  return resolveBundledAgentinRoot(options);
}

function normalizeManifestPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function hashFile(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function readSeedManifest(targetDir) {
  const manifestPath = path.join(targetDir, SEED_MANIFEST_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : { files: {} };
  } catch (_) {
    return { files: {} };
  }
}

function writeSeedManifest(targetDir, files) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(targetDir, SEED_MANIFEST_FILE),
    JSON.stringify({ version: 1, files }, null, 2),
    'utf-8'
  );
}

function getManifestHash(manifest, relativePath) {
  const entry = manifest?.files?.[relativePath];
  return typeof entry === 'string' ? entry : entry?.sha256 || null;
}

function copySeedRecursive(sourceDir, targetDir, stats, manifest, nextFiles, relativeBase = '') {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === SEED_MANIFEST_FILE) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const relativePath = normalizeManifestPath(path.join(relativeBase, entry.name));

    if (entry.isDirectory()) {
      copySeedRecursive(sourcePath, targetPath, stats, manifest, nextFiles, relativePath);
      continue;
    }

    const sourceHash = hashFile(sourcePath);
    const previousHash = getManifestHash(manifest, relativePath);
    if (fs.existsSync(targetPath)) {
      const targetHash = hashFile(targetPath);
      if (previousHash && targetHash === previousHash && sourceHash !== previousHash) {
        fs.cpSync(sourcePath, targetPath);
        stats.updated += 1;
        nextFiles[relativePath] = { sha256: sourceHash };
        continue;
      }
      stats.kept += 1;
      if (targetHash === sourceHash) {
        nextFiles[relativePath] = { sha256: sourceHash };
      } else if (previousHash) {
        nextFiles[relativePath] = { sha256: previousHash };
      }
      continue;
    }

    fs.cpSync(sourcePath, targetPath);
    stats.copied += 1;
    nextFiles[relativePath] = { sha256: sourceHash };
  }
}

function ensureMutableAgentinRoot(paths = {}) {
  const source = paths.bundledAgentinRoot;
  const target = paths.agentinRoot;
  const stats = { source, target, copied: 0, updated: 0, kept: 0, skipped: false };

  if (
    paths.seedMutableAgentinRoot === false
    || !source
    || !target
    || path.resolve(source) === path.resolve(target)
    || !fs.existsSync(source)
  ) {
    return { ...stats, skipped: true };
  }

  const manifest = readSeedManifest(target);
  const nextFiles = {};
  copySeedRecursive(source, target, stats, manifest, nextFiles);
  writeSeedManifest(target, nextFiles);
  stats.manifestPath = path.join(target, SEED_MANIFEST_FILE);
  return stats;
}

function buildRuntimePaths(options = {}) {
  const bundledAgentinRoot = resolveBundledAgentinRoot(options);
  const agentinRoot = resolveDefaultAgentinRoot(options);
  const seedMutableAgentinRoot = isPackagedRuntime(options)
    && path.resolve(agentinRoot) !== path.resolve(bundledAgentinRoot);
  const rendererPath = options.rendererPath || path.join(__dirname, '../renderer/index.html');
  const promptBasePath = options.promptBasePath || path.join(agentinRoot, 'prompts');
  const promptTemplatesDir = options.promptTemplatesDir || path.join(promptBasePath, 'templates');
  const sessionWorkspaceBase = options.sessionWorkspaceBase || path.join(agentinRoot, 'workspaces');
  const knowledgeBaseDir = options.knowledgeBaseDir || path.join(agentinRoot, 'knowledge');
  const agentBasePath = options.agentBasePath || path.join(agentinRoot, 'agents');
  const connectorsDir = options.connectorsDir || path.join(agentinRoot, 'connectors');
  const pluginsDir = options.pluginsDir || path.join(agentinRoot, 'plugins');
  const memoryBasePath = options.memoryBasePath || path.join(agentinRoot, 'memory');
  const workflowBasePath = options.workflowBasePath || path.join(agentinRoot, 'workflows');
  const researchBasePath = options.researchBasePath || path.join(agentinRoot, 'research');
  const subtaskBasePath = options.subtaskBasePath || path.join(agentinRoot, 'subtasks');
  const a2aBaseDir = options.a2aBaseDir || path.join(agentinRoot, 'a2a');
  const a2aTargetsDir = options.a2aTargetsDir || path.join(a2aBaseDir, 'targets');
  const a2aTasksDir = options.a2aTasksDir || path.join(a2aBaseDir, 'tasks');
  const a2aEventsDir = options.a2aEventsDir || path.join(a2aBaseDir, 'events');
  const tasksBasePath = options.tasksBasePath || path.join(agentinRoot, 'tasks');
  const tasksQueueFile = options.tasksQueueFile || path.join(tasksBasePath, 'tasks.md');
  const uiBasePath = options.uiBasePath || path.join(agentinRoot, 'ui');
  const typefacesFile = options.typefacesFile || path.join(uiBasePath, 'typefaces.json');
  const userProfilePath = options.userProfilePath || path.join(agentinRoot, 'userabout', 'memoryaboutuser.md');
  const userDataPath = getUserDataPath(options);

  return {
    agentinRoot,
    bundledAgentinRoot,
    seedMutableAgentinRoot,
    rendererPath,
    promptBasePath,
    promptTemplatesDir,
    sessionWorkspaceBase,
    knowledgeBaseDir,
    agentBasePath,
    connectorsDir,
    pluginsDir,
    memoryBasePath,
    workflowBasePath,
    researchBasePath,
    subtaskBasePath,
    a2aBaseDir,
    a2aTargetsDir,
    a2aTasksDir,
    a2aEventsDir,
    tasksBasePath,
    tasksQueueFile,
    uiBasePath,
    typefacesFile,
    userDataPath,
    userProfilePath,
    backgroundNotifyPromptPath: options.backgroundNotifyPromptPath || path.join(promptTemplatesDir, 'background-notify.md'),
    backgroundDaemonBasePath: options.backgroundDaemonBasePath || path.join(agentBasePath, 'pro', 'background-daemon'),
    coldStartTemplatePath: options.coldStartTemplatePath || path.join(promptTemplatesDir, 'cold-start-discovery.md')
  };
}

module.exports = {
  SEED_MANIFEST_FILE,
  buildRuntimePaths,
  ensureMutableAgentinRoot
};
