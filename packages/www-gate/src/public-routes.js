const { REGISTRY_TYPES } = require('./db');
const { createUserCookie, hashPassword, verifyPassword, clearCookie } = require('./auth');
const { readForm, redirect, sendHtml, sendJson } = require('./http-utils');
const views = require('./views');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function wantsJson(req) {
  return String(req.headers.accept || '').includes('application/json');
}

function isSafePublicUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function publicContext(app, req) {
  return app.context(req);
}

async function handlePublic(app, req, res, url) {
  const ctx = publicContext(app, req);
  const path = url.pathname;
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true, kind: 'www-gate' });
    return true;
  }

  if (method === 'GET' && path === '/') {
    sendHtml(res, 200, views.home(ctx, {
      blocks: app.store.content('home'),
      links: app.store.links(),
      registry: app.store.registry()
    }));
    return true;
  }

  if (method === 'GET' && path === '/downloads') {
    sendHtml(res, 200, views.downloads(ctx, app.store.links()));
    return true;
  }

  if (method === 'GET' && path === '/github') {
    const link = app.store.links().find(item => item.link_key === 'github');
    const fallback = 'https://github.com/dkeiz/wellagent-desktop';
    redirect(res, isSafePublicUrl(link?.url) ? link.url : fallback);
    return true;
  }

  if (method === 'GET' && path === '/registry') {
    sendHtml(res, 200, views.registryIndex(ctx, app.store.registry()));
    return true;
  }

  const registryTypeMatch = /^\/registry\/([^/]+)$/.exec(path);
  if (method === 'GET' && registryTypeMatch) {
    const type = registryTypeMatch[1];
    if (!REGISTRY_TYPES.includes(type)) return false;
    sendHtml(res, 200, views.registryType(ctx, type, app.store.registry(type)));
    return true;
  }

  const registryDetailMatch = /^\/registry\/([^/]+)\/([^/]+)$/.exec(path);
  if (method === 'GET' && registryDetailMatch) {
    const [, type, slug] = registryDetailMatch;
    if (!REGISTRY_TYPES.includes(type)) return false;
    const item = app.store.registryItem(type, slug);
    if (!item || item.status !== 'published') return false;
    sendHtml(res, 200, views.registryDetail(ctx, item));
    return true;
  }

  if (method === 'GET' && path === '/signup') {
    sendHtml(res, 200, views.authForm(ctx, 'Signup', '/signup', [
      { label: 'Display name', name: 'displayName' },
      { label: 'Email', name: 'email', type: 'email' },
      { label: 'Password', name: 'password', type: 'password' }
    ]));
    return true;
  }

  if (method === 'POST' && path === '/signup') {
    const form = await readForm(req);
    const email = normalizeEmail(form.email);
    const displayName = String(form.displayName || '').trim();
    const password = String(form.password || '');
    const signupRateLimit = app.checkRateLimit('signup', `${app.clientIp(req)}:${email || 'signup'}`);
    if (!signupRateLimit.allowed) {
      sendHtml(res, 429, views.authForm(ctx, 'Signup', '/signup', [
        { label: 'Display name', name: 'displayName', value: displayName },
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], `Too many signup attempts. Try again in about ${signupRateLimit.retryAfterSec} seconds.`));
      return true;
    }
    if (!email || !displayName || password.length < 8) {
      sendHtml(res, 400, views.authForm(ctx, 'Signup', '/signup', [
        { label: 'Display name', name: 'displayName', value: displayName },
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], 'Email, display name, and an 8+ character password are required.'));
      return true;
    }
    if (app.store.userByEmail(email)) {
      sendHtml(res, 409, views.authForm(ctx, 'Signup', '/signup', [
        { label: 'Display name', name: 'displayName', value: displayName },
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], 'That email is already registered.'));
      return true;
    }
    const info = app.store.db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role, status, bio, created_at, updated_at)
      VALUES (?, ?, ?, 'user', 'pending', '', ?, ?)
    `).run(email, displayName, hashPassword(password), app.now(), app.now());
    app.store.audit('public-signup', 'user.signup', 'user', info.lastInsertRowid, { email });
    sendHtml(res, 200, views.layout(ctx, 'Signup pending', '<h1>Signup received</h1><div class="card"><p>Your account is pending admin approval.</p><p><a href="/login">Return to login</a></p></div>'));
    return true;
  }

  if (method === 'GET' && path === '/login') {
    sendHtml(res, 200, views.authForm(ctx, 'Login', '/login', [
      { label: 'Email', name: 'email', type: 'email' },
      { label: 'Password', name: 'password', type: 'password' }
    ]));
    return true;
  }

  if (method === 'POST' && path === '/login') {
    const form = await readForm(req);
    const email = normalizeEmail(form.email);
    const loginRateLimit = app.checkRateLimit('login', `${app.clientIp(req)}:${email || 'login'}`);
    if (!loginRateLimit.allowed) {
      sendHtml(res, 429, views.authForm(ctx, 'Login', '/login', [
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], `Too many login attempts. Try again in about ${loginRateLimit.retryAfterSec} seconds.`));
      return true;
    }
    const user = app.store.userByEmail(email);
    if (!user || !verifyPassword(form.password, user.password_hash)) {
      sendHtml(res, 401, views.authForm(ctx, 'Login', '/login', [
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], 'Invalid email or password.'));
      return true;
    }
    if (user.status !== 'active') {
      sendHtml(res, 403, views.authForm(ctx, 'Login', '/login', [
        { label: 'Email', name: 'email', type: 'email', value: email },
        { label: 'Password', name: 'password', type: 'password' }
      ], `Account status is ${user.status}. Admin approval is required.`));
      return true;
    }
    redirect(res, '/account', { 'set-cookie': createUserCookie(app.config, user) });
    return true;
  }

  if (method === 'POST' && path === '/logout') {
    redirect(res, '/', { 'set-cookie': clearCookie('www_gate_session') });
    return true;
  }

  if (method === 'GET' && path === '/account') {
    const user = app.requireUser(req, res);
    if (!user) return true;
    sendHtml(res, 200, views.account({ ...ctx, user }));
    return true;
  }

  if (method === 'GET' && path === '/webgate') {
    const user = app.requireUser(req, res);
    if (!user) return true;
    sendHtml(res, 200, views.webgate({ ...ctx, user }));
    return true;
  }

  if (wantsJson(req)) sendJson(res, 404, { success: false, error: 'Not found' });
  return false;
}

module.exports = { handlePublic };

