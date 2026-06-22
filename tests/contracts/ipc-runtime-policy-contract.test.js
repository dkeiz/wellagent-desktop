const { createPolicyIpcMain } = require('../../src/main/ipc/runtime-policy-ipc');

module.exports = {
  name: 'ipc-runtime-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const calls = [];
    const fakeIpc = {
      handlers: new Map(),
      handle(channel, handler) {
        this.handlers.set(channel, handler);
      }
    };
    const policyIpc = createPolicyIpcMain(fakeIpc, {
      runtimePolicy: {
        createRendererIpcPrincipal(channel) {
          return { type: 'renderer', id: `renderer:${channel}`, profile: 'renderer-ipc' };
        },
        assert(input) {
          calls.push(input);
          return true;
        }
      }
    });

    policyIpc.handle('demo:channel', async (event, value) => ({ value }));
    const result = await fakeIpc.handlers.get('demo:channel')({ sender: { id: 7 } }, 'ok');

    assert.deepEqual(result, { value: 'ok' }, 'Expected wrapped IPC handler result to pass through');
    assert.equal(calls.length, 1, 'Expected runtime policy to be called for IPC invoke');
    assert.equal(calls[0].action, 'ipc.invoke', 'Expected IPC policy action');
    assert.equal(calls[0].resource, 'demo:channel', 'Expected IPC channel as policy resource');
    assert.equal(calls[0].principal.profile, 'renderer-ipc', 'Expected renderer IPC principal profile');
  }
};
