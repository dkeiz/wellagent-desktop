const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'workspace-indicator-todo-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const script = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'workspace-indicator.js'), 'utf8');
    const css = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'workspace-indicator.css'), 'utf8');

    assert.includes(script, 'window.electronAPI.getTodos(sessionId)', 'Expected todo badge to request active-session todos');
    assert.includes(script, 'this.setTodoExpanded(!this.todoExpanded)', 'Expected todo button to toggle its own dropdown');
    assert.ok(!script.includes('<span class="todo-floating-progress">0/0</span>'), 'Expected todo badge to avoid leaking a 0/0 placeholder before active todos load');
    assert.includes(script, "this.elements.todoProgress.textContent = shouldShow ? `${done}/${total}` : '';", 'Expected todo badge counter to render only when active todos exist');
    assert.includes(script, "todoFlag.setAttribute('aria-hidden', 'true');", 'Expected todo badge to start hidden until active todos exist');
    assert.includes(script, "this.elements.todoFlag.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');", 'Expected todo badge accessibility state to match active todo visibility');
    assert.includes(css, 'flex-direction: column;', 'Expected floating controls to stack vertically');
    assert.includes(css, 'height: 26px;', 'Expected compact floating button height');
    assert.includes(css, '.todo-floating-flag[hidden] {', 'Expected todo badge hidden state to override display styling');
    assert.includes(css, 'display: none !important;', 'Expected hidden todo badge to be impossible to paint');
  }
};
