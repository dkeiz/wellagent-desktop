const fs = require('fs');
const path = require('path');
const budgets = require('../fixtures/line-budgets.json');

function collectFiles(rootDir) {
  const pending = (budgets.roots || ['src', 'tools', 'tests'])
    .map(root => path.join(rootDir, root));
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        pending.push(path.join(current, entry));
      }
      continue;
    }

    const relativePath = path.relative(rootDir, current).replace(/\\/g, '/');
    if (isExcluded(relativePath)) continue;
    if (!/\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx)$/.test(current)) continue;
    files.push(current);
  }

  return files;
}

function isExcluded(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return (budgets.exclude || []).some(pattern => {
    const value = String(pattern || '').replace(/\\/g, '/');
    if (value.includes('**')) {
      let offset = 0;
      for (const part of value.split('**')) {
        if (!part) continue;
        const index = normalized.indexOf(part, offset);
        if (index < 0) return false;
        offset = index + part.length;
      }
      return true;
    }
    return normalized === value;
  });
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content === '' ? 0 : content.split(/\r?\n/).length;
}

module.exports = {
  name: 'line-budget-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const violations = [];
    const warnings = [];
    const files = collectFiles(rootDir);
    const softMaxLines = Number(budgets.softMaxLines || 0);

    for (const filePath of files) {
      const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const lineCount = countLines(filePath);
      const fileBudget = budgets.allowlist[relativePath];

      if (fileBudget !== undefined) {
        if (lineCount > fileBudget) {
          violations.push(`${relativePath}: ${lineCount} lines exceeds allowlisted budget ${fileBudget}`);
        } else if (softMaxLines > 0 && lineCount > softMaxLines && lineCount > Math.floor(fileBudget * 0.85)) {
          warnings.push(`${relativePath}: ${lineCount} lines is near allowlisted budget ${fileBudget}`);
        }
        continue;
      }

      if (lineCount > budgets.defaultMaxLines) {
        violations.push(`${relativePath}: ${lineCount} lines exceeds default max ${budgets.defaultMaxLines}`);
      } else if (softMaxLines > 0 && lineCount > softMaxLines) {
        warnings.push(`${relativePath}: ${lineCount} lines exceeds soft warning threshold ${softMaxLines}`);
      }
    }

    if (warnings.length > 0) {
      console.warn(`Line budget warnings:\n${warnings.join('\n')}`);
    }

    assert.equal(
      violations.length,
      0,
      `Line budget violations detected:\n${violations.join('\n')}`
    );
  }
};
