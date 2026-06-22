const fs = require('fs');
const path = require('path');

function collectImports(css) {
  const imports = [];
  const pattern = /@import\s+url\('([^']+)'\);/g;
  let match;

  while ((match = pattern.exec(css)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

function stripQuery(relativePath) {
  return String(relativePath).replace(/\?.*$/, '');
}

module.exports = {
  name: 'styles-layout-import-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const layoutPath = path.join(rootDir, 'src', 'renderer', 'styles', 'layout.css');
    const css = fs.readFileSync(layoutPath, 'utf8');
    const imports = collectImports(css).map(stripQuery);
    const expected = [
      './layout/layout-core.css',
      './layout/layout-widgets.css',
      './layout/layout-chat.css',
      './layout/layout-tools.css',
      './layout/layout-workflows.css',
      './layout/layout-sidebar.css',
      './layout/layout-desktop-split.css',
      './layout/layout-statusbar.css'
    ];

    assert.deepEqual(imports, expected, 'layout.css imports changed unexpectedly');

    for (const relativeImport of imports) {
      const importPath = path.resolve(path.dirname(layoutPath), relativeImport);
      assert.ok(fs.existsSync(importPath), `Missing imported stylesheet: ${relativeImport}`);
    }

    const coreCss = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'layout', 'layout-core.css'), 'utf8');
    assert.ok(!coreCss.includes('scroll-behavior: smooth'), 'Chat tab restores should not animate from top to bottom');
    assert.includes(coreCss, 'scroll-behavior: auto', 'Expected programmatic chat scroll jumps to be instant');

    const themeCss = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    assert.includes(themeCss, 'grid-template-rows: auto minmax(0, 1fr) auto auto;', 'Right panel grid should reserve a row for plugin widgets before the calendar');
    assert.includes(themeCss, '.widget-panel > .plugin-sidebar-widgets { grid-column: 1 / -1; grid-row: 3;', 'Plugin sidebar widgets should render above the calendar dock');
    assert.includes(themeCss, 'grid-row: 4;', 'Calendar dock should stay below plugin sidebar widgets');
  }
};
