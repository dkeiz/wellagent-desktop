async function getCompanionUiState(db) {
  const theme = String(await db.getSetting('ui.theme') || 'light').trim() || 'light';
  const skinEnabled = await db.getSetting('ui.skin.enabled') === 'true';
  const skinId = String(await db.getSetting('ui.skin.id') || 'default').trim() || 'default';
  const skinTheme = String(await db.getSetting('ui.skin.theme') || theme).trim() || theme;
  const typeSize = Math.min(18, Math.max(11, Number.parseInt(await db.getSetting('ui.typeSize') || '13', 10) || 13));

  return {
    theme,
    typeSize,
    skin: {
      enabled: skinEnabled,
      id: skinEnabled ? skinId : 'default',
      theme: skinEnabled ? skinTheme : theme,
      skinHref: skinEnabled && skinId !== 'default' ? `/companion/skin-cast/${encodeURIComponent(skinId)}/skin.css` : '',
      themeHref: skinEnabled && skinId !== 'default' ? `/companion/skin-cast/${encodeURIComponent(skinId)}/themes/${encodeURIComponent(skinTheme)}.css` : ''
    }
  };
}

module.exports = {
  getCompanionUiState
};
