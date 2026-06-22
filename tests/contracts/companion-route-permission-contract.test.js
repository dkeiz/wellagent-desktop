const path = require('path');

function createDb() {
  const writes = [];
  return {
    writes,
    async getSetting() {
      return null;
    },
    async saveSetting(key, value) {
      writes.push({ key, value });
    }
  };
}

function createContainer(db, extraServices = {}) {
  const services = new Map([['db', db], ...Object.entries(extraServices)]);
  return {
    get(name) {
      if (!services.has(name)) throw new Error(`Missing service: ${name}`);
      return services.get(name);
    },
    optional(name) {
      return services.has(name) ? services.get(name) : null;
    },
    replace(name, value) {
      services.set(name, value);
      return this;
    }
  };
}

function createDispatch({ rootDir, permissions, extraServices = {} }) {
  const db = createDb();
  const { configureCompanionServer } = require(path.join(
    rootDir,
    'src',
    'main',
    'companion',
    'companion-backend-dispatch.js'
  ));
  let dispatch = null;
  configureCompanionServer({
    companionServer: {
      setDispatch(fn) {
        dispatch = fn;
      },
      disconnectDevice() {}
    },
    container: createContainer(db, extraServices),
    db,
    companionAuth: {
      async validateAccessToken() {
        return {
          valid: true,
          payload: {
            deviceId: 'companion-route-contract-device',
            platform: 'web',
            permissions
          }
        };
      }
    }
  });
  return {
    db,
    dispatch(method, urlPath, body = {}) {
      return dispatch(
        method,
        urlPath,
        body,
        {},
        'access-token',
        {},
        new URL(`http://127.0.0.1${urlPath}`)
      );
    }
  };
}

module.exports = {
  name: 'companion-route-permission-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const { getCompanionRoutePolicy } = require(path.join(
      rootDir,
      'src',
      'main',
      'companion',
      'companion-backend-dispatch.js'
    ));
    const CompanionPermissions = require(path.join(rootDir, 'src', 'main', 'companion-permissions.js'));
    const permissions = new CompanionPermissions();

    assert.deepEqual(
      getCompanionRoutePolicy('POST', '/companion/agents/active', { active: false }),
      { category: 'admin', channel: 'deactivate-agent' },
      'Expected agent deactivation to have an explicit companion route policy'
    );
    assert.deepEqual(
      getCompanionRoutePolicy('POST', '/companion/daemon', { kind: 'workflow', running: true }),
      { category: 'admin', channel: 'daemon:workflow-start' },
      'Expected daemon control route to resolve a concrete channel'
    );
    assert.deepEqual(
      getCompanionRoutePolicy('POST', '/companion/task-queue/action', { action: 'approve' }),
      { category: 'action', channel: 'task-queue:approve' },
      'Expected task queue action route to resolve a concrete channel'
    );

    assert.equal(
      permissions.isChannelAllowed({ preset: 'read-only', settingsWrite: false }, 'llm:set-thinking-mode'),
      false,
      'Expected read-only devices to be blocked from LLM setting mutation'
    );
    assert.equal(
      permissions.isChannelAllowed({ preset: 'standard', daemonControl: true }, 'daemon:memory-start'),
      true,
      'Expected standard devices with daemonControl to retain daemon controls'
    );
    assert.equal(
      permissions.isChannelAllowed({ preset: 'standard' }, 'task-queue:approve'),
      false,
      'Expected standard devices not to approve queued tasks'
    );
    assert.equal(
      permissions.isChannelAllowed({ preset: 'full' }, 'task-queue:approve'),
      true,
      'Expected full devices to approve queued tasks'
    );

    const readOnly = createDispatch({
      rootDir,
      permissions: {
        preset: 'read-only',
        mediaUpload: false,
        settingsWrite: false,
        agentManagement: false,
        daemonControl: false
      },
      extraServices: {
        capabilityManager: {
          setMainEnabled() {
            assert.fail('Denied capability route reached capability manager');
          }
        },
        agentManager: {
          activateAgent() {
            assert.fail('Denied agent route reached agent manager');
          }
        }
      }
    });

    const deniedRoutes = [
      ['POST', '/companion/llm/thinking', { mode: 'think' }],
      ['POST', '/companion/agents/active', { agentId: 'agent-1', active: true }],
      ['POST', '/companion/capabilities/main', { enabled: false }],
      ['POST', '/companion/daemon', { kind: 'memory', running: true }],
      ['POST', '/companion/task-queue/action', { action: 'approve', taskId: 'task-1' }]
    ];
    for (const [method, urlPath, body] of deniedRoutes) {
      const response = await readOnly.dispatch(method, urlPath, body);
      assert.equal(response.status, 403, `Expected ${method} ${urlPath} to be permission-gated`);
    }
    assert.deepEqual(readOnly.db.writes, [], 'Expected denied routes not to mutate settings');

    const runtimeDenied = createDispatch({
      rootDir,
      permissions: { preset: 'full', settingsWrite: true, agentManagement: true, daemonControl: true },
      extraServices: {
        runtimePolicy: {
          createCompanionPrincipal() {
            return { type: 'companion', id: 'companion:denied', profile: 'companion-standard' };
          },
          assert() {
            const error = new Error('runtime denied companion route');
            error.code = 'RUNTIME_POLICY_DENIED';
            throw error;
          }
        }
      }
    });
    const runtimeDeniedResponse = await runtimeDenied.dispatch('GET', '/companion/settings/full');
    assert.equal(runtimeDeniedResponse.status, 403, 'Expected runtime policy to gate companion routes');
    assert.includes(runtimeDeniedResponse.body.error, 'runtime denied companion route', 'Expected runtime policy denial message');

    const taskCalls = [];
    const full = createDispatch({
      rootDir,
      permissions: { preset: 'full', settingsWrite: true, agentManagement: true, daemonControl: true },
      extraServices: {
        taskQueueService: {
          approveTask(taskId, options) {
            taskCalls.push({ taskId, options });
            return { success: true, taskId };
          }
        }
      }
    });
    const approved = await full.dispatch('POST', '/companion/task-queue/action', {
      action: 'approve',
      taskId: 'task-1'
    });
    assert.equal(approved.status, 200, 'Expected full companion devices to approve queued tasks');
    assert.deepEqual(taskCalls, [{ taskId: 'task-1', options: { actor: 'companion-web' } }]);
  }
};
