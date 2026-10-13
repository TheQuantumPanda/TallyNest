import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import { ownerA, ownerB, secret, origin } from './transaction-api.js';

export async function groupApiSetup(t, repository, users = {
  async findById(id) { return [ownerA, ownerB].includes(id) ? { _id: id, name: 'Test', email: 'test@example.test' } : null; },
}, nodeEnv = 'test') {
  const app = createApp({ nodeEnv, clientOrigin: origin, jwtSecret: secret }, {
    groupRepository: repository,
    repository: users,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return async (path = '', { method = 'GET', body, user = ownerA, headers = {} } = {}) => {
    const token = user ? jwt.sign({}, secret, { algorithm: 'HS256', subject: user,
      issuer: 'smart-finance-manager', audience: 'smart-finance-manager-web', expiresIn: 900 }) : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/groups${path}`, {
      method, headers: { Origin: origin, 'X-CSRF-Protection': '1',
        ...(token ? { Cookie: `${nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access'}=${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
}
export const group = { name: 'Household', description: 'Shared space', currency: 'INR' };
export function groupApiContract(setup) {
  test('group API creates initial owner and returns sanitized metadata/ETag', async t => {
    const request = await setup(t), result = await request('', { method: 'POST', body: group });
    assert.equal(result.status, 201);
    const row = result.body.data.group;
    assert.equal(row.name, group.name); assert.equal(row.version, 0); assert.equal(row.membership.role, 'owner');
    assert.ok(new Date(row.membership.createdAt).getTime());
    assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'description', 'currency', 'version', 'membership', 'createdAt', 'updatedAt'].sort());
    assert.equal(result.headers.get('etag'), `"tn-${row.id}-v0"`); assert.equal(result.headers.get('cache-control'), 'no-store');
  });
  test('group API rejects invalid metadata, protected fields and operator injection', async t => {
    const request = await setup(t);
    for (const patch of [{ name: '' }, { name: '  ' }, { name: 'x'.repeat(101) }, { name: { $ne: '' } }, { name: 123 }, { description: 'x'.repeat(2001) }, { description: null }, { currency: 'USD' }, { currency: null }, { owner: ownerB }, { creator: ownerB }, { members: [] }, { memberIds: [ownerB] }, { role: 'owner' }, { _id: ownerB }, { __v: 1 }, { version: 1 }, { createdAt: new Date() }, { updatedAt: new Date() }, { $set: { name: 'Oops' } }, { balanceMinor: 1 }]) {
      const result = await request('', { method: 'POST', body: { ...group, ...patch } });
      assert.equal(result.status, 400, JSON.stringify(patch)); assert.equal(result.body.code, 'INVALID_GROUP');
    }
    assert.deepEqual((await request()).body.data.groups, []);
    const row = (await request('', { method: 'POST', body: { name: '  Trim me  ' } })).body.data.group;
    assert.equal(row.name, 'Trim me'); assert.equal(row.currency, 'INR'); assert.equal(row.description, undefined);
  });
  test('group API requires auth, CSRF, origin and mutation JSON', async t => {
    const request = await setup(t);
    for (const [method, path, body] of [['POST', '', group], ['GET', ''], ['GET', '/' + ownerA], ['PATCH', '/' + ownerA, { name: 'Edit' }], ['DELETE', '/' + ownerA]]) {
      assert.equal((await request(path, { method, body, user: null })).status, 401);
      if (method === 'GET') continue;
      for (const headers of [{ Origin: '' }, { Origin: 'http://evil.test' }, { 'X-CSRF-Protection': '' }]) assert.equal((await request(path, { method, body, headers })).status, 403);
    }
    assert.equal((await request('', { method: 'POST', body: group, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  });
  test('group API isolates foreign and missing IDs identically and validates IDs', async t => {
    const request = await setup(t), row = (await request('', { method: 'POST', body: group })).body.data.group;
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const options = { method, user: ownerB, ...(method === 'PATCH' ? { body: { name: 'Unauthorized' } } : {}) };
      const foreign = await request('/' + row.id, options), missing = await request('/507f1f77bcf86cd799439099', options);
      assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
      for (const id of ['bad', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) assert.equal((await request('/' + id, { ...options, user: ownerA })).status, 400);
    }
    assert.deepEqual((await request('', { user: ownerB })).body.data.groups, []);
    assert.equal((await request('/' + row.id)).body.data.group.name, group.name);
  });
  test('group API bounded pagination returns only memberships in deterministic order', async t => {
    const request = await setup(t); const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await request('', { method: 'POST', body: { name: `Group ${i}` } })).body.data.group.id);
    await request('', { method: 'POST', body: group, user: ownerB });
    const first = await request('?limit=2'); assert.equal(first.body.pagination.hasMore, true);
    const second = await request('?limit=2&after=' + first.body.pagination.nextAfter);
    assert.equal(second.body.pagination.hasMore, false); assert.equal(second.body.pagination.nextAfter, null);
    assert.deepEqual([...first.body.data.groups, ...second.body.data.groups].map(row => row.id), ids.sort().reverse());
    assert.equal((await request()).body.pagination.limit, 20);
    assert.equal((await request('?limit=100')).status, 200);
    for (const query of ['?limit=101', '?limit=0', '?limit=1.5', '?limit=20&limit=10', '?after=bad', '?owner=' + ownerB, '?search=Household', '?$where=x', '?after[$ne]=x']) assert.equal((await request(query)).status, 400, query);
  });
  test('group API metadata PATCH requires ETags and full validation, nullable description clears', async t => {
    const request = await setup(t), row = (await request('', { method: 'POST', body: group })).body.data.group;
    const path = '/' + row.id, body = { name: 'Changed' };
    assert.equal((await request(path, { method: 'PATCH', body })).status, 428);
    for (const value of ['*', `W/"tn-${row.id}-v0"`, `"tn-${ownerB}-v0"`, `"tn-${row.id}-v9007199254740992"`]) assert.equal((await request(path, { method: 'PATCH', body, headers: { 'If-Match': value } })).status, 400);
    const headers = { 'If-Match': `"tn-${row.id}-v0"` };
    for (const data of [{}, { name: '' }, { currency: 'USD' }, { creator: ownerB }, { members: [] }, { role: 'owner' }, { __v: 2 }, { $inc: { __v: 1 } }]) assert.equal((await request(path, { method: 'PATCH', body: data, headers })).status, 400);
    const updated = await request(path, { method: 'PATCH', body: { name: ' Changed ', description: null }, headers });
    assert.equal(updated.status, 200); assert.equal(updated.body.data.group.name, 'Changed'); assert.equal(updated.body.data.group.description, undefined); assert.equal(updated.body.data.group.version, 1);
    assert.equal(updated.headers.get('etag'), `"tn-${row.id}-v1"`);
    assert.equal((await request(path, { method: 'PATCH', body, headers })).status, 412);
  });
  test('group API concurrent updates preserve one winner and never overwrite', async t => {
    const request = await setup(t), row = (await request('', { method: 'POST', body: group })).body.data.group;
    const results = await Promise.all(['One', 'Two'].map(name => request('/' + row.id, { method: 'PATCH', body: { name }, headers: { 'If-Match': `"tn-${row.id}-v0"` } })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.ok([409, 412].includes(results.find(result => result.status !== 200).status));
    const latest = (await request('/' + row.id)).body.data.group;
    assert.equal(latest.version, 1); assert.equal(latest.name, results.find(result => result.status === 200).body.data.group.name);
  });
  test('group API owner deletion removes membership and missing deletion returns 404', async t => {
    const request = await setup(t), row = (await request('', { method: 'POST', body: group })).body.data.group;
    const removed = await request('/' + row.id, { method: 'DELETE' }); assert.equal(removed.status, 200); assert.equal(removed.body.message, 'Group deleted');
    assert.equal((await request('/' + row.id)).status, 404); assert.equal((await request('/' + row.id, { method: 'DELETE' })).status, 404);
    assert.deepEqual((await request()).body.data.groups, []);
  });
}
