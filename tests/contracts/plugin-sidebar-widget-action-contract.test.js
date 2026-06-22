const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

class SidebarWidgetContainer {
  constructor(map) {
    this.map = { ...map };
  }

  get(name) {
    if (!(name in this.map)) {
      throw new Error(`Missing service ${name}`);
    }
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }

  replace(name, value) {
    this.map[name] = value;
  }
}

module.exports = {
  name: 'plugin-sidebar-widget-action-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-plugin-sidebar-widget-');
    try {
      const db = new MemoryDB();
      const container = new SidebarWidgetContainer({
        db,
        mcpServer: { tools: new Map(), registerTool() {} },
        capabilityManager: null,
        runtimePolicy: null,
        setupSuperagentService: {
          async getAssessment() {
            return {
              userMode: 'partial',
              userProfile: 'returning',
              setupStage: 'init_missing',
              summary: 'One safe setup change is recommended.',
              state: {
                llm: { configured: true, provider: 'openai', model: 'gpt-5.2-codex' },
                capabilities: { mainEnabled: true, groupsConfig: [] },
                companion: { running: false, enabled: false },
                curatedPlugins: []
              }
            };
          },
          async runAction() {
            return {
              success: true,
              result: { success: true },
              assessment: await this.getAssessment()
            };
          },
          async dismissAction() {
            return { success: true };
          }
        }
      });

      const pluginManager = new PluginManager(container);
      await pluginManager.initialize();
      await pluginManager.enablePlugin('agent-setup-superagent');

      const widgets = pluginManager.getSidebarWidgets();
      const healthWidget = widgets.find((entry) => entry.id === 'setup-health');
      assert.ok(healthWidget, 'Expected setup-health sidebar widget to be discoverable');
      assert.ok(
        Array.isArray(healthWidget.actionNames) && healthWidget.actionNames.includes('open-setup-chat'),
        'Expected serialized sidebar widget payload to expose open-setup-chat action'
      );

      const actionResult = await pluginManager.runSidebarWidgetAction('setup-health', 'open-setup-chat', {});
      assert.equal(actionResult.success, true, 'Expected setup widget open action to succeed');
      assert.equal(actionResult.openAgentSlug, 'setup-superagent', 'Expected setup widget open action to target setup-superagent');
    } finally {
      require('fs').rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
