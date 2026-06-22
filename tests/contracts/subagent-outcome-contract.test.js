const path = require('path');
const AgentManager = require('../../src/main/agent-manager');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'subagent-outcome-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-subagent-outcome-');
    const agent = {
      id: 11,
      name: 'Outcome Agent',
      type: 'sub',
      icon: '📡',
      system_prompt: 'You are an outcome-test worker.'
    };
    const deliveredMessages = [];
    const prompts = [];
    const settings = new Map();
    let callCount = 0;

    const db = {
      async getSetting(key) {
        return settings.has(key) ? settings.get(key) : null;
      },
      async saveSetting(key, value) {
        settings.set(key, value);
        return true;
      },
      async getAgents() {
        return [agent];
      },
      async getAgent(id) {
        return id === 11 ? agent : null;
      },
      async updateAgent() {
        return { success: true };
      },
      async addConversation(message, sessionId) {
        deliveredMessages.push({ message, sessionId });
        return { sessionId, ...message };
      },
      async getConversations(limit, sessionId) {
        return deliveredMessages
          .filter(entry => String(entry.sessionId) === String(sessionId))
          .map(entry => ({
            role: entry.message.role,
            content: entry.message.content,
            metadata: entry.message.metadata || null
          }));
      }
    };

    const chainController = {
      async executeWithChaining(prompt, history, options) {
        callCount += 1;
        prompts.push({ prompt, historyLength: history.length });
        await options.trace.onAssistantMessage({
          step: 1,
          content: 'No result found after checking the allowed source.',
          toolCalls: []
        });
        return {
          completionResult: {
            status: 'empty',
            summary: 'No result found after checking the allowed source.',
            data: {},
            artifacts: [],
            notes: ''
          }
        };
      }
    };

    const subtaskRuntime = new SubtaskRuntime(
      db,
      null,
      null,
      path.join(tempBase, 'subtasks')
    );

    const manager = new AgentManager(
      db,
      {},
      null,
      null,
      null,
      chainController,
      null,
      subtaskRuntime
    );
    await manager.initialize();

    const ack = await manager.invokeSubAgent(55, 11, 'Try the lookup and report the noticed outcome.', {
      contractType: 'task_complete'
    });
    const completed = await manager.waitForSubagentRun(ack.runId, 3000);

    assert.equal(callCount, 1, 'Expected noticed outcome envelope to be accepted without reminder loop');
    assert.equal(completed.status, 'empty', 'Expected opaque child outcome label to be preserved');
    assert.equal(completed.result.contract.status, 'empty', 'Expected delivered contract status to remain opaque');
    assert.equal(
      completed.result.contract.summary,
      'No result found after checking the allowed source.',
      'Expected noticed outcome summary to be preserved'
    );

    const childMessages = deliveredMessages.filter(entry => String(entry.sessionId) === String(ack.childSessionId));
    const reminderMessages = childMessages.filter(entry => entry.message.metadata?.kind === 'backend_completion_reminder');
    assert.equal(reminderMessages.length, 0, 'Expected no backend reminder when a noticed empty outcome is delivered');
    assert.equal(prompts.length, 1, 'Expected only the initial delegated task prompt');
  }
};
