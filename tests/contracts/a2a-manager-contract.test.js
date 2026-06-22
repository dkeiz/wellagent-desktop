const fs = require('fs');
const http = require('http');
const path = require('path');
const fetch = require('node-fetch');
const { A2AManager } = require('../../src/main/a2a-manager');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

function createFakeA2AServer() {
  let started = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        protocolVersion: '0.3.0',
        name: 'Remote Agent',
        url: `http://127.0.0.1:${server.address().port}/rpc`,
        capabilities: { streaming: false }
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            kind: 'task',
            id: 'remote-task-1',
            status: { state: 'completed' },
            history: [],
            artifacts: [{ parts: [{ type: 'text', text: 'remote-ok' }] }]
          }
        }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      started = true;
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      if (!started) return;
      await new Promise((resolve) => server.close(() => resolve()));
      started = false;
    }
  };
}

function createFakeWorkflowServer() {
  let promptCounter = 0;
  const history = new Map();
  let started = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/prompt') {
      const promptId = `prompt-${++promptCounter}`;
      history.set(promptId, {
        outputs: {
          image: [
            { filename: 'fake.png', subfolder: '', type: 'output' }
          ]
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: promptId }));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
      const promptId = url.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        [promptId]: history.get(promptId) || {}
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      started = true;
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      if (!started) return;
      await new Promise((resolve) => server.close(() => resolve()));
      started = false;
    }
  };
}

function collectSse(url, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      }
    });

    const events = [];
    const timer = setTimeout(() => {
      req.destroy(new Error(`SSE timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('response', (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(5).trim());
            events.push(parsed.result || parsed.error);
          }
          idx = buffer.indexOf('\n\n');
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve(events);
      });
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

module.exports = {
  name: 'a2a-manager-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempBase = makeTempDir('localagent-a2a-');
    const db = new MemoryDB();
    const providerCalls = [];
    const bridgeCalls = [];
    const remoteServer = createFakeA2AServer();
    const workflowServer = createFakeWorkflowServer();
    let manager = null;

    try {
      manager = new A2AManager({
        db,
        aiService: {
          getProviders() {
            return ['openai', 'lmstudio'];
          },
          async getModels(provider) {
            return provider === 'openai' ? ['gpt-5.2-codex'] : ['local-model'];
          }
        },
        dispatcher: {
          async dispatch(prompt, _history, options = {}) {
            providerCalls.push({ prompt, provider: options.provider });
            return {
              content: `provider:${options.provider}:${prompt}`,
              model: options.model || 'default'
            };
          }
        },
        externalChannelBridge: {
          async requestReply(input) {
            bridgeCalls.push(input);
            return {
              success: true,
              sessionId: 'a2a-session-1',
              content: `reply:${input.text}`,
              provider: 'mock',
              model: 'mock-model'
            };
          },
          async stopGeneration() {
            return { success: true, stopped: true };
          }
        },
        baseDir: path.join(tempBase, 'a2a')
      });
      await manager.initialize();

      const targets = await manager.listTargets();
      assert.ok(targets.some((target) => target.id === 'codex'), 'Expected codex target to be seeded');
      assert.ok(targets.some((target) => target.id === 'lmstudio'), 'Expected lmstudio target to be seeded');
      assert.ok(targets.some((target) => target.id === 'comfyui'), 'Expected comfyui target to be seeded');

      const statusBefore = await manager.getExposureStatus();
      assert.equal(statusBefore.enabled, false, 'Expected A2A exposure to be disabled by default');

      const started = await manager.setExposureEnabled(true);
      assert.equal(started.enabled, true, 'Expected exposure enablement to persist');
      assert.equal(started.running, true, 'Expected exposure enablement to start the server');

      const cardResponse = await fetch(started.cardUrl);
      assert.equal(cardResponse.status, 200, 'Expected agent card endpoint to respond');
      const card = await cardResponse.json();
      assert.equal(card.name, 'LocalAgent', 'Expected LocalAgent A2A card');

      const blockingPayload = {
        jsonrpc: '2.0',
        id: 'blocking-1',
        method: 'message/send',
        params: {
          configuration: { blocking: true },
          metadata: { localagent: { mockResponse: 'blocking-ok' } },
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'hello a2a' }]
          }
        }
      };
      const blockingJson = await (await fetch(started.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blockingPayload)
      })).json();
      assert.equal(blockingJson.result.status.state, 'completed', 'Expected blocking send to complete');
      assert.equal(blockingJson.result.artifacts[0].parts[0].text, 'blocking-ok', 'Expected blocking mock response artifact');

      const invalidTaskJson = await (await fetch(started.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'invalid-task-1',
          method: 'message/send',
          params: {
            configuration: { blocking: true },
            metadata: { localagent: { mockResponse: 'never-used' } },
            message: {
              role: 'user',
              taskId: '../escape',
              parts: [{ type: 'text', text: 'bad task id' }]
            }
          }
        })
      })).json();
      assert.equal(invalidTaskJson.error.message, 'Invalid task id', 'Expected invalid A2A task ids to be rejected');
      assert.equal(fs.existsSync(path.join(manager.baseDir, 'escape.json')), false, 'Expected traversal task file write to be blocked');
      assert.equal(fs.existsSync(path.join(manager.baseDir, 'escape.jsonl')), false, 'Expected traversal task event write to be blocked');

      const streamEvents = await collectSse(started.rpcUrl, {
        jsonrpc: '2.0',
        id: 'stream-1',
        method: 'message/stream',
        params: {
          metadata: { localagent: { mockResponse: 'stream-ok', delayMs: 25 } },
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'stream me' }]
          }
        }
      });
      assert.ok(streamEvents.length >= 2, 'Expected streaming send to emit multiple events');
      assert.equal(streamEvents[streamEvents.length - 1].status.state, 'completed', 'Expected streaming task to complete');

      const cancelJson = await (await fetch(started.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'cancel-seed',
          method: 'message/send',
          params: {
            metadata: { localagent: { mockResponse: 'cancel-never', delayMs: 200 } },
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'cancel me' }]
            }
          }
        })
      })).json();
      const cancelTaskId = cancelJson.result.id;
      const canceledJson = await (await fetch(started.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'cancel-1',
          method: 'tasks/cancel',
          params: { id: cancelTaskId }
        })
      })).json();
      assert.equal(canceledJson.result.status.state, 'canceled', 'Expected cancel to mark task canceled');

      const providerRun = await manager.callTarget('codex', { prompt: 'use provider' });
      assert.equal(providerRun.result.content, 'provider:openai:use provider', 'Expected provider bridge to use dispatcher');
      assert.equal(providerCalls[0].provider, 'openai', 'Expected codex target to route to openai provider');

      const lmstudioRun = await manager.callTarget('lmstudio', { prompt: 'local provider' });
      assert.equal(lmstudioRun.result.content, 'provider:lmstudio:local provider', 'Expected LM Studio target to route to lmstudio');

      const remoteBaseUrl = await remoteServer.start();
      const discovered = await manager.discoverA2A(remoteBaseUrl);
      assert.equal(discovered.bridgeType, 'a2a', 'Expected discovery to store an A2A target');
      const remoteRun = await manager.callTarget(discovered.id, { prompt: 'remote hello' });
      assert.equal(remoteRun.result.remoteTask.id, 'remote-task-1', 'Expected outbound A2A call to return remote task');

      const workflowBaseUrl = await workflowServer.start();
      const comfyTarget = await manager.describeTarget('comfyui');
      comfyTarget.transport.baseUrl = workflowBaseUrl;
      fs.writeFileSync(
        path.join(manager.targetsDir, 'comfyui.json'),
        JSON.stringify(comfyTarget, null, 2),
        'utf-8'
      );
      const comfyRun = await manager.callTarget('comfyui', {
        payload: {
          '1': { inputs: {}, class_type: 'CheckpointLoaderSimple' }
        }
      });
      assert.ok(comfyRun.result.outputs, 'Expected ComfyUI workflow bridge to return outputs');

      const cliManifest = {
        id: 'cli-echo',
        label: 'CLI Echo',
        bridgeType: 'cli',
        enabled: true,
        capabilities: { chat: true },
        transport: { type: 'process' },
        execution: {
          command: process.execPath,
          args: ['-e', "process.stdin.on('data', c => process.stdout.write(c.toString().toUpperCase()));"]
        },
        privacy: { localOnly: true },
        defaults: { timeoutMs: 5000 }
      };
      fs.writeFileSync(
        path.join(manager.targetsDir, 'cli-echo.json'),
        JSON.stringify(cliManifest, null, 2),
        'utf-8'
      );
      const cliRun = await manager.callTarget('cli-echo', { prompt: 'cli-ok' });
      assert.equal(cliRun.result.content, 'CLI-OK', 'Expected CLI bridge to capture stdout');

      let invalidTargetError = null;
      try {
        await manager.describeTarget('../escape');
      } catch (error) {
        invalidTargetError = error;
      }
      assert.ok(invalidTargetError, 'Expected invalid target ids to be rejected');
      assert.equal(invalidTargetError.message, 'Invalid target id', 'Expected target-id validation before file access');

      const savedRun = await manager.getRun(providerRun.id);
      assert.equal(savedRun.id, providerRun.id, 'Expected getRun to return persisted outbound run');
      assert.equal(bridgeCalls.length, 0, 'Expected mock-only inbound tests to avoid external bridge invocation');
    } finally {
      if (manager) {
        await manager.shutdown();
      }
      await remoteServer.stop().catch(() => {});
      await workflowServer.stop().catch(() => {});
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
