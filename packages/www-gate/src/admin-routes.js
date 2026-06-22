const { REGISTRY_TYPES } = require('./db');
const { createAdminCookie, clearCookie, hashPassword, timingSafeEqual, verifyCsrf } = require('./auth');
const { readForm, redirect, sendHtml } = require('./http-utils');
const views = require('./views');

function bool(value) {
  return value === '1' || value === 'true' || value === 'on';
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function requireAdmin(app, req, res, ctx) {
  if (!app.config.adminSecret) {
    sendHtml(res, 503, views.layout(ctx, 'Admin disabled', '<h1>Admin disabled</h1><p>Set WWW_ADMIN_SECRET before using admin routes.</p>'));
    return false;
  }
  if (!ctx.admin) {
    sendHtml(res, 401, views.adminLogin(ctx));
    return false;
  }
  return true;
}

async function requireAdminPost(app, req, res, ctx) {
  if (!requireAdmin(app, req, res, ctx)) return null;
  const form = await readForm(req);
  if (!verifyCsrf(app.config.adminSecret, ctx.admin.cookieValue, form.csrf)) {
    sendHtml(res, 403, views.layout(ctx, 'CSRF failed', '<h1>Request rejected</h1><p>Refresh the admin page and try again.</p>'));
    return null;
  }
  return form;
}

async function handleAdmin(app, req, res, url) {
  const ctx = app.context(req);
  const path = url.pathname;
  const method = String(req.method || 'GET').toUpperCase();
  if (!path.startsWith('/admin')) return false;

  if (method === 'POST' && path === '/admin/auth') {
    if (!app.config.adminSecret) {
      sendHtml(res, 503, views.adminLogin(ctx, 'Set WWW_ADMIN_SECRET before using admin routes.'));
      return true;
    }
    const form = await readForm(req);
    const adminRateLimit = app.checkRateLimit('adminAuth', `${app.clientIp(req)}:admin`);
    if (!adminRateLimit.allowed) {
      sendHtml(res, 429, views.adminLogin(ctx, `Too many admin login attempts. Try again in about ${adminRateLimit.retryAfterSec} seconds.`));
      return true;
    }
    if (!timingSafeEqual(String(form.secret || ''), app.config.adminSecret)) {
      sendHtml(res, 401, views.adminLogin(ctx, 'Invalid admin secret.'));
      return true;
    }
    redirect(res, '/admin', { 'set-cookie': createAdminCookie(app.config) });
    return true;
  }

  if (method === 'POST' && path === '/admin/logout') {
    redirect(res, '/', { 'set-cookie': clearCookie('www_gate_admin') });
    return true;
  }

  if (!requireAdmin(app, req, res, ctx)) return true;

  if (method === 'GET' && path === '/admin') {
    const counts = app.store.counts();
    const body = `<div class="grid">
      ${Object.entries(counts).map(([key, value]) => `<div class="card"><h3>${views.escapeHtml(key)}</h3><p class="lead">${views.escapeHtml(value)}</p></div>`).join('')}
    </div><form method="post" action="/admin/logout">${views.hiddenCsrf(ctx)}<button type="submit">Leave admin</button></form>`;
    sendHtml(res, 200, views.adminLayout(ctx, 'Dashboard', body));
    return true;
  }

  if (method === 'GET' && path === '/admin/content') {
    sendHtml(res, 200, views.adminLayout(ctx, 'Content', renderContentAdmin(ctx, app.store.content())));
    return true;
  }

  if (method === 'POST' && path === '/admin/content/save') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    const id = Number(form.id) || 0;
    const data = [
      String(form.blockKey || '').trim(),
      String(form.title || '').trim(),
      String(form.body || '').trim(),
      String(form.location || 'home').trim(),
      Number(form.sortOrder) || 0,
      bool(form.visible) ? 1 : 0,
      app.now()
    ];
    if (id) {
      app.store.db.prepare(`
        UPDATE content_blocks SET block_key = ?, title = ?, body = ?, location = ?, sort_order = ?, visible = ?, updated_at = ? WHERE id = ?
      `).run(...data, id);
      app.store.audit('admin', 'content.update', 'content', id);
    } else {
      app.store.db.prepare(`
        INSERT INTO content_blocks (block_key, title, body, location, sort_order, visible, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(...data);
      app.store.audit('admin', 'content.create', 'content', data[0]);
    }
    redirect(res, '/admin/content');
    return true;
  }

  if (method === 'POST' && path === '/admin/content/delete') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    app.store.db.prepare('DELETE FROM content_blocks WHERE id = ?').run(Number(form.id) || 0);
    app.store.audit('admin', 'content.delete', 'content', form.id);
    redirect(res, '/admin/content');
    return true;
  }

  if (method === 'GET' && path === '/admin/links') {
    sendHtml(res, 200, views.adminLayout(ctx, 'Links', renderLinksAdmin(ctx, app.store.links())));
    return true;
  }

  if (method === 'POST' && path === '/admin/links/save') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    const id = Number(form.id) || 0;
    const data = [
      String(form.linkKey || '').trim(),
      String(form.title || '').trim(),
      String(form.url || '').trim(),
      String(form.description || '').trim(),
      String(form.kind || 'link').trim(),
      Number(form.sortOrder) || 0,
      bool(form.visible) ? 1 : 0,
      app.now()
    ];
    if (id) {
      app.store.db.prepare(`
        UPDATE links SET link_key = ?, title = ?, url = ?, description = ?, kind = ?, sort_order = ?, visible = ?, updated_at = ? WHERE id = ?
      `).run(...data, id);
    } else {
      app.store.db.prepare(`
        INSERT INTO links (link_key, title, url, description, kind, sort_order, visible, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...data);
    }
    app.store.audit('admin', id ? 'link.update' : 'link.create', 'link', id || data[0]);
    redirect(res, '/admin/links');
    return true;
  }

  if (method === 'POST' && path === '/admin/links/delete') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    app.store.db.prepare('DELETE FROM links WHERE id = ?').run(Number(form.id) || 0);
    app.store.audit('admin', 'link.delete', 'link', form.id);
    redirect(res, '/admin/links');
    return true;
  }

  if (method === 'GET' && path === '/admin/registry') {
    sendHtml(res, 200, views.adminLayout(ctx, 'Registry', renderRegistryAdmin(ctx, app.store.allRegistry())));
    return true;
  }

  if (method === 'POST' && path === '/admin/registry/save') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    const id = Number(form.id) || 0;
    const type = REGISTRY_TYPES.includes(form.type) ? form.type : 'project';
    const slug = slugify(form.slug || form.title);
    const data = [
      type,
      slug,
      String(form.title || '').trim(),
      String(form.summary || '').trim(),
      String(form.body || '').trim(),
      String(form.url || '').trim(),
      String(form.ownerName || '').trim(),
      String(form.status || 'draft').trim(),
      Number(form.sortOrder) || 0,
      String(form.metadataJson || '').trim(),
      app.now()
    ];
    if (id) {
      app.store.db.prepare(`
        UPDATE registry_items SET type = ?, slug = ?, title = ?, summary = ?, body = ?, url = ?, owner_name = ?, status = ?, sort_order = ?, metadata_json = ?, updated_at = ? WHERE id = ?
      `).run(...data, id);
    } else {
      app.store.db.prepare(`
        INSERT INTO registry_items (type, slug, title, summary, body, url, owner_name, status, sort_order, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...data, app.now());
    }
    app.store.audit('admin', id ? 'registry.update' : 'registry.create', 'registry', id || slug);
    redirect(res, '/admin/registry');
    return true;
  }

  if (method === 'POST' && path === '/admin/registry/delete') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    app.store.db.prepare('DELETE FROM registry_items WHERE id = ?').run(Number(form.id) || 0);
    app.store.audit('admin', 'registry.delete', 'registry', form.id);
    redirect(res, '/admin/registry');
    return true;
  }

  if (method === 'GET' && path === '/admin/users') {
    sendHtml(res, 200, views.adminLayout(ctx, 'Users', renderUsersAdmin(ctx, app.store.users())));
    return true;
  }

  if (method === 'POST' && path === '/admin/users/save') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    const id = Number(form.id) || 0;
    if (id) {
      const current = app.store.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (current) {
        const passwordHash = form.password ? hashPassword(form.password) : current.password_hash;
        app.store.db.prepare(`
          UPDATE users SET email = ?, display_name = ?, password_hash = ?, role = ?, status = ?, bio = ?, updated_at = ? WHERE id = ?
        `).run(form.email, form.displayName, passwordHash, form.role, form.status, form.bio || '', app.now(), id);
      }
    } else {
      app.store.db.prepare(`
        INSERT INTO users (email, display_name, password_hash, role, status, bio, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(form.email, form.displayName, hashPassword(form.password || 'change-me-now'), form.role || 'user', form.status || 'pending', form.bio || '', app.now(), app.now());
    }
    app.store.audit('admin', id ? 'user.update' : 'user.create', 'user', id || form.email);
    redirect(res, '/admin/users');
    return true;
  }

  if (method === 'POST' && path === '/admin/users/delete') {
    const form = await requireAdminPost(app, req, res, ctx);
    if (!form) return true;
    app.store.db.prepare('DELETE FROM users WHERE id = ?').run(Number(form.id) || 0);
    app.store.audit('admin', 'user.delete', 'user', form.id);
    redirect(res, '/admin/users');
    return true;
  }

  return false;
}

function renderContentAdmin(ctx, items) {
  const rows = items.map(item => editableRow(ctx, '/admin/content/save', '/admin/content/delete', item.id, [
    ['blockKey', item.block_key], ['title', item.title], ['location', item.location], ['sortOrder', item.sort_order],
    ['body', item.body, 'textarea'], ['visible', item.visible, 'checkbox']
  ])).join('');
  return `${newContentForm(ctx)}<div class="list">${rows}</div>`;
}

function renderLinksAdmin(ctx, items) {
  const rows = items.map(item => editableRow(ctx, '/admin/links/save', '/admin/links/delete', item.id, [
    ['linkKey', item.link_key], ['title', item.title], ['url', item.url], ['kind', item.kind], ['sortOrder', item.sort_order],
    ['description', item.description, 'textarea'], ['visible', item.visible, 'checkbox']
  ])).join('');
  return `${newLinkForm(ctx)}<div class="list">${rows}</div>`;
}

function renderRegistryAdmin(ctx, items) {
  const rows = items.map(item => editableRow(ctx, '/admin/registry/save', '/admin/registry/delete', item.id, [
    ['type', item.type, 'select', REGISTRY_TYPES], ['slug', item.slug], ['title', item.title], ['summary', item.summary],
    ['url', item.url], ['ownerName', item.owner_name], ['status', item.status, 'select', ['draft', 'published', 'hidden']],
    ['sortOrder', item.sort_order], ['body', item.body, 'textarea'], ['metadataJson', item.metadata_json, 'textarea']
  ])).join('');
  return `${newRegistryForm(ctx)}<div class="list">${rows}</div>`;
}

function renderUsersAdmin(ctx, users) {
  const rows = users.map(user => editableRow(ctx, '/admin/users/save', '/admin/users/delete', user.id, [
    ['email', user.email], ['displayName', user.display_name], ['password', '', 'passwordOptional'],
    ['role', user.role, 'select', ['user', 'admin']], ['status', user.status, 'select', ['pending', 'active', 'suspended']],
    ['bio', user.bio, 'textarea']
  ])).join('');
  return `${newUserForm(ctx)}<div class="list">${rows}</div>`;
}

function input(name, value, type = 'text', choices = []) {
  if (type === 'textarea') return `<label>${name}<textarea name="${name}">${views.escapeHtml(value || '')}</textarea></label>`;
  if (type === 'checkbox') return `<label><input name="${name}" type="checkbox" value="1" ${value ? 'checked' : ''}> ${name}</label>`;
  if (type === 'select') {
    return `<label>${name}<select name="${name}">${choices.map(choice => `<option value="${choice}" ${choice === value ? 'selected' : ''}>${choice}</option>`).join('')}</select></label>`;
  }
  const required = type === 'passwordOptional' ? '' : 'required';
  const inputType = type === 'passwordOptional' ? 'password' : type;
  return `<label>${name}<input name="${name}" type="${inputType}" value="${views.escapeHtml(value || '')}" ${required}></label>`;
}

function editableRow(ctx, savePath, deletePath, id, fields) {
  return `<div class="card"><form class="form wide" method="post" action="${savePath}">
    ${views.hiddenCsrf(ctx)}<input type="hidden" name="id" value="${id}">
    <div class="row">${fields.map(field => input(...field)).join('')}</div>
    <button class="primary" type="submit">Save</button>
  </form><form class="inline-form" method="post" action="${deletePath}">
    ${views.hiddenCsrf(ctx)}<input type="hidden" name="id" value="${id}"><button class="danger" type="submit">Delete</button>
  </form></div>`;
}

function newContentForm(ctx) {
  return `<div class="card"><h2>New content block</h2><form class="form wide" method="post" action="/admin/content/save">
    ${views.hiddenCsrf(ctx)}<div class="row">${[
      input('blockKey', ''), input('title', ''), input('location', 'home'), input('sortOrder', '0'),
      input('body', '', 'textarea'), input('visible', 1, 'checkbox')
    ].join('')}</div><button class="primary" type="submit">Create</button></form></div>`;
}

function newLinkForm(ctx) {
  return `<div class="card"><h2>New link</h2><form class="form wide" method="post" action="/admin/links/save">
    ${views.hiddenCsrf(ctx)}<div class="row">${[
      input('linkKey', ''), input('title', ''), input('url', 'https://'), input('kind', 'link'),
      input('sortOrder', '0'), input('description', '', 'textarea'), input('visible', 1, 'checkbox')
    ].join('')}</div><button class="primary" type="submit">Create</button></form></div>`;
}

function newRegistryForm(ctx) {
  return `<div class="card"><h2>New registry item</h2><form class="form wide" method="post" action="/admin/registry/save">
    ${views.hiddenCsrf(ctx)}<div class="row">${[
      input('type', 'project', 'select', REGISTRY_TYPES), input('slug', ''), input('title', ''), input('summary', ''),
      input('url', ''), input('ownerName', ''), input('status', 'published', 'select', ['draft', 'published', 'hidden']),
      input('sortOrder', '0'), input('body', '', 'textarea'), input('metadataJson', '', 'textarea')
    ].join('')}</div><button class="primary" type="submit">Create</button></form></div>`;
}

function newUserForm(ctx) {
  return `<div class="card"><h2>New user</h2><form class="form wide" method="post" action="/admin/users/save">
    ${views.hiddenCsrf(ctx)}<div class="row">${[
      input('email', ''), input('displayName', ''), input('password', '', 'password'),
      input('role', 'user', 'select', ['user', 'admin']), input('status', 'pending', 'select', ['pending', 'active', 'suspended']),
      input('bio', '', 'textarea')
    ].join('')}</div><button class="primary" type="submit">Create</button></form></div>`;
}

module.exports = { handleAdmin, requireAdmin };
