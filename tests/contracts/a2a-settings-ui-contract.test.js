const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'a2a-settings-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const indexPath = path.join(rootDir, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const primarySettingsStart = html.indexOf('<div class="settings-group">');
    const privacySectionStart = html.indexOf('<div class="settings-group privacy-section">');

    assert.ok(primarySettingsStart !== -1, 'Expected primary settings group in index.html');
    assert.ok(privacySectionStart > primarySettingsStart, 'Expected privacy section after primary settings group');
    const privacySectionEnd = html.indexOf('<div class="settings-group skin-settings-section">');

    const primarySettingsMarkup = html.slice(primarySettingsStart, privacySectionStart);
    assert.includes(
      primarySettingsMarkup,
      'id="a2a-expose-enabled"',
      'Expected A2A toggle to live in the primary application settings group'
    );
    assert.includes(
      primarySettingsMarkup,
      'id="a2a-status-text"',
      'Expected A2A status text to stay with the primary application settings controls'
    );
    assert.ok(
      primarySettingsMarkup.indexOf('id="show-tool-calls"') < primarySettingsMarkup.indexOf('id="a2a-expose-enabled"'),
      'Expected A2A to appear after the existing three checkboxes'
    );
    assert.ok(
      primarySettingsMarkup.indexOf('id="a2a-expose-enabled"') < primarySettingsMarkup.indexOf('id="type-size-slider"'),
      'Expected A2A to remain before the type size control'
    );
    assert.equal(
      html.includes('<h3>A2A Exposure</h3>'),
      false,
      'Expected A2A exposure to avoid a standalone settings card'
    );
    assert.ok(privacySectionEnd > privacySectionStart, 'Expected visual skins section after privacy section');
    const privacyMarkup = html.slice(privacySectionStart, privacySectionEnd);
    assert.includes(privacyMarkup, '<div class="privacy-row">', 'Expected privacy controls to render in a single row wrapper');
    assert.ok(
      privacyMarkup.indexOf('<h3>') < privacyMarkup.indexOf('id="private-close-no-confirm"')
        && privacyMarkup.indexOf('id="private-close-no-confirm"') < privacyMarkup.indexOf('id="delete-all-conversations-btn"'),
      'Expected privacy heading, checkbox, and delete button to stay in one row order'
    );

    const appPath = path.join(rootDir, 'src', 'renderer', 'app.js');
    const appSource = fs.readFileSync(appPath, 'utf8');
    assert.includes(
      appSource,
      "Listening at ${status.cardUrl || 'localhost'}",
      'Expected A2A status copy to render only the listener URL'
    );
    assert.equal(
      appSource.includes('A2A exposure is enabled. Listening at'),
      false,
      'Expected A2A status copy to omit the old prefixed sentence'
    );
  }
};
