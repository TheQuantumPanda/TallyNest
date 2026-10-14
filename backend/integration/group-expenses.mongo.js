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
import { createInvitationRepository } from '../src/repositories/invitation.repository.js';
import { createMembershipRepository } from '../src/repositories/membership.repository.js';
import { invitationApiSetup, ownerC } from '../tests/helpers/invitation-api.js';
import { ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { createGroupExpenseRepository, ensureGroupExpenseIndexes } from '../src/repositories/group-expense.repository.js';
import { groupExpenseApiContract, expenseInput } from '../tests/helpers/group-expense-api.js';
import { randomUUID } from 'node:crypto';
const database = `tallynest_group_expense_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  await ensureGroupIndexes();
  await ensureGroupExpenseIndexes();
  await Promise.all([User.init(), Transaction.init(), Budget.init(), RecurringSchedule.init()]);
  passwordHash = await hashPassword('disposable group integration password');
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([GroupExpense.deleteMany({}), Group.deleteMany({}), User.deleteMany({}), Transaction.deleteMany({}), Budget.deleteMany({}), RecurringSchedule.deleteMany({})]);
  await User.create([{ _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash }, { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash }, { _id: ownerC, name: 'Owner C', email: 'c@example.test', passwordHash }]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const { databases } = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(databases.some(row => row.name === database), false);
    await mongoose.disconnect(); console.log(`Dropped disposable database: ${database}`);
  }
});
const dependencies = () => ({ groupRepository: createGroupRepository(), invitationRepository: createInvitationRepository(), membershipRepository: createMembershipRepository(), groupExpenseRepository: createGroupExpenseRepository() });
async function setup(t, modify = value => value) {
  const deps = modify(dependencies()), request = await invitationApiSetup(t, deps, userRepository);
  const group = await deps.groupRepository.createForOwner(ownerA, { name: 'Shared' });
  group.members.push({ user: ownerB, role: 'member', createdAt: new Date() }); await group.save();
  return { request, groupId: String(group._id), deps };
}
groupExpenseApiContract(setup);

test('real critical first-expense/deletion and first-expense/removal races have safe outcomes', async t => {
  for (const action of ['delete', 'remove']) for (let i = 0; i < 8; i++) {
    const { request, groupId } = await setup(t), before = await request(`/groups/${groupId}`), base = `/groups/${groupId}/expenses`;
    const [created, destructive] = await Promise.all([
      request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } }),
      request(action === 'delete' ? `/groups/${groupId}` : `/groups/${groupId}/members/${ownerB}`, { method: 'DELETE', headers: { 'If-Match': before.etag } }),
    ]);
    assert.notEqual(created.status === 201 && destructive.status === 200, true);
    const rows = await GroupExpense.find({ group: groupId }), group = await Group.findById(groupId);
    if (rows.length) { assert.ok(group.financialHistoryAt); assert.equal(group.members.some(row => String(row.user) === ownerB), true); assert.equal(destructive.status, 409); }
    else if (action === 'delete' && destructive.status === 200) assert.equal(group, null);
    else if (destructive.status === 200) assert.equal(group.members.some(row => String(row.user) === ownerB), false);
  }
});
test('lock write rechecks required identities, prevents stale destructive writes and survives model edits', async t => {
  const { request, groupId, deps } = await setup(t), before = await deps.groupRepository.findByIdForMember(ownerA, groupId);
  const locked = await deps.groupRepository.lockHistoryForMember(ownerA, groupId, before.__v, [ownerA, ownerB]);
  assert.ok(locked.financialHistoryAt);
  assert.equal(await deps.groupRepository.deleteForOwner(ownerA, groupId), null);
  assert.equal(await deps.membershipRepository.remove(ownerA, groupId, ownerB, before.__v), null);
  assert.equal(await deps.membershipRepository.remove(ownerB, groupId, ownerB, locked.__v, true), null);
  const stamp = locked.financialHistoryAt.toISOString(); locked.financialHistoryAt = undefined; await assert.rejects(locked.save());
  assert.equal((await Group.findById(groupId)).financialHistoryAt.toISOString(), stamp);
  assert.equal((await request(`/groups/${groupId}`, { method: 'PATCH', body: { financialHistoryAt: null }, headers: { 'If-Match': `"tn-${groupId}-v${locked.__v}"` } })).status, 400);
  const second = await setup(t); const old = await second.deps.groupRepository.findByIdForMember(ownerA, second.groupId);
  await second.deps.membershipRepository.remove(ownerA, second.groupId, ownerB, old.__v);
  assert.equal(await second.deps.groupRepository.lockHistoryForMember(ownerA, second.groupId, old.__v, [ownerA, ownerB]), null);
});
test('failed creation after lock and unknown insertion outcomes recover without duplicates or lost history', async t => {
  for (const stage of ['before', 'after']) {
    const { request, groupId } = await setup(t, deps => {
      const create = deps.groupExpenseRepository.create;
      return { ...deps, groupExpenseRepository: { ...deps.groupExpenseRepository, async create(...args) { if (stage === 'after') await create(...args); throw new Error('Injected private financial write failure'); } } };
    });
    const key = randomUUID(), base = `/groups/${groupId}/expenses`;
    const first = await request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } });
    assert.equal(first.status, 500); assert.equal(first.body.stack, undefined); assert.equal(first.body.message, 'Internal server error');
    assert.ok((await Group.findById(groupId)).financialHistoryAt);
    assert.equal(await GroupExpense.countDocuments({ group: groupId }), stage === 'after' ? 1 : 0);
    const fresh = await invitationApiSetup(t, dependencies(), userRepository);
    const recovery = await fresh(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} });
    assert.equal(recovery.status, 200);
    const recovered = await fresh(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } });
    assert.equal(recovered.status, 200); assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
  }
});
test('concurrent idempotent creates on a locked group have one persisted expense and replay safely', async t => {
  const { request, groupId, deps } = await setup(t), group = await deps.groupRepository.findByIdForMember(ownerA, groupId);
  await deps.groupRepository.lockHistoryForMember(ownerA, groupId, group.__v, [ownerA, ownerB]);
  const key = randomUUID(), base = `/groups/${groupId}/expenses`;
  const results = await Promise.all(Array.from({ length: 4 }, () => request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } })));
  assert.equal(results.filter(row => row.status === 201).length, 1); assert.ok(results.every(row => [200, 201, 409].includes(row.status)));
  for (let i = 0; i < 3; i++) assert.equal((await request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } })).status, 200);
  assert.equal(new Set(results.filter(row => row.status !== 409).map(row => row.body.data.expense.id)).size, 1); assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
});
test('real MongoDB financial constraints/indexes reject invalid raw writes and preserve exact maximum amounts', async t => {
  const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`;
  const created = await request(base, { method: 'POST', body: { ...expenseInput, amountMinor: Number.MAX_SAFE_INTEGER, split: { method: 'percentage', participants: [{ user: ownerA, basisPoints: 3333 }, { user: ownerB, basisPoints: 6667 }] } }, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(created.status, 201);
  const stored = await GroupExpense.findById(created.body.data.expense.id), original = stored.toObject();
  assert.equal(stored.amountMinor, Number.MAX_SAFE_INTEGER); assert.equal(stored.shares.reduce((total, row) => total + BigInt(row.amountMinor), 0n), BigInt(Number.MAX_SAFE_INTEGER));
  for (const patch of [{ amountMinor: 0 }, { amountMinor: 1.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { shares: [{ user: new mongoose.Types.ObjectId(ownerA), amountMinor: Number.MAX_SAFE_INTEGER - 1 }] }, { shares: [original.shares[0], original.shares[0]] }, { currency: 'USD' }, { category: 'salary' }, { __v: 0.5 }, { split: { method: 'percentage', participants: [{ user: new mongoose.Types.ObjectId(ownerA), basisPoints: 5000 }] } }]) await assert.rejects(GroupExpense.collection.updateOne({ _id: stored._id }, { $set: patch }), error => error.code === 121);
  assert.deepEqual((await GroupExpense.findById(stored._id)).toObject(), original);
  const indexes = await GroupExpense.collection.indexes();
  assert.ok(indexes.some(index => JSON.stringify(index.key) === JSON.stringify({ group: 1, expenseDate: -1, _id: -1 })));
  assert.ok(indexes.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify({ group: 1, creator: 1, creationKey: 1 })));
  await assert.rejects(GroupExpense.collection.insertOne({ ...original, _id: new mongoose.Types.ObjectId() }), error => error.code === 11000);
});
test('payer and participant identities must be registered current members, not arbitrary valid ObjectIds', async t => {
  const { request, groupId } = await setup(t), group = await Group.findById(groupId);
  const unregistered = new mongoose.Types.ObjectId(); group.members.push({ user: unregistered, role: 'member', createdAt: new Date() }); await group.save();
  const result = await request(`/groups/${groupId}/expenses`, { method: 'POST', body: { ...expenseInput, payer: String(unregistered) }, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(result.status, 400); assert.equal(result.body.code, 'INVALID_MEMBERSHIP'); assert.equal(await GroupExpense.countDocuments({ group: groupId }), 0);
});
test('group expenses never enter personal ledgers, dashboard/budget totals or recurring templates', async t => {
  const transaction = await Transaction.create({ ...expense, owner: ownerA });
  const budget = await Budget.create({ owner: ownerA, category: 'food_dining', currency: 'INR', amountMinor: 50000, month: '2026-10' });
  const { recurringRepository } = await import('../src/repositories/recurring.repository.js');
  const schedule = await recurringRepository.createForOwner(ownerA, { type: 'expense', title: 'Future', amountMinor: 100, currency: 'INR', category: 'food_dining', frequency: 'daily', startDate: '2030-01-01T00:00:00.000Z', status: 'paused' });
  const original = [transaction, budget, schedule].map(row => row.toObject());
  const { request, groupId } = await setup(t), beforeDashboard = await request('/dashboard/summary?period=this_year'), beforeBudgets = await request('/budgets/summary?month=2026-10');
  const created = await request(`/groups/${groupId}/expenses`, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } });
  const row = created.body.data.expense;
  await request(`/groups/${groupId}/expenses/${row.id}`, { method: 'PATCH', body: { amountMinor: 20000 }, headers: { 'If-Match': created.etag } });
  const latest = await request(`/groups/${groupId}/expenses/${row.id}`);
  await request(`/groups/${groupId}/expenses/${row.id}`, { method: 'DELETE', headers: { 'If-Match': latest.etag } });
  assert.deepEqual((await request('/dashboard/summary?period=this_year')).body, beforeDashboard.body);
  assert.deepEqual((await request('/budgets/summary?month=2026-10')).body, beforeBudgets.body);
  assert.deepEqual((await Promise.all([Transaction.findById(transaction._id), Budget.findById(budget._id), RecurringSchedule.findById(schedule._id)])).map(row => row.toObject()), original);
  assert.equal(await Transaction.countDocuments({}), 1); assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
});
