import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { Router } from 'express';
import { createApp } from '../app.js';

const secret = 'abcdef0123456789'.repeat(4);
const config = {
  nodeEnv: 'production',
  clientOrigin: 'https://rehearsal.example',
  jwtSecret: '0123456789abcdef'.repeat(4),
  proxySharedSecret: secret,
  trustProxyHops: 2,
};
async function setup(t, dependencies) {
  const app = createApp(config, dependencies),
    server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}
test('protected proxy ingress rejects bypass before parsing bodies or authenticating; health stays safe', async (t) => {
  const request = await setup(t);
  for (const headers of [
    {},
    { 'x-tallynest-proxy-secret': 'wrong' },
    { 'x-tallynest-proxy-secret': '$PROXY_SHARED_SECRET' },
    { 'x-tallynest-proxy-secret': `${secret}, forged` },
  ]) {
    const response = await request('/api/auth/register', {
      method: 'POST',
      headers,
      body: 'not JSON',
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'error', message: 'Proxy access required' });
  }
  assert.equal((await request('/api/health')).status, 200);
  assert.equal(
    (await request('/api/auth/me', { headers: { 'x-tallynest-proxy-secret': secret } })).status,
    401,
  );
});
test('protected origin disables caching for health, unknown routes and parser errors without echoing ingress', async (t) => {
  const request = await setup(t);
  for (const [path, options, status] of [
    ['/api/health', {}, 200],
    ['/api/health', { method: 'HEAD' }, 200],
    ['/api/health', { method: 'POST' }, 403],
    ['/api/health/extra', {}, 403],
    ['/api/unknown', { headers: { 'x-tallynest-proxy-secret': secret } }, 404],
    [
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'x-tallynest-proxy-secret': secret, 'Content-Type': 'application/json' },
        body: '{',
      },
      400,
    ],
  ]) {
    const response = await request(path, options);
    assert.equal(response.status, status);
    for (const header of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control'])
      assert.equal(response.headers.get(header), 'no-store');
    assert.equal(response.headers.get('x-tallynest-proxy-secret'), null);
    assert.equal((await response.text()).includes(secret), false);
  }
});

test('production cookies and ETags survive ingress; proxy identity still requires user authentication', async (t) => {
  const request = await setup(t, {
    repository: { findById: async () => null },
  });
  const response = await request('/api/auth/logout', {
    method: 'POST',
    headers: {
      'x-tallynest-proxy-secret': secret,
      Origin: config.clientOrigin,
      'X-CSRF-Protection': '1',
    },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-sfm_access=;/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
    assert.ok(cookie.includes(attribute), attribute);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.ok(response.headers.get('etag'));
  assert.equal(response.headers.get('access-control-allow-origin'), config.clientOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-expose-headers'), /ETag/);
  assert.equal(
    (await request('/api/auth/me', { headers: { 'x-tallynest-proxy-secret': secret } })).status,
    401,
  );
});

test('local ingress preserves financial request metadata and response versions across statuses', async (t) => {
  // This exercises Express ingress, not Vercel's external rewrite implementation.
  const cycleRoutes = Router();
  const metadata = {
    Origin: config.clientOrigin,
    'X-CSRF-Protection': '1',
    'Idempotency-Key': 'public-test-intent',
    'If-Match': '"record-v1"',
    'If-Group-Match': '"group-v2"',
    'If-Cycle-Match': '"cycle-v3"',
    Cookie: '__Host-sfm_access=public-test-cookie',
  };
  cycleRoutes.post('/__ingress-contract', (req, res) => {
    for (const [key, value] of Object.entries(metadata)) assert.equal(req.get(key), value);
    assert.deepEqual(req.body, { amountMinor: 123 });
    assert.equal(req.query.cursor, 'a+b/c=');
    res.set({ ETag: '"record-v2"', 'X-Group-ETag': '"group-v3"' });
    res.status(Number(req.query.status)).json({ status: 'fixture' });
  });
  const request = await setup(t, { cycleRoutes });
  for (const status of [200, 409, 412, 500]) {
    const response = await request(
      `/api/groups/__ingress-contract?cursor=a%2Bb%2Fc%3D&status=${status}`,
      {
        method: 'POST',
        headers: {
          ...metadata,
          'Content-Type': 'application/json',
          'x-tallynest-proxy-secret': secret,
        },
        body: JSON.stringify({ amountMinor: 123 }),
      },
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get('etag'), '"record-v2"');
    assert.equal(response.headers.get('x-group-etag'), '"group-v3"');
    for (const header of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control'])
      assert.equal(response.headers.get(header), 'no-store');
    assert.equal(response.headers.get('x-tallynest-proxy-secret'), null);
  }
  const preflight = await request('/api/groups/__ingress-contract', {
    method: 'OPTIONS',
    headers: {
      'x-tallynest-proxy-secret': secret,
      Origin: config.clientOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': Object.keys(metadata)
        .filter((key) => key !== 'Cookie')
        .join(','),
    },
  });
  assert.equal(preflight.status, 204);
  const allowed = preflight.headers.get('access-control-allow-headers').toLowerCase().split(',');
  for (const key of [
    'X-CSRF-Protection',
    'Idempotency-Key',
    'If-Match',
    'If-Group-Match',
    'If-Cycle-Match',
  ])
    assert.ok(allowed.includes(key.toLowerCase()), key);
});
test('authenticated proxy does not bypass exact Origin or CSRF; IP buckets ignore untrusted left prefixes', async (t) => {
  const request = await setup(t);
  const headers = {
    'x-tallynest-proxy-secret': secret,
    Origin: config.clientOrigin,
    'X-CSRF-Protection': '1',
    'Content-Type': 'application/json',
    'X-Forwarded-For': '203.0.113.99, 198.51.100.2, 192.0.2.1',
  };
  for (const extra of [{ Origin: 'https://wrong.example' }, { 'X-CSRF-Protection': '' }]) {
    assert.equal(
      (
        await request('/api/auth/register', {
          method: 'POST',
          headers: { ...headers, ...extra },
          body: '{}',
        })
      ).status,
      403,
    );
  }
  // Invalid input reaches validation without using any MongoDB repository.
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request('/api/auth/register', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request('/api/auth/register', {
        method: 'POST',
        headers: {
          ...headers,
          'X-Forwarded-For': '203.0.113.100, 198.51.100.2, 192.0.2.1',
        },
        body: '{}',
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await request('/api/auth/register', {
        method: 'POST',
        headers: {
          ...headers,
          'X-Forwarded-For': '203.0.113.100, 198.51.100.3, 192.0.2.1',
        },
        body: '{}',
      })
    ).status,
    400,
  );
});
test('app factory cannot enable blanket proxy trust or unprotected hop trust', () => {
  for (const override of [
    { trustProxyHops: true },
    { trustProxyHops: 1 },
    { proxySharedSecret: undefined },
  ])
    assert.throws(() => createApp({ ...config, ...override }), /protected two-hop ingress/);
});
