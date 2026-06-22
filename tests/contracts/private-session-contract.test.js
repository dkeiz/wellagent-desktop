const fs = require('fs');
const path = require('path');
const { registerChatDataHandlers } = require('../../src/main/ipc/register-chat-data-handlers');
const SessionWorkspace = require('../../src/main/session-workspace');
const { PrivateSessionStore, isPrivateSessionId } = require('../../src/main/private-session-store');
const { makeTempDir } = require('../helpers/fakes');

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
  name: 'private-session-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-private-session-');
    const sessionWorkspace = new SessionWorkspace(path.join(tempBase, 'workspaces'));
    const privateSessionStore = new PrivateSessionStore({ sessionWorkspace });
    const dbConversations = [];
    const dbCalls = {
      createChatSession: 0,
      setCurrentSession: 0,
      enqueueMemoryJob: 0,
      rememberSetting: 0
    };
    const activity = { active: 0, idle: 0, recorded: 0 };
    let currentSessionId = null;

    const db = {
      async getSetting() { return null; },
      get() { return null; },
      async getConversations() { return dbConversations.slice(); },
      async addConversation(message) {
        dbConversations.push(message);
        return message;
      },
      async createChatSession() {
        dbCalls.createChatSession += 1;
        return { id: 'db-session' };
      },
      async setCurrentSession() {
        dbCalls.setCurrentSession += 1;
      },
      async enqueueMemoryJob() {
        dbCalls.enqueueMemoryJob += 1;
      },
      async saveSetting() {
        dbCalls.rememberSetting += 1;
      }
    };

    const ipcMain = new FakeIpcMain();
    registerChatDataHandlers(ipcMain, {
      db,
      mcpServer: {
        setCurrentSessionId(sessionId) { currentSessionId = sessionId; },
        getCurrentSessionId() { return currentSessionId; },
        setCurrentAgentContext() {}
      },
      windowManager: { send() {} },
      chainController: null,
      agentLoop: {
        recordActivity() { activity.recorded += 1; }
      },
      agentManager: null,
      dispatcher: {
        async dispatch(prompt) {
          return { content: `Echo:${prompt}`, model: 'mock' };
        }
      },
      sessionWorkspace,
      sessionInitManager: { recordActivity: async () => {} },
      promptFileManager: null,
      memoryDaemon: null,
      taskQueueService: null,
      executionDirectory: null,
      privateSessionStore,
      privateModeDefault: false,
      testClientMode: false,
      testClientStore: { sessions: new Map(), currentSessionId: null }
    }, {
      markUserActive() { activity.active += 1; },
      markUserIdle() { activity.idle += 1; }
    });

    try {
      const session = await ipcMain.invoke('create-chat-session', { private: true });
      assert.equal(isPrivateSessionId(session.id), true, 'Expected private session id');
      assert.equal(dbCalls.createChatSession, 0, 'Expected no DB chat session for private mode');

      const response = await ipcMain.invoke('send-message', 'secret text', false, session.id);
      assert.includes(response.content, 'Echo:secret text', 'Expected private message response');
      assert.equal(dbConversations.length, 0, 'Expected no DB conversation rows for private mode');
      assert.equal(activity.active, 0, 'Expected no user-active background event for private mode');
      assert.equal(activity.idle, 0, 'Expected no user-idle background event for private mode');
      assert.equal(activity.recorded, 0, 'Expected no agent-loop activity for private mode');
      assert.equal(dbCalls.setCurrentSession, 0, 'Expected no current-session DB write for private mode');
      assert.equal(privateSessionStore.getMessages(session.id, 10).length, 2, 'Expected private messages in memory only');

      sessionWorkspace.writeOutput(session.id, 'private-report', 'temporary private output');
      const closeSummary = await ipcMain.invoke('private-session:close-summary', session.id);
      assert.equal(closeSummary.requiresConfirmation, true, 'Expected close confirmation contract');
      assert.equal(closeSummary.messageCount, 2, 'Expected close summary to report in-memory messages');
      assert.equal(closeSummary.fileCount, 1, 'Expected close summary to report workspace files');

      const discard = await ipcMain.invoke('private-session:discard', session.id);
      assert.equal(discard.success, true, 'Expected private discard to succeed');
      assert.equal(privateSessionStore.getMessages(session.id, 10).length, 0, 'Expected private messages removed after discard');
      assert.equal(fs.existsSync(sessionWorkspace.getWorkspacePath(session.id)), true, 'Workspace path can be recreated after discard');
      assert.deepEqual(sessionWorkspace.listFiles(session.id), [], 'Expected private workspace files removed after discard');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
