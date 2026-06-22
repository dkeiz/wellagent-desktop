const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadElectronApi(rootDir) {
  const electronApiPath = path.join(rootDir, 'src', 'renderer', 'electron-api.js');
  const code = fs.readFileSync(electronApiPath, 'utf8');

  const ipcRenderer = {
    invoke: async () => ({}),
    on: () => ({}),
    send: () => ({}),
    removeListener: () => ({})
  };

  const sandbox = {
    require: (request) => {
      if (request === 'electron') {
        return {
          contextBridge: {
            exposeInMainWorld(name, api) {
              sandbox.window[name] = api;
            }
          },
          ipcRenderer
        };
      }
      throw new Error(`Unsupported require in renderer sandbox: ${request}`);
    },
    window: {},
    console
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'electron-api.js' });

  return sandbox.window.electronBridge || sandbox.window.electronAPI;
}

function flattenElectronApi(api) {
  const keys = new Set();
  for (const [name, value] of Object.entries(api)) {
    keys.add(name);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const childName of Object.keys(value)) {
        keys.add(`${name}.${childName}`);
      }
    }
  }
  return keys;
}

function collectRendererApiReferences(rootDir) {
  const targets = [
    path.join(rootDir, 'src', 'renderer', 'app.js'),
    path.join(rootDir, 'src', 'renderer', 'components')
  ];

  const files = [];
  for (const target of targets) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const fileName of fs.readdirSync(target)) {
        if (fileName.endsWith('.js')) {
          files.push(path.join(target, fileName));
        }
      }
      continue;
    }
    files.push(target);
  }

  const references = [];
  const pattern = /window\.electronAPI(?:\?\.)?\.([A-Za-z_$][\w$]*)(?:(?:\?\.)?\.([A-Za-z_$][\w$]*))?/g;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const topLevel = match[1];
      const nested = match[2] || null;
      references.push({
        filePath,
        key: nested ? `${topLevel}.${nested}` : topLevel
      });
    }
  }

  return references;
}

function collectHtmlIds(html) {
  const ids = new Set();
  const pattern = /\sid="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

module.exports = {
  loadElectronApi,
  flattenElectronApi,
  collectRendererApiReferences,
  collectHtmlIds
};
