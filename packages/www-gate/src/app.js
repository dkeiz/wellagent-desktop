const http = require('http');
const path = require('path');
const { getAdminSession, getUserSession, csrfToken } = require('./auth');
const { WwwGateDb, now } = require('./db');
const { parseCookies, redirect, sendHtml, servePublicAsset } = require('./http-utils');
const { loadConfig } = require('./config');
const { RateLimiter } = require('./rate-limit');
const { handleAdmin } = require('./admin-routes');
const { handlePublic } = require('./public-routes');
const views = require('./views');

function createApp(config = loadConfig()) {
  const store = new WwwGateDb(config.dbPath);
  store.init();
  const rateLimiters = {
    adminAuth: new RateLimiter(15 * 60 * 1000, 20),
    login: new RateLimiter(15 * 60 * 1000, 15),
    signup: new RateLimiter(15 * 60 * 1000, 8)
  };

  const app = {
    config,
    store,
    rateLimiters,
    now,
    clientIp(req) {
      return String(req.socket?.remoteAddress || 'anonymous');
    },
    checkRateLimit(name, key) {
      const limiter = this.rateLimiters[name];
      if (!limiter) return { allowed: true, retryAfterSec: 0 };
      return limiter.check(key);
    },
    context(req) {
      const cookies = parseCookies(req.headers.cookie || '');
      const userSession = getUserSession(config, cookies);
      const admin = getAdminSession(config, cookies);
      const user = userSession?.id ? store.userById(userSession.id) : null;
      return {
        admin,
        adminCsrf: admin ? csrfToken(config.adminSecret, admin.cookieValue) : '',
        cookies,
        path: new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname,
        user: user?.status === 'active' ? user : null
      };
    },
    requireUser(req, res) {
      const ctx = this.context(req);
      if (ctx.user) return ctx.user;
      redirect(res, '/login');
      return null;
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const served = servePublicAsset(res, path.join(config.packageRoot, 'public'), url.pathname);
        if (served) return;
      }
      if (await handleAdmin(app, req, res, url)) return;
      if (await handlePublic(app, req, res, url)) return;
      sendHtml(res, 404, views.layout(app.context(req), 'Not found', '<h1>Not found</h1><p>The requested page does not exist.</p>'));
    } catch (error) {
      sendHtml(res, 500, views.layout(app.context(req), 'Server error', `<h1>Server error</h1><p>${views.escapeHtml(error.message)}</p>`));
    }
  });

  server.wwwGate = app;
  return server;
}

module.exports = { createApp };
