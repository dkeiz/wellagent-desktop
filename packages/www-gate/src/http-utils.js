const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const DEFAULT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin'
};

const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'"
].join('; ');

function withSecurityHeaders(headers = {}) {
  return {
    ...DEFAULT_SECURITY_HEADERS,
    ...headers
  };
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Number(options.maxAge) || 0}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readForm(req) {
  const body = await readBody(req);
  return Object.fromEntries(new URLSearchParams(body));
}

function send(res, status, body, headers = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  res.writeHead(status, {
    'content-length': content.length,
    ...withSecurityHeaders(headers)
  });
  res.end(content);
}

function sendHtml(res, status, html, headers = {}) {
  send(res, status, html, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'Content-Security-Policy': HTML_CSP,
    ...headers
  });
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value || {}), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, withSecurityHeaders({ location, ...headers }));
  res.end();
}

function servePublicAsset(res, publicRoot, urlPath) {
  let relative = '';
  try {
    relative = decodeURIComponent(String(urlPath || '').replace(/^\/assets\//, ''));
  } catch (_) {
    return false;
  }
  relative = relative.replace(/\\/g, '/');
  if (!relative || relative.includes('\0')) return false;
  const root = path.resolve(publicRoot);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  const ext = path.extname(target).toLowerCase();
  send(res, 200, fs.readFileSync(target), {
    'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'cache-control': 'public, max-age=3600'
  });
  return true;
}

module.exports = {
  cookie,
  parseCookies,
  readForm,
  redirect,
  sendHtml,
  sendJson,
  servePublicAsset
};
