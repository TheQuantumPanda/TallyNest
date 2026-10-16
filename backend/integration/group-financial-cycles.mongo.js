import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { Group, groupCollectionValidator } from '../src/models/group.model.js';
import {
  GroupExpense,
  groupExpenseCollectionValidator,
} from '../src/models/group-expense.model.js';
import {
  GroupSettlement,
  settlementCollectionValidator,
} from '../src/models/group-settlement.model.js';
import { createGroupRepository, ensureGroupIndexes } from '../src/repositories/group.repository.js';
import { ensureGroupFinancialCycleIndexes } from '../src/repositories/group-financial-cycle.repository.js';
import { ensureGroupExpenseIndexes } from '../src/repositories/group-expense.repository.js';
import { ensureSettlementIndexes } from '../src/repositories/settlement.repository.js';
import { createGroupExpenseRepository } from '../src/repositories/group-expense.repository.js';
import { createSettlementRepository } from '../src/repositories/settlement.repository.js';
import { createMembershipRepository } from '../src/repositories/membership.repository.js';
import { createGroupBalanceRepository } from '../src/repositories/group-balance.repository.js';
import { calculateBalances } from '../src/utils/group-balances.js';
import { publicExpense } from '../src/services/group-expense.service.js';
import { publicSettlement } from '../src/services/settlement.service.js';
import { cycleBelongsToGroup } from '../src/utils/group-financial-cycle.js';
import { toPublicGroup } from '../src/services/group.service.js';
import { ownerA, ownerB } from '../tests/helpers/transaction-api.js';

const database = `tallynest_cycle_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const operation = () => new mongoose.Types.ObjectId();
const openedAt = new Date('2026-10-01T00:00:00.000Z');
const frozenAt = new Date('2026-10-02T00:00:00.000Z');
const closedAt = new Date('2026-10-03T00:00:00.000Z');
let groupA, groupB;
const cycle = (group, fields = {}) => ({
  group: group._id,
  sequence: 1,
  currency: 'INR',
  status: 'open',
  activeSlot: true,
  memberIds: [new mongoose.Types.ObjectId(ownerA)],
  openedAt,
  openOperationId: operation(),
  ...fields,
});
const raw = (value) => ({
  ...value,
  _id: operation(),
  createdAt: openedAt,
  updatedAt: closedAt,
  __v: 0,
});

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  assert.equal(mongoose.connection.name, database);
  await ensureGroupIndexes();
  await ensureGroupFinancialCycleIndexes();
  await ensureGroupExpenseIndexes();
  await ensureSettlementIndexes();
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([
    GroupFinancialCycle.deleteMany({}),
    Group.deleteMany({}),
    GroupExpense.deleteMany({}),
    GroupSettlement.deleteMany({}),
  ]);
  const repository = createGroupRepository();
  groupA = await repository.createForOwner(ownerA, { name: 'Cycle fixture A' });
  groupB = await repository.createForOwner(ownerB, { name: 'Cycle fixture B' });
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

test('cycle indexes and strict validator install idempotently on MongoDB 8.0', async () => {
  await ensureGroupFinancialCycleIndexes();
  const indexes = await GroupFinancialCycle.collection.indexes();
  assert.ok(indexes.some((row) => row.unique && row.key.group === 1 && row.key.sequence === 1));
  assert.ok(
    indexes.some(
      (row) =>
        row.unique && row.key.group === 1 && row.partialFilterExpression?.activeSlot === true,
    ),
  );
  assert.ok(
    indexes.some((row) => row.key.group === 1 && row.key.sequence === -1 && row.key._id === -1),
  );
  const collection = (
    await mongoose.connection.db
      .listCollections({ name: GroupFinancialCycle.collection.name })
      .toArray()
  )[0];
  assert.equal(collection.options.validationLevel, 'strict');
  assert.equal(collection.options.validationAction, 'error');
  await ensureGroupFinancialCycleIndexes();
  assert.equal((await GroupFinancialCycle.collection.indexes()).length, indexes.length);
});

test('unique active slot, group sequence and closed history are enforced by MongoDB', async () => {
  const first = await GroupFinancialCycle.create(cycle(groupA));
  await assert.rejects(
    GroupFinancialCycle.create(cycle(groupA, { sequence: 1 })),
    (e) => e.code === 11000,
  );
  await assert.rejects(
    GroupFinancialCycle.create(
      cycle(groupA, {
        sequence: 2,
        previousCycleId: first._id,
      }),
    ),
    (e) => e.code === 11000,
  );
  const other = await GroupFinancialCycle.create(
    cycle(groupB, { memberIds: [new mongoose.Types.ObjectId(ownerB)] }),
  );
  assert.equal(cycleBelongsToGroup(other, String(groupA._id)), false);
  assert.equal((await GroupFinancialCycle.find({ group: groupA._id })).length, 1);
  await GroupFinancialCycle.collection.updateOne(
    { _id: first._id },
    {
      $set: {
        status: 'closed',
        frozenAt,
        closedAt,
        freezeOperationId: operation(),
        closeOperationId: operation(),
      },
      $unset: { activeSlot: '' },
    },
  );
  const second = await GroupFinancialCycle.create(
    cycle(groupA, {
      sequence: 2,
      previousCycleId: first._id,
    }),
  );
  await GroupFinancialCycle.collection.updateOne(
    { _id: second._id },
    {
      $set: {
        status: 'closed',
        frozenAt,
        closedAt,
        freezeOperationId: operation(),
        closeOperationId: operation(),
      },
      $unset: { activeSlot: '' },
    },
  );
  await GroupFinancialCycle.create(cycle(groupA, { sequence: 3, previousCycleId: second._id }));
  assert.equal(
    await GroupFinancialCycle.countDocuments({ group: groupA._id, status: 'closed' }),
    2,
  );
});

test('raw MongoDB validator rejects malformed cycle state, sequence, members and versions', async () => {
  const good = raw(cycle(groupA));
  await GroupFinancialCycle.collection.insertOne(good);
  for (const change of [
    { status: 'invalid' },
    { status: 'closed' },
    { activeSlot: false },
    { sequence: 0 },
    { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { previousCycleId: operation() },
    { memberIds: [] },
    { memberIds: [good.memberIds[0], good.memberIds[0]] },
    { memberIds: [new mongoose.Types.ObjectId(ownerB), good.memberIds[0]] },
    { __v: -1 },
    { __v: 0.5 },
    { currency: 'USD' },
    { unknown: true },
  ])
    await assert.rejects(
      GroupFinancialCycle.collection.insertOne({ ...good, ...change, _id: operation() }),
      (e) => e.code === 121,
    );
  await assert.rejects(
    GroupFinancialCycle.collection.updateOne({ _id: good._id }, { $set: { status: 'frozen' } }),
    (e) => e.code === 121,
  );
});

test('Mongoose preserves immutable cycle association and member snapshot', async () => {
  const row = await GroupFinancialCycle.create(cycle(groupA));
  const originalOperationId = String(row.openOperationId);
  assert.throws(() => row.memberIds.push(new mongoose.Types.ObjectId(ownerB)));
  row.group = groupB._id;
  row.sequence = 2;
  row.memberIds = [new mongoose.Types.ObjectId(ownerB)];
  row.openOperationId = operation();
  await assert.rejects(row.save(), (e) =>
    ['group', 'sequence', 'memberIds', 'openOperationId'].every((key) => e.errors?.[key]),
  );
  const saved = await GroupFinancialCycle.findById(row._id);
  assert.equal(String(saved.group), String(groupA._id));
  assert.equal(saved.sequence, 1);
  assert.deepEqual(saved.memberIds.map(String), [ownerA]);
  assert.equal(String(saved.openOperationId), originalOperationId);
  assert.equal(await GroupFinancialCycle.countDocuments({ group: groupB._id }), 0);
});

test('legacy group and financial validators allow absent cycle fields but reject malformed optional associations', async () => {
  const original = await Group.findById(groupA._id);
  assert.equal(original.currentCycleId, undefined);
  assert.equal(original.financialProtocolVersion, undefined);
  await original.validate();
  await Group.collection.updateOne(
    { _id: groupA._id },
    { $set: { financialHistoryAt: openedAt, settlementStartedAt: frozenAt } },
  );
  const frozen = await Group.findById(groupA._id);
  await frozen.validate();
  assert.equal(frozen.currentCycleId, undefined);
  assert.equal(groupCollectionValidator.$and.length > 0, true);
  await Group.collection.updateOne(
    { _id: groupB._id },
    {
      $set: {
        currentCycleId: operation(),
        cycleEpoch: 0,
        currentCycleState: 'open',
        financialProtocolVersion: 2,
      },
    },
  );
  assert.equal(toPublicGroup(await Group.findById(groupB._id), ownerB).currentCycleId, undefined);
  for (const value of [
    { cycleEpoch: 0.5 },
    { financialProtocolVersion: 1 },
    { currentCycleState: 'reset' },
  ])
    await assert.rejects(
      Group.collection.updateOne({ _id: groupA._id }, { $set: value }),
      (e) => e.code === 121,
    );
  const reserved = await createGroupRepository().reserveFinancial(
    ownerA,
    String(groupA._id),
    frozen.__v,
    {
      _id: operation(),
      actor: ownerA,
      kind: 'expense_create',
      payload: {},
      createdAt: new Date(),
    },
  );
  assert.equal(reserved, null, 'global settlement freeze still blocks expense reservation');
  assert.equal(
    await createMembershipRepository().remove(ownerA, String(groupA._id), ownerB, frozen.__v),
    null,
  );
  assert.ok(groupExpenseCollectionValidator.$and);
  assert.ok(settlementCollectionValidator.$and);
  for (const model of [GroupExpense, GroupSettlement]) {
    const collection = (
      await mongoose.connection.db.listCollections({ name: model.collection.name }).toArray()
    )[0];
    assert.equal(collection.options.validationAction, 'error');
    assert.equal(collection.options.validationLevel, 'strict');
  }
});

test('legacy expense, receipt, tombstone, settlement and balance behavior remain unchanged', async () => {
  groupA.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await groupA.save();
  const expenseRepository = createGroupExpenseRepository();
  const input = {
    payer: ownerA,
    title: 'Legacy shared lunch',
    amountMinor: 101,
    currency: 'INR',
    category: 'food_dining',
    expenseDate: '2026-10-01T12:00:00.000Z',
    split: { method: 'equal', participants: [ownerA, ownerB] },
  };
  const key = 'a'.repeat(64);
  const expense = await expenseRepository.create(
    String(groupA._id),
    ownerA,
    input,
    key,
    'b'.repeat(64),
    String(operation()),
    String(operation()),
  );
  assert.equal(expense.cycleId, undefined);
  assert.equal(publicExpense(expense).cycleId, undefined);
  assert.equal(
    (await expenseRepository.findReceipt(String(groupA._id), ownerA, key)).id,
    expense.id,
  );
  await assert.rejects(
    expenseRepository.create(
      String(groupA._id),
      ownerA,
      input,
      key,
      'b'.repeat(64),
      String(operation()),
      String(operation()),
    ),
    (e) => e.code === 11000,
  );
  const settlement = await createSettlementRepository().create(String(groupA._id), {
    _id: operation(),
    actor: ownerB,
    createdAt: new Date(),
    payload: {
      targetId: String(operation()),
      recipient: ownerA,
      amountMinor: 50,
      key: 'c'.repeat(64),
      hash: 'd'.repeat(64),
    },
  });
  assert.equal(settlement.cycleId, undefined);
  assert.equal(publicSettlement(settlement).cycleId, undefined);
  assert.equal(
    (await createSettlementRepository().receipt(String(groupA._id), ownerB, 'c'.repeat(64))).id,
    settlement.id,
  );
  const memberIds = [ownerA, ownerB];
  const before = calculateBalances(
    memberIds,
    await createGroupBalanceRepository().aggregate(String(groupA._id), memberIds),
  );
  assert.equal(before.find((row) => row.user === ownerA)?.paid, 101n);
  await GroupSettlement.collection.updateOne(
    { _id: settlement._id },
    {
      $set: {
        status: 'rejected',
        rejectedAt: new Date(),
        decisionBy: new mongoose.Types.ObjectId(ownerA),
        lastFinancialOperation: operation(),
        __v: 1,
      },
    },
  );
  await GroupExpense.collection.updateOne(
    { _id: expense._id },
    { $set: { deletedAt: new Date() } },
  );
  assert.equal(
    (await expenseRepository.findReceipt(String(groupA._id), ownerA, key)).id,
    expense.id,
  );
  assert.equal(await expenseRepository.find(String(groupA._id), String(expense._id)), null);
  const after = calculateBalances(
    memberIds,
    await createGroupBalanceRepository().aggregate(String(groupA._id), memberIds),
  );
  assert.equal(after.find((row) => row.user === ownerA)?.paid, 0n);
  const candidateCycleId = operation();
  await GroupExpense.collection.updateOne(
    { _id: expense._id },
    { $set: { cycleId: candidateCycleId } },
  );
  await GroupSettlement.collection.updateOne(
    { _id: settlement._id },
    { $set: { cycleId: candidateCycleId } },
  );
  assert.equal(publicExpense(await GroupExpense.findById(expense._id)).cycleId, undefined);
  assert.equal(publicSettlement(await GroupSettlement.findById(settlement._id)).cycleId, undefined);
  await assert.rejects(
    GroupExpense.collection.updateOne({ _id: expense._id }, { $set: { cycleId: 'bad' } }),
    (e) => e.code === 121,
  );
  await assert.rejects(
    GroupSettlement.collection.updateOne({ _id: settlement._id }, { $set: { cycleId: 'bad' } }),
    (e) => e.code === 121,
  );
});
