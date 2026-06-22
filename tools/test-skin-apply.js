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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function hasPattern(text, regex) {
  return regex.test(text);
}

function runApplySimulation(rootDir = process.cwd(), logger = console) {
  const rendererRoot = path.join(rootDir, 'src', 'renderer');
  const manifestPath = path.join(rendererRoot, 'skins', 'manifest.json');
  const contractPath = path.join(rendererRoot, 'skins', 'contract.json');
  if (!fileExists(manifestPath)) {
    logger.error(`[apply-sim] Missing manifest: ${manifestPath}`);
    return { ok: false, errors: ['missing-manifest'], cases: [] };
  }
  if (!fileExists(contractPath)) {
    logger.error(`[apply-sim] Missing contract: ${contractPath}`);
    return { ok: false, errors: ['missing-contract'], cases: [] };
  }

  const manifest = JSON.parse(read(manifestPath));
  const contract = JSON.parse(read(contractPath));
  const requiredThemeTokens = Array.isArray(contract.requiredThemeTokens) && contract.requiredThemeTokens.length
    ? contract.requiredThemeTokens
    : DEFAULT_THEME_TOKENS;
  const skins = (manifest.skins || []).filter((skin) => skin.compatible && skin.id !== 'default');
  const cases = [];
  const errors = [];

  for (const skin of skins) {
    const basePath = path.join(rendererRoot, 'skins', skin.id, 'skin.css');
    const baseExists = fileExists(basePath);
    const baseText = baseExists ? read(basePath) : '';
    const baseSelectorOk = hasPattern(baseText, new RegExp(`html\\[data-active-skin="${skin.id}"\\]`));
    const contractTokenOk = hasPattern(baseText, /--skin-contract-id\s*:\s*[^;]+;/);

    for (const theme of (skin.supportedThemes || [])) {
      const themePath = path.join(rendererRoot, 'skins', skin.id, 'themes', `${theme}.css`);
      const themeExists = fileExists(themePath);
      const themeText = themeExists ? read(themePath) : '';
      const themeSelectorOk = hasPattern(
        themeText,
        new RegExp(`html\\[data-active-skin="${skin.id}"\\]\\[data-theme="${theme}"\\]`)
      );
      const themeTokenOk = hasPattern(themeText, /--skin-theme-id\s*:\s*[^;]+;/);
      const requiredThemeTokensOk = requiredThemeTokens.every((token) => {
        const escapedToken = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        return hasPattern(themeText, new RegExp(`${escapedToken}\\s*:\\s*[^;]+;`));
      });

      const ok = baseExists && baseSelectorOk && contractTokenOk && themeExists && themeSelectorOk && themeTokenOk && requiredThemeTokensOk;
      const item = {
        skin: skin.id,
        theme,
        ok,
        checks: {
          baseExists,
          baseSelectorOk,
          contractTokenOk,
          themeExists,
          themeSelectorOk,
          themeTokenOk,
          requiredThemeTokensOk
        }
      };
      cases.push(item);
      if (!ok) {
        errors.push(`${skin.id}:${theme}`);
        logger.error(`[apply-sim] FAIL ${skin.id}/${theme} ${JSON.stringify(item.checks)}`);
      } else {
        logger.log(`[apply-sim] PASS ${skin.id}/${theme}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      compatibleSkins: skins.length,
      testedCases: cases.length,
      failedCases: errors.length
    },
    cases
  };
}

if (require.main === module) {
  const result = runApplySimulation();
  console.log('[apply-sim] Summary:');
  console.log(JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    failed: result.errors
  }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { runApplySimulation };
