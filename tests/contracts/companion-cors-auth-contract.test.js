const CompanionApiServer = require('../../src/main/companion/companion-api-server');
const {
  getAllowedCorsOrigin,
  withCorsHeaders
} = require('../../src/main/companion/companion-server-core');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'companion-cors-auth-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    assert.equal(
      getAllowedCorsOrigin({ headers: { origin: 'http://127.0.0.1:8790', host: '127.0.0.1:8790' } }),
      'http://127.0.0.1:8790',
      'Expected same host companion origin to be allowed'
    );
    assert.equal(
      getAllowedCorsOrigin({ headers: { origin: 'http://evil.example', host: '127.0.0.1:8790' } }),
      null,
      'Expected unrelated origins to be rejected'
    );
    assert.equal(
      getAllowedCorsOrigin({ headers: { origin: 'http://127.0.0.1:8790', host: '127.0.0.1' } }),
      null,
      'Expected explicit origin ports not to be accepted when the Host header has a different implicit port'
    );
    assert.equal(
      withCorsHeaders({ headers: { origin: 'http://evil.example', host: '127.0.0.1:8790' } })['Access-Control-Allow-Origin'],
      undefined,
      'Expected rejected origins not to receive CORS reflection'
    );

    const server = new CompanionApiServer({ host: '127.0.0.1', port: 8790 });
    assert.equal(
      server._extractAuthToken({
        headers: { authorization: 'Bearer header-token' },
        url: '/companion/agents'
      }, '/companion/agents'),
      'header-token',
      'Expected Authorization bearer tokens to remain supported'
    );
    assert.equal(
      server._extractAuthToken({
        headers: {},
        url: '/companion/agents?token=query-token'
      }, '/companion/agents'),
      null,
      'Expected query bearer tokens to be ignored on general API routes'
    );
    assert.equal(
      server._extractAuthToken({
        headers: {},
        url: '/companion/artifact/session/file.png?token=query-token'
      }, '/companion/artifact/session/file.png'),
      null,
      'Expected artifact URLs not to accept bearer tokens in the query string'
    );

    const browserClient = fs.readFileSync(path.join(rootDir, 'src', 'main', 'companion', 'companion-web', 'assets', 'client.js'), 'utf8');
    const mobileClient = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'api', 'client.ts'), 'utf8');
    assert.ok(!browserClient.includes('?token=${encodeURIComponent(this.accessToken)}'), 'Expected browser artifact URLs not to include bearer access tokens');
    assert.ok(!mobileClient.includes('?token=${encodeURIComponent(this.accessToken)}'), 'Expected mobile artifact URLs not to include bearer access tokens');
    assert.includes(browserClient, '/companion/artifact/ticket?', 'Expected browser client to request short-lived artifact tickets');
    assert.includes(mobileClient, '/companion/artifact/ticket?', 'Expected mobile client to request short-lived artifact tickets');
  }
};
