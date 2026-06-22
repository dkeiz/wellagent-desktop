const fs = require('fs');
const path = require('path');
const { evaluateMathExpression } = require('../../src/main/mcp/register-prompt-tools');

function assertThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message || '').includes(expectedMessage)) {
      throw new Error(`Expected error to include "${expectedMessage}", received "${error.message}"`);
    }
    return;
  }
  throw new Error(`Expected function to throw "${expectedMessage}"`);
}

module.exports = {
  name: 'calculate-tool-safety-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const source = fs.readFileSync(path.join(rootDir, 'src', 'main', 'mcp', 'register-prompt-tools.js'), 'utf8');
    assert.ok(!source.includes('Function(\'"use strict"; return (\' + params.expression'), 'calculate must not evaluate user input with Function');

    assert.equal(evaluateMathExpression('(123 + 456) * 2'), 1158, 'Expected arithmetic expressions to work');
    assert.equal(evaluateMathExpression('Math.sqrt(16) + pow(2, 3)'), 12, 'Expected allowlisted Math functions to work');
    assert.equal(Math.round(evaluateMathExpression('sin(pi / 2)') * 1000), 1000, 'Expected Math constants to work');

    assertThrows(() => evaluateMathExpression('process.exit()'), 'Invalid math expression');
    assertThrows(() => evaluateMathExpression('constructor.constructor("return process")()'), 'Invalid math expression');
    assertThrows(() => evaluateMathExpression('1 / 0'), 'Math result is not finite');
  }
};
