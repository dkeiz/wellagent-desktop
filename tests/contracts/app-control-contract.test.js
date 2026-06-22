const Module = require('module');
const path = require('path');

module.exports = {
  name: 'app-control-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const handlerPath = path.join(rootDir, 'src', 'main', 'ipc', 'register-app-control-handlers.js');
    const originalLoad = Module._load;
    const calls = { reloads: 0, relaunches: 0, quits: 0, opened: [] };
    const sender = { id: 'renderer-webcontents' };
    const ownerWindow = {
      webContents: {
        reloadIgnoringCache() {
          calls.reloads += 1;
        }
      }
    };

    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') {
        return {
          app: {
            relaunch() {
              calls.relaunches += 1;
            },
            quit() {
              calls.quits += 1;
            }
          },
          BrowserWindow: {
            fromWebContents(target) {
              return target === sender ? ownerWindow : null;
            }
          },
          shell: {
            async openExternal(url) {
              calls.opened.push(url);
            }
          }
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[require.resolve(handlerPath)];
    const { registerAppControlHandlers } = require(handlerPath);
    Module._load = originalLoad;

    const handlers = new Map();
    registerAppControlHandlers({
      handle(channel, fn) {
        handlers.set(channel, fn);
      }
    });

    const refreshResult = await handlers.get('app:refresh-window')({ sender });
    assert.equal(refreshResult.success, true, 'Expected refresh IPC to acknowledge success');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls.reloads, 1, 'Expected refresh IPC to reload the owner window once');

    const restartResult = await handlers.get('app:restart')({});
    assert.equal(restartResult.success, true, 'Expected restart IPC to acknowledge success');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls.relaunches, 1, 'Expected restart IPC to relaunch the app once');
    assert.equal(calls.quits, 1, 'Expected restart IPC to quit the app once');

    const openResult = await handlers.get('shell:open-external')({}, 'https://example.com/docs');
    assert.equal(openResult.success, true, 'Expected allowed external URL to open');
    assert.deepEqual(calls.opened, ['https://example.com/docs'], 'Expected shell openExternal to receive normalized URL');

    const deniedResult = await handlers.get('shell:open-external')({}, 'file:///tmp/secret.txt');
    assert.equal(deniedResult.success, false, 'Expected disallowed external URL protocol to be denied');
  }
};
