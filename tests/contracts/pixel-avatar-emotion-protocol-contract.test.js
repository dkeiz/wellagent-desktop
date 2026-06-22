const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'pixel-avatar-emotion-protocol-contract',
  tags: ['contract', 'fast', 'plugin'],
  async run({ assert, rootDir }) {
    const protocolPath = path.join(rootDir, 'agentin', 'plugins', 'pixel-avatar', 'emotionProtocol.js');
    const pluginPath = path.join(rootDir, 'agentin', 'plugins', 'pixel-avatar', 'main.js');
    const skillPath = path.join(rootDir, 'agentin', 'skills', 'avatar.md');
    const protocol = require(protocolPath);
    const plugin = require(pluginPath);

    assert.deepEqual(protocol.getAvailableEmotions(), [
      'neutral',
      'happy',
      'sad',
      'surprised',
      'thinking',
      'angry',
      'excited',
      'sleepy',
      'staring'
    ], 'Expected stable canonical emotion list');

    const directive = protocol.resolveEmotion('<!-- emotion: thinking -->\nChecking the file now.');
    assert.equal(directive.emotion, 'thinking', 'Expected explicit emotion marker to win');
    assert.equal(directive.source, 'directive', 'Expected directive source');

    const equalsDirective = protocol.extractEmotionDirective('<!-- emotion=happy --> done');
    assert.equal(equalsDirective.emotion, 'happy', 'Expected equals directive form');

    const latestDirective = protocol.extractEmotionDirective('<!-- emotion: sad -->x<!-- emotion: excited -->y');
    assert.equal(latestDirective.emotion, 'excited', 'Expected latest directive to win');

    const stripped = protocol.stripEmotionDirectives('<!-- emotion: angry -->\nDo not speak the marker.');
    assert.equal(stripped, 'Do not speak the marker.', 'Expected stripped display text');

    const auto = protocol.resolveEmotion('Let me check this and analyze the likely cause.', {
      emotionMode: 'hybrid',
      autoEmotionThreshold: '2'
    });
    assert.equal(auto.emotion, 'thinking', 'Expected weighted fallback to detect thinking');
    assert.equal(auto.source, 'auto', 'Expected auto source');

    const weak = protocol.resolveEmotion('Plain factual sentence.', {
      emotionMode: 'hybrid',
      fallbackEmotion: 'neutral',
      autoEmotionThreshold: '3'
    });
    assert.equal(weak.emotion, 'neutral', 'Expected weak text to fall back to neutral');

    assert.equal(fs.existsSync(skillPath), false, 'Expected avatar skill file to be opt-in and absent by default');

    const skill = protocol.generateAvatarSkill({
      emotions: protocol.getAvailableEmotions(),
      emotionMode: 'hybrid',
      fallbackEmotion: 'neutral',
      autoEmotionThreshold: '2'
    });
    assert.includes(skill, '# Avatar Emotion Protocol', 'Expected skill title');
    assert.includes(skill, '<!-- emotion: thinking -->', 'Expected marker example');
    for (const emotion of protocol.getAvailableEmotions()) {
      assert.includes(skill, `- ${emotion}`, `Expected skill to list ${emotion}`);
    }

    const tempRoot = fs.mkdtempSync(path.join(rootDir, 'agentin', 'pixel-avatar-skill-'));
    const pluginDir = path.join(tempRoot, 'agentin', 'plugins', 'pixel-avatar');
    fs.mkdirSync(pluginDir, { recursive: true });
    try {
      const disabled = plugin._private.syncAvatarSkill(pluginDir, { exposeExternalSkill: 'false' });
      const tempSkillPath = path.join(tempRoot, 'agentin', 'skills', 'avatar.md');
      assert.equal(disabled.exposed, false, 'Expected external skill exposure to default off');
      assert.equal(fs.existsSync(tempSkillPath), false, 'Expected disabled sync not to create avatar.md');

      const enabled = plugin._private.syncAvatarSkill(pluginDir, { exposeExternalSkill: 'true' });
      assert.equal(enabled.exposed, true, 'Expected explicit config to expose external skill');
      assert.equal(fs.existsSync(tempSkillPath), true, 'Expected enabled sync to create avatar.md');
      assert.includes(fs.readFileSync(tempSkillPath, 'utf-8'), '# Avatar Emotion Protocol', 'Expected generated skill content');

      const removed = plugin._private.syncAvatarSkill(pluginDir, { exposeExternalSkill: 'false' });
      assert.equal(removed.exposed, false, 'Expected disabled sync after enable to report hidden');
      assert.equal(fs.existsSync(tempSkillPath), false, 'Expected disabled sync to remove generated avatar.md');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
};
