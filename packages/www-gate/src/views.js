const { REGISTRY_TYPES } = require('./db');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function nl2br(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function safeHref(value, fallback = '#') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (_) {
    return fallback;
  }
  return fallback;
}

function navClass(ctx, href) {
  const path = ctx.path || '/';
  if (href === '/') return path === '/' ? ' class="active"' : '';
  return path === href || path.startsWith(`${href}/`) ? ' class="active"' : '';
}

function layout(ctx, title, body) {
  const user = ctx.user;
  const navUser = user
    ? `<a${navClass(ctx, '/account')} href="/account">${escapeHtml(user.display_name)}</a><form class="inline-form" method="post" action="/logout"><button class="nav-action" type="submit">Logout</button></form>`
    : `<a${navClass(ctx, '/login')} href="/login">Login</a><a${navClass(ctx, '/signup')} href="/signup">Signup</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - LocalAgent</title>
  <script src="/assets/theme.js"></script>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/"><span class="brand-mark">LA</span><span>LocalAgent Portal</span></a>
      <nav class="nav">
        <a${navClass(ctx, '/')} href="/">Overview</a>
        <a${navClass(ctx, '/downloads')} href="/downloads">Downloads</a>
        <a${navClass(ctx, '/registry')} href="/registry">Registry</a>
        <a${navClass(ctx, '/webgate')} href="/webgate">Webgate Dashboard</a>
        ${navUser}
        <a${navClass(ctx, '/admin')} href="/admin">Admin</a>
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle theme"><span class="theme-toggle-icon"></span><span data-theme-label>Dark</span></button>
      </nav>
    </header>
    <main class="content">${body}</main>
    <footer class="footer">LocalAgent public portal. Global user promotion and gateway registration system.</footer>
  </div>
</body>
</html>`;
}

function hero(blocks, links) {
  const release = links.find(link => link.link_key === 'releases');
  const github = links.find(link => link.link_key === 'github');
  return `<section class="hero">
    <div class="hero-text">
      <h1>The Local-First AI Agent Companion</h1>
      <p class="lead">Run powerful agentic workflows securely on your local desktop. Connect to Ollama, Anthropic, or OpenAI. Gated user proxy ready for external web integrations.</p>
      <div class="btn-group">
        ${release ? `<a class="btn btn-primary" href="${escapeHtml(safeHref(release.url))}">Download Beta Client</a>` : ''}
        <a class="btn" href="/registry">Explore Registry Skills</a>
        ${github ? `<a class="btn" href="${escapeHtml(safeHref(github.url))}">View Source</a>` : ''}
      </div>
    </div>
    <div class="product-visual" aria-label="LocalAgent workspace preview">
      <div class="visual-header">
        <div class="visual-dots"><span class="visual-dot"></span><span class="visual-dot"></span><span class="visual-dot"></span></div>
        <div class="visual-title">LocalAgent Workspace Preview</div>
        <div class="visual-spacer"></div>
      </div>
      <div class="visual-grid">
        <div class="visual-pane">
          <div class="visual-line accent"></div><div class="visual-line"></div><div class="visual-line short"></div>
          <div class="visual-line success"></div><div class="visual-line"></div><div class="visual-line short"></div>
        </div>
        <div class="visual-pane visual-pane-main">
          <div><div class="visual-line"></div><div class="visual-line"></div><div class="visual-line short"></div></div>
          <span class="pill visual-session">Active Session</span>
        </div>
      </div>
    </div>
  </section>`;
}

function home(ctx, data) {
  const cards = [
    ['Complete Privacy', 'Your workspace remains fully offline. System actions, command pipelines, and file reads never touch third-party servers unless authorized.'],
    ['Flow-Based Workflows', 'Build custom agentic chains with drag-and-drop connectors. Orchestrate multi-agent interactions with step-by-step visibility.'],
    ['Extensible Registry', 'Discover community skills, plugins, and custom integrations. Install new features with a single click from the public repository.']
  ].map(([title, body]) => `<article class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`).join('');
  const registry = data.registry.slice(0, 6).map(item => registryCard(item)).join('');
  return layout(ctx, 'Public Portal', `${hero(data.blocks, data.links)}
    <section class="band"><h2 class="band-title">Features At A Glance</h2><div class="features-grid">${cards}</div></section>
    <section class="band"><h2 class="band-title">Registry Highlights</h2><div class="registry-grid">${registry}</div></section>`);
}

function downloads(ctx, links) {
  const cards = links.map(link => `<article class="platform-card">
    <div class="platform-info">
      <h3>${escapeHtml(link.title)}</h3>
      <p>${escapeHtml(link.description || '')}</p>
      <span class="sha-tag">${escapeHtml(link.kind)}</span>
    </div>
    <a class="btn ${link.kind === 'download' ? 'btn-primary' : ''}" href="${escapeHtml(safeHref(link.url))}">Open</a>
  </article>`).join('');
  return layout(ctx, 'Downloads', `<section class="downloads-container"><h1 class="page-title">Downloads and Links</h1><p class="lead">Deploy the official desktop companion, configure command line bindings, or access open source files.</p><div>${cards}</div></section>`);
}

function registryCard(item) {
  return `<article class="registry-card">
    <div class="card-header"><span class="pill ${escapeHtml(item.type)}">${escapeHtml(item.type)}</span> <span class="status-active">${escapeHtml(item.status)}</span></div>
    <h3><a href="/registry/${escapeHtml(item.type)}/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.summary)}</p>
    ${item.owner_name ? `<p class="muted">Owner: ${escapeHtml(item.owner_name)}</p>` : ''}
  </article>`;
}

function registryIndex(ctx, items) {
  const typeLinks = REGISTRY_TYPES.map(type => `<a class="filter-tag" href="/registry/${type}">${type}</a>`).join('');
  return layout(ctx, 'Registry', `<h1 class="page-title">Registry Explorer</h1><p class="lead">Skills, plugins, public users, and related project entries.</p><div class="registry-layout"><aside class="registry-sidebar"><div class="filter-group"><label>Category Filter</label><a class="filter-tag active" href="/registry">All Categories</a>${typeLinks}</div></aside><div class="registry-grid">${items.map(registryCard).join('')}</div></div>`);
}

function registryType(ctx, type, items) {
  return layout(ctx, `${type} Registry`, `<h1 class="page-title">${escapeHtml(type)} registry</h1><p><a class="btn" href="/registry">All registry entries</a></p><div class="registry-grid">${items.map(registryCard).join('') || '<p>No published entries yet.</p>'}</div>`);
}

function registryDetail(ctx, item) {
  return layout(ctx, item.title, `<article class="card">
    <p><a href="/registry/${escapeHtml(item.type)}">Back to ${escapeHtml(item.type)}</a></p>
    <h1>${escapeHtml(item.title)}</h1>
    <p class="lead">${escapeHtml(item.summary)}</p>
    <p>${nl2br(item.body || '')}</p>
    ${item.url ? `<p><a class="btn btn-primary" href="${escapeHtml(safeHref(item.url))}">Open link</a></p>` : ''}
    <p class="muted">Owner: ${escapeHtml(item.owner_name || 'LocalAgent')}</p>
  </article>`);
}

function authForm(ctx, title, action, fields, message = '') {
  const controls = fields.map(field => `<div class="input-field"><label>${escapeHtml(field.label)}</label>
    <input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" required></div>
  `).join('');
  const alternate = action === '/login'
    ? '<p class="muted">Need access? <a href="/signup">Create an account</a>.</p>'
    : '<p class="muted">Already registered? <a href="/login">Login</a>.</p>';
  return layout(ctx, title, `<div class="auth-container"><div class="auth-card"><h1>${escapeHtml(title)}</h1>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}
    <form class="auth-form" method="post" action="${escapeHtml(action)}">${controls}<button class="btn btn-primary" type="submit">${escapeHtml(title)}</button></form>${alternate}</div></div>`);
}

function account(ctx) {
  return layout(ctx, 'Account', `<h1>Account</h1><div class="card">
    <h2>${escapeHtml(ctx.user.display_name)}</h2>
    <p>${escapeHtml(ctx.user.email)}</p>
    <p>Status: <span class="status ${escapeHtml(ctx.user.status)}">${escapeHtml(ctx.user.status)}</span></p>
    <p>Role: ${escapeHtml(ctx.user.role)}</p>
  </div>`);
}

function webgate(ctx) {
  return layout(ctx, 'Webgate', `<h1 class="page-title">Registered Webgate Gating</h1>
    <p class="lead">This is the reserved global webgate area for chosen users.</p>
    <div class="gate-dashboard"><div class="card"><h3>Traffic and Key Monitor</h3><p>V1 does not connect to the desktop companion or mobile app. Access here proves registered-user gating and leaves the local gateway untouched.</p><div class="console-box">[WEB] Registered webgate area initialized<br>[AUTH] User session accepted<br>[GATE] Local companion gateway remains separate<br>[SYS] Ready for future remote workflow routes</div></div><div class="card"><h3>Gating Settings</h3><p>Restricts web access to approved registered users.</p><button class="btn btn-accent" type="button">Verified Account</button></div></div>`);
}

function adminLogin(ctx, message = '') {
  return layout(ctx, 'Admin', `<div class="auth-container"><div class="auth-card"><h1>Admin</h1>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}
    <form class="form" method="post" action="/admin/auth">
      <label>Admin secret <input name="secret" type="password" required></label>
      <button class="btn btn-primary" type="submit">Enter admin</button>
    </form></div></div>`);
}

function adminLayout(ctx, title, body) {
  const links = '<div class="registry-types"><a class="pill" href="/admin">Dashboard</a><a class="pill" href="/admin/content">Content</a><a class="pill" href="/admin/links">Links</a><a class="pill" href="/admin/registry">Registry</a><a class="pill" href="/admin/users">Users</a></div>';
  return layout(ctx, `Admin ${title}`, `<h1>Admin ${escapeHtml(title)}</h1>${links}${body}`);
}

function hiddenCsrf(ctx) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(ctx.adminCsrf || '')}">`;
}

module.exports = {
  account,
  adminLayout,
  adminLogin,
  authForm,
  downloads,
  escapeHtml,
  hiddenCsrf,
  home,
  layout,
  registryDetail,
  registryIndex,
  registryType,
  webgate
};
