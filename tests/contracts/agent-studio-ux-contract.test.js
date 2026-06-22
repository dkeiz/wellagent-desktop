const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'agent-studio-ux-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const comfySource = fs.readFileSync(path.join(rootDir, 'agentin/plugins/agent-comfy-studio/main.js'), 'utf8');
    assert.includes(comfySource, 'data-agent-ui-action="quick-generate"', 'ComfyUI Studio should expose a quick-generate form');
    assert.includes(comfySource, 'data-agent-ui-action="load-models"', 'ComfyUI Studio should expose model discovery');
    assert.includes(comfySource, 'copyOutputsToAgentGallery', 'ComfyUI Studio should copy generated images into the agent gallery');
    assert.includes(comfySource, 'comfy-gallery', 'ComfyUI Studio should render recent image thumbnails');
    assert.includes(comfySource, 'Discover models">Models</button>', 'ComfyUI Studio should use clear model discovery copy');
    assert.ok(!comfySource.includes('No recent images yet.'), 'ComfyUI Studio should not render an empty gallery placeholder');
    assert.ok(!comfySource.includes('class="comfy-grid"'), 'ComfyUI Studio should avoid the old tall grid wrapper');

    const bookSource = fs.readFileSync(path.join(rootDir, 'agentin/plugins/agent-book-writer/main.js'), 'utf8');
    assert.includes(bookSource, 'book-writer-state.json', 'Book Writer should persist the active project');
    assert.includes(bookSource, 'data-agent-ui-action="create-project"', 'Book Writer should expose project creation in the panel');
    assert.includes(bookSource, 'data-agent-ui-action="generate-next"', 'Book Writer should expose next-chapter scaffolding in the panel');
    assert.includes(bookSource, 'class="bw-compact"', 'Book Writer should render as a compact control band');
    assert.includes(bookSource, 'No outline yet. Send premise, genre, characters, and target length.', 'Book Writer should use a concise empty-state instruction');
    assert.ok(!bookSource.includes('Chapter Outline</div>'), 'Book Writer should avoid the old oversized outline card');
    assert.ok(!bookSource.includes('Scaffold Next Chapter'), 'Book Writer should use compact action labels');
    assert.includes(bookSource, 'scaffold generated', 'Book Writer should create a draft scaffold file');

    const avatarSource = fs.readFileSync(path.join(rootDir, 'agentin/plugins/pixel-avatar/main.js'), 'utf8');
    assert.includes(avatarSource, "fs.readFileSync(path.join(pluginDir, 'avatar.js')", 'Pixel Avatar should use the restored avatar renderer');
    assert.includes(avatarSource, "fs.readFileSync(path.join(pluginDir, 'avatar-cat.js')", 'Pixel Avatar should load split procedural character renderers');
    assert.includes(avatarSource, 'readSpriteSources(pluginDir, imageCharacter)', 'Pixel Avatar should load sprite assets for the active character');
    assert.includes(avatarSource, 'avatar.loadCustomSprites', 'Pixel Avatar should pass sprite assets into the avatar renderer');
    assert.includes(avatarSource, 'sidebar-widget-unmount', 'Pixel Avatar should clean up on widget unmount');
    assert.includes(avatarSource, 'avatarPreset', 'Pixel Avatar should persist character choice via preset config');
    assert.includes(avatarSource, 'data-config-key', 'Pixel Avatar setup should use button groups for preset choices');
    assert.includes(avatarSource, "context.registerSidebarWidget({", 'Pixel Avatar config changes should refresh the sidebar widget');
    assert.includes(avatarSource, 'chrome: false', 'Pixel Avatar sidebar widget should hide generic widget chrome');
    assert.ok(!avatarSource.includes('pxav-info-bar'), 'Pixel Avatar should not render emotion/mode labels below the canvas');
    assert.ok(!avatarSource.includes('pxav-mode'), 'Pixel Avatar should not render generated/pixel mode labels');

    const pluginStudioSource = fs.readFileSync(path.join(rootDir, 'src/renderer/components/plugin-studio-panel.js'), 'utf8');
    assert.includes(pluginStudioSource, 'handlePluginOwnedChoice', 'Plugin Studio should autosave plugin-owned choice buttons');
    assert.includes(pluginStudioSource, 'window.electronAPI.plugins.setConfig(plugin.id, key, value)', 'Plugin-owned choice buttons should persist immediately');
    assert.includes(pluginStudioSource, "this.setResult('');", 'Plugin-owned choice autosave should not show a JSON success block');

    const sidebarWidgetSource = fs.readFileSync(path.join(rootDir, 'src/renderer/components/plugin-sidebar-widget.js'), 'utf8');
    assert.includes(sidebarWidgetSource, '_widgetChanged', 'Sidebar widgets should remount when plugin config changes their HTML');
    assert.includes(sidebarWidgetSource, 'widget.chrome !== false', 'Sidebar widgets should support hiding generic chrome');

    const tabsSource = fs.readFileSync(path.join(rootDir, 'src/renderer/components/main-panel-tabs.js'), 'utf8');
    assert.includes(tabsSource, 'new FormData(form)', 'Agent ChatUI actions should submit form field values');
    assert.includes(tabsSource, 'result.openSidebarTab', 'Agent ChatUI actions should be able to open workspace tabs');
    assert.includes(tabsSource, 'result.openPluginStudio', 'Agent ChatUI actions should be able to focus Plugin Studio');

    for (const relativePath of [
      'agentin/plugins/agent-comfy-studio/main.js',
      'agentin/plugins/agent-book-writer/main.js',
      'agentin/plugins/agent-setup-superagent/main.js',
      'agentin/plugins/pixel-avatar/main.js',
      'agentin/plugins/pixel-avatar/avatar.js',
      'agentin/plugins/pixel-avatar/avatar-cat.js',
      'agentin/plugins/pixel-avatar/avatar-common.js',
      'agentin/plugins/pixel-avatar/avatar-robot.js',
      'agentin/plugins/pixel-avatar/avatar-girl.js',
      'src/renderer/components/main-panel-tabs.js',
      'src/renderer/components/plugin-studio-panel.js',
      'src/renderer/components/plugin-sidebar-widget.js'
    ]) {
      const lineCount = fs.readFileSync(path.join(rootDir, relativePath), 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${relativePath} to stay under 1000 lines`);
    }
  }
};
