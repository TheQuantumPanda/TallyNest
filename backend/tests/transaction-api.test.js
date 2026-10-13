import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTransactions } from './helpers/transaction-repository.js';
import { apiSetup, transactionApiContract, transactionConcurrencyContract, ownerA, expense } from './helpers/transaction-api.js';
import { createTransactionService } from '../src/services/transaction.service.js';


async function setup(t, { wrapRepository = value => value } = {}) {
  return apiSetup(t, wrapRepository(isolatedTransactions()));
}
transactionApiContract(setup);
transactionConcurrencyContract(setup);

test('transaction errors hide internal details in development and production', async t => {
  for (const nodeEnv of ['development', 'production']) {
    const repository = isolatedTransactions();
    repository.findPageForOwner = async () => { throw new Error('passwordHash secret database details'); };
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
  assert.equal((await request('?limit=50')).body.data.transactions.length, 50);
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
  const response = await request(`/${created.body.data.transaction.id}`, { method: 'PATCH', headers: { 'If-Match': `"tn-${created.body.data.transaction.id}-v0"` }, body: { title: 'Edit' } });
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
