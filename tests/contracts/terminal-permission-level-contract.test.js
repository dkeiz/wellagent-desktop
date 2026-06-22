const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const CapabilityManager = require('../../src/main/capability-manager');
const ToolPermissionStore = require('../../src/main/tool-permission-store');
const ToolPermissionService = require('../../src/main/tool-permission-service');
const { ExecutionDirectory } = require('../../src/main/execution-directory');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

function createDb() {
  const db = new MemoryDB();
  db.profiles = new Map();
  db.toolStates = new Map();
  db.get = function get(sql, args = []) {
    if (sql.includes('FROM agent_permission_profiles')) {
      return this.profiles.get(Number(args[0]));
    }
    if (sql.includes('SELECT agent_id FROM chat_sessions')) {
      return undefined;
    }
    return MemoryDB.prototype.get.call(this, sql, args);
  };
  db.all = function all(sql, args = []) {
    if (sql.includes('FROM agent_tool_states')) {
      const agentId = Number(args[0]);
      return Array.from(this.toolStates.entries())
        .filter(([key]) => key.startsWith(`${agentId}:`))
        .map(([key, active]) => ({ tool_name: key.split(':')[1], active: active ? 1 : 0 }));
    }
    if (sql.includes('SELECT agent_id FROM agent_permission_profiles')) {
      return Array.from(this.profiles.keys()).map(agent_id => ({ agent_id }));
    }
    return MemoryDB.prototype.all.call(this, sql, args);
  };
  db.run = function run(sql, args = []) {
    if (sql.includes('INSERT OR REPLACE INTO agent_permission_profiles')) {
      this.profiles.set(Number(args[0]), {
        agent_id: Number(args[0]),
        main_enabled: args[1] ? 1 : 0,
        preset_id: args[2],
        files_mode: args[3],
        unsafe_enabled: args[4] ? 1 : 0,
        web_enabled: args[5] ? 1 : 0,
        terminal_enabled: args[6] ? 1 : 0,
        terminal_mode: args[7],
        ports_enabled: args[8] ? 1 : 0,
        visual_enabled: args[9] ? 1 : 0
      });
      return;
    }
    if (sql.includes('INSERT OR REPLACE INTO agent_tool_states')) {
      this.toolStates.set(`${Number(args[0])}:${String(args[1])}`, Boolean(args[2]));
      return;
    }
    if (sql.includes('DELETE FROM agent_permission_profiles')) {
      this.profiles.delete(Number(args[0]));
      return;
    }
    if (sql.includes('DELETE FROM agent_tool_states')) {
      return;
    }
    return MemoryDB.prototype.run.call(this, sql, args);
  };
  return db;
}

module.exports = {
  name: 'terminal-permission-level-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-terminal-permission-');
    const executionRoot = path.join(tempBase, 'project');
    const outsideRoot = path.join(tempBase, 'outside');
    fs.mkdirSync(executionRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    try {
      const db = createDb();
      await db.setSetting('tool_timeout_ms', '5');
      const capabilityManager = new CapabilityManager(db);
      capabilityManager.setTerminalMode('workspace');
      const server = new MCPServer(db, capabilityManager);
      server.setExecutionDirectory(new ExecutionDirectory(db, { defaultRoot: executionRoot }));
      const permissionService = new ToolPermissionService({
        db,
        capabilityManager,
        mcpServer: server,
        agentManager: null,
        store: new ToolPermissionStore(db)
      });
      await permissionService.initialize();
      server.setToolPermissionService(permissionService);

      const inside = await server.executeTool('run_command', {
        command: 'Write-Output inside',
        cwd: executionRoot,
        timeout: 1000
      });
      assert.equal(inside.needsPermission, undefined, 'Expected workspace cwd not to request permission');
      assert.ok(inside.result, 'Expected workspace cwd to reach command execution');

      const outsidePrompt = await server.executeTool('run_command', {
        command: 'Write-Output outside',
        cwd: outsideRoot,
        timeout: 1000
      });
      assert.equal(outsidePrompt.needsPermission, true, 'Expected outside cwd permission request');
      assert.equal(outsidePrompt.permissionType, 'terminal_scope', 'Expected terminal scope request');
      assert.equal(outsidePrompt.currentMode, 'workspace', 'Expected current terminal mode');

      const once = await server.executeTool('run_command', {
        command: 'Write-Output once',
        cwd: outsideRoot,
        timeout: 1000
      }, null, { allowOutsideExecutionRootOnce: true });
      assert.equal(once.needsPermission, undefined, 'Expected allow-once outside cwd not to request permission');
      assert.ok(once.result, 'Expected allow-once outside cwd to reach command execution');
      assert.equal(capabilityManager.getTerminalMode(), 'workspace', 'Allow-once must not persist system mode');

      capabilityManager.setTerminalMode('system');
      const system = await server.executeTool('run_command', {
        command: 'Write-Output system',
        cwd: outsideRoot,
        timeout: 1000
      });
      assert.equal(system.needsPermission, undefined, 'Expected system terminal mode not to request permission');
      assert.ok(system.result, 'Expected system terminal mode to reach command execution');

      capabilityManager.setTerminalMode('off');
      const off = await server.executeTool('run_command', { command: 'Write-Output blocked' });
      assert.equal(off.needsPermission, true, 'Expected terminal off to block run_command');
      assert.equal(off.reason, 'profile_disabled', 'Expected permission service to report disabled profile');

      await permissionService.setAgentGroup(7, 'terminal', 'system');
      const agentProfile = await permissionService.getAgentProfile(7);
      assert.equal(agentProfile.profile.terminal_mode, 'system', 'Expected agent terminal mode to persist');

      db.profiles.set(8, {
        agent_id: 8,
        main_enabled: 1,
        files_mode: 'read',
        terminal_enabled: 1
      });
      const legacy = await permissionService.resolveContext({ agentId: 8 });
      assert.equal(legacy.groups.terminal, 'workspace', 'Expected legacy terminal_enabled=true to map to workspace');

      capabilityManager.setTerminalMode('workspace');
      assert.equal(
        server._resolveTimeoutMs('run_command', { timeout: 60 }, 5),
        60000,
        'Expected run_command timeout to be interpreted as seconds'
      );
      assert.equal(
        server._resolveTimeoutMs('run_command', { timeout_ms: 1000 }, 5),
        1000,
        'Expected run_command timeout_ms to preserve millisecond compatibility'
      );
      assert.equal(
        server._resolveTimeoutMs('run_command', {}, 5),
        30000,
        'Expected default run_command timeout to override generic tool timeout'
      );
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
