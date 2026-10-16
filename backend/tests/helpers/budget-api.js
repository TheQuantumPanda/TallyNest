import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import { ownerA, ownerB, secret, origin } from './transaction-api.js';

export const budget = {
  category: 'food_dining',
  amountMinor: 10050,
  month: '2026-10',
  currency: 'INR',
};
export async function budgetApiSetup(
  t,
  repository,
  users = {
    async findById(id) {
      return [ownerA, ownerB].includes(id)
        ? { _id: id, name: 'Test', email: 'test@example.test' }
        : null;
    },
  },
) {
  const app = createApp(
    { nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret },
    {
      budgetRepository: repository,
      repository: users,
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return async (path = '', { method = 'GET', body, user = ownerA, headers = {} } = {}) => {
    const token = user
      ? jwt.sign({}, secret, {
          algorithm: 'HS256',
          subject: user,
          issuer: 'smart-finance-manager',
          audience: 'smart-finance-manager-web',
          expiresIn: 900,
        })
      : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/budgets${path}`, {
      method,
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(token ? { Cookie: `sfm_access=${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      headers: response.headers,
    };
  };
}
export function budgetApiContract(setup) {
  test('budget API creates exact limits and returns only public fields with version/ETag', async (t) => {
    const request = await setup(t);
    for (const amountMinor of [1, 10050, Number.MAX_SAFE_INTEGER]) {
      const response = await request('', {
        method: 'POST',
        body: {
          ...budget,
          amountMinor,
          month: amountMinor === 1 ? '2024-02' : amountMinor === 10050 ? '2026-10' : '9999-12',
        },
      });
      assert.equal(response.status, 201);
      const row = response.body.data.budget;
      assert.equal(row.amountMinor, amountMinor);
      assert.equal(row.version, 0);
      assert.equal(response.headers.get('etag'), `"tn-${row.id}-v0"`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(
        Object.keys(row).sort(),
        [
          'id',
          'version',
          'category',
          'currency',
          'amountMinor',
          'month',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    }
  });
  test('budget API rejects invalid money, categories, months and mass assignment', async (t) => {
    const request = await setup(t);
    for (const patch of [
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.5 },
      { amountMinor: '100' },
      { amountMinor: null },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { category: 'salary' },
      { category: 'bad' },
      { currency: 'USD' },
      { month: '2026-00' },
      { month: '2026-13' },
      { month: '0000-01' },
      { month: '26-01' },
      { month: '2026-1' },
      { month: '2026-10-01' },
      { month: { $ne: null } },
      { owner: ownerB },
      { _id: ownerB },
      { __v: 2 },
      { version: 0 },
      { createdAt: '2026-01-01' },
      { updatedAt: '2026-01-01' },
      { $set: {} },
    ]) {
      const result = await request('', { method: 'POST', body: { ...budget, ...patch } });
      assert.equal(result.status, 400, JSON.stringify(patch));
      assert.equal(result.body.code, 'INVALID_BUDGET');
    }
    assert.deepEqual((await request('?month=2026-10')).body.data.budgets, []);
  });
  test('budget API enforces monthly uniqueness but allows other owners, categories and months', async (t) => {
    const request = await setup(t);
    assert.equal((await request('', { method: 'POST', body: budget })).status, 201);
    const duplicate = await request('', { method: 'POST', body: budget });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'BUDGET_EXISTS');
    for (const options of [
      { body: { ...budget, month: '2026-11' } },
      { body: { ...budget, category: 'other' } },
      { body: budget, user: ownerB },
    ]) {
      assert.equal((await request('', { method: 'POST', ...options })).status, 201);
    }
  });
  test('budget API concurrent creation has exactly one winner', async (t) => {
    const request = await setup(t);
    const results = await Promise.all([
      request('', { method: 'POST', body: budget }),
      request('', { method: 'POST', body: budget }),
    ]);
    assert.deepEqual(results.map((row) => row.status).sort(), [201, 409]);
    assert.equal((await request('?month=2026-10')).body.data.budgets.length, 1);
  });
  test('budget API lists only requested month/currency/category and rejects query operators', async (t) => {
    const request = await setup(t);
    for (const changes of [{}, { category: 'other' }, { month: '2026-11' }])
      await request('', { method: 'POST', body: { ...budget, ...changes } });
    await request('', { method: 'POST', body: budget, user: ownerB });
    assert.deepEqual(
      (await request('?month=2026-10')).body.data.budgets.map((row) => row.category),
      ['food_dining', 'other'],
    );
    assert.equal(
      (await request('?month=2026-10&category=other&currency=INR')).body.data.budgets.length,
      1,
    );
    assert.deepEqual((await request('?month=2024-02')).body.data.budgets, []);
    for (const query of [
      '',
      '?month=bad',
      '?month=2026-10&currency=USD',
      '?month=2026-10&category=salary',
      '?month=2026-10&owner=' + ownerB,
      '?month=2026-10&month=2026-11',
      '?month[$ne]=x',
      '?month=2026-10&$where=x',
    ]) {
      const response = await request(query);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.code, 'INVALID_QUERY');
    }
  });
  test('budget CRUD requires authentication and mutations require exact origin and CSRF', async (t) => {
    const request = await setup(t);
    for (const [method, path, body] of [
      ['GET', '?month=2026-10'],
      ['GET', '/' + ownerB],
      ['POST', '', budget],
      ['PATCH', '/' + ownerB, { amountMinor: 5 }],
      ['DELETE', '/' + ownerB],
    ]) {
      assert.equal((await request(path, { method, body, user: null })).status, 401);
      if (method === 'GET') continue;
      for (const headers of [
        { Origin: '' },
        { Origin: 'http://evil.example' },
        { 'X-CSRF-Protection': '' },
      ]) {
        const response = await request(path, { method, body, headers });
        assert.equal(response.status, 403);
        assert.equal(response.body.code, 'CSRF_REJECTED');
      }
    }
    assert.equal(
      (
        await request('', {
          method: 'POST',
          body: budget,
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
      415,
    );
  });
  test('budget API foreign reads, updates and deletes are indistinguishable from missing IDs', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: budget })).body.data.budget;
    assert.equal((await request('/' + row.id)).status, 200);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const options = {
        method,
        user: ownerB,
        ...(method === 'PATCH' ? { body: { amountMinor: 1 } } : {}),
      };
      const foreign = await request('/' + row.id, options);
      assert.equal(foreign.status, 404);
      assert.deepEqual(foreign.body, (await request('/507f1f77bcf86cd799439099', options)).body);
    }
    assert.equal((await request('/' + row.id)).body.data.budget.amountMinor, budget.amountMinor);
  });
  test('budget PATCH requires resource version and rejects stale/invalid updates', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: budget })).body.data.budget;
    const path = '/' + row.id;
    assert.equal((await request(path, { method: 'PATCH', body: { amountMinor: 5 } })).status, 428);
    for (const value of [
      '*',
      'W/"tn-' + row.id + '-v0"',
      '"tn-' + ownerB + '-v0"',
      '"tn-' + row.id + '-v9007199254740992"',
    ]) {
      assert.equal(
        (
          await request(path, {
            method: 'PATCH',
            body: { amountMinor: 5 },
            headers: { 'If-Match': value },
          })
        ).status,
        400,
      );
    }
    const headers = { 'If-Match': `"tn-${row.id}-v0"` };
    for (const body of [
      {},
      { amountMinor: 0 },
      { category: 'salary' },
      { month: '2026-13' },
      { owner: ownerB },
      { $inc: { amountMinor: 1 } },
      { version: 1 },
      { currency: null },
    ]) {
      assert.equal((await request(path, { method: 'PATCH', body, headers })).status, 400);
    }
    const changed = await request(path, {
      method: 'PATCH',
      body: { amountMinor: 50000, month: '2026-11', category: 'other' },
      headers,
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.budget.version, 1);
    assert.equal(changed.body.data.budget.currency, 'INR');
    assert.equal(changed.body.data.budget.amountMinor, 50000);
    assert.equal(changed.headers.get('etag'), `"tn-${row.id}-v1"`);
    const stale = await request(path, { method: 'PATCH', body: { amountMinor: 60000 }, headers });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.code, 'VERSION_MISMATCH');
  });
  test('budget PATCH cannot move into an existing monthly/category slot', async (t) => {
    const request = await setup(t);
    await request('', { method: 'POST', body: budget });
    const row = (await request('', { method: 'POST', body: { ...budget, category: 'other' } })).body
      .data.budget;
    const result = await request('/' + row.id, {
      method: 'PATCH',
      body: { category: 'food_dining' },
      headers: { 'If-Match': `"tn-${row.id}-v0"` },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'BUDGET_EXISTS');
    assert.equal((await request('/' + row.id)).body.data.budget.version, 0);
  });
  test('budget API hard deletes owned records and rejects invalid IDs', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: budget })).body.data.budget;
    assert.deepEqual((await request('/' + row.id, { method: 'DELETE' })).body, {
      status: 'ok',
      message: 'Budget deleted',
    });
    assert.equal((await request('/' + row.id)).status, 404);
    assert.equal((await request('/' + row.id, { method: 'DELETE' })).status, 404);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const response = await request('/bad', {
        method,
        ...(method === 'PATCH' ? { body: { amountMinor: 5 } } : {}),
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'INVALID_BUDGET_ID');
    }
  });
  test('concurrent budget PATCH operations cannot overwrite validated stale state', async (t) => {
    let waiting = 0;
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const request = await setup(t, {
      wrapRepository(repository) {
        return {
          ...repository,
          async findByIdForOwner(...args) {
            const snapshot = await repository.findByIdForOwner(...args);
            waiting += 1;
            if (waiting <= 2) {
              if (waiting === 2) release();
              await ready;
            }
            return snapshot;
          },
        };
      },
    });
    const row = (await request('', { method: 'POST', body: budget })).body.data.budget;
    const responses = await Promise.all(
      [100, 200].map((amountMinor) =>
        request('/' + row.id, {
          method: 'PATCH',
          body: { amountMinor },
          headers: { 'If-Match': `"tn-${row.id}-v0"` },
        }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(
      responses.find((response) => response.status === 409).body.code,
      'BUDGET_CONFLICT',
    );
    const stored = (await request('/' + row.id)).body.data.budget;
    assert.equal(stored.version, 1);
    assert.equal(
      stored.amountMinor,
      responses.find((response) => response.status === 200).body.data.budget.amountMinor,
    );
  });
}
