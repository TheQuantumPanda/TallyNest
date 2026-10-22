import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { spawnSync } from 'node:child_process';
import { createApp } from '../app.js';
import { ipTag, proxyIpDiagnostic } from '../src/middleware/proxy-ip-diagnostic.middleware.js';

const signing = '0123456789abcdef'.repeat(4);
const ingress = 'abcdef0123456789'.repeat(4);
const token = 'fedcba9876543210'.repeat(4);
const origin = 'https://tallynest-plum.vercel.app';
const id = '0123456789abcdef01234567';

async function setup(t, enabled = true, failSink = false, expiredInitially = false) {
  let time = Date.now();
  const records = [];
  const session = jwt.sign({}, signing, {
    algorithm: 'HS256',
    subject: id,
    issuer: 'smart-finance-manager',
    audience: 'smart-finance-manager-web',
    expiresIn: 900,
  });
  const app = createApp(
    {
      nodeEnv: 'production',
      clientOrigin: origin,
      jwtSecret: signing,
      proxySharedSecret: ingress,
      trustProxyHops: 2,
      proxyIpDiagnostic: enabled
        ? { token, until: new Date(time + (expiredInitially ? -60000 : 60000)).toISOString() }
        : undefined,
    },
    {
      repository: {
        findById: async () => ({ _id: id, name: 'Fixture', email: 'fixture@example.com' }),
      },
      proxyDiagnosticOptions: {
        now: () => time,
        emit: (record) => {
          if (failSink) throw new Error('sink failure');
          records.push(record);
        },
      },
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    records,
    expire: () => {
      time += 60001;
    },
    request: async (headers = {}, path = '/api/auth/me', options = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        ...options,
        headers: {
          Origin: origin,
          Cookie: `__Host-sfm_access=${session}`,
          'x-tallynest-proxy-secret': ingress,
          'x-tallynest-proxy-diagnostic': token,
          'x-tallynest-proxy-probe': 'A-baseline',
          'X-Forwarded-For': '198.51.100.2, 192.0.2.1',
          ...headers,
        },
      });
      await response.text();
      return response;
    },
  };
}

test('passive diagnostic distinguishes socket, rightmost forwarding hop and selected client without raw data', async (t) => {
  const { records, request } = await setup(t);
  for (const xff of ['198.51.100.2, 192.0.2.1', '203.0.113.99, 198.51.100.2, 192.0.2.1'])
    assert.equal((await request({ 'X-Forwarded-For': xff })).status, 200);
  for (const record of records) {
    assert.equal(record.socketTag, ipTag(token, '127.0.0.1'));
    assert.equal(record.rightmostTag, ipTag(token, '192.0.2.1'));
    assert.equal(record.secondRightTag, ipTag(token, '198.51.100.2'));
    assert.equal(record.resolvedTag, ipTag(token, '198.51.100.2'));
    assert.deepEqual(Object.keys(record).sort(), [
      'event',
      'probe',
      'resolvedTag',
      'rightmostTag',
      'secondRightTag',
      'sequence',
      'socketTag',
      'trustHops',
      'xffCount',
    ]);
  }
  assert.equal(records.length, 2);
  const serialized = JSON.stringify(records);
  for (const sensitive of [token, ingress, signing, id, 'Cookie', '198.51.100.2', '192.0.2.1'])
    assert.equal(serialized.includes(sensitive), false);
});

test('shorter path demonstrates the two-hop spoofing risk; distinct clients yield distinct tags', async (t) => {
  const { records, request } = await setup(t);
  await request({ 'X-Forwarded-For': '203.0.113.99, 198.51.100.2' });
  assert.equal(records[0].resolvedTag, ipTag(token, '203.0.113.99'));
  await request({ 'X-Forwarded-For': '198.51.100.3, 192.0.2.1' });
  assert.equal(records[1].resolvedTag, ipTag(token, '198.51.100.3'));
  assert.notEqual(records[0].resolvedTag, records[1].resolvedTag);
});

test('no records for anonymous/bypassed/unselected traffic, wrong token/origin, queries or mutations', async (t) => {
  const { records, request } = await setup(t);
  assert.equal((await request({ Cookie: '' })).status, 401);
  assert.equal((await request({ 'x-tallynest-proxy-secret': '' })).status, 403);
  for (const headers of [
    { 'x-tallynest-proxy-diagnostic': '' },
    { 'x-tallynest-proxy-diagnostic': 'wrong' },
    { Origin: 'https://wrong.example' },
    { Origin: '' },
    { 'x-tallynest-proxy-probe': 'untrusted-log-content\t' },
  ])
    assert.equal((await request(headers)).status, 200);
  await request({}, '/api/auth/me?extra=1');
  await request({}, '/api/health');
  assert.equal((await request({}, '/api/auth/logout', { method: 'POST' })).status, 403);
  assert.equal(records.length, 0);
});

test('disabled, expired and exhausted diagnostics do not change successful responses', async (t) => {
  const disabled = await setup(t, false);
  assert.equal((await disabled.request()).status, 200);
  assert.equal(disabled.records.length, 0);
  const active = await setup(t);
  for (let i = 0; i < 22; i++) assert.equal((await active.request()).status, 200);
  assert.equal(active.records.length, 20);
  const expired = await setup(t);
  expired.expire();
  assert.equal((await expired.request()).status, 200);
  assert.equal(expired.records.length, 0);
  const restartedExpired = await setup(t, true, false, true);
  assert.equal((await restartedExpired.request()).status, 200);
  assert.equal(restartedExpired.records.length, 0);
  const failing = await setup(t, true, true);
  assert.equal((await failing.request()).status, 200);
});

test('IP fingerprints normalize IPv6/mapped IPv4, reject invalid input and separate keys', () => {
  assert.equal(ipTag(token, '::ffff:c000:201'), ipTag(token, '192.0.2.1'));
  assert.equal(ipTag(token, '2001:0db8:0:0::1'), ipTag(token, '2001:db8::1'));
  assert.notEqual(ipTag(token, '192.0.2.1'), ipTag(ingress, '192.0.2.1'));
  for (const input of [undefined, '', 'garbage', '192.0.2.1, 192.0.2.2', 'fe80::1%eth0'])
    assert.equal(ipTag(token, input), null);
  assert.throws(() => proxyIpDiagnostic({ token, until: 'invalid' }, origin), /configuration/);
});

test('offline comparison CLI prints only a tag and uses generic errors', () => {
  const script = new URL('../scripts/proxy-ip-tag.js', import.meta.url);
  const run = (input) =>
    spawnSync(process.execPath, [script.pathname], {
      input: JSON.stringify(input),
      encoding: 'utf8',
    });
  const valid = run({ token, ip: '198.51.100.2' });
  assert.equal(valid.status, 0);
  assert.equal(valid.stdout.trim(), ipTag(token, '198.51.100.2'));
  assert.equal(valid.stderr, '');
  const invalid = run({ token, ip: 'sensitive-invalid-value' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr.trim(), 'Invalid private comparison input');
});

test('malformed, absent and oversized forwarding input never appears in diagnostic output', async (t) => {
  const { records, request } = await setup(t);
  for (const value of ['private-invalid-input', '', '203.0.113.99,'.repeat(200)]) {
    assert.equal((await request({ 'X-Forwarded-For': value })).status, 200);
  }
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.equal(record.xffCount, null);
    assert.equal(record.rightmostTag, null);
    assert.equal(record.secondRightTag, null);
  }
  assert.equal(JSON.stringify(records).includes('private-invalid-input'), false);
});
