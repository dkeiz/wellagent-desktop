const path = require('path');
const { buildRuntimePaths } = require('../../src/main/runtime-paths');

module.exports = {
  name: 'runtime-paths-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const rootPath = path.join('sandbox', 'agentin');
    const defaultPaths = buildRuntimePaths({ agentinRoot: rootPath });
    assert.equal(defaultPaths.promptBasePath, path.join(rootPath, 'prompts'), 'Expected prompt base path to derive from agentin root');
    assert.equal(defaultPaths.promptTemplatesDir, path.join(rootPath, 'prompts', 'templates'), 'Expected prompt templates path to derive from prompt base path');
    assert.equal(defaultPaths.memoryBasePath, path.join(rootPath, 'memory'), 'Expected memory path to derive from agentin root');
    assert.equal(defaultPaths.a2aBaseDir, path.join(rootPath, 'a2a'), 'Expected A2A base path to derive from agentin root');
    assert.equal(defaultPaths.a2aTargetsDir, path.join(rootPath, 'a2a', 'targets'), 'Expected A2A targets path to derive from A2A base path');
    assert.equal(defaultPaths.backgroundDaemonBasePath, path.join(rootPath, 'agents', 'pro', 'background-daemon'), 'Expected daemon path to derive from agent base path');

    const customPromptBase = path.join('custom', 'prompts');
    const customAgentBase = path.join('custom', 'agents');
    const overridePaths = buildRuntimePaths({
      agentinRoot: rootPath,
      promptBasePath: customPromptBase,
      agentBasePath: customAgentBase,
      connectorsDir: path.join('custom', 'connectors')
    });

    assert.equal(overridePaths.promptTemplatesDir, path.join(customPromptBase, 'templates'), 'Expected prompt template path to follow prompt base overrides');
    assert.equal(overridePaths.backgroundDaemonBasePath, path.join(customAgentBase, 'pro', 'background-daemon'), 'Expected daemon path to follow agent base overrides');
    assert.equal(overridePaths.connectorsDir, path.join('custom', 'connectors'), 'Expected explicit connector paths to be preserved');
  }
};
