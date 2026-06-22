const fs = require('fs');
const path = require('path');

const DEFAULT_THEME_TOKENS = [
  '--main-bg',
  '--sidebar-bg',
  '--chat-bg',
  '--card-bg',
  '--bg-secondary',
  '--bg-tertiary',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-color',
  '--border-color',
  '--hover-bg',
  '--active-bg',
  '--primary-color',
  '--user-msg-bg',
  '--user-msg-text',
  '--input-bg'
];

const DEFAULT_UI_TOKENS = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--control-h-sm',
  '--control-h-md',
  '--control-h-lg',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--text-xs',
  '--text-sm',
  '--text-md',
  '--text-lg'
];

const DEFAULT_ALIAS_TOKENS = [
  '--accent-color',
  '--accent-hover',
  '--accent-rgb',
  '--bg-primary',
  '--background-color',
  '--background-color-light',
  '--text-tertiary'
];

function runCheckSkins(options = {}) {
  const logger = options.logger || console;
  const root = options.rootDir || process.cwd();
  const rendererRoot = path.join(root, 'src', 'renderer');
  const manifestPath = path.join(rendererRoot, 'skins', 'manifest.json');
  const contractPath = path.join(rendererRoot, 'skins', 'contract.json');
  const themePath = path.join(rendererRoot, 'styles', 'theme.css');
  const indexPath = path.join(rendererRoot, 'index.html');
  const errors = [];

  function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function fail(message) {
    logger.error(`[check-skins] ERROR: ${message}`);
    errors.push(message);
  }

  function ok(message) {
    logger.log(`[check-skins] ${message}`);
  }

  function ensureFile(filePath, message) {
    if (!fs.existsSync(filePath)) {
      fail(`${message}: missing ${filePath}`);
      return false;
    }
    return true;
  }

  function ensureContains(filePath, pattern, message) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!pattern.test(content)) {
      fail(`${message}: expected pattern ${pattern} in ${filePath}`);
      return false;
    }
    return true;
  }

  function ensureAnyPattern(filePath, patterns, message) {
    const content = fs.readFileSync(filePath, 'utf8');
    const matched = patterns.some((pattern) => pattern.test(content));
    if (!matched) {
      fail(`${message}: none of ${patterns.map((pattern) => pattern.toString()).join(', ')} matched in ${filePath}`);
      return false;
    }
    return true;
  }

  function ensureTokenDeclarations(filePath, tokens, message) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const token of tokens) {
      const escapedToken = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const pattern = new RegExp(`${escapedToken}\\s*:`);
      if (!pattern.test(content)) {
        fail(`${message}: missing token ${token} in ${filePath}`);
      }
    }
  }

  if (!ensureFile(manifestPath, 'Manifest')) return { ok: false, errors };
  if (!ensureFile(contractPath, 'Contract')) return { ok: false, errors };
  if (!ensureFile(themePath, 'Theme stylesheet')) return { ok: false, errors };
  if (!ensureFile(indexPath, 'Renderer index')) return { ok: false, errors };

  const manifest = readJson(manifestPath);
  const contract = readJson(contractPath);
  const requiredThemeTokens = Array.isArray(contract.requiredThemeTokens) && contract.requiredThemeTokens.length
    ? contract.requiredThemeTokens
    : DEFAULT_THEME_TOKENS;
  const requiredUiTokens = Array.isArray(contract.requiredUiTokens) && contract.requiredUiTokens.length
    ? contract.requiredUiTokens
    : DEFAULT_UI_TOKENS;
  const requiredAliasTokens = Array.isArray(contract.requiredAliasTokens) && contract.requiredAliasTokens.length
    ? contract.requiredAliasTokens
    : DEFAULT_ALIAS_TOKENS;
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const skins = manifest.skins || [];

  if (!skins.length) fail('No skins declared in manifest.');
  if (!manifest.defaultSkinId) fail('defaultSkinId is not set.');

  ensureTokenDeclarations(themePath, requiredThemeTokens, 'Theme stylesheet missing required theme tokens');
  ensureTokenDeclarations(themePath, requiredUiTokens, 'Theme stylesheet missing required UI tokens');
  ensureTokenDeclarations(themePath, requiredAliasTokens, 'Theme stylesheet missing required alias tokens');

  const ids = new Set();
  let compatibleSkins = 0;

  for (const skin of skins) {
    if (!skin.id) {
      fail('Skin without id found.');
      continue;
    }
    if (ids.has(skin.id)) fail(`Duplicate skin id: ${skin.id}`);
    ids.add(skin.id);

    const themes = skin.supportedThemes || [];
    if (!themes.length) fail(`Skin "${skin.id}" has no supportedThemes.`);
    const skinBase = path.join(rendererRoot, 'skins', skin.id, 'skin.css');
    if (!ensureFile(skinBase, `Skin "${skin.id}" base stylesheet`)) continue;

    const baseSelectors = skin.id === manifest.defaultSkinId
      ? [/^:root\b/m, new RegExp(`html\\[data-active-skin="${skin.id}"\\]`)]
      : [new RegExp(`html\\[data-active-skin="${skin.id}"\\]`)];
    ensureAnyPattern(
      skinBase,
      baseSelectors,
      `Skin "${skin.id}" base selector`
    );

    ensureContains(
      skinBase,
      /--skin-contract-id\s*:/,
      `Skin "${skin.id}" contract token declaration`
    );

    if (skin.compatible) {
      compatibleSkins += 1;
      for (const theme of themes) {
        const themePath = path.join(rendererRoot, 'skins', skin.id, 'themes', `${theme}.css`);
        if (ensureFile(themePath, `Skin "${skin.id}" theme "${theme}"`)) {
          const selectorPatterns = skin.id === manifest.defaultSkinId
            ? [
              new RegExp(`:root\\[data-theme="${theme}"\\]`),
              new RegExp(`html\\[data-active-skin="${skin.id}"\\]\\[data-theme="${theme}"\\]`)
            ]
            : [new RegExp(`html\\[data-active-skin="${skin.id}"\\]\\[data-theme="${theme}"\\]`)];
          ensureAnyPattern(
            themePath,
            selectorPatterns,
            `Skin "${skin.id}" theme "${theme}" selector`
          );
          ensureContains(
            themePath,
            /--skin-theme-id\s*:/,
            `Skin "${skin.id}" theme "${theme}" token declaration`
          );
          if (skin.id !== manifest.defaultSkinId) {
            ensureTokenDeclarations(
              themePath,
              requiredThemeTokens,
              `Skin "${skin.id}" theme "${theme}" required token declarations`
            );
          }
        }
      }
    }
  }

  if (!ids.has(manifest.defaultSkinId)) {
    fail(`defaultSkinId "${manifest.defaultSkinId}" is not present in skins[]`);
  }

  const requiredIds = contract.requiredIds || [];
  for (const id of requiredIds) {
    if (!indexHtml.includes(`id="${id}"`)) {
      fail(`Contract id "${id}" is missing from index.html`);
    }
  }

  if (!errors.length) {
    ok(`Validated ${skins.length} skins (${compatibleSkins} compatible) and ${requiredIds.length} contract IDs.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      skins: skins.length,
      compatibleSkins,
      requiredThemeTokens: requiredThemeTokens.length,
      requiredUiTokens: requiredUiTokens.length,
      requiredAliasTokens: requiredAliasTokens.length,
      requiredDomIds: requiredIds.length
    }
  };
}

if (require.main === module) {
  const result = runCheckSkins();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

module.exports = { runCheckSkins };
