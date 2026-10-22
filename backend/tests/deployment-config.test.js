import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const load = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

for (const path of ['vercel.json', 'deployment/vercel.rehearsal.example.json']) {
  test(`${path}: API routing is bounded, precedes files and accepts every method`, async () => {
    const config = await load(path);
    const [api, filesystem, spa] = config.routes;
    const pattern = new RegExp(api.src);
    for (const pathname of ['/api', '/api/', '/api/auth/me', '/api/unknown/deep']) {
      assert.ok(pattern.test(pathname), pathname);
    }
    for (const pathname of ['/apiculture', '/apiary/me', '/app/groups/123', '/assets/app.js']) {
      assert.equal(pattern.test(pathname), false, pathname);
    }
    assert.equal(api.methods, undefined);
    assert.equal(api.continue, undefined);
    assert.equal(api.has, undefined);
    assert.equal(api.missing, undefined);
    assert.match(api.dest, /^https:\/\/[a-zA-Z0-9-]+\.onrender\.com\/api\/\$1$/);
    assert.deepEqual(filesystem, { handle: 'filesystem' });
    assert.deepEqual(spa, { src: '^/.*$', methods: ['GET', 'HEAD'], dest: '/index.html' });
    assert.equal(config.routes.length, 3);
    assert.equal(config.framework, 'vite');
    assert.equal(config.installCommand, 'npm ci --prefix frontend --include=dev');
    assert.equal(config.buildCommand, 'npm run build --prefix frontend');
    assert.equal(config.outputDirectory, 'frontend/dist');
  });

  test(`${path}: only the server ingress header changes and all API responses opt out of caching`, async () => {
    const config = await load(path);
    // No response transform, cookie/Origin rewrite, redirect or public env injection.
    assert.deepEqual(Object.keys(config).sort(), [
      '$schema',
      'buildCommand',
      'framework',
      'installCommand',
      'outputDirectory',
      'routes',
    ]);
    const api = config.routes[0];
    assert.deepEqual(api.transforms, [
      {
        type: 'request.headers',
        op: 'set',
        target: { key: 'x-tallynest-proxy-secret' },
        args: '$PROXY_SHARED_SECRET',
        env: ['PROXY_SHARED_SECRET'],
      },
    ]);
    assert.deepEqual(api.headers, {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'x-vercel-enable-rewrite-caching': '0',
    });
  });
}

test('reviewed root configuration differs from the reusable example only by fixed origin', async () => {
  const actual = await load('vercel.json');
  const example = await load('deployment/vercel.rehearsal.example.json');
  assert.equal(actual.routes[0].dest, 'https://tallynest-api-rehearsal.onrender.com/api/$1');
  example.routes[0].dest = actual.routes[0].dest;
  assert.deepEqual(actual, example);
});
