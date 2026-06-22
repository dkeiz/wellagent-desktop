const { RuntimePolicy } = require('../../src/main/runtime-policy');

function captureDenied(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

module.exports = {
  name: 'runtime-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const policy = new RuntimePolicy();

    policy.assert({
      principal: { id: 'subagent:strict', profile: 'strict-subagent' },
      action: 'tool.execute',
      resource: 'read_file'
    });

    const strictProcessError = captureDenied(() => policy.assert({
      principal: { id: 'subagent:strict', profile: 'strict-subagent' },
      action: 'process.spawn',
      resource: 'npm'
    }));
    assert.equal(strictProcessError?.code, 'RUNTIME_POLICY_DENIED', 'Expected strict subagent to deny process spawn');

    policy.assert({
      principal: { id: 'subagent:wide', profile: 'wide-agent' },
      action: 'process.spawn',
      resource: 'npm'
    });

    const strictPluginManifest = {
      id: 'strict-plugin',
      runtimePermissions: {
        profile: 'plugin-strict'
      }
    };
    const strictPluginPrincipal = policy.createPluginPrincipal('strict-plugin', strictPluginManifest);
    policy.assert({
      principal: strictPluginPrincipal,
      action: 'plugin.config.read',
      manifest: strictPluginManifest
    });
    const connectorError = captureDenied(() => policy.assert({
      principal: strictPluginPrincipal,
      action: 'plugin.connector.start',
      manifest: strictPluginManifest,
      metadata: { connectorName: 'telegram' }
    }));
    assert.equal(connectorError?.code, 'RUNTIME_POLICY_DENIED', 'Expected strict plugin to deny undeclared connector access');

    const connectorPluginManifest = {
      id: 'connector-plugin',
      runtimePermissions: {
        profile: 'plugin-strict',
        connectors: ['telegram'],
        managedProcesses: true
      }
    };
    const connectorPrincipal = policy.createPluginPrincipal('connector-plugin', connectorPluginManifest);
    policy.assert({
      principal: connectorPrincipal,
      action: 'plugin.connector.start',
      manifest: connectorPluginManifest,
      metadata: { connectorName: 'telegram' }
    });
    policy.assert({
      principal: connectorPrincipal,
      action: 'plugin.process.manage',
      manifest: connectorPluginManifest
    });

    const otherConnectorError = captureDenied(() => policy.assert({
      principal: connectorPrincipal,
      action: 'plugin.connector.start',
      manifest: connectorPluginManifest,
      metadata: { connectorName: 'mail' }
    }));
    assert.equal(otherConnectorError?.code, 'RUNTIME_POLICY_DENIED', 'Expected connector grant to stay connector-specific');
  }
};
