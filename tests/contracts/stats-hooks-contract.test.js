const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScript(filePath, context) {
  const source = fs.readFileSync(filePath, 'utf8');
  vm.runInNewContext(source, context, { filename: filePath });
}

module.exports = {
  name: 'stats-hooks-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const savedStats = [];
    const localStorage = new Map();
    const domHandlers = [];
    const context = {
      console,
      document: {
        addEventListener(type, handler) {
          if (type === 'DOMContentLoaded') {
            domHandlers.push(handler);
          }
        },
        getElementById() {
          return null;
        }
      },
      setTimeout(fn) {
        fn();
        return 1;
      },
      localStorage: {
        getItem(key) {
          return localStorage.has(key) ? localStorage.get(key) : null;
        },
        setItem(key, value) {
          localStorage.set(key, String(value));
          savedStats.push([key, String(value)]);
        }
      },
      window: null
    };
    context.window = context;
    context.window.document = context.document;

    const shellPath = path.join(rootDir, 'src', 'renderer', 'components', 'renderer-shell.js');
    const statsPath = path.join(rootDir, 'src', 'renderer', 'components', 'stats.js');
    loadScript(shellPath, context);

    const panel = {
      async sendMessage() {
        this.sendCalls = (this.sendCalls || 0) + 1;
      },
      async newChat() {
        this.newChatCalls = (this.newChatCalls || 0) + 1;
      }
    };
    context.window.mainPanel = panel;
    context.window.localAgentRendererShell.initializeMainPanel(panel);
    loadScript(statsPath, context);
    for (const handler of domHandlers) handler();

    assert.ok(context.window.statsTracker, 'Expected stats tracker singleton to be installed');

    await panel.sendMessage();
    await panel.newChat();

    assert.equal(panel.sendCalls, 1, 'Expected stats wrapper to preserve original sendMessage behavior');
    assert.equal(panel.newChatCalls, 1, 'Expected stats wrapper to preserve original newChat behavior');
    assert.equal(context.window.statsTracker.stats.messagesCount, 1, 'Expected sendMessage wrapper to increment sent-message stats');
    assert.equal(context.window.statsTracker.stats.sessionsStarted, 1, 'Expected newChat wrapper to increment session stats');
    assert.ok(savedStats.length > 0, 'Expected stats tracker to persist updated stats after tracked actions');
  }
};
