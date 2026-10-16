import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { User } from '../src/models/user.model.js';
import { Transaction } from '../src/models/transaction.model.js';
import { Budget } from '../src/models/budget.model.js';
import { RecurringSchedule } from '../src/models/recurring.model.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { createGroupRepository, ensureGroupIndexes } from '../src/repositories/group.repository.js';
import { groupApiSetup, groupApiContract, group } from '../tests/helpers/group-api.js';
import { ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';

const database = `tallynest_group_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  assert.equal(mongoose.connection.name, database);
  await ensureGroupIndexes();
  await Promise.all([User.init(), Transaction.init(), Budget.init(), RecurringSchedule.init()]);
  passwordHash = await hashPassword('disposable group integration password');
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([
    Group.deleteMany({}),
    User.deleteMany({}),
    Transaction.deleteMany({}),
    Budget.deleteMany({}),
    RecurringSchedule.deleteMany({}),
  ]);
  await User.create([
    { _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash },
    { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash },
  ]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const { databases } = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(
      databases.some((row) => row.name === database),
      false,
    );
    await mongoose.disconnect();
    console.log(`Dropped disposable database: ${database}`);
  }
});
groupApiContract((t) => groupApiSetup(t, createGroupRepository(), userRepository));

test('real MongoDB installs membership index and strict collection invariants idempotently', async () => {
  await ensureGroupIndexes();
  const indexes = await Group.collection.indexes();
  assert.ok(
    indexes.some(
      (index) => JSON.stringify(index.key) === JSON.stringify({ 'members.user': 1, _id: -1 }),
    ),
  );
  const collection = (
    await mongoose.connection.db.listCollections({ name: Group.collection.name }).toArray()
  )[0];
  assert.equal(collection.options.validationAction, 'error');
  assert.equal(collection.options.validationLevel, 'strict');
  assert.ok(collection.options.validator.$and);
});
test('real MongoDB enforces duplicate membership and exactly one creator-owner even for raw writes', async () => {
  const repository = createGroupRepository(),
    row = await repository.createForOwner(ownerA, group);
  const original = (await Group.findById(row._id)).toObject();
  const owner = { user: new mongoose.Types.ObjectId(ownerA), role: 'owner', createdAt: new Date() };
  const other = {
    user: new mongoose.Types.ObjectId(ownerB),
    role: 'member',
    createdAt: new Date(),
  };
  for (const members of [
    [],
    [owner, owner],
    [owner, other, { ...other, createdAt: new Date('2020-01-01') }],
    [{ ...owner, role: 'member' }],
    [{ ...other, role: 'owner' }],
    [owner, { ...other, role: 'owner' }],
    [owner, { ...other, role: 'admin' }],
    Array(101).fill(owner),
  ]) {
    await assert.rejects(
      Group.collection.updateOne({ _id: row._id }, { $set: { members } }),
      (error) => error.code === 121,
    );
  }
  assert.deepEqual((await Group.findById(row._id)).toObject(), original);
  await assert.rejects(
    Group.collection.insertOne({ ...original, _id: new mongoose.Types.ObjectId(), members: [] }),
    (error) => error.code === 121,
  );
  for (const fields of [{ __v: 0.5 }, { balanceMinor: 1 }, { currency: 'USD' }, { name: '  ' }])
    await assert.rejects(
      Group.collection.updateOne({ _id: row._id }, { $set: fields }),
      (error) => error.code === 121,
    );
});
test('real member can read/list but cannot mutate; unrelated user receives identical missing response', async (t) => {
  const repository = createGroupRepository(),
    row = await repository.createForOwner(ownerA, group);
  row.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await row.save();
  const request = await groupApiSetup(t, repository, userRepository),
    path = '/' + row._id;
  const read = await request(path, { user: ownerB });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.group.membership.role, 'member');
  assert.equal((await request('', { user: ownerB })).body.data.groups.length, 1);
  assert.equal(
    (
      await request(path, {
        user: ownerB,
        method: 'PATCH',
        body: { name: 'Denied' },
        headers: { 'If-Match': read.headers.get('etag') },
      })
    ).status,
    403,
  );
  assert.equal((await request(path, { user: ownerB, method: 'DELETE' })).status, 403);
  assert.equal(await repository.replaceForOwner(ownerB, String(row._id), row.__v, group), null);
  assert.equal(await repository.deleteForOwner(ownerB, String(row._id)), null);
  // No joining endpoint: memberships above are trusted disposable test fixtures.
});
test('real atomic creation has no group/membership failure gap and survives lost acknowledgement', async () => {
  class BeforeWriteFailure extends Group {
    async save() {
      assert.equal(this.members.length, 1);
      throw new Error('before insert');
    }
  }
  await assert.rejects(createGroupRepository(BeforeWriteFailure).createForOwner(ownerA, group));
  assert.equal(await Group.countDocuments({}), 0);
  class AfterWriteFailure extends Group {
    async save(options) {
      await super.save(options);
      throw new Error('after commit');
    }
  }
  await assert.rejects(createGroupRepository(AfterWriteFailure).createForOwner(ownerA, group));
  const rows = await Group.find({ 'members.user': ownerA });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].members.length, 1);
  assert.equal(String(rows[0].creator), ownerA);
  assert.equal(rows[0].members[0].role, 'owner');
  await rows[0].validate();
});
test('real concurrent creation commits independent groups each with exactly one owner', async () => {
  const repository = createGroupRepository();
  const rows = await Promise.all(
    Array.from({ length: 5 }, () => repository.createForOwner(ownerA, group)),
  );
  assert.equal(new Set(rows.map((row) => String(row._id))).size, 5);
  for (const row of await Group.find({})) {
    assert.equal(row.members.length, 1);
    assert.equal(String(row.members[0].user), ownerA);
    assert.equal(row.members[0].role, 'owner');
  }
});
test('real database CAS prevents concurrent metadata loss and persists identifiers and memberships', async () => {
  const repository = createGroupRepository(),
    row = await repository.createForOwner(ownerA, group);
  const results = await Promise.all(
    ['One', 'Two'].map((name) =>
      repository.replaceForOwner(ownerA, String(row._id), 0, { ...group, name }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  const persisted = await repository.findByIdForMember(ownerA, String(row._id));
  assert.equal(persisted.__v, 1);
  assert.equal(persisted.name, results.find(Boolean).name);
  assert.ok(persisted._id instanceof mongoose.Types.ObjectId);
  assert.ok(persisted.members[0].createdAt instanceof Date);
  assert.equal(await repository.findByIdForMember(ownerB, String(row._id)), null);
});
test('real metadata update/deletion leave all personal transactions, budgets and recurring records unchanged', async () => {
  const transaction = await Transaction.create({ ...expense, owner: ownerA });
  const budget = await Budget.create({
    owner: ownerA,
    category: 'food_dining',
    currency: 'INR',
    amountMinor: 50000,
    month: '2026-10',
  });
  // No due processing or financial schema changes are involved in group operations.
  const { recurringRepository } = await import('../src/repositories/recurring.repository.js');
  const schedule = await recurringRepository.createForOwner(ownerA, {
    type: 'expense',
    title: 'Future',
    amountMinor: 100,
    currency: 'INR',
    category: 'food_dining',
    frequency: 'daily',
    startDate: '2030-01-01T00:00:00.000Z',
    status: 'paused',
  });
  const original = [transaction, budget, schedule].map((row) => row.toObject());
  const repository = createGroupRepository(),
    row = await repository.createForOwner(ownerA, group);
  await repository.replaceForOwner(ownerA, String(row._id), 0, { ...group, name: 'Renamed' });
  await repository.deleteForOwner(ownerA, String(row._id));
  const persisted = await Promise.all([
    Transaction.findById(transaction._id),
    Budget.findById(budget._id),
    RecurringSchedule.findById(schedule._id),
  ]);
  assert.deepEqual(
    persisted.map((item) => item.toObject()),
    original,
  );
  assert.equal(await Group.countDocuments({}), 0);
});
