const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('./helpers/assert');

const rootDir = path.resolve(__dirname, '..');
const contractDir = path.join(__dirname, 'contracts');

const externalSuites = {
  quick: [
    ['node', ['tools/test-ipc-registration.js']],
    ['node', ['tools/test-plugin-knowledge-managers.js']],
    ['node', ['tools/test-dispatcher-mocked.js']],
    ['node', ['tools/test-tool-routing-lifecycle.js']],
    ['node', ['tools/test-testclient-mode.js']]
  ],
  core: [
    ['node', ['tools/test-ipc-flow-mocked.js']]
  ],
  skin: [
    ['node', ['src/main/main.js', '--skintest', '--nowindow']]
  ],
  live: [
    ['node', ['tools/test-ollama-live.js']]
  ]
};

function discoverContractTests() {
  return fs.readdirSync(contractDir)
    .filter(fileName => fileName.endsWith('.test.js'))
    .sort()
    .map(fileName => path.join(contractDir, fileName));
}

function resolveSuite(name) {
  switch (name) {
    case 'contracts':
      return {
        moduleTests: discoverContractTests(),
        commandTests: []
      };
    case 'quick':
      return {
        moduleTests: discoverContractTests(),
        commandTests: externalSuites.quick
      };
    case 'core':
      return {
        moduleTests: discoverContractTests(),
        commandTests: [...externalSuites.quick, ...externalSuites.core]
      };
    case 'skin':
      return {
        moduleTests: [],
        commandTests: externalSuites.skin
      };
    case 'live':
      return {
        moduleTests: [],
        commandTests: externalSuites.live
      };
    case 'all':
      return {
        moduleTests: discoverContractTests(),
        commandTests: [...externalSuites.quick, ...externalSuites.core, ...externalSuites.skin, ...externalSuites.live]
      };
    default:
      throw new Error(`Unknown suite "${name}". Use contracts, quick, core, skin, live, or all.`);
  }
}

async function runModuleTest(filePath) {
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);
  if (!mod || typeof mod.run !== 'function') {
    throw new Error(`Test module does not export run(): ${filePath}`);
  }

  const startedAt = Date.now();
  await mod.run({ assert, rootDir });
  return {
    name: mod.name || path.basename(filePath),
    elapsedMs: Date.now() - startedAt
  };
}

async function runCommandTest(command, args) {
  const label = `${command} ${args.join(' ')}`;
  const startedAt = Date.now();

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });

  return {
    name: label,
    elapsedMs: Date.now() - startedAt
  };
}

async function main() {
  const suiteName = process.argv[2] || 'contracts';
  const suite = resolveSuite(suiteName);
  const results = [];

  console.log(`[suite] Starting ${suiteName}`);

  for (const filePath of suite.moduleTests) {
    const result = await runModuleTest(filePath);
    results.push(result);
    console.log(`[suite] PASS module ${result.name} (${result.elapsedMs}ms)`);
  }

  for (const [command, args] of suite.commandTests) {
    const result = await runCommandTest(command, args);
    results.push(result);
    console.log(`[suite] PASS command ${result.name} (${result.elapsedMs}ms)`);
  }

  const totalMs = results.reduce((sum, result) => sum + result.elapsedMs, 0);
  console.log(`[suite] PASS ${suiteName}: ${results.length} test item(s), total ${totalMs}ms`);
}

main().catch((error) => {
  console.error(`[suite] FAIL: ${error.message}`);
  process.exit(1);
});
