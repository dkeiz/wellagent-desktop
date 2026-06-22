const { StartupProfiler } = require('../../src/main/startup-profiler');

module.exports = {
  name: 'startup-profiler-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const logs = [];
    const profiler = new StartupProfiler({
      enabled: true,
      logger: {
        log(message) {
          logs.push(message);
        }
      }
    });

    const syncValue = profiler.timeSync('sync.stage', () => 42);
    const asyncValue = await profiler.time('async.stage', async () => 'ok');
    profiler.mark('ready', { window: true });

    const summary = profiler.summary();
    assert.equal(syncValue, 42, 'Expected sync timing to return the callback value');
    assert.equal(asyncValue, 'ok', 'Expected async timing to return the callback value');
    assert.equal(summary.length, 3, 'Expected profiler summary to include timed and marked stages');
    assert.equal(summary[0].name, 'sync.stage', 'Expected sync stage to be recorded');
    assert.equal(summary[1].name, 'async.stage', 'Expected async stage to be recorded');
    assert.equal(summary[2].name, 'ready', 'Expected ready mark to be recorded');
    assert.ok(summary[0].detail.durationMs >= 0, 'Expected timed stages to include duration');
    assert.includes(logs.join('\n'), '[Startup] ready', 'Expected enabled profiler to log marks');
  }
};
