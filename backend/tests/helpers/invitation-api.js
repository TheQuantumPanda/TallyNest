import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import { ownerA, ownerB, origin, secret } from './transaction-api.js';
export const ownerC = '507f1f77bcf86cd799439033';
export async function invitationApiSetup(
  t,
  dependencies = {},
  users = {
    async findById(id) {
      return [ownerA, ownerB, ownerC].includes(id)
        ? { _id: id, name: 'Registered account', email: 'private@example.test' }
        : null;
    },
  },
) {
  const app = createApp(
    { nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret },
    { ...dependencies, repository: users },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return async (path, { method = 'GET', body, user = ownerA, headers = {} } = {}) => {
    const token = user
      ? jwt.sign({}, secret, {
          algorithm: 'HS256',
          subject: user,
          issuer: 'smart-finance-manager',
          audience: 'smart-finance-manager-web',
          expiresIn: 900,
        })
      : null;
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path.replace(/^\/api(?=\/)/, '')}`,
      {
        method,
        headers: {
          Origin: origin,
          'X-CSRF-Protection': '1',
          ...(token ? { Cookie: `sfm_access=${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get('etag'),
      headers: response.headers,
    };
  };
}
export async function createInvite(request, input = {}) {
  const created = await request('/groups', {
    method: 'POST',
    body: { name: 'Collaboration', description: 'Private description' },
  });
  const group = created.body.data.group;
  const result = await request(`/groups/${group.id}/invitations`, {
    method: 'POST',
    body: input,
    headers: { 'If-Match': created.etag },
  });
  assert.equal(result.status, 201);
  return { groupId: group.id, ...result.body.data, etag: result.etag };
}
export function invitationApiContract(setup) {
  test('invitation creation returns an unpredictable one-time token and routine metadata never exposes it', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    assert.equal(/^[A-Za-z0-9_-]{43}$/.test(created.token), true);
    assert.equal(created.invitation.maxUses, 1);
    assert.equal(created.invitation.usedCount, 0);
    const second = await request(`/groups/${created.groupId}/invitations`, {
      method: 'POST',
      body: { maxUses: 2 },
      headers: { 'If-Match': created.etag },
    });
    assert.equal(second.status, 201);
    assert.notEqual(second.body.data.invitation.id, created.invitation.id);
    assert.equal(second.body.data.token === created.token, false);
    const listing = await request(`/groups/${created.groupId}/invitations`);
    assert.equal(listing.status, 200);
    assert.equal(listing.body.data.invitations.length, 2);
    assert.equal(JSON.stringify(listing.body).includes(created.token), false);
    assert.equal(JSON.stringify(listing.body).includes('tokenHash'), false);
    assert.equal(listing.headers.get('cache-control'), 'no-store');
  });
  test('invitation inspection gives only minimal group information and invalid tokens are non-disclosing', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    const response = await request(created.inspectionPath, { user: ownerB });
    assert.equal(response.status, 200);
    assert.deepEqual(
      Object.keys(response.body.data.invitation).sort(),
      ['group', 'expiresAt'].sort(),
    );
    assert.deepEqual(
      Object.keys(response.body.data.invitation.group).sort(),
      ['id', 'name', 'currency'].sort(),
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    for (const token of ['bad', 'a'.repeat(42), 'a'.repeat(44), '_'.repeat(43), 'A'.repeat(43)]) {
      const invalid = await request('/invitations/' + token, { user: ownerB });
      assert.equal(invalid.status, 404);
      assert.equal(invalid.body.code, 'INVITATION_UNAVAILABLE');
    }
  });
  test('owner-only invitation operations isolate groups and require matching versions', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    for (const [method, path, body] of [
      ['POST', `/groups/${created.groupId}/invitations`, {}],
      ['GET', `/groups/${created.groupId}/invitations`],
      ['DELETE', `/groups/${created.groupId}/invitations/${created.invitation.id}`],
    ]) {
      const result = await request(path, { method, body, user: ownerB });
      assert.equal(result.status, 404);
    }
    const path = `/groups/${created.groupId}/invitations`;
    assert.equal((await request(path, { method: 'POST', body: {} })).status, 428);
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          body: {},
          headers: { 'If-Match': `"tn-${created.groupId}-v0"` },
        })
      ).status,
      412,
    );
    for (const body of [
      { maxUses: 0 },
      { maxUses: 21 },
      { maxUses: 1.1 },
      { expiresInSeconds: 0 },
      { expiresInSeconds: 604801 },
      { user: ownerB },
      { group: ownerB },
      { tokenHash: 'x' },
      { $set: {} },
    ])
      assert.equal(
        (await request(path, { method: 'POST', body, headers: { 'If-Match': created.etag } }))
          .status,
        400,
      );
  });
  test('registered acceptance atomically joins as member and decrements available uses', async (t) => {
    const request = await setup(t),
      created = await createInvite(request, { maxUses: 2 });
    const accepted = await request(created.acceptancePath, {
      method: 'POST',
      body: {},
      user: ownerB,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.group.membership.role, 'member');
    assert.equal(accepted.body.data.group.version, 2);
    assert.equal(
      (await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).body.code,
      'ALREADY_MEMBER',
    );
    const listing = await request(`/groups/${created.groupId}/invitations`);
    assert.equal(listing.body.data.invitations[0].usedCount, 1);
    assert.equal((await request(`/groups/${created.groupId}`, { user: ownerB })).status, 200);
    assert.equal(
      (await request(`/groups/${created.groupId}/invitations`, { user: ownerB })).status,
      403,
    );
  });
  test('single-use concurrent acceptance admits only one account and preserves the creator owner', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    const results = await Promise.all(
      [ownerB, ownerC].map((user) =>
        request(created.acceptancePath, { method: 'POST', body: {}, user }),
      ),
    );
    assert.equal(results.filter((row) => row.status === 200).length, 1);
    assert.ok([404, 409].includes(results.find((row) => row.status !== 200).status));
    const listing = await request(`/groups/${created.groupId}/members`);
    assert.equal(listing.body.data.members.length, 2);
    assert.equal(listing.body.data.members.filter((row) => row.role === 'owner').length, 1);
    assert.equal(listing.body.data.members.find((row) => row.role === 'owner').id, ownerA);
    assert.equal((await request(created.inspectionPath, { user: ownerC })).status, 404);
  });
  test('revocation and group deletion atomically invalidate invitations without exposing secrets', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    const revoked = await request(
      `/groups/${created.groupId}/invitations/${created.invitation.id}`,
      { method: 'DELETE', headers: { 'If-Match': created.etag } },
    );
    assert.equal(revoked.status, 200);
    assert.equal((await request(created.inspectionPath, { user: ownerB })).status, 404);
    assert.equal(
      (await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).status,
      404,
    );
    const second = await request(`/groups/${created.groupId}/invitations`, {
      method: 'POST',
      body: {},
      headers: { 'If-Match': revoked.etag },
    });
    assert.equal(second.status, 201);
    assert.equal((await request(`/groups/${created.groupId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(second.body.data.inspectionPath, { user: ownerB })).status, 404);
  });
  test('member listing preserves public-profile privacy; ordinary members can read but not remove others', async (t) => {
    const request = await setup(t),
      created = await createInvite(request, { maxUses: 2 });
    await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
    const members = await request(`/groups/${created.groupId}/members`, { user: ownerB });
    assert.equal(members.status, 200);
    for (const member of members.body.data.members)
      assert.deepEqual(Object.keys(member).sort(), ['id', 'name', 'role', 'joinedAt'].sort());
    assert.equal(
      (await request(`/groups/${created.groupId}/members`, { user: ownerC })).status,
      404,
    );
    assert.equal(
      (
        await request(`/groups/${created.groupId}/members/${ownerA}`, {
          method: 'DELETE',
          user: ownerB,
          headers: { 'If-Match': members.etag },
        })
      ).status,
      403,
    );
    assert.equal((await request(`/groups/${created.groupId}/members?user=${ownerC}`)).status, 400);
  });
  test('owner removal retains invitation receipts and cannot resurrect a removed member', async (t) => {
    const request = await setup(t),
      created = await createInvite(request, { maxUses: 2 });
    await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
    const current = await request(`/groups/${created.groupId}`);
    const removed = await request(`/groups/${created.groupId}/members/${ownerB}`, {
      method: 'DELETE',
      headers: { 'If-Match': current.etag },
    });
    assert.equal(removed.status, 200);
    assert.equal((await request(`/groups/${created.groupId}`, { user: ownerB })).status, 404);
    assert.equal(
      (await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).body.code,
      'ALREADY_ACCEPTED',
    );
    assert.equal(
      (
        await request(`/groups/${created.groupId}/members/${ownerA}`, {
          method: 'DELETE',
          headers: { 'If-Match': removed.etag },
        })
      ).body.code,
      'OWNER_PROTECTED',
    );
  });
  test('voluntary member leave uses ETags and the sole owner cannot leave', async (t) => {
    const request = await setup(t),
      created = await createInvite(request, { maxUses: 2 });
    const joined = await request(created.acceptancePath, {
      method: 'POST',
      body: {},
      user: ownerB,
    });
    const path = `/groups/${created.groupId}/leave`;
    assert.equal((await request(path, { method: 'POST', body: {}, user: ownerB })).status, 428);
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          body: { user: ownerC },
          user: ownerB,
          headers: { 'If-Match': joined.etag },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          body: {},
          user: ownerA,
          headers: { 'If-Match': joined.etag },
        })
      ).body.code,
      'OWNER_PROTECTED',
    );
    const left = await request(path, {
      method: 'POST',
      body: {},
      user: ownerB,
      headers: { 'If-Match': joined.etag },
    });
    assert.equal(left.status, 200);
    assert.equal(left.body.message, 'Group left');
    assert.equal((await request(`/groups/${created.groupId}`, { user: ownerB })).status, 404);
    assert.equal((await request(path, { method: 'POST', body: {}, user: ownerB })).status, 404);
  });
  test('invitation and membership routes preserve authentication, CSRF, JSON and anti-mass assignment', async (t) => {
    const request = await setup(t),
      created = await createInvite(request);
    for (const [method, path, body] of [
      ['GET', created.inspectionPath],
      ['POST', created.acceptancePath, {}],
      ['POST', `/groups/${created.groupId}/invitations`, {}],
      ['DELETE', `/groups/${created.groupId}/invitations/${created.invitation.id}`],
      ['GET', `/groups/${created.groupId}/members`],
      ['DELETE', `/groups/${created.groupId}/members/${ownerB}`],
      ['POST', `/groups/${created.groupId}/leave`, {}],
    ]) {
      assert.equal((await request(path, { method, body, user: null })).status, 401);
      if (method === 'GET') continue;
      for (const headers of [
        { Origin: '' },
        { Origin: 'http://evil.test' },
        { 'X-CSRF-Protection': '' },
      ])
        assert.equal((await request(path, { method, body, headers })).status, 403);
    }
    for (const body of [
      { user: ownerC },
      { email: 'x@test.test' },
      { role: 'owner' },
      { $push: {} },
    ])
      assert.equal(
        (await request(created.acceptancePath, { method: 'POST', body, user: ownerB })).status,
        400,
      );
    assert.equal(
      (
        await request(created.acceptancePath, {
          method: 'POST',
          body: {},
          user: ownerB,
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
      415,
    );
  });
  test('strict user rate limits apply to inspection and acceptance with sanitized errors', async (t) => {
    const request = await setup(t);
    for (let i = 0; i < 30; i++)
      assert.equal((await request('/invitations/bad', { user: ownerB })).status, 404);
    const limited = await request('/invitations/bad', { user: ownerB });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    for (let i = 0; i < 15; i++)
      assert.equal(
        (await request('/invitations/bad/accept', { method: 'POST', body: {}, user: ownerC }))
          .status,
        404,
      );
    assert.equal(
      (await request('/invitations/bad/accept', { method: 'POST', body: {}, user: ownerC })).status,
      429,
    );
  });
}
