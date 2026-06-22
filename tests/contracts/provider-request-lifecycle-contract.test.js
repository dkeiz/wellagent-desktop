const BaseAdapter = require('../../src/main/providers/base-adapter');

module.exports = {
  name: 'provider-request-lifecycle-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const adapter = new BaseAdapter('lifecycle-test', {});
    const first = adapter._startRequest('request-one');
    const second = adapter._startRequest('request-two');

    assert.equal(adapter.isGenerating, true, 'Expected adapter to generate while requests are active');
    assert.equal(adapter.getActiveRequestCount(), 2, 'Expected two active requests');

    adapter._endRequest(first.requestId);
    assert.equal(first.signal.aborted, false, 'Expected ending one request not to abort it');
    assert.equal(second.signal.aborted, false, 'Expected ending one request not to affect another request');
    assert.equal(adapter.getActiveRequestCount(), 1, 'Expected one active request after ending the first');
    assert.equal(adapter.isGenerating, true, 'Expected adapter to remain generating while one request is active');

    const stopped = adapter.stop();
    assert.equal(stopped, true, 'Expected stop without id to abort active provider requests');
    assert.equal(second.signal.aborted, true, 'Expected active request signal to be aborted');
    assert.equal(adapter.isGenerating, true, 'Expected request to remain active until cleanup runs');

    adapter._endRequest(second.requestId);
    assert.equal(adapter.getActiveRequestCount(), 0, 'Expected cleanup to remove the aborted request');
    assert.equal(adapter.isGenerating, false, 'Expected adapter not to generate after all requests end');
  }
};
