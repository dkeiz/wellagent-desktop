const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEscapingDocument() {
  return {
    createElement() {
      return {
        innerHTML: '',
        set textContent(value) {
          this.innerHTML = String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }
      };
    }
  };
}

function loadMessageFormatter(rootDir) {
  const source = fs.readFileSync(
    path.join(rootDir, 'src', 'renderer', 'components', 'message-formatter.js'),
    'utf8'
  );
  const context = {
    window: {},
    document: makeEscapingDocument(),
    URL,
    console
  };
  vm.runInNewContext(source, context, { filename: 'message-formatter.js' });
  return context.window.MessageFormatter;
}

module.exports = {
  name: 'message-formatter-viewer-link-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const MessageFormatter = loadMessageFormatter(rootDir);
    const formatter = new MessageFormatter();
    const html = formatter.renderMarkdown(
      '[Web](https://example.com/report) [File](file:///C:/tmp/report.md) [Mail](mailto:test@example.com)',
      { allowImages: true }
    );

    assert.includes(html, 'data-url="https://example.com/report"', 'Expected web links to get viewer buttons');
    assert.includes(html, 'data-url="file:///C:/tmp/report.md"', 'Expected file links to get viewer buttons');
    assert.includes(html, 'href="mailto:test@example.com"', 'Expected mailto links to remain normal links');
    assert.equal(html.includes('data-url="mailto:test@example.com"'), false, 'Mailto links should not be intercepted by the viewer');
  }
};
