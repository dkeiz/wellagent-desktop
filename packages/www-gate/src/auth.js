const crypto = require('crypto');
const { cookie } = require('./http-utils');

const USER_COOKIE = 'www_gate_session';
const ADMIN_COOKIE = 'www_gate_admin';
const USER_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(secret, value) {
  return crypto.createHmac('sha256', String(secret || '')).update(String(value || '')).digest('base64url');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signedValue(secret, payload) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(secret, body)}`;
}

function isFreshSession(session, maxAgeMs) {
  const issuedAt = Number(session?.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  const now = Date.now();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) return false;
  return now - issuedAt <= maxAgeMs;
}

function readSignedValue(secret, value) {
  const [body, mac] = String(value || '').split('.');
  if (!body || !mac || !timingSafeEqual(mac, sign(secret, body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function csrfToken(secret, signedCookie) {
  if (!secret || !signedCookie) return '';
  return sign(secret, `${signedCookie}:csrf`);
}

function verifyCsrf(secret, signedCookie, token) {
  const expected = csrfToken(secret, signedCookie);
  return expected && timingSafeEqual(expected, token);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, expected] = String(stored || '').split(':');
  if (kind !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('base64url');
  return timingSafeEqual(actual, expected);
}

function createUserCookie(config, user) {
  const value = signedValue(config.sessionSecret, {
    id: user.id,
    role: user.role,
    issuedAt: Date.now()
  });
  return cookie(USER_COOKIE, value, {
    maxAge: Math.floor(USER_SESSION_MAX_AGE_MS / 1000),
    secure: config.secureCookies === true
  });
}

function createAdminCookie(config) {
  const value = signedValue(config.adminSecret, { admin: true, issuedAt: Date.now() });
  return cookie(ADMIN_COOKIE, value, {
    maxAge: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
    secure: config.secureCookies === true
  });
}

function clearCookie(name) {
  return cookie(name, '', { maxAge: 0 });
}

function getUserSession(config, cookies) {
  if (!config.sessionSecret) return null;
  const session = readSignedValue(config.sessionSecret, cookies[USER_COOKIE]);
  return session?.id && isFreshSession(session, USER_SESSION_MAX_AGE_MS) ? session : null;
}

function getAdminSession(config, cookies) {
  if (!config.adminSecret) return null;
  const value = cookies[ADMIN_COOKIE];
  const session = readSignedValue(config.adminSecret, value);
  return session?.admin && isFreshSession(session, ADMIN_SESSION_MAX_AGE_MS)
    ? { ...session, cookieValue: value }
    : null;
}

module.exports = {
  ADMIN_COOKIE,
  USER_COOKIE,
  clearCookie,
  createAdminCookie,
  createUserCookie,
  csrfToken,
  getAdminSession,
  getUserSession,
  hashPassword,
  timingSafeEqual,
  verifyCsrf,
  verifyPassword
};
