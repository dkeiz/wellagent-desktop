const fs = require('fs');
const path = require('path');
const AgentManager = require('../../src/main/agent-manager');
const SubtaskRuntime = require('../../src/main/subtask-runtime');
const { makeTempDir } = require('../helpers/fakes');

function createSessionWorkspace(baseDir) {
  return {
    getWorkspacePath(sessionId) {
      const dir = path.join(baseDir, String(sessionId));
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    listFiles(sessionId) {
      const dir = path.join(baseDir, String(sessionId));
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).map(name => {
        const filePath = path.join(dir, name);
        const stat = fs.statSync(filePath);
        return {
          path: filePath,
          name,
          size: stat.size,
          created: stat.birthtime
        };
      });
    },
    cleanup(sessionId) {
      const dir = path.join(baseDir, String(sessionId));
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  };
}

module.exports = {
  name: 'subagent-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-subtasks-');
    const workspaceBase = path.join(tempBase, 'workspaces');
    const sessionWorkspace = createSessionWorkspace(workspaceBase);
    const agent = {
      id: 7,
      name: 'Search Agent',
      type: 'sub',
      icon: '🌐',
      system_prompt: 'You are a search worker.'
    };
    const deliveredMessages = [];
    const statusUpdates = [];
    const publishedEvents = [];
    const settings = new Map([
      ['agents.defaultsSeeded.v1', 'true'],
      ['agents.defaultAdditionsSynced.v4.book-comfy-setup-search', 'true']
    ]);

    const db = {
      async getSetting(key) {
        return settings.get(key) || null;
      },
      async saveSetting(key, value) {
        settings.set(key, String(value));
        return { key, value };
      },
      async getAgents() {
        return [agent];
      },
      async getAgent(id) {
        return id === 7 ? agent : null;
      },
      async updateAgent(id, data) {
        statusUpdates.push({ id, data });
        return { id, ...data };
      },
      async addConversation(message, sessionId) {
        deliveredMessages.push({ message, sessionId });
        return { sessionId, ...message };
      }
    };

    let capturedPrompt = null;
    let capturedOptions = null;
    const chainController = {
      async executeWithChaining(prompt, history, options) {
        capturedPrompt = prompt;
        capturedOptions = options;

        await options.trace.onAssistantMessage({
          step: 1,
          content: 'Searching sources and preparing the result.',
          toolCalls: []
        });

        const notesPath = path.join(sessionWorkspace.getWorkspacePath(options.sessionId), 'notes.md');
        fs.writeFileSync(notesPath, '# Notes\n\nSource A\n', 'utf-8');

        await options.trace.onToolResult({
          step: 1,
          toolName: 'read_file',
          params: { path: 'source-a.md' },
          success: true,
          result: { ok: true }
        });

        await options.trace.onSyntheticUserMessage({
          step: 1,
          kind: 'tool_results',
          content: '<tool_results>\nTool: read_file\nResult: {"ok":true}\n</tool_results>'
        });

        return {
          chainComplete: true,
          completionTool: 'complete_subtask',
          completionResult: {
            status: 'research_complete',
            summary: 'Found two relevant sources',
            data: {
              findings: ['A', 'B']
            },
            artifacts: [
              {
                name: 'notes.md',
                description: 'Research notes'
              }
            ],
            notes: 'done'
          }
        };
      }
    };

    const eventBus = {
      publish(eventType, payload) {
        publishedEvents.push({ eventType, payload });
      },
      mainWindow: {
        webContents: {
          send() {}
        }
      }
    };

    const subtaskRuntime = new SubtaskRuntime(
      db,
      sessionWorkspace,
      eventBus,
      path.join(tempBase, 'subtasks')
    );

    const manager = new AgentManager(
      db,
      {},
      null,
      null,
      sessionWorkspace,
      chainController,
      eventBus,
      subtaskRuntime
    );
    await manager.initialize();

    const ack = await manager.invokeSubAgent(10, 7, 'Research Electron security guidance', {
      contractType: 'research_complete',
      expectedOutput: 'Include findings and sources'
    });

    assert.equal(ack.accepted, true, 'Expected immediate subagent acknowledgment');
    assert.equal(ack.status, 'queued', 'Expected queued status in immediate acknowledgment');
    assert.ok(fs.existsSync(ack.runDir), 'Expected run folder to be created');
    assert.ok(fs.existsSync(ack.tracePath), 'Expected trace file to be created');
    assert.ok(fs.existsSync(path.join(ack.runDir, 'request.json')), 'Expected request manifest');
    assert.ok(fs.existsSync(path.join(ack.runDir, 'status.json')), 'Expected status manifest');

    const completed = await manager.waitForSubagentRun(ack.runId, 2000);

    assert.equal(completed.status, 'research_complete', 'Expected completed contract status');
    assert.equal(completed.result.contract.summary, 'Found two relevant sources', 'Expected structured summary');
    assert.deepEqual(completed.result.contract.data, { findings: ['A', 'B'] }, 'Expected structured data payload');
    assert.equal(completed.result.contract.artifacts.length, 1, 'Expected merged artifacts');
    assert.equal(completed.result.contract.artifacts[0].name, 'notes.md', 'Expected merged artifact name');
    assert.ok(fs.existsSync(completed.result_path), 'Expected result.json to be written');
    assert.ok(fs.existsSync(completed.messages_path), 'Expected messages.jsonl to be written');

    const traceText = fs.readFileSync(completed.trace_path, 'utf-8');
    assert.includes(traceText, 'parent may inspect this run folder', 'Expected delegated-run guidance in trace');
    assert.includes(traceText, 'Searching sources', 'Expected assistant trace entry');

    assert.includes(capturedPrompt, 'Required completion envelope', 'Expected completion envelope instructions in prompt');
    assert.includes(capturedPrompt, 'Include findings and sources', 'Expected output instructions in prompt');
    assert.includes(capturedPrompt, ack.runDir, 'Expected run directory guidance in prompt');
    assert.equal(capturedOptions.sessionId, ack.childSessionId, 'Expected child session id to be passed to chain controller');
    assert.equal(capturedOptions.agentId, 7, 'Expected child agent id to be passed to chain controller');

    const childMessages = deliveredMessages.filter(entry => String(entry.sessionId) === String(ack.childSessionId));
    const parentMessages = deliveredMessages.filter(entry => Number(entry.sessionId) === 10);
    assert.ok(childMessages.length >= 4, 'Expected delegated child chat log to be persisted');
    assert.ok(childMessages.some(entry => entry.message.content.includes('<tool_results>')), 'Expected delegated child history to persist generated tool-results context');
    assert.equal(parentMessages.length, 1, 'Expected completed result to be autosent to parent session');
    assert.includes(parentMessages[0].message.content, ack.runId, 'Expected parent delivery to include canonical run id');
    assert.includes(parentMessages[0].message.content, ack.runDir, 'Expected parent delivery to mention run folder');
    assert.includes(parentMessages[0].message.content, completed.result_path, 'Expected parent delivery to mention result file');
    assert.includes(parentMessages[0].message.content, '"findings"', 'Expected parent delivery to inline structured contract data');

    assert.deepEqual(
      statusUpdates.map(entry => entry.data.status),
      ['active', 'idle'],
      'Expected subagent status lifecycle updates'
    );
    assert.deepEqual(
      publishedEvents.map(entry => entry.eventType),
      ['subagent:queued', 'subagent:started', 'subagent:completed'],
      'Expected delegated run lifecycle events'
    );
  }
};
