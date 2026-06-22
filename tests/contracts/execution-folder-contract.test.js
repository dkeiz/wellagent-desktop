const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const SessionWorkspace = require('../../src/main/session-workspace');
const { ExecutionDirectory } = require('../../src/main/execution-directory');
const { CodexCliAdapter } = require('../../src/main/providers/codex-cli-adapter');
const { tokenizePath } = require('../../src/main/path-tokens');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'execution-folder-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-execution-folder-');
    const executionRoot = path.join(tempBase, 'project');
    const outsideRoot = path.join(tempBase, 'outside');
    const agentinRoot = path.join(tempBase, 'agentin');
    const agentBase = path.join(agentinRoot, 'agents');
    const workspaceRoot = path.join(tempBase, 'agentin', 'workspaces');
    const knowledgeRoot = path.join(agentinRoot, 'knowledge');
    const promptDir = path.join(agentinRoot, 'prompts');
    const promptPath = path.join(promptDir, 'system.md');
    const rulesPath = path.join(promptDir, 'rules');
    const agentHome = path.join(agentBase, 'pro', 'workspace-agent');
    fs.mkdirSync(executionRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.mkdirSync(agentHome, { recursive: true });
    fs.mkdirSync(knowledgeRoot, { recursive: true });
    fs.mkdirSync(rulesPath, { recursive: true });
    fs.writeFileSync(path.join(knowledgeRoot, 'guide.md'), 'knowledge survives execution root overrides', 'utf-8');

    const db = new MemoryDB();
    await db.saveSetting('execution.rootPath', executionRoot);
    const executionDirectory = new ExecutionDirectory(db, { defaultRoot: tempBase });
    const sessionWorkspace = new SessionWorkspace(workspaceRoot);
    const server = new MCPServer(db, null);
    const agentManager = {
      basePath: agentBase,
      sessionWorkspace,
      resolveAgentFolder: async () => agentHome,
      getAgent: async () => ({ id: 1, name: 'Workspace Agent' })
    };
    server.setExecutionDirectory(executionDirectory);
    server.setSessionWorkspace(sessionWorkspace);
    server.setAgentManager(agentManager);
    server.setCurrentSessionId('s-exec');
    server.setCurrentAgentContext({ sessionId: 's-exec', agentId: 1 });
    server.setAIService({
      getSystemPrompt: () => 'base prompt',
      setSystemPrompt: async () => ({ ok: true })
    });
    server.setPromptFileManager({
      systemPromptPath: promptPath,
      rulesPath,
      ensureDirectories() {
        fs.mkdirSync(promptDir, { recursive: true });
        fs.mkdirSync(rulesPath, { recursive: true });
      },
      async saveSystemPrompt(content) {
        fs.mkdirSync(promptDir, { recursive: true });
        fs.writeFileSync(promptPath, content, 'utf-8');
      },
      getSafeFilename(name, priority = 1) {
        return `${String(priority).padStart(3, '0')}-${String(name || 'rule')}.md`;
      }
    });

    try {
      const context = await executionDirectory.getContext();
      assert.equal(context.rootPath, executionRoot, 'Expected execution root to come from settings');
      assert.equal(context.configuredRoot, executionRoot, 'Expected configured root to be surfaced');
      assert.equal(context.source, 'configured', 'Expected configured root context source');
      assert.equal(context.allowOutsideRoot, false, 'Expected outside-root execution to be denied by default');

      assert.equal(await server.getExecutionRoot(), executionRoot, 'Expected MCP execution root to use settings');
      const tokenized = await tokenizePath(path.join(executionRoot, 'src', 'index.js'), {
        sessionWorkspace,
        executionDirectory
      });
      assert.equal(tokenized, '{execution}/src/index.js', 'Expected execution root path token');

      const denied = await server.executeTool('run_command', {
        command: 'Write-Output outside',
        cwd: outsideRoot,
        output_to_file: false
      });
      assert.equal(denied.needsPermission, true, 'Expected outside cwd to request permission');
      assert.equal(denied.permissionType, 'terminal_scope', 'Expected terminal scope permission request');
      assert.equal(denied.requiredMode, 'system', 'Expected system terminal mode request');

      await executionDirectory.setAllowOutsideRoot(true);
      await executionDirectory.assertPathAllowed(outsideRoot);

      const toolGet = await server.executeTool('execution_root', { action: 'get' });
      assert.equal(toolGet.result.rootPath, '{execution}', 'Expected execution_root get to tokenize active root');

      const nestedRoot = path.join(executionRoot, 'nested');
      fs.mkdirSync(nestedRoot, { recursive: true });
      const toolSet = await server.executeTool('execution_root', {
        action: 'set',
        path: '{execution}/nested'
      });
      assert.equal(toolSet.result.rootPath, '{execution}', 'Expected updated root to remain portable');
      assert.equal(await executionDirectory.getRoot(), nestedRoot, 'Expected execution_root set to update root');

      const readKnowledge = await server.executeTool('read_file', {
        path: '{knowledge}/guide.md'
      });
      assert.includes(readKnowledge.result.path, '{knowledge}/guide.md', 'Expected knowledge path to remain separate from execution root');
      assert.includes(readKnowledge.result.content, 'survives execution root overrides', 'Expected knowledge read to still work after execution root change');

      const promptUpdate = await server.executeTool('modify_system_prompt', {
        content: 'workspace test prompt'
      });
      assert.includes(promptUpdate.result.path, '{agentin}/prompts/system.md', 'Expected prompt writes to stay under agentin');

      const codex = new CodexCliAdapter(db);
      assert.equal(await codex._getWorkingDirectory(), nestedRoot, 'Expected Codex CLI cwd to use updated execution root');

      const resetContext = await executionDirectory.clearRoot();
      assert.equal(resetContext.source, 'default', 'Expected clearRoot to restore default source');
      assert.equal(resetContext.rootPath, tempBase, 'Expected clearRoot to restore default root');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
