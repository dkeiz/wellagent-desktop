const MCPServer = require('../../src/main/mcp-server');
const PluginManager = require('../../src/main/plugin-manager');
const { MemoryDB, TestContainer, PluginCapabilityStub } = require('../helpers/fakes');

module.exports = {
  name: 'telegram-mtproto-plugin-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new MemoryDB();
    const capabilityManager = new PluginCapabilityStub();
    const mcpServer = new MCPServer(db, capabilityManager);
    const connectorState = new Map();
    const connectorRuntime = {
      listConnectors: async () => [],
      startConnector: async () => ({ success: true }),
      stopConnector: async () => ({ success: true }),
      getConfig: async (name) => {
        const prefix = `${name}.`;
        const result = {};
        for (const [key, value] of connectorState.entries()) {
          if (key.startsWith(prefix)) {
            result[key.slice(prefix.length)] = value;
          }
        }
        return result;
      },
      setConfig: async (name, key, value) => {
        connectorState.set(`${name}.${key}`, String(value));
        return { success: true, name, key };
      }
    };
    const container = new TestContainer({ db, mcpServer, capabilityManager, connectorRuntime });
    const pluginManager = new PluginManager(container);

    await pluginManager.initialize();
    await pluginManager.enablePlugin('telegram-relay');

    assert.equal(
      mcpServer.tools.has('plugin_telegram_relay_send_direct'),
      true,
      'Telegram plugin should register MTProto direct send tool'
    );

    const status = await pluginManager.runPluginAction('telegram-relay', 'status', {});
    assert.equal(status.success, true, 'Telegram status action should succeed');
    assert.equal(status.mtproto.mode, 'user', 'Telegram plugin should default to MTProto user mode');
    assert.equal(status.mtproto.enabled, false, 'Telegram MTProto should default to disabled');

    await pluginManager.setPluginConfig('telegram-relay', 'proxyType', 'mtproxy');
    await pluginManager.setPluginConfig('telegram-relay', 'proxyHost', '149.154.167.99');
    await pluginManager.setPluginConfig('telegram-relay', 'proxyPort', '443');
    await pluginManager.setPluginConfig('telegram-relay', 'proxySecret', '0123456789abcdef0123456789abcdef');
    const mtproxyLink = await pluginManager.runPluginAction('telegram-relay', 'build-proxy-link', {});
    assert.includes(mtproxyLink.proxyLink, 'tg://proxy', 'MTProxy link should use tg://proxy');
    assert.includes(mtproxyLink.proxyLink, 'secret=0123456789abcdef0123456789abcdef', 'MTProxy link should include the proxy secret');

    const applied = await pluginManager.runPluginAction('telegram-relay', 'apply-proxy-link', {
      link: 'tg://socks?server=127.0.0.1&port=1080&user=alice&pass=secret'
    });
    assert.equal(applied.success, true, 'Proxy link apply should succeed');

    const config = await pluginManager.getPluginConfig('telegram-relay', { includeSecrets: true });
    assert.equal(config.proxyType, 'socks5', 'SOCKS proxy link should set proxy type');
    assert.equal(config.proxyHost, '127.0.0.1', 'SOCKS proxy link should set host');
    assert.equal(config.proxyPort, '1080', 'SOCKS proxy link should set port');
    assert.equal(config.proxyUsername, 'alice', 'SOCKS proxy link should set username');
    assert.equal(config.proxyPassword, 'secret', 'SOCKS proxy link should set password');

    const compactApplied = await pluginManager.runPluginAction('telegram-relay', 'apply-proxy-link', {
      link: '149.154.167.99:443:0123456789abcdef0123456789abcdef'
    });
    assert.equal(compactApplied.success, true, 'Compact MTProxy address should apply');
    const compactConfig = await pluginManager.getPluginConfig('telegram-relay', { includeSecrets: true });
    assert.equal(compactConfig.proxyType, 'mtproxy', 'Compact MTProxy address should set proxy type');
    assert.equal(compactConfig.proxyHost, '149.154.167.99', 'Compact MTProxy address should set host');
    assert.equal(compactConfig.proxyPort, '443', 'Compact MTProxy address should set port');
    assert.equal(compactConfig.proxySecret, '0123456789abcdef0123456789abcdef', 'Compact MTProxy address should set secret');

    const clearedProxy = await pluginManager.runPluginAction('telegram-relay', 'clear-proxy', {});
    assert.equal(clearedProxy.success, true, 'Proxy clear action should succeed');
    const clearedConfig = await pluginManager.getPluginConfig('telegram-relay', { includeSecrets: true });
    assert.equal(clearedConfig.proxyType, 'none', 'Proxy clear should disable proxy');
    assert.equal(clearedConfig.proxyHost || '', '', 'Proxy clear should wipe host');
    assert.equal(clearedConfig.proxySecret || '', '', 'Proxy clear should wipe secret');

    const cleared = await pluginManager.runPluginAction('telegram-relay', 'mtproto-clear-session', {});
    assert.equal(cleared.success, true, 'MTProto clear session should succeed');
    assert.equal(
      (await pluginManager.getPluginConfig('telegram-relay', { includeSecrets: true })).sessionString || '',
      '',
      'MTProto clear session should wipe saved session'
    );

    await pluginManager.disablePlugin('telegram-relay');
  }
};
