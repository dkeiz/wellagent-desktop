const path = require('path');

module.exports = {
  name: 'tts-text-utils-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const utils = require(path.join(rootDir, 'src', 'renderer', 'components', 'tts-text-utils.js'));

    const answerOnly = utils.extractSpeakableText([
      '<think>I should inspect the data.</think>',
      'Here is the result:',
      'https://example.com/docs',
      '```js',
      'const secret = 1;',
      '```'
    ].join('\n'), 'answer');

    assert.equal(
      answerOnly,
      'Here is the result: link',
      `Expected answer mode to drop think blocks, links, and fenced code: ${answerOnly}`
    );

    const thinkingAndAnswer = utils.extractSpeakableText(
      '<think>Reasoning with [docs](https://example.com).</think>\nFinal answer with https://example.com/path',
      'thinking + answer'
    );
    assert.equal(
      thinkingAndAnswer,
      'Reasoning with link. Final answer with link',
      `Expected thinking + answer mode to keep both cleaned sections: ${thinkingAndAnswer}`
    );

    const emotionMarker = utils.extractSpeakableText(
      '<!-- emotion: thinking -->\nLet me check this carefully.',
      'answer'
    );
    assert.equal(
      emotionMarker,
      'Let me check this carefully.',
      `Expected TTS speech text to strip hidden emotion markers: ${emotionMarker}`
    );

    const noisy = utils.normalizeSpeakText([
      '###########',
      '-----=====-----',
      'Useful line',
      '{"tool":"value"}'
    ].join('\n'));
    assert.equal(noisy, 'Useful line', `Expected symbol-heavy lines to be skipped: ${noisy}`);
  }
};
