import { apiSetup } from './helpers/transaction-api.js';
import { isolatedTransactions } from './helpers/transaction-repository.js';
import { transactionQueryContract } from './helpers/transaction-query-api.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransactionCursor } from '../src/utils/transaction-cursor.js';
import { transactionQuerySchema } from '../src/validators/transaction-query.validator.js';
import { createTransactionRepository } from '../src/repositories/transaction.repository.js';
import { ownerA, secret, expense } from './helpers/transaction-api.js';
transactionQueryContract(t => apiSetup(t, isolatedTransactions()));


test('expired cursors and signing-secret changes are rejected; defaults bind identically', () => {
  let now = 1000;
  const codec = createTransactionCursor(secret, () => now);
  const query = transactionQuerySchema.parse({});
  const last = { _id: ownerA, transactionDate: new Date(expense.transactionDate), amountMinor: 10050 };
  const token = codec.encode(ownerA, query, last);
  const explicit = transactionQuerySchema.parse({ sortBy: 'transactionDate', sortOrder: 'desc', currency: 'INR', limit: '100' });
  assert.equal(codec.decode(token, ownerA, explicit).id, ownerA);
  const changedSecret = createTransactionCursor('fedcba9876543210'.repeat(4), () => now);
  assert.throws(() => changedSecret.decode(token, ownerA, query), error => error.code === 'INVALID_CURSOR');
  now += 24 * 60 * 60 * 1000;
  assert.throws(() => codec.decode(token, ownerA, query), error => error.code === 'INVALID_CURSOR');
});

test('repository builds bounded owner-scoped keyset comparisons and escapes literal title search', async () => {
  const calls = [];
  const model = { find(filter) { calls.push(['filter', filter]); return {
    sort(sort) { calls.push(['sort', sort]); return this; },
    limit(limit) { calls.push(['limit', limit]); return this; },
    maxTimeMS(value) { calls.push(['timeout', value]); return this; },
    exec: async () => [],
  }; } };
  const repository = createTransactionRepository(model);
  await repository.findPageForOwner(ownerA, {
    currency: 'INR', sortBy: 'amountMinor', sortOrder: 'asc', limit: 100,
    search: '.*', after: { id: ownerA, value: 10050 },
  });
  assert.deepEqual(calls, [
    ['filter', { owner: ownerA, currency: 'INR', deletedAt: { $exists: false }, title: { $regex: '\\.\\*', $options: 'i' },
      $or: [{ amountMinor: { $gt: 10050 } }, { amountMinor: 10050, _id: { $gt: ownerA } }] }],
    ['sort', { amountMinor: 1, _id: 1 }], ['limit', 101], ['timeout', 1000],
  ]);
  const count = calls.length;
  for (const options of [{ limit: 101 }, { limit: 20, sortBy: '$where' },
    { limit: 20, owner: { $ne: null } }, { limit: 20, after: { id: ownerA, value: 100 } }]) {
    assert.throws(() => repository.findPageForOwner(ownerA, options));
  }
  assert.throws(() => repository.findPageForOwner({ $ne: null }, { limit: 20 }));
  assert.equal(calls.length, count);
});
