const { registerPluginKnowledgeHandlers } = require('../../src/main/ipc/register-plugin-knowledge-handlers');
const { buildPluginKnowledgeRuntime } = require('../../src/main/ipc/runtime-dependencies');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, fn) {
    this.handlers.set(channel, fn);
  }

  invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler({}, ...args);
  }
}

module.exports = {
  name: 'plugin-ipc-workflow-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const events = [];
    const pluginManager = {
      listPlugins() {
        return [{ id: 'demo-plugin', name: 'Demo Plugin', status: 'disabled', visibleInSidebar: true }];
      },
      async rescanPlugins() {
        return { added: ['demo-plugin'], total: 1 };
      },
      async enablePlugin(id) {
        this.enabled = id;
      },
      async disablePlugin(id) {
        this.disabled = id;
      },
      setPluginSidebarVisible(id, visible) {
        return { id, visibleInSidebar: visible };
      },
      async getPluginConfig() {
        return { token: 'abc' };
      },
      getPluginDetail(id) {
        return { id, manifest: { id, name: 'Demo Plugin', version: '1.0.0' } };
      },
      async runPluginAction(id, action, params) {
        return { id, action, params, ok: true };
      },
      getSidebarWidgets() {
        return [{ id: 'widget-1' }];
      }
    };
    const shared = {
      container: { optional() { return null; } },
      pluginManager,
      runtimePaths: { pluginsDir: 'C:\\plugins' },
      windowManager: { send(channel, payload) { events.push({ channel, payload }); } },
      agentManager: null,
      mcpServer: null,
      db: null
    };

    const ipc = new FakeIpcMain();
    registerPluginKnowledgeHandlers(ipc, buildPluginKnowledgeRuntime(shared));

    const listed = await ipc.invoke('plugins:list');
    assert.equal(listed.length, 1, 'Expected plugin list handler to return runtime plugin inventory');

    const scanned = await ipc.invoke('plugins:scan');
    assert.equal(scanned.success, true, 'Expected plugin scan handler to succeed');
    assert.equal(scanned.total, 1, 'Expected plugin scan handler to report runtime totals');

    const enabled = await ipc.invoke('plugins:enable', 'demo-plugin');
    assert.equal(enabled.success, true, 'Expected plugin enable handler to succeed');
    assert.equal(pluginManager.enabled, 'demo-plugin', 'Expected runtime plugin manager to receive enable requests');

    const toggled = await ipc.invoke('plugins:set-sidebar-visible', 'demo-plugin', false);
    assert.equal(toggled.success, true, 'Expected plugin sidebar visibility handler to succeed');
    assert.equal(toggled.visibleInSidebar, false, 'Expected plugin sidebar visibility handler to return updated state');

    const opened = await ipc.invoke('plugins:open-studio', { focusPluginId: 'demo-plugin' });
    assert.equal(opened.success, true, 'Expected plugin studio handler to succeed');
    assert.ok(events.some((entry) => entry.channel === 'plugins:open-studio'), 'Expected plugin studio open to notify the window manager');
  }
};
