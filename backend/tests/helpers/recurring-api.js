import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import { ownerA, ownerB, origin, secret } from './transaction-api.js';
export const schedule = {
  type: 'expense',
  title: 'Monthly meal plan',
  amountMinor: 10050,
  currency: 'INR',
  category: 'food_dining',
  frequency: 'monthly',
  startDate: '2024-01-31T09:30:00.000Z',
};
export async function recurringApiSetup(
  t,
  {
    repository,
    transactions,
    users = {
      async findById(id) {
        return [ownerA, ownerB].includes(id)
          ? { _id: id, name: 'QA', email: 'qa@example.test' }
          : null;
      },
    },
    now = () => new Date('2024-03-31T09:30:00.000Z'),
  },
) {
  const app = createApp(
    { nodeEnv: 'test', jwtSecret: secret, clientOrigin: origin },
    {
      repository: users,
      recurringRepository: repository,
      recurringTransactions: transactions,
      recurringNow: now,
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (path = '', { method = 'GET', body, user = ownerA, headers = {} } = {}) => {
    const token = user
      ? jwt.sign({}, secret, {
          subject: user,
          algorithm: 'HS256',
          issuer: 'smart-finance-manager',
          audience: 'smart-finance-manager-web',
          expiresIn: 900,
        })
      : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/recurring${path}`, {
      method,
      headers: {
        ...(method === 'POST' && path === '' ? { 'Idempotency-Key': randomUUID() } : {}),
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(token ? { Cookie: `sfm_access=${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}
export function recurringApiContract(setup) {
  test('recurring API creates each income/expense frequency without immediately adding financial entries', async (t) => {
    const request = await setup(t);
    for (const frequency of ['daily', 'weekly', 'monthly', 'yearly'])
      for (const type of ['income', 'expense']) {
        const result = await request('', {
          method: 'POST',
          body: {
            ...schedule,
            type,
            category: type === 'income' ? 'salary' : 'food_dining',
            frequency,
          },
        });
        assert.equal(result.status, 201);
        const row = result.body.data.schedule;
        assert.equal(row.amountMinor, 10050);
        assert.equal(row.nextOccurrenceDate, schedule.startDate);
        assert.equal(result.headers.get('etag'), `"tn-${row.id}-v0"`);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(row.processing, false);
        assert.equal(row.exhausted, false);
        for (const key of [
          'owner',
          '__v',
          '_id',
          'pending',
          'occurrenceNumber',
          'token',
          'passwordHash',
        ])
          assert.equal(Object.hasOwn(row, key), false);
      }
    assert.equal((await request()).body.data.schedules.length, 8);
  });
  test('recurring API rejects protected fields, invalid money/categories/currencies/calendar ranges', async (t) => {
    const request = await setup(t);
    for (const changes of [
      { creationKey: 'f'.repeat(64) },
      { creationHash: 'f'.repeat(64) },
      { owner: ownerB },
      { _id: ownerB },
      { __v: 7 },
      { nextOccurrenceDate: schedule.startDate },
      { pending: {} },
      { lastOccurrenceDate: schedule.startDate },
      { occurrenceNumber: 0 },
      { createdAt: schedule.startDate },
      { updatedAt: schedule.startDate },
      { $set: {} },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.5 },
      { amountMinor: '100' },
      { amountMinor: null },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { category: 'salary' },
      { currency: 'USD' },
      { frequency: 'hourly' },
      { startDate: '2024-02-30T00:00:00.000Z' },
      { startDate: '0000-01-01T00:00:00.000Z' },
      { startDate: '2024-01-01' },
      { endDate: '2023-12-01T00:00:00.000Z' },
      { status: 'deleted' },
    ]) {
      const result = await request('', { method: 'POST', body: { ...schedule, ...changes } });
      assert.equal(result.status, 400, JSON.stringify(changes));
      assert.equal(result.body.code, 'INVALID_RECURRING');
    }
  });
  test('every recurring endpoint requires authentication and mutations enforce CSRF/Origin', async (t) => {
    const request = await setup(t);
    for (const [method, path, body] of [
      ['POST', '', schedule],
      ['GET', ''],
      ['GET', '/' + ownerB],
      ['PATCH', '/' + ownerB, { title: 'Changed' }],
      ['DELETE', '/' + ownerB],
      ['POST', '/' + ownerB + '/pause', {}],
      ['POST', '/' + ownerB + '/resume', {}],
      ['POST', '/process', {}],
    ]) {
      assert.equal((await request(path, { method, body, user: null })).status, 401);
      if (method !== 'GET')
        for (const headers of [
          { Origin: '' },
          { Origin: 'http://evil.example' },
          { 'X-CSRF-Protection': '' },
        ])
          assert.equal((await request(path, { method, body, headers })).status, 403);
    }
    assert.equal(
      (
        await request('', {
          method: 'POST',
          body: schedule,
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
      415,
    );
  });
  test('recurring ownership isolation includes reads, update, pause, resume and delete', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: schedule })).body.data.schedule;
    for (const [method, suffix, body] of [
      ['GET', ''],
      ['PATCH', '', { title: 'Changed' }],
      ['DELETE', ''],
      ['POST', '/pause', {}],
      ['POST', '/resume', {}],
    ]) {
      const foreign = await request('/' + row.id + suffix, { method, body, user: ownerB });
      const missing = await request('/507f1f77bcf86cd799439099' + suffix, {
        method,
        body,
        user: ownerB,
      });
      assert.equal(foreign.status, 404);
      assert.deepEqual(foreign.body, missing.body);
    }
    assert.deepEqual((await request('', { user: ownerB })).body.data.schedules, []);
    assert.equal((await request('/bad')).status, 400);
  });
  test('ETags, full update validation, nullable notes/end date and explicit pause/resume are preserved', async (t) => {
    const request = await setup(t);
    const row = (
      await request('', {
        method: 'POST',
        body: { ...schedule, notes: 'memo', endDate: '2024-12-31T00:00:00.000Z' },
      })
    ).body.data.schedule;
    const path = '/' + row.id,
      headers = { 'If-Match': `"tn-${row.id}-v0"` };
    assert.equal(
      (await request(path, { method: 'PATCH', body: { title: 'Updated' } })).status,
      428,
    );
    for (const patch of [
      { type: 'income' },
      { category: 'salary' },
      { amountMinor: 0 },
      { owner: ownerB },
      {},
      { nextOccurrenceDate: schedule.startDate },
    ])
      assert.equal((await request(path, { method: 'PATCH', body: patch, headers })).status, 400);
    const updated = await request(path, {
      method: 'PATCH',
      body: { type: 'income', category: 'salary', amountMinor: 20001, notes: null, endDate: null },
      headers,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.schedule.version, 1);
    assert.equal(Object.hasOwn(updated.body.data.schedule, 'notes'), false);
    assert.equal(
      (await request(path, { method: 'PATCH', body: { title: 'Stale' }, headers })).status,
      412,
    );
    const paused = await request(path + '/pause', {
      method: 'POST',
      body: {},
      headers: { 'If-Match': updated.headers.get('etag') },
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.data.schedule.status, 'paused');
    const processed = await request('/process', { method: 'POST', body: {} });
    assert.equal(processed.body.data.processing.generated, 0);
    const resumed = await request(path + '/resume', {
      method: 'POST',
      body: {},
      headers: { 'If-Match': paused.headers.get('etag') },
    });
    assert.equal(resumed.body.data.schedule.status, 'active');
  });
  test('bounded owner processing catches up only the caller and safely repeats', async (t) => {
    const request = await setup(t);
    await request('', { method: 'POST', body: schedule });
    await request('', { method: 'POST', body: schedule, user: ownerB });
    for (const input of [
      { limit: 101 },
      { limit: 0 },
      { limit: '1' },
      { owner: ownerB },
      { asOf: schedule.startDate },
      { $where: '' },
    ])
      assert.equal((await request('/process', { method: 'POST', body: input })).status, 400);
    const first = await request('/process', { method: 'POST', body: { limit: 2 } });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.processing.generated, 2);
    assert.equal(first.body.data.processing.hasMoreDue, true);
    const second = await request('/process', { method: 'POST', body: { limit: 2 } });
    assert.equal(second.body.data.processing.generated, 1);
    assert.equal(
      (await request('/process', { method: 'POST', body: {} })).body.data.processing.generated,
      0,
    );
    assert.equal(
      (await request('', { user: ownerB })).body.data.schedules[0].nextOccurrenceDate,
      schedule.startDate,
    );
  });
  test('schedule deletion leaves history and listing rejects client query operators', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: schedule })).body.data.schedule;
    await request('/process', { method: 'POST', body: { limit: 1 } });
    assert.equal((await request('/' + row.id, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/' + row.id)).status, 404);
    for (const query of [
      '?owner=' + ownerB,
      '?status=bad',
      '?limit=101',
      '?after=bad',
      '?$where=x',
      '?status=active&status=paused',
    ])
      assert.equal((await request(query)).status, 400);
  });
}
