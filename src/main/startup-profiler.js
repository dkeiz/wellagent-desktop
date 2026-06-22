const { performance } = require('perf_hooks');

function formatMs(value) {
  return `${Math.round(Number(value || 0))}ms`;
}

class StartupProfiler {
  constructor(options = {}) {
    this.enabled = options.enabled === true || process.env.LOCALAGENT_STARTUP_TRACE === '1';
    this.logger = options.logger || console;
    this.startedAt = performance.now();
    this.lastAt = this.startedAt;
    this.events = [];
  }

  mark(name, detail = null) {
    const now = performance.now();
    const event = {
      name: String(name || 'startup.mark'),
      elapsedMs: now - this.startedAt,
      deltaMs: now - this.lastAt,
      detail: detail && typeof detail === 'object' ? { ...detail } : detail
    };
    this.lastAt = now;
    this.events.push(event);

    if (this.enabled && this.logger?.log) {
      const suffix = event.detail ? ` ${JSON.stringify(event.detail)}` : '';
      this.logger.log(`[Startup] ${event.name} +${formatMs(event.deltaMs)} total=${formatMs(event.elapsedMs)}${suffix}`);
    }
    return event;
  }

  timeSync(name, fn) {
    const startedAt = performance.now();
    try {
      return fn();
    } finally {
      this.mark(name, { durationMs: performance.now() - startedAt });
    }
  }

  async time(name, fn) {
    const startedAt = performance.now();
    try {
      return await fn();
    } finally {
      this.mark(name, { durationMs: performance.now() - startedAt });
    }
  }

  summary() {
    return this.events.map(event => ({ ...event }));
  }
}

function createStartupProfiler(options = {}) {
  return new StartupProfiler(options);
}

module.exports = {
  StartupProfiler,
  createStartupProfiler
};
