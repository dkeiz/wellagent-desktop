const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const { createApp } = require('../packages/www-gate/src/app');

function request(port, options = {}) {
  const body = options.body || '';
  const headers = {
    ...(options.headers || {})
  };
  if (body && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (body) headers['content-length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timed out requesting ${options.path || '/'}`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function form(values) {
  return new URLSearchParams(values).toString();
}

function firstCookie(response) {
  const raw = response.headers['set-cookie'];
  if (!raw || !raw[0]) return '';
  return raw[0].split(';')[0];
}

function csrf(html) {
  const match = /name="csrf"\s+value="([^"]+)"/.exec(html);
  return match ? match[1] : '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolve => server.close(() => resolve()));
}

function cleanupDb(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); } catch (_) {}
  }
}

async function runSmoke() {
  const dbPath = path.join(os.tmpdir(), `localagent-www-gate-${process.pid}-${Date.now()}.sqlite`);
  const server = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    publicBaseUrl: '',
    adminSecret: 'admin-secret',
    sessionSecret: 'session-secret',
    packageRoot: path.join(rootDir, 'packages', 'www-gate')
  });
  const port = await listen(server);

  try {
    const health = await request(port, { path: '/health' });
    assert(health.status === 200 && health.body.includes('www-gate'), 'Expected health response');

    const home = await request(port, { path: '/' });
    assert(home.status === 200 && home.body.includes('LocalAgent'), 'Expected home page');

    const downloads = await request(port, { path: '/downloads' });
    assert(downloads.status === 200 && downloads.body.includes('Desktop releases'), 'Expected downloads page');

    const registry = await request(port, { path: '/registry/plugin' });
    assert(registry.status === 200 && registry.body.includes('plugin registry'), 'Expected plugin registry page');

    const signupBody = form({
      displayName: 'Smoke User',
      email: 'smoke@example.com',
      password: '12345678'
    });
    const signup = await request(port, { path: '/signup', method: 'POST', body: signupBody });
    assert(signup.status === 200 && signup.body.includes('pending admin approval'), 'Expected pending signup');

    const deniedLogin = await request(port, {
      path: '/login',
      method: 'POST',
      body: form({ email: 'smoke@example.com', password: '12345678' })
    });
    assert(deniedLogin.status === 403, 'Expected pending user login to be denied');

    const adminLogin = await request(port, {
      path: '/admin/auth',
      method: 'POST',
      body: form({ secret: 'admin-secret' })
    });
    assert(adminLogin.status === 303, 'Expected admin login redirect');
    const adminCookie = firstCookie(adminLogin);
    assert(adminCookie.includes('www_gate_admin='), 'Expected admin cookie');

    const usersPage = await request(port, {
      path: '/admin/users',
      headers: { cookie: adminCookie }
    });
    const token = csrf(usersPage.body);
    assert(usersPage.status === 200 && token, 'Expected users page and CSRF token');

    const user = server.wwwGate.store.userByEmail('smoke@example.com');
    const approve = await request(port, {
      path: '/admin/users/save',
      method: 'POST',
      headers: { cookie: adminCookie },
      body: form({
        csrf: token,
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        password: '',
        role: 'user',
        status: 'active',
        bio: ''
      })
    });
    assert(approve.status === 303, 'Expected user approval redirect');

    const login = await request(port, {
      path: '/login',
      method: 'POST',
      body: form({ email: 'smoke@example.com', password: '12345678' })
    });
    assert(login.status === 303, 'Expected active user login redirect');
    const userCookie = firstCookie(login);
    assert(userCookie.includes('www_gate_session='), 'Expected user session cookie');

    const webgate = await request(port, {
      path: '/webgate',
      headers: { cookie: userCookie }
    });
    assert(webgate.status === 200 && webgate.body.includes('Registered Webgate'), 'Expected registered webgate page');
  } finally {
    await close(server);
    server.wwwGate.store.close();
    cleanupDb(dbPath);
  }
}

if (require.main === module) {
  runSmoke()
    .then(() => {
      console.log('[www-gate-smoke] PASS');
      process.exit(0);
    })
    .catch(error => {
      console.error(`[www-gate-smoke] FAIL: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runSmoke };
