const path = require('path');

const packageRoot = path.resolve(__dirname, '..');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function loadConfig(env = process.env) {
  const publicBaseUrl = String(env.WWW_PUBLIC_BASE_URL || '').trim();
  return {
    host: env.WWW_GATE_HOST || '0.0.0.0',
    port: Number(env.WWW_GATE_PORT || env.PORT) || 8080,
    dbPath: env.WWW_GATE_DB || path.join(packageRoot, 'data', 'www-gate.sqlite'),
    publicBaseUrl,
    adminSecret: String(env.WWW_ADMIN_SECRET || '').trim(),
    sessionSecret: String(env.WWW_SESSION_SECRET || '').trim(),
    secureCookies: parseBoolean(env.WWW_SECURE_COOKIES, /^https:\/\//i.test(publicBaseUrl)),
    packageRoot
  };
}

module.exports = { loadConfig, packageRoot };
