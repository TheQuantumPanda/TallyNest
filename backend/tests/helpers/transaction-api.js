import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';

export const ownerA = '507f1f77bcf86cd799439011';
export const ownerB = '507f1f77bcf86cd799439022';
export const secret = '0123456789abcdef'.repeat(4);
export const origin = 'http://localhost:5173';
export const expense = { type: 'expense', title: 'Lunch', amountMinor: 10050,
  currency: 'INR', category: 'food_dining', transactionDate: '2026-10-13T07:00:00.000Z' };
export const income = { ...expense, type: 'income', category: 'salary' };

export async function apiSetup(t, transactions, users = {
  async findById(id) { return [ownerA, ownerB].includes(id) ? { _id: id, name: 'Test', email: 'test@example.com' } : null; },
}, config = {}) {
  const app = createApp({ nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret, ...config },
    { repository: users, transactionRepository: transactions });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return async function request(path = '', { method = 'GET', body, user = ownerA, headers = {} } = {}) {
    const token = user ? jwt.sign({}, secret, { algorithm: 'HS256', subject: user,
      issuer: 'smart-finance-manager', audience: 'smart-finance-manager-web', expiresIn: 900 }) : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transactions${path}`, {
      method, headers: { ...(method === 'POST' && path === '' ? { 'Idempotency-Key': randomUUID() } : {}), Origin: origin, 'X-CSRF-Protection': '1',
        ...(token ? { Cookie: `${config.nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access'}=${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
}

export function transactionApiContract(setup) {
  for (const [kind, data] of [['income', income], ['expense', expense]]) {
    test(`API creates valid ${kind} with sanitized integer response`, async t => {
      const request = await setup(t);
      const response = await request('', { method: 'POST', body: data });
      assert.equal(response.status, 201);
      assert.equal(response.body.data.transaction.type, kind);
      assert.equal(response.body.data.transaction.amountMinor, 10050);
      assert.equal(response.body.data.transaction.currency, 'INR');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(response.body.data.transaction).sort(),
        ['id', 'type', 'title', 'amountMinor', 'currency', 'category', 'transactionDate', 'createdAt', 'updatedAt', 'version'].sort());
      for (const key of ['owner', '_id', '__v', 'passwordHash', 'token']) {
        assert.equal(JSON.stringify(response.body).includes(`"${key}"`), false);
      }
    });
  }

  test('API rejects invalid amounts, currencies, categories, dates and protected fields', async t => {
    const request = await setup(t);
    for (const changes of [{ creationKey: 'f'.repeat(64) }, { creationHash: 'f'.repeat(64) }, { amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.1 },
      { amountMinor: '100' }, { amountMinor: null }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { currency: 'USD' }, { category: 'salary' }, { category: 'bad' },
      { transactionDate: '2026-02-30T00:00:00.000Z' }, { owner: ownerB }, { _id: ownerB },
      { createdAt: expense.transactionDate }, { updatedAt: expense.transactionDate }, { __v: 9 }, { recurringSchedule: ownerB }, { scheduledDate: expense.transactionDate }, { deletedAt: expense.transactionDate }, { recurrence: {} }, { $set: {} }]) {
      const response = await request('', { method: 'POST', body: { ...expense, ...changes } });
      assert.equal(response.status, 400, JSON.stringify(changes));
      assert.equal(response.body.code, 'INVALID_TRANSACTION');
    }
    assert.deepEqual((await request()).body.data.transactions, []);
  });

  test('every CRUD endpoint requires authentication', async t => {
    const request = await setup(t);
    for (const [method, path, body] of [['POST', '', expense], ['GET', '', undefined],
      ['GET', `/${ownerB}`, undefined], ['PATCH', `/${ownerB}`, { title: 'Edited' }], ['DELETE', `/${ownerB}`, undefined]]) {
      const result = await request(path, { method, body, user: null });
      assert.equal(result.status, 401);
      assert.equal(result.body.code, 'AUTH_REQUIRED');
    }
  });

  test('all state-changing endpoints enforce CSRF and exact origin', async t => {
    const request = await setup(t);
    for (const [method, path, body] of [['POST', '', expense], ['PATCH', `/${ownerB}`, { title: 'Edited' }],
      ['DELETE', `/${ownerB}`, undefined]]) {
      for (const headers of [{ 'X-CSRF-Protection': '' }, { Origin: 'http://evil.example' }, { Origin: '' }]) {
        const result = await request(path, { method, body, headers });
        assert.equal(result.status, 403);
        assert.equal(result.body.code, 'CSRF_REJECTED');
      }
    }
  });

  test('owned lookup succeeds; foreign and missing records have identical 404 responses', async t => {
    const request = await setup(t);
    const created = (await request('', { method: 'POST', body: expense })).body.data.transaction;
    assert.equal((await request(`/${created.id}`)).status, 200);
    const foreign = await request(`/${created.id}`, { user: ownerB });
    const missing = await request('/507f1f77bcf86cd799439099', { user: ownerB });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.deepEqual((await request('', { user: ownerB })).body.data.transactions, []);
  });

  test('PATCH validates merged state, supports atomic type/category changes and clearing notes', async t => {
    const request = await setup(t);
    const id = (await request('', { method: 'POST', body: { ...expense, notes: 'memo' } })).body.data.transaction.id;
    for (const patch of [{ type: 'income' }, { category: 'salary' }, { amountMinor: 0 }, {},
      { owner: ownerB }, { _id: ownerB }, { __v: 100 }, { updatedAt: expense.transactionDate },
      { notes: 42 }, { currency: 'USD' }, { amountMinor: 1.5 }, { title: ' ' }, { $inc: { amountMinor: 1 } }]) {
      assert.equal((await request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: patch })).status, 400);
    }
    const edited = await request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: { type: 'income', category: 'salary', amountMinor: 20000, notes: null } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.transaction.type, 'income');
    assert.equal(edited.body.data.transaction.category, 'salary');
    assert.equal(edited.body.data.transaction.amountMinor, 20000);
    assert.equal(Object.hasOwn(edited.body.data.transaction, 'notes'), false);
    const retained = await request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v1"` }, body: { title: 'Edited' } });
    assert.equal(retained.body.data.transaction.currency, 'INR');
    assert.equal(retained.body.data.transaction.amountMinor, 20000);
  });

  test('cross-user updates and deletes match missing-record 404 and leave owner data intact', async t => {
    const request = await setup(t);
    const id = (await request('', { method: 'POST', body: expense })).body.data.transaction.id;
    for (const method of ['PATCH', 'DELETE']) {
      const opts = { method, user: ownerB, ...(method === 'PATCH' ? { body: { title: 'Stolen' } } : {}) };
      const foreign = await request(`/${id}`, opts);
      const missing = await request('/507f1f77bcf86cd799439099', opts);
      assert.equal(foreign.status, 404);
      assert.deepEqual(foreign.body, missing.body);
    }
    assert.equal((await request(`/${id}`)).body.data.transaction.title, expense.title);
    assert.deepEqual((await request(`/${id}`, { method: 'DELETE' })).body,
      { status: 'ok', message: 'Transaction deleted' });
    assert.equal((await request(`/${id}`)).status, 404);
    assert.equal((await request(`/${id}`, { method: 'DELETE' })).status, 404);
  });

  test('invalid IDs return 400 for lookup, update and delete', async t => {
    const request = await setup(t);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      for (const id of ['bad', '123', 'g'.repeat(24), '%24ne']) {
        const result = await request(`/${id}`, { method, ...(method === 'PATCH' ? { body: { title: 'Edit' } } : {}) });
        assert.equal(result.status, 400);
        assert.equal(result.body.code, 'INVALID_TRANSACTION_ID');
      }
    }
  });

  test('listing sorts by date and descending ID, is owner-scoped and rejects unsupported queries', async t => {
    const request = await setup(t);
    const first = (await request('', { method: 'POST', body: expense })).body.data.transaction;
    const second = (await request('', { method: 'POST', body: income })).body.data.transaction;
    const older = (await request('', { method: 'POST', body: { ...expense, transactionDate: '2026-10-12T00:00:00.000Z' } })).body.data.transaction;
    await request('', { method: 'POST', body: expense, user: ownerB });
    assert.deepEqual((await request()).body.data.transactions.map(row => row.id),
      [first.id, second.id].sort().reverse().concat(older.id));
    assert.equal((await request('?owner=' + ownerB)).status, 400);
    assert.equal((await request('?limit=99999')).status, 400);
  });

  test('JSON is required and CORS permits PATCH/DELETE with credentials', async t => {
    const request = await setup(t);
    assert.equal((await request('', { method: 'POST', body: expense, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    const preflight = await request('', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PATCH' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
  });
}

export function transactionConcurrencyContract(setup) {
  test('concurrent independent type/category patches cannot persist an invalid merged state', async t => {
    let waiting = 0;
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const request = await setup(t, { wrapRepository(repository) {
      return { ...repository, async findByIdForOwner(...args) {
        const snapshot = await repository.findByIdForOwner(...args);
        waiting += 1;
        if (waiting <= 2) {
          if (waiting === 2) release();
          await ready;
        }
        return snapshot;
      } };
    } });
    const id = (await request('', { method: 'POST', body: { ...expense, category: 'other' } })).body.data.transaction.id;
    const results = await Promise.all([
      request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: { type: 'income' } }),
      request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: { category: 'food_dining' } }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(results.find(result => result.status === 409).body.code, 'TRANSACTION_CONFLICT');
    const state = (await request(`/${id}`)).body.data.transaction;
    assert.ok((state.type === 'income' && state.category === 'other') ||
      (state.type === 'expense' && state.category === 'food_dining'));
  });

  test('concurrent independent title/amount patches produce one success and one conflict without lost updates', async t => {
    let waiting = 0;
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const request = await setup(t, { wrapRepository(repository) {
      return { ...repository, async findByIdForOwner(...args) {
        const snapshot = await repository.findByIdForOwner(...args);
        waiting += 1;
        if (waiting <= 2) { if (waiting === 2) release(); await ready; }
        return snapshot;
      } };
    } });
    const id = (await request('', { method: 'POST', body: expense })).body.data.transaction.id;
    const responses = await Promise.all([
      request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: { title: 'Edited' } }),
      request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v0"` }, body: { amountMinor: 30000 } }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const failedTitle = responses[0].status === 409;
    const retry = await request(`/${id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${id}-v1"` }, body: failedTitle ? { title: 'Edited' } : { amountMinor: 30000 } });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.transaction.title, 'Edited');
    assert.equal(retry.body.data.transaction.amountMinor, 30000);
  });
}
