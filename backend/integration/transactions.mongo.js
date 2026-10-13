import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Transaction } from '../src/models/transaction.model.js';
import { transactionQueryContract } from '../tests/helpers/transaction-query-api.js';
import { User } from '../src/models/user.model.js';
import { createTransactionRepository } from '../src/repositories/transaction.repository.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { apiSetup, transactionApiContract, transactionConcurrencyContract, ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';

// Deliberately no MONGO_URI/.env fallback: integration must never use development data.
const database = `tallynest_crud_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  assert.match(database, /^tallynest_crud_test_/);
  await Promise.all([Transaction.init(), User.init()]);
  passwordHash = await hashPassword('public integration test password');
  console.log(`Disposable MongoDB database: ${database}`);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const remaining = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(remaining.databases.some(item => item.name === database), false);
    await mongoose.disconnect();
    console.log(`Dropped disposable database: ${database}`);
  }
});
beforeEach(async () => {
  await Promise.all([Transaction.deleteMany({}), User.deleteMany({})]);
  await User.create([
    { _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash },
    { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash },
  ]);
});
async function setup(t, { wrapRepository = value => value } = {}) {
  return apiSetup(t, wrapRepository(createTransactionRepository()), userRepository);
}
transactionApiContract(setup);
transactionConcurrencyContract(setup);
transactionQueryContract(setup);

test('real MongoDB retains exact integer boundaries, ObjectId/date values and declared index', async t => {
  const request = await setup(t);
  const response = await request('', { method: 'POST', body: { ...expense, amountMinor: Number.MAX_SAFE_INTEGER } });
  assert.equal(response.status, 201);
  const stored = await Transaction.findOne({ owner: ownerA, _id: response.body.data.transaction.id }).exec();
  assert.equal(stored.amountMinor, Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isSafeInteger(stored.amountMinor));
  assert.equal(stored.owner.toHexString(), ownerA);
  assert.equal(stored.transactionDate.toISOString(), expense.transactionDate);
  const indexes = await Transaction.collection.indexes();
  assert.ok(indexes.some(index => index.key.owner === 1 && index.key.transactionDate === -1 && index.key._id === -1));
  assert.ok(indexes.some(index => index.key.owner === 1 && index.key.amountMinor === -1 && index.key._id === -1));
});

test('real atomic update rejects stale versions without changing persisted state', async () => {
  const repository = createTransactionRepository();
  const document = await repository.createForOwner(ownerA, { ...expense, category: 'other' });
  assert.equal(document.__v, 0);
  const updated = await repository.replaceForOwner(ownerA, String(document._id), 0, { ...expense, category: 'other', type: 'income' });
  assert.equal(updated.__v, 1);
  const rejected = await repository.replaceForOwner(ownerA, String(document._id), 0, expense);
  assert.equal(rejected, null);
  const stored = await repository.findByIdForOwner(ownerA, String(document._id));
  assert.equal(stored.type, 'income');
  assert.equal(stored.category, 'other');
  assert.equal(stored.__v, 1);
});
