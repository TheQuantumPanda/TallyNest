import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../app.js';

const secret = 'abcdef0123456789'.repeat(4);
const config = {
  nodeEnv: 'production',
  clientOrigin: 'https://rehearsal.example',
  jwtSecret: '0123456789abcdef'.repeat(4),
  proxySharedSecret: secret,
  trustProxyHops: 2,
};
async function setup(t) {
  const app = createApp(config),
    server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}
test('protected proxy ingress rejects bypass before parsing bodies or authenticating; health stays safe', async (t) => {
  const request = await setup(t);
  for (const headers of [{}, { 'x-tallynest-proxy-secret': 'wrong' }]) {
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
