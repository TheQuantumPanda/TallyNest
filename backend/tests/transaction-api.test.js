import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '../src/models/transaction.model.js';
import { apiSetup, transactionApiContract, transactionConcurrencyContract, ownerA, expense } from './helpers/transaction-api.js';
import { createTransactionService } from '../src/services/transaction.service.js';

function isolatedTransactions() {
  const records = new Map();
  const snapshot = document => document ? Transaction.hydrate(document.toObject()) : null;
  return {
    records,
    async createForOwner(owner, data) {
      const document = new Transaction({ ...data, owner });
      await document.validate();
      document.createdAt = new Date();
      document.updatedAt = new Date();
      document.__v = 0;
      records.set(String(document._id), document);
      return snapshot(document);
    },
    async findByIdForOwner(owner, id) {
      const document = records.get(String(id));
      return document && String(document.owner) === String(owner) ? snapshot(document) : null;
    },
    async findForOwner(owner, { limit = 50 } = {}) {
      return [...records.values()].filter(row => String(row.owner) === String(owner))
        .sort((a, b) => b.transactionDate - a.transactionDate || String(b._id).localeCompare(String(a._id)))
        .slice(0, limit).map(snapshot);
    },
    async replaceForOwner(owner, id, version, data) {
      const document = records.get(String(id));
      if (!document || String(document.owner) !== String(owner) || document.__v !== version) return null;
      const updated = new Transaction({ ...data, owner, _id: document._id,
        createdAt: document.createdAt, updatedAt: new Date(), __v: version + 1 });
      await updated.validate();
      // Repeat the CAS after async validation, like the atomic database write.
      if (records.get(String(id)).__v !== version) return null;
      records.set(String(id), updated);
      return snapshot(updated);
    },
    async deleteForOwner(owner, id) {
      const document = await this.findByIdForOwner(owner, id);
      if (document) records.delete(String(id));
      return document;
    },
  };
}

async function setup(t, { wrapRepository = value => value } = {}) {
  return apiSetup(t, wrapRepository(isolatedTransactions()));
}
transactionApiContract(setup);
transactionConcurrencyContract(setup);

test('transaction errors hide internal details in development and production', async t => {
  for (const nodeEnv of ['development', 'production']) {
    const repository = isolatedTransactions();
    repository.findForOwner = async () => { throw new Error('passwordHash secret database details'); };
    const request = await apiSetup(t, repository, undefined, { nodeEnv });
    const response = await request();
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { status: 'error', message: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

test('bounded list returns at most 50 transactions', async t => {
  const repository = isolatedTransactions();
  for (let i = 0; i < 55; i += 1) await repository.createForOwner(ownerA, expense);
  const request = await apiSetup(t, repository);
  assert.equal((await request()).body.data.transactions.length, 50);
});

test('transaction requests have an authenticated user rate limit', async t => {
  const request = await setup(t);
  for (let i = 0; i < 300; i += 1) assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
});

test('service rejects non-JSON numeric edge cases before repository writes', async () => {
  const service = createTransactionService({ repository: isolatedTransactions() });
  for (const amountMinor of [NaN, Infinity, -Infinity]) {
    await assert.rejects(() => service.create(ownerA, { ...expense, amountMinor }), error => error.status === 400);
  }
});

test('PATCH after a concurrent deletion returns the same not-found response', async t => {
  const repository = isolatedTransactions();
  repository.replaceForOwner = async (owner, id) => { await repository.deleteForOwner(owner, id); return null; };
  const request = await apiSetup(t, repository);
  const created = await request('', { method: 'POST', body: expense });
  const response = await request(`/${created.body.data.transaction.id}`, { method: 'PATCH', body: { title: 'Edit' } });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'TRANSACTION_NOT_FOUND');
});

test('malformed transaction JSON cannot disclose payloads or stacks', async t => {
  const { createApp } = await import('../app.js');
  const { once } = await import('node:events');
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":"malformed',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Bad Request', code: 'INVALID_REQUEST' });
});
