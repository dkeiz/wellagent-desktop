const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList() {
  const classes = new Set();
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createConnector(nodeId, type) {
  const listeners = new Map();
  return {
    dataset: { node: nodeId, type },
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    fire(eventName) {
      const handler = listeners.get(eventName);
      if (handler) {
        handler({
          preventDefault() {},
          stopPropagation() {},
          target: this
        });
      }
    },
    closest(selector) {
      return selector === '.node-connector.input' && type === 'input' ? this : null;
    }
  };
}

function createWorkflowEditorTestContext(source) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener() {},
    elementFromPoint() {
      return null;
    }
  };
  const window = {
    electronAPI: {
      on() {}
    },
    getSelection() {
      return { removeAllRanges() {} };
    }
  };
  const context = {
    console,
    document,
    window,
    setTimeout,
    clearTimeout
  };
  context.window = window;
  vm.runInNewContext(source, context, { filename: 'workflow-editor.js' });
  return { context, elements, document };
}

module.exports = {
  name: 'workflow-editor-interaction-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const filePath = path.join(rootDir, 'src', 'renderer', 'components', 'workflow-editor.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const { context, elements, document } = createWorkflowEditorTestContext(source);
    const WorkflowEditor = context.window.WorkflowEditor;
    const editor = new WorkflowEditor();

    editor.canvas = {
      getBoundingClientRect() {
        return { left: 0, top: 0 };
      }
    };
    editor.canvasContainer = { classList: createClassList() };
    editor.connectionsLayer = { innerHTML: '' };
    editor.zoom = 1;

    const fromNode = { id: 'node-from', type: 'tool', x: 100, y: 120 };
    const toNode = { id: 'node-to', type: 'tool', x: 360, y: 120 };
    const toNode2 = { id: 'node-to-2', type: 'tool', x: 560, y: 140 };
    editor.nodes.set(fromNode.id, fromNode);
    editor.nodes.set(toNode.id, toNode);
    editor.nodes.set(toNode2.id, toNode2);
    elements.set(fromNode.id, { offsetWidth: 200, offsetHeight: 80, style: {} });
    elements.set(toNode.id, { offsetWidth: 200, offsetHeight: 80, style: {} });
    elements.set(toNode2.id, { offsetWidth: 200, offsetHeight: 80, style: {} });

    const inputTo = createConnector(toNode.id, 'input');
    const inputTo2 = createConnector(toNode2.id, 'input');
    const outputFrom = createConnector(fromNode.id, 'output');
    editor.bindNodeConnectors({
      querySelectorAll() {
        return [inputTo, inputTo2, outputFrom];
      }
    });

    outputFrom.fire('mousedown');
    assert.equal(editor.connectingFrom, fromNode.id, 'Expected mousedown on output connector to enter connecting mode');
    assert.ok(editor.canvasContainer.classList.contains('workflow-interacting'), 'Expected connecting mode to enable interaction lock');
    assert.includes(editor.connectionsLayer.innerHTML, 'connection-line-preview', 'Expected connecting mode to render preview line');

    editor.onCanvasMouseUp({
      clientX: 120,
      clientY: 120,
      target: { closest: () => null }
    });
    assert.equal(editor.connectingFrom, fromNode.id, 'Expected click-to-click mode to keep source selected when mouseup is not on input');

    inputTo.fire('mousedown');
    assert.equal(editor.connectingFrom, null, 'Expected input connector click to finalize connection');
    assert.deepEqual(editor.connections, [{ from: fromNode.id, to: toNode.id }], 'Expected one completed connection');

    outputFrom.fire('mousedown');
    editor.onCanvasMouseMove({
      clientX: 440,
      clientY: 210,
      preventDefault() {}
    });
    assert.equal(editor.connectMoved, true, 'Expected connection drag movement to be tracked');
    editor.onCanvasMouseUp({
      clientX: 440,
      clientY: 210,
      target: { closest: () => null }
    });
    assert.equal(editor.connectingFrom, null, 'Expected drag release outside input to cancel pending connection');

    outputFrom.fire('mousedown');
    editor.onCanvasMouseMove({
      clientX: 580,
      clientY: 200,
      preventDefault() {}
    });
    document.elementFromPoint = () => inputTo2;
    editor.onCanvasMouseUp({
      clientX: 580,
      clientY: 200,
      target: { closest: () => null }
    });
    assert.deepEqual(
      editor.connections,
      [{ from: fromNode.id, to: toNode.id }, { from: fromNode.id, to: toNode2.id }],
      'Expected mouseup hit-test to complete connection on hovered input connector'
    );

    editor.zoom = 2;
    editor.startDragging(fromNode.id, { clientX: 100, clientY: 100 });
    editor.onCanvasMouseMove({
      clientX: 140,
      clientY: 160,
      preventDefault() {}
    });
    assert.equal(fromNode.x, 120, 'Expected drag movement on X to be zoom-adjusted');
    assert.equal(fromNode.y, 150, 'Expected drag movement on Y to be zoom-adjusted');
    editor.onCanvasMouseUp({
      clientX: 140,
      clientY: 160,
      target: { closest: () => null }
    });
    assert.ok(!editor.canvasContainer.classList.contains('workflow-interacting'), 'Expected interaction lock to clear after drag end');
  }
};
