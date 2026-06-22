const fs = require('fs');
const path = require('path');
const { runElectronScript } = require('../helpers/electron-contract');

function read(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

module.exports = {
  name: 'www-gate-contract',
  tags: ['contract', 'fast', 'www'],
  async run({ assert, rootDir }) {
    const files = [
      'packages/www-gate/package.json',
      'packages/www-gate/Dockerfile',
      'packages/www-gate/README.md',
      'packages/www-gate/public/styles.css',
      'packages/www-gate/src/app.js',
      'packages/www-gate/src/auth.js',
      'packages/www-gate/src/config.js',
      'packages/www-gate/src/db.js',
      'packages/www-gate/src/public-routes.js',
      'packages/www-gate/src/admin-routes.js',
      'packages/www-gate/src/views.js',
      'docs/www-gate.md',
      'tools/test-www-gate-smoke.js'
    ];

    for (const relativePath of files) {
      const absolutePath = path.join(rootDir, relativePath);
      assert.ok(fs.existsSync(absolutePath), `Expected ${relativePath} to exist`);
      const lineCount = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
      assert.ok(lineCount <= 1000, `Expected ${relativePath} to stay under 1000 lines`);
    }

    const pkg = JSON.parse(read(rootDir, 'packages/www-gate/package.json'));
    assert.equal(pkg.name, '@localagent/www-gate', 'Expected separate www-gate workspace package');
    assert.equal(pkg.private, true, 'Expected www-gate package to remain private');
    assert.equal(pkg.dependencies['better-sqlite3'], '^9.0.1', 'Expected SQLite dependency');
    assert.equal(pkg.scripts.start, 'node src/index.js', 'Expected package start script');

    const rootPkg = JSON.parse(read(rootDir, 'package.json'));
    assert.ok(rootPkg.workspaces.includes('packages/*'), 'Expected root workspaces to include packages/*');
    assert.equal(rootPkg.scripts['start:www-gate'], 'electron packages/www-gate/src/index.js', 'Expected root start script');
    assert.equal(rootPkg.scripts['test:www-gate'], 'electron tools/test-www-gate-smoke.js', 'Expected root smoke script');

    const configSource = read(rootDir, 'packages/www-gate/src/config.js');
    for (const envName of ['WWW_GATE_HOST', 'WWW_GATE_PORT', 'WWW_GATE_DB', 'WWW_PUBLIC_BASE_URL', 'WWW_ADMIN_SECRET', 'WWW_SESSION_SECRET', 'WWW_SECURE_COOKIES']) {
      assert.includes(configSource, envName, `Expected ${envName} config support`);
    }

    const dbSource = read(rootDir, 'packages/www-gate/src/db.js');
    for (const tableName of ['content_blocks', 'links', 'registry_items', 'users', 'audit_events']) {
      assert.includes(dbSource, `CREATE TABLE IF NOT EXISTS ${tableName}`, `Expected ${tableName} schema`);
    }
    for (const type of ['skill', 'plugin', 'user', 'project']) {
      assert.includes(dbSource, `'${type}'`, `Expected ${type} registry support`);
    }
    assert.includes(dbSource, 'https://github.com/dkeiz/wellagent-desktop/releases/latest', 'Expected seeded releases link');
    assert.includes(dbSource, 'wellbot npm CLI', 'Expected seeded npm CLI link');

    const publicRoutes = read(rootDir, 'packages/www-gate/src/public-routes.js');
    for (const route of ['path === \'/\'', 'path === \'/downloads\'', 'path === \'/registry\'', 'path === \'/github\'', 'path === \'/signup\'', 'path === \'/login\'', 'path === \'/account\'', 'path === \'/webgate\'']) {
      assert.includes(publicRoutes, route, `Expected public route marker ${route}`);
    }
    assert.includes(publicRoutes, "'pending'", 'Expected signup users to start pending');
    assert.includes(publicRoutes, "user.status !== 'active'", 'Expected login to require active status');

    const authSource = read(rootDir, 'packages/www-gate/src/auth.js');
    assert.includes(authSource, 'crypto.scryptSync', 'Expected scrypt password hashing');
    assert.includes(authSource, 'csrfToken', 'Expected CSRF token helper');
    assert.includes(authSource, 'verifyCsrf', 'Expected CSRF verification helper');
    assert.includes(authSource, 'issuedAt', 'Expected signed sessions to carry issuance timestamps');
    assert.includes(authSource, 'secureCookies', 'Expected signed sessions to support Secure cookies');
    const httpSource = read(rootDir, 'packages/www-gate/src/http-utils.js');
    assert.includes(httpSource, 'HttpOnly', 'Expected HTTP-only cookies');
    assert.includes(httpSource, 'SameSite=Lax', 'Expected SameSite cookies');
    assert.includes(httpSource, 'Content-Security-Policy', 'Expected HTML responses to set a CSP');
    assert.includes(httpSource, 'X-Content-Type-Options', 'Expected responses to disable MIME sniffing');

    const adminRoutes = read(rootDir, 'packages/www-gate/src/admin-routes.js');
    for (const marker of ['/admin/content/save', '/admin/links/save', '/admin/registry/save', '/admin/users/save']) {
      assert.includes(adminRoutes, marker, `Expected admin CRUD marker ${marker}`);
    }
    assert.includes(adminRoutes, 'WWW_ADMIN_SECRET', 'Expected missing admin secret guidance');
    assert.includes(adminRoutes, 'verifyCsrf', 'Expected admin writes to verify CSRF');

    const dockerfile = read(rootDir, 'packages/www-gate/Dockerfile');
    assert.includes(dockerfile, 'VOLUME ["/data"]', 'Expected persistent SQLite volume');
    assert.includes(dockerfile, 'WWW_GATE_DB=/data/www-gate.sqlite', 'Expected Docker DB path');
    assert.includes(dockerfile, 'EXPOSE 8080', 'Expected Docker port');

    const docs = read(rootDir, 'docs/www-gate.md');
    assert.includes(docs, 'does not replace the existing local', 'Expected docs to preserve local gateway boundary');
    assert.includes(read(rootDir, 'README.md'), 'packages/www-gate', 'Expected root README to mention www gate');

    const allPackageSource = files
      .filter(file => file.startsWith('packages/www-gate/src/'))
      .map(file => read(rootDir, file))
      .join('\n');
    assert.ok(!allPackageSource.includes('src/main/companion'), 'WWW gate must not import companion internals');

    await runElectronScript(rootDir, path.join('tools', 'test-www-gate-smoke.js'));
  }
};

