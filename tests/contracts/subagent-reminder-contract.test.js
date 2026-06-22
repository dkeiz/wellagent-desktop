const path = require('path');
const AgentManager = require('../../src/main/agent-manager');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const { makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'subagent-reminder-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-subagent-reminder-');
    const agent = {
      id: 9,
      name: 'Reminder Agent',
      type: 'sub',
      icon: '🧪',
      system_prompt: 'You are a reminder-test worker.'
    };
    const deliveredMessages = [];
    const publishedEvents = [];
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
        return id === 9 ? agent : null;
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

        if (callCount === 1) {
          return { content: '' };
        }

        if (callCount === 2) {
          await options.trace.onAssistantMessage({
            step: 1,
            content: 'Done.',
            toolCalls: []
          });
          return {
            completionResult: {
              status: 'task_complete',
              summary: 'Done',
              data: {},
              artifacts: [],
              notes: ''
            }
          };
        }

        await options.trace.onAssistantMessage({
          step: 1,
          content: 'No result found after checking the available path.',
          toolCalls: []
        });
        return {
          completionResult: {
            status: 'task_failed',
            summary: 'No result found after checking the available path.',
            data: {
              outcome: 'empty'
            },
            artifacts: [],
            notes: 'Returning noticed failure instead of stopping silently.'
          }
        };
      }
    };

    const eventBus = {
      publish(eventType, payload) {
        publishedEvents.push({ eventType, payload });
      }
    };

    const subtaskRuntime = new SubtaskRuntime(
      db,
      null,
      eventBus,
      path.join(tempBase, 'subtasks')
    );

    const manager = new AgentManager(
      db,
      {},
      null,
      null,
      null,
      chainController,
      eventBus,
      subtaskRuntime
    );
    await manager.initialize();

    const ack = await manager.invokeSubAgent(77, 9, 'Find something useful or fail properly.', {
      contractType: 'task_complete'
    });
    const completed = await manager.waitForSubagentRun(ack.runId, 3000);

    assert.equal(callCount, 3, 'Expected backend reminders to continue the child until a proper completion contract exists');
    assert.equal(completed.status, 'task_failed', 'Expected final noticed failure instead of silent stop');
    assert.equal(
      completed.result.contract.summary,
      'No result found after checking the available path.',
      'Expected final child response to be preserved'
    );
    assert.deepEqual(
      completed.result.contract.data,
      { outcome: 'empty' },
      'Expected noticed empty-result payload'
    );

    assert.includes(prompts[1].prompt, 'Silent stop is invalid', 'Expected backend reminder after silent stop');
    assert.includes(prompts[2].prompt, 'empty completion envelope', 'Expected backend reminder after empty success payload');
    assert.ok(prompts[2].historyLength >= 2, 'Expected reminder continuation to reuse child history');

    const childMessages = deliveredMessages.filter(entry => String(entry.sessionId) === String(ack.childSessionId));
    const reminderMessages = childMessages.filter(entry => entry.message.metadata?.kind === 'backend_completion_reminder');
    assert.equal(reminderMessages.length, 2, 'Expected two backend reminder messages to be persisted to the child session');

    assert.deepEqual(
      publishedEvents.map(entry => entry.eventType),
      ['subagent:queued', 'subagent:started', 'subagent:completed'],
      'Expected delegated run to complete after reminders'
    );
  }
};
