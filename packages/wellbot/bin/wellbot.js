#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEASES_URL = 'https://github.com/dkeiz/wellagent-desktop/releases/latest';
const REPO_URL = 'https://github.com/dkeiz/wellagent-desktop';
const DEFAULT_EXPAND_DIR = path.join(os.homedir(), '.wellbot', 'desktop');

function printHelp() {
  console.log(`wellbot

Usage:
  wellbot                 Show this help
  wellbot doctor          Check local requirements
  wellbot releases        Print the desktop download URL
  wellbot path            Print the default expanded app path
  wellbot expand [dir]    Clone the full desktop source from GitHub
  wellbot install [dir]   Run npm install in the desktop source
  wellbot update [dir]    Pull the latest desktop source changes
  wellbot desktop [dir]   Run the desktop app from source

Examples:
  wellbot expand --install
  wellbot desktop

The npm package is intentionally small. It can expand into the full app from:
  ${RELEASES_URL}
`);
}

function commandExists(command) {
  const pathValue = process.env.PATH || process.env.Path || process.env.path || '';
  const paths = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = path.join(dir, process.platform === 'win32' ? `${command}${ext.toLowerCase()}` : command);
      const altCandidate = path.join(dir, process.platform === 'win32' ? `${command}${ext.toUpperCase()}` : command);
      if (isExecutable(candidate) || isExecutable(altCandidate)) return true;
    }
  }
  return false;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function findDesktopRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const packagePath = path.join(current, 'package.json');
    const mainPath = path.join(current, 'src', 'main', 'main.js');
    if (fs.existsSync(packagePath) && fs.existsSync(mainPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (pkg.name === 'localagent-desktop') return current;
      } catch (_) {
        return null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getDesktopRoot(inputDir) {
  if (inputDir) {
    const resolved = path.resolve(inputDir);
    return findDesktopRoot(resolved) || (isDesktopRoot(resolved) ? resolved : null);
  }
  return findDesktopRoot(process.cwd()) || (isDesktopRoot(DEFAULT_EXPAND_DIR) ? DEFAULT_EXPAND_DIR : null);
}

function isDesktopRoot(dir) {
  const packagePath = path.join(dir, 'package.json');
  const mainPath = path.join(dir, 'src', 'main', 'main.js');
  if (!fs.existsSync(packagePath) || !fs.existsSync(mainPath)) return false;
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).name === 'localagent-desktop';
  } catch (_) {
    return false;
  }
}

function firstPositional(args) {
  return args.find(arg => !String(arg).startsWith('-')) || '';
}

function hasFlag(args, name) {
  return args.includes(name);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || 'inherit',
    encoding: options.encoding || undefined,
    shell: process.platform === 'win32'
  });
}

function ensureGit() {
  if (commandExists('git')) return true;
  console.error('git is required for this command.');
  console.error(`Download desktop builds instead: ${RELEASES_URL}`);
  process.exitCode = 1;
  return false;
}

function runDoctor() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const desktopRoot = getDesktopRoot();
  const checks = [
    ['Node.js >= 18', nodeMajor >= 18, process.version],
    ['npm available', commandExists('npm'), 'required for source installs'],
    ['git available', commandExists('git'), 'recommended for source installs'],
    ['desktop source repo', Boolean(desktopRoot), desktopRoot || `not found; default path is ${DEFAULT_EXPAND_DIR}`]
  ];

  let failed = false;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed = true;
    console.log(`${ok ? 'OK ' : 'NO '} ${label} - ${detail}`);
  }

  if (!desktopRoot) {
    console.log('');
    console.log(`Download desktop builds: ${RELEASES_URL}`);
    console.log('Or run: wellbot expand --install');
  }

  process.exitCode = failed ? 1 : 0;
}

function expandDesktop(args) {
  if (!ensureGit()) return;
  const installAfter = hasFlag(args, '--install');
  const force = hasFlag(args, '--force');
  const target = path.resolve(firstPositional(args) || DEFAULT_EXPAND_DIR);

  if (fs.existsSync(target)) {
    if (isDesktopRoot(target)) {
      console.log(`Desktop source already exists: ${target}`);
      if (installAfter) installDesktop([target]);
      return;
    }

    const entries = fs.readdirSync(target);
    if (entries.length > 0 && !force) {
      console.error(`Target directory is not empty: ${target}`);
      console.error('Use --force only after checking that path.');
      process.exitCode = 1;
      return;
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const result = run('git', ['clone', '--depth', '1', REPO_URL, target]);
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }

  console.log(`Desktop source expanded to: ${target}`);
  if (installAfter) installDesktop([target]);
}

function installDesktop(args) {
  const desktopRoot = getDesktopRoot(firstPositional(args));
  if (!desktopRoot) {
    console.error('Desktop source repo was not found.');
    console.error('Run: wellbot expand');
    process.exitCode = 1;
    return;
  }

  const result = run('npm', ['install'], { cwd: desktopRoot });
  process.exitCode = result.status || 0;
}

function updateDesktop(args) {
  if (!ensureGit()) return;
  const desktopRoot = getDesktopRoot(firstPositional(args));
  if (!desktopRoot) {
    console.error('Desktop source repo was not found.');
    console.error('Run: wellbot expand');
    process.exitCode = 1;
    return;
  }

  const result = run('git', ['pull', '--ff-only'], { cwd: desktopRoot });
  process.exitCode = result.status || 0;
}

function runDesktop(args) {
  const desktopRoot = getDesktopRoot(firstPositional(args));
  if (!desktopRoot) {
    console.error('Desktop source repo was not found.');
    console.error('Run: wellbot expand --install');
    console.error(`Or download the full app: ${RELEASES_URL}`);
    process.exitCode = 1;
    return;
  }

  const result = run('npm', ['start'], { cwd: desktopRoot });
  process.exitCode = result.status || 0;
}

const command = String(process.argv[2] || 'help').trim().toLowerCase();
const args = process.argv.slice(3);

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp();
} else if (command === 'doctor') {
  runDoctor();
} else if (command === 'path') {
  console.log(DEFAULT_EXPAND_DIR);
} else if (command === 'expand' || command === 'autoexpand') {
  expandDesktop(args);
} else if (command === 'install') {
  installDesktop(args);
} else if (command === 'update') {
  updateDesktop(args);
} else if (command === 'releases' || command === 'download') {
  console.log(RELEASES_URL);
} else if (command === 'desktop' || command === 'run') {
  runDesktop(args);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('');
  printHelp();
  process.exitCode = 1;
}

