const { registerMediaTools } = require('../../src/main/mcp/register-media-tools');

function createServer() {
  const tools = new Map();
  const checked = [];
  return {
    tools,
    checked,
    registerTool(name, definition, handler) {
      tools.set(name, { definition, handler });
    },
    getCurrentSessionId() {
      return 'media-session';
    },
    async assertExecutionPathAllowed(filePath, options) {
      checked.push({ filePath, options });
    }
  };
}

module.exports = {
  name: 'media-tool-execution-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const server = createServer();
    registerMediaTools(server);

    const source = require('fs').readFileSync(require('path').join(process.cwd(), 'src', 'main', 'mcp', 'register-media-tools.js'), 'utf8');
    assert.includes(source, 'async function assertMediaPathAllowed', 'Expected media tools to use a shared path-policy helper');
    assert.includes(source, 'server.assertExecutionPathAllowed?.(filePath', 'Expected media read/open paths to go through execution path policy');
    assert.includes(source, 'await assertMediaPathAllowed(server, savePath);', 'Expected screenshot save path to go through execution path policy');
    assert.ok(server.tools.has('get_image_info'), 'Expected media tools to register normally');
    assert.ok(server.tools.has('screenshot'), 'Expected screenshot tool to register normally');
  }
};
