const PluginSummaryService = require('../../src/main/plugin-summary-service');

module.exports = {
  name: 'plugin-summary-service-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const service = new PluginSummaryService();
    const plugins = new Map([
      ['summary-plugin', {
        manifest: {
          name: 'Summary Plugin',
          version: '2.0.0',
          description: 'Summary test',
          agentSlug: 'agent-a',
          agentSlugs: ['agent-a', 'agent-b'],
          capabilities: ['tts'],
          contracts: { tts: true }
        },
        status: 'enabled',
        visibleInSidebar: false,
        handlers: [
          {
            name: 'speak',
            toolName: 'plugin_summary_plugin_speak',
            definition: { description: 'Speak text' }
          }
        ],
        chatUIs: [{ title: 'Panel' }]
      }]
    ]);

    const list = service.list(plugins);
    assert.equal(list.length, 1, 'Expected one plugin summary');
    assert.equal(list[0].visibleInSidebar, false, 'Expected summary to expose sidebar visibility');
    assert.equal(list[0].handlerCount, 1, 'Expected summary to expose handler count');
    assert.equal(list[0].chatUICount, 1, 'Expected summary to expose chat UI count');

    const detail = service.detail(plugins, 'summary-plugin', {
      loadConfig: () => ({ voice: 'test' })
    });
    assert.equal(detail.config.voice, 'test', 'Expected detail to include loaded config');
    assert.equal(detail.handlers[0].toolName, 'plugin_summary_plugin_speak', 'Expected detail to expose handler metadata');
  }
};
