const path = require('path');

function headers(map = {}) {
  const entries = Object.fromEntries(Object.entries(map).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(key) {
      return entries[String(key || '').toLowerCase()] || '';
    }
  };
}

function response(status, headerMap = {}) {
  return { status, headers: headers(headerMap) };
}

async function captureError(fn) {
  try {
    await fn();
    return '';
  } catch (error) {
    return error.message || String(error);
  }
}

module.exports = {
  name: 'fetch-url-network-policy-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const {
      assertFetchableUrl,
      fetchWithPolicy,
      isFetchContentTypeAllowed,
      isPrivateIpAddress
    } = require(path.join(rootDir, 'src', 'main', 'mcp', 'register-web-system-tools.js'));

    assert.equal(isPrivateIpAddress('127.0.0.1'), true, 'Expected loopback IPv4 to be private');
    assert.equal(isPrivateIpAddress('10.1.2.3'), true, 'Expected RFC1918 IPv4 to be private');
    assert.equal(isPrivateIpAddress('169.254.1.1'), true, 'Expected link-local IPv4 to be private');
    assert.equal(isPrivateIpAddress('::1'), true, 'Expected loopback IPv6 to be private');
    assert.equal(isPrivateIpAddress('fc00::1'), true, 'Expected unique-local IPv6 to be private');
    assert.equal(isPrivateIpAddress('93.184.216.34'), false, 'Expected public IPv4 to pass private-address check');

    assert.includes(
      await captureError(() => assertFetchableUrl('file:///etc/passwd')),
      'only supports http and https',
      'Expected non-HTTP schemes to be rejected'
    );
    assert.includes(
      await captureError(() => assertFetchableUrl('http://127.0.0.1:8080')),
      'private, local, or reserved',
      'Expected loopback URLs to be rejected'
    );
    assert.includes(
      await captureError(() => assertFetchableUrl('http://localhost:8080')),
      'localhost',
      'Expected localhost names to be rejected'
    );
    assert.equal(
      await assertFetchableUrl('https://93.184.216.34/path'),
      'https://93.184.216.34/path',
      'Expected public literal HTTP(S) URLs to remain fetchable'
    );

    assert.equal(isFetchContentTypeAllowed('text/html; charset=utf-8'), true, 'Expected text content to be allowed');
    assert.equal(isFetchContentTypeAllowed('application/json'), true, 'Expected JSON content to be allowed');
    assert.equal(isFetchContentTypeAllowed('application/activity+json'), true, 'Expected +json content to be allowed');
    assert.equal(isFetchContentTypeAllowed('image/png'), false, 'Expected binary image content to be rejected');
    assert.equal(isFetchContentTypeAllowed('application/octet-stream'), false, 'Expected binary streams to be rejected');

    const seen = [];
    const redirected = await fetchWithPolicy(async (url, options) => {
      seen.push({ url, method: options.method, redirect: options.redirect });
      if (seen.length === 1) {
        return response(302, { location: '/final' });
      }
      return response(200, { 'content-type': 'text/plain' });
    }, 'https://93.184.216.34/start', { method: 'POST' });
    assert.equal(redirected.url, 'https://93.184.216.34/final', 'Expected relative redirects to resolve against the current URL');
    assert.equal(redirected.redirectCount, 1, 'Expected redirect count to be reported');
    assert.deepEqual(seen.map(entry => entry.method), ['POST', 'GET'], 'Expected 302 redirects to switch to GET');
    assert.deepEqual(seen.map(entry => entry.redirect), ['manual', 'manual'], 'Expected redirects to be handled manually');

    assert.includes(
      await captureError(() => fetchWithPolicy(async () => response(302, { location: 'http://127.0.0.1/private' }), 'https://93.184.216.34/start')),
      'private, local, or reserved',
      'Expected redirects to private addresses to be rejected before the next request'
    );
    assert.includes(
      await captureError(() => fetchWithPolicy(async () => response(200, { 'content-type': 'image/png' }), 'https://93.184.216.34/image')),
      'non-text content type',
      'Expected binary content types to be rejected'
    );
  }
};
