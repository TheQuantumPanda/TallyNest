import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Budget } from '../src/models/budget.model.js';
import { User } from '../src/models/user.model.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { Transaction } from '../src/models/transaction.model.js';
import { createBudgetRepository } from '../src/repositories/budget.repository.js';
import { budgetApiSetup, budgetApiContract, budget } from '../tests/helpers/budget-api.js';
import { ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';

// No environment URI fallback: this suite can only write its own disposable DB.
const database = `tallynest_budget_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  await Promise.all([Budget.init(), Transaction.init(), User.init()]);
  passwordHash = await hashPassword('disposable budget integration password');
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([Budget.deleteMany({}), User.deleteMany({})]);
  await User.create([
    { _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash },
    { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash },
  ]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const remaining = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(remaining.databases.some(item => item.name === database), false);
    await mongoose.disconnect(); console.log(`Dropped disposable database: ${database}`);
  }
});
budgetApiContract((t, { wrapRepository = value => value } = {}) => budgetApiSetup(t, wrapRepository(createBudgetRepository()), userRepository));

test('real budget unique index exists and concurrent model inserts have one winner', async () => {
  const indexes = await Budget.collection.indexes();
  assert.ok(indexes.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify({ owner: 1, month: 1, currency: 1, category: 1 })));
  const results = await Promise.allSettled([Budget.create({ ...budget, owner: ownerA }), Budget.create({ ...budget, owner: ownerA })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 11000);
  assert.equal(await Budget.countDocuments({ owner: ownerA }), 1);
  await Budget.create({ ...budget, owner: ownerB });
});
test('real budget integer/month/owner round-trip and mutations leave transactions unchanged', async () => {
  const transaction = await Transaction.create({ ...expense, owner: ownerA });
  const before = transaction.toObject();
  const repository = createBudgetRepository();
  const row = await repository.createForOwner(ownerA, { ...budget, amountMinor: Number.MAX_SAFE_INTEGER });
  const stored = await repository.findByIdForOwner(ownerA, String(row._id));
  assert.equal(stored.amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(stored.owner.toHexString(), ownerA); assert.equal(stored.month, budget.month);
  assert.equal(await repository.findByIdForOwner(ownerB, String(row._id)), null);
  assert.equal(await repository.replaceForOwner(ownerB, String(row._id), 0, budget), null);
  assert.equal(await repository.deleteForOwner(ownerB, String(row._id)), null);
  await repository.replaceForOwner(ownerA, String(row._id), 0, budget);
  assert.equal(await repository.replaceForOwner(ownerA, String(row._id), 0, { ...budget, amountMinor: 500 }), null);
  await repository.deleteForOwner(ownerA, String(row._id));
  assert.deepEqual((await Transaction.findOne({ owner: ownerA, _id: transaction._id })).toObject(), before);
});
