import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { User } from '../src/models/user.model.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { GroupSettlement } from '../src/models/group-settlement.model.js';
import { createGroupRepository, ensureGroupIndexes } from '../src/repositories/group.repository.js';
import {
  createGroupExpenseRepository,
  ensureGroupExpenseIndexes,
} from '../src/repositories/group-expense.repository.js';
import {
  createSettlementRepository,
  ensureSettlementIndexes,
} from '../src/repositories/settlement.repository.js';
import { createGroupBalanceRepository } from '../src/repositories/group-balance.repository.js';
import { createMembershipRepository } from '../src/repositories/membership.repository.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { invitationApiSetup, ownerC } from '../tests/helpers/invitation-api.js';
import { ownerA, ownerB } from '../tests/helpers/transaction-api.js';
import { expenseInput } from '../tests/helpers/group-expense-api.js';
import { settlementApiContract, addExpense, propose } from '../tests/helpers/settlement-api.js';
const database = `tallynest_settlement_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  assert.equal(mongoose.connection.name, database);
  await ensureGroupIndexes();
  await ensureGroupExpenseIndexes();
  await ensureSettlementIndexes();
  await User.init();
  passwordHash = await hashPassword('disposable settlement test password');
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([
    Group.deleteMany({}),
    GroupExpense.deleteMany({}),
    GroupSettlement.deleteMany({}),
    User.deleteMany({}),
  ]);
  await User.create(
    [ownerA, ownerB, ownerC].map((id, index) => ({
      _id: id,
      name: `Account ${index}`,
      email: `${index}@example.test`,
      passwordHash,
    })),
  );
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
const dependencies = () => ({
  groupRepository: createGroupRepository(),
  groupExpenseRepository: createGroupExpenseRepository(),
  settlementRepository: createSettlementRepository(),
  groupBalanceRepository: createGroupBalanceRepository(),
  membershipRepository: createMembershipRepository(),
});
async function setup(t, modify = (value) => value) {
  const deps = modify(dependencies()),
    request = await invitationApiSetup(t, deps, userRepository);
  const group = await deps.groupRepository.createForOwner(ownerA, {
    name: 'Settlement integration',
  });
  group.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await group.save();
  return { request, groupId: String(group._id), deps };
}
settlementApiContract(setup);
function gate() {
  let release, entered;
  const wait = new Promise((resolve) => {
      release = resolve;
    }),
    ready = new Promise((resolve) => {
      entered = resolve;
    });
  return {
    release,
    ready,
    async block() {
      entered();
      await wait;
    },
  };
}
test('expense update/delete and first settlement are serialized, not a lock precheck race', async (t) => {
  for (const method of ['PATCH', 'DELETE']) {
    const pause = gate();
    let armed = false;
    const { request, groupId } = await setup(t, (deps) => ({
      ...deps,
      groupExpenseRepository: {
        ...deps.groupExpenseRepository,
        async replace(...args) {
          if (armed) await pause.block();
          return deps.groupExpenseRepository.replace(...args);
        },
        async remove(...args) {
          if (armed) await pause.block();
          return deps.groupExpenseRepository.remove(...args);
        },
      },
    }));
    const created = await addExpense(request, groupId);
    armed = true;
    const writing = request(`/groups/${groupId}/expenses/${created.body.data.expense.id}`, {
      method,
      ...(method === 'PATCH' ? { body: { amountMinor: 6000 } } : {}),
      headers: { 'If-Match': created.etag },
    });
    await pause.ready;
    assert.equal((await propose(request, groupId, 2000)).body.code, 'FINANCIAL_BUSY');
    assert.equal((await request(`/groups/${groupId}/balances`)).body.code, 'FINANCIAL_BUSY');
    pause.release();
    assert.equal((await writing).status, 200);
    const settlement = await propose(request, groupId, 2000);
    assert.equal(settlement.status, method === 'PATCH' ? 201 : 409);
    const stored = await GroupExpense.findById(created.body.data.expense.id);
    assert.equal(
      method === 'PATCH' ? stored.amountMinor : !!stored.deletedAt,
      method === 'PATCH' ? 6000 : true,
    );
  }
});
test('first settlement reservation fences expense creation/update/delete before mode is established', async (t) => {
  const pause = gate();
  let armed = false;
  const { request, groupId } = await setup(t, (deps) => ({
    ...deps,
    groupRepository: {
      ...deps.groupRepository,
      async beginSettlementMode(...args) {
        if (armed) await pause.block();
        return deps.groupRepository.beginSettlementMode(...args);
      },
    },
  }));
  const created = await addExpense(request, groupId);
  armed = true;
  const pending = propose(request, groupId, 5000);
  await pause.ready;
  const group = await Group.findById(groupId);
  assert.ok(group.financialOperation);
  assert.equal(group.settlementStartedAt, undefined);
  for (const [method, suffix, body] of [
    ['POST', '', expenseInput],
    ['PATCH', '/' + created.body.data.expense.id, { amountMinor: 20000 }],
    ['DELETE', '/' + created.body.data.expense.id],
  ]) {
    const result = await request(`/groups/${groupId}/expenses${suffix}`, {
      method,
      body,
      headers: { 'If-Match': created.etag, 'Idempotency-Key': randomUUID() },
    });
    assert.equal(result.body.code, 'FINANCIAL_BUSY');
  }
  pause.release();
  assert.equal((await pending).status, 201);
  assert.equal((await GroupExpense.findById(created.body.data.expense.id)).amountMinor, 10000);
  assert.equal(
    (
      await request(`/groups/${groupId}/expenses/${created.body.data.expense.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': created.etag },
      })
    ).body.code,
    'EXPENSES_FROZEN',
  );
});
test('a delayed original expense worker cannot rewrite settled history after concurrent recovery', async (t) => {
  const pause = gate();
  let armed = false;
  const { request, groupId } = await setup(t, (deps) => ({
    ...deps,
    groupExpenseRepository: {
      ...deps.groupExpenseRepository,
      async replace(...args) {
        if (armed) await pause.block();
        return deps.groupExpenseRepository.replace(...args);
      },
    },
  }));
  const created = await addExpense(request, groupId);
  armed = true;
  const delayed = request(`/groups/${groupId}/expenses/${created.body.data.expense.id}`, {
    method: 'PATCH',
    body: { amountMinor: 6000 },
    headers: { 'If-Match': created.etag },
  });
  await pause.ready;
  const fresh = await invitationApiSetup(t, dependencies(), userRepository);
  const recovered = await fresh(`/groups/${groupId}/financial-recovery`, {
    method: 'POST',
    body: {},
  });
  assert.equal(recovered.status, 200);
  const proposal = await propose(fresh, groupId, 3000);
  assert.equal(proposal.status, 201);
  assert.equal(
    (
      await fresh(`/groups/${groupId}/settlements/${proposal.body.data.settlement.id}/confirm`, {
        method: 'POST',
        body: {},
        headers: { 'If-Match': proposal.etag },
      })
    ).status,
    200,
  );
  pause.release();
  assert.equal((await delayed).status, 200);
  const row = await GroupExpense.findById(created.body.data.expense.id);
  assert.equal(row.amountMinor, 6000);
  assert.equal(row.__v, 1);
  assert.deepEqual(
    (await fresh(`/groups/${groupId}/balances`)).body.data.balances.members.map(
      (row) => row.netMinor,
    ),
    [0, 0],
  );
});
test('crashes before/after settlement insert and during mode/release recover durably without duplicate effects', async (t) => {
  for (const stage of [
    'reservation',
    'before_mode',
    'mode',
    'before_insert',
    'after_insert',
    'release',
  ]) {
    let armed = false;
    const { request, groupId } = await setup(t, (deps) => ({
      ...deps,
      groupRepository: {
        ...deps.groupRepository,
        async reserveFinancial(...args) {
          const row = await deps.groupRepository.reserveFinancial(...args);
          if (armed && stage === 'reservation') throw new Error('private failure');
          return row;
        },
        async beginSettlementMode(...args) {
          if (armed && stage === 'before_mode') throw new Error('private failure');
          const row = await deps.groupRepository.beginSettlementMode(...args);
          if (armed && stage === 'mode') throw new Error('private failure');
          return row;
        },
        async finishFinancial(...args) {
          if (armed && stage === 'release') throw new Error('private failure');
          return deps.groupRepository.finishFinancial(...args);
        },
      },
      settlementRepository: {
        ...deps.settlementRepository,
        async create(...args) {
          if (armed && stage === 'before_insert') throw new Error('private failure');
          const row = await deps.settlementRepository.create(...args);
          if (armed && stage === 'after_insert') throw new Error('private failure');
          return row;
        },
      },
    }));
    await addExpense(request, groupId);
    armed = true;
    const key = randomUUID(),
      failed = await propose(request, groupId, 3000, { 'Idempotency-Key': key });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.message, 'Internal server error');
    const group = await Group.findById(groupId);
    assert.ok(group.financialOperation);
    assert.equal(!!group.settlementStartedAt, !['reservation', 'before_mode'].includes(stage));
    const fresh = await invitationApiSetup(t, dependencies(), userRepository);
    const recovery = await Promise.all(
      Array.from({ length: 3 }, () =>
        fresh(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} }),
      ),
    );
    assert.ok(recovery.every((row) => row.status === 200));
    assert.equal(await GroupSettlement.countDocuments({ group: groupId }), 1);
    assert.equal((await propose(fresh, groupId, 3000, { 'Idempotency-Key': key })).status, 200);
    assert.equal((await Group.findById(groupId)).financialOperation, undefined);
    assert.deepEqual(
      (await fresh(`/groups/${groupId}/balances`)).body.data.balances.members.map(
        (row) => row.netMinor,
      ),
      [5000, -5000],
    );
  }
});
test('unknown confirmation outcome recovers one terminal record; confirmation never creates personal finances', async (t) => {
  let armed = false;
  const { request, groupId } = await setup(t, (deps) => ({
    ...deps,
    settlementRepository: {
      ...deps.settlementRepository,
      async decide(...args) {
        const row = await deps.settlementRepository.decide(...args);
        if (armed) throw new Error('private interrupted decision');
        return row;
      },
    },
  }));
  await addExpense(request, groupId);
  const proposal = await propose(request, groupId);
  armed = true;
  const result = await request(
    `/groups/${groupId}/settlements/${proposal.body.data.settlement.id}/confirm`,
    { method: 'POST', body: {}, headers: { 'If-Match': proposal.etag } },
  );
  assert.equal(result.status, 500);
  const fresh = await invitationApiSetup(t, dependencies(), userRepository);
  assert.equal(
    (await fresh(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} })).status,
    200,
  );
  const stored = await GroupSettlement.findById(proposal.body.data.settlement.id);
  assert.equal(stored.__v, 1);
  assert.equal(stored.status, 'confirmed');
  assert.equal(await GroupSettlement.countDocuments({ group: groupId }), 1);
  assert.deepEqual(
    (await fresh(`/groups/${groupId}/balances`)).body.data.balances.members.map(
      (row) => row.netMinor,
    ),
    [0, 0],
  );
  for (const name of ['transactions', 'budgets', 'recurringschedules'])
    assert.equal(await mongoose.connection.db.collection(name).countDocuments({}), 0);
});
test('maximum integer balances are exact; corrupt records and aggregate overflow fail closed', async (t) => {
  const { request, groupId } = await setup(t);
  const created = await addExpense(request, groupId, {
    ...expenseInput,
    amountMinor: Number.MAX_SAFE_INTEGER,
    split: { method: 'equal', participants: [ownerB] },
  });
  const balanced = await request(`/groups/${groupId}/balances`);
  assert.equal(balanced.status, 200);
  assert.deepEqual(
    balanced.body.data.balances.members.map((row) => row.netMinor),
    [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
  );
  const confirmed = await propose(request, groupId, Number.MAX_SAFE_INTEGER);
  assert.equal(confirmed.status, 201);
  assert.equal(
    (
      await request(`/groups/${groupId}/settlements/${confirmed.body.data.settlement.id}/confirm`, {
        method: 'POST',
        body: {},
        headers: { 'If-Match': confirmed.etag },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await request(`/groups/${groupId}/balances`)).body.data.balances.members.map(
      (row) => row.netMinor,
    ),
    [0, 0],
  );
  const raw = (await GroupExpense.findById(created.body.data.expense.id)).toObject();
  for (const patch of [
    { amountMinor: 1.5 },
    { deletedAt: 'invalid tombstone' },
    { currency: 'USD' },
    { payer: new mongoose.Types.ObjectId(ownerC) },
    { shares: [{ user: new mongoose.Types.ObjectId(ownerB), amountMinor: 1 }] },
  ]) {
    await GroupExpense.collection.updateOne(
      { _id: raw._id },
      { $set: patch },
      { bypassDocumentValidation: true },
    );
    const failed = await request(`/groups/${groupId}/balances`);
    assert.equal(failed.status, 422, JSON.stringify(failed.body));
    assert.equal(failed.body.data, undefined);
    await GroupExpense.collection.replaceOne({ _id: raw._id }, raw);
  }
  const second = await setup(t);
  await addExpense(second.request, second.groupId, {
    ...expenseInput,
    amountMinor: Number.MAX_SAFE_INTEGER,
  });
  await addExpense(second.request, second.groupId);
  assert.equal(
    (await second.request(`/groups/${second.groupId}/balances`)).body.code,
    'BALANCE_OVERFLOW',
  );
});
test('MongoDB indexes, immutable audit shape, tombstone receipts and membership locks remain enforced', async (t) => {
  const { request, groupId } = await setup(t);
  const tombstone = await addExpense(request, groupId);
  assert.equal(
    (
      await request(`/groups/${groupId}/expenses/${tombstone.body.data.expense.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': tombstone.etag },
      })
    ).status,
    200,
  );
  await addExpense(request, groupId);
  const created = await propose(request, groupId),
    row = await GroupSettlement.findById(created.body.data.settlement.id);
  const indexes = await GroupSettlement.collection.indexes();
  assert.ok(
    indexes.some(
      (row) =>
        row.unique &&
        JSON.stringify(row.key) === JSON.stringify({ group: 1, sender: 1, creationKey: 1 }),
    ),
  );
  assert.ok(
    indexes.some((row) => JSON.stringify(row.key) === JSON.stringify({ group: 1, _id: -1 })),
  );
  await assert.rejects(
    GroupSettlement.collection.insertOne({ ...row.toObject(), _id: new mongoose.Types.ObjectId() }),
    (error) => error.code === 11000,
  );
  for (const patch of [
    { amountMinor: 0 },
    { amountMinor: 1.5 },
    { status: 'confirmed' },
    { recipient: row.sender },
    { __v: 1 },
    { decisionBy: row.sender },
  ])
    await assert.rejects(
      GroupSettlement.collection.updateOne({ _id: row._id }, { $set: patch }),
      (error) => error.code === 121,
    );
  assert.equal(
    (await request(`/groups/${groupId}`, { method: 'DELETE' })).body.code,
    'FINANCIAL_HISTORY_LOCKED',
  );
  assert.equal(
    (
      await request(`/groups/${groupId}/leave`, {
        method: 'POST',
        user: ownerB,
        body: {},
        headers: { 'If-Match': (await request(`/groups/${groupId}`)).etag },
      })
    ).body.code,
    'FINANCIAL_HISTORY_LOCKED',
  );
  assert.ok((await GroupExpense.findById(tombstone.body.data.expense.id)).deletedAt);
  assert.equal(await GroupExpense.countDocuments({ group: groupId }), 2);
  const current = await Group.findById(groupId);
  const stamp = current.settlementStartedAt.toISOString();
  current.settlementStartedAt = undefined;
  await assert.rejects(current.save());
  assert.equal((await Group.findById(groupId)).settlementStartedAt.toISOString(), stamp);
});
test('three-member paise remainders and competing creditors/debtors reconcile through confirmations', async (t) => {
  const { request, groupId } = await setup(t);
  const group = await Group.findById(groupId);
  group.members.push({ user: ownerC, role: 'member', createdAt: new Date() });
  await group.save();
  await addExpense(request, groupId, {
    ...expenseInput,
    amountMinor: 10001,
    split: { method: 'equal', participants: [ownerC, ownerB, ownerA] },
  });
  const initial = (await request(`/groups/${groupId}/balances`)).body.data.balances;
  assert.deepEqual(
    initial.members.map((row) => row.netMinor),
    [6667, -3334, -3333],
  );
  for (const [sender, amountMinor] of [
    [ownerB, 3334],
    [ownerC, 3333],
  ]) {
    const proposed = await request(`/groups/${groupId}/settlements`, {
      method: 'POST',
      user: sender,
      body: { recipient: ownerA, amountMinor },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    assert.equal(proposed.status, 201);
    const confirmed = await request(
      `/groups/${groupId}/settlements/${proposed.body.data.settlement.id}/confirm`,
      { method: 'POST', body: {}, headers: { 'If-Match': proposed.etag } },
    );
    assert.equal(confirmed.status, 200);
  }
  const final = (await request(`/groups/${groupId}/balances`)).body.data.balances;
  assert.deepEqual(
    final.members.map((row) => row.netMinor),
    [0, 0, 0],
  );
  assert.deepEqual(final.suggestions, []);
});
test('corrupt settlement records never produce partial balances or get confirmed', async (t) => {
  const { request, groupId } = await setup(t);
  await addExpense(request, groupId);
  const created = await propose(request, groupId, 1000);
  const raw = (await GroupSettlement.findById(created.body.data.settlement.id)).toObject();
  for (const patch of [
    { amountMinor: 1.5 },
    { amountMinor: 6000 },
    { recipient: new mongoose.Types.ObjectId(ownerC) },
    { status: 'confirmed' },
    { currency: 'USD' },
    { sender: raw.recipient },
  ]) {
    await GroupSettlement.collection.updateOne(
      { _id: raw._id },
      { $set: patch },
      { bypassDocumentValidation: true },
    );
    const failed = await request(`/groups/${groupId}/balances`);
    assert.equal(failed.status, 422);
    assert.equal(failed.body.data, undefined);
    assert.equal(failed.body.stack, undefined);
    await GroupSettlement.collection.replaceOne({ _id: raw._id }, raw);
  }
  // Confirmation validates authoritative balances again, not a previously read suggestion.
  const expense = await GroupExpense.findOne({ group: groupId });
  await GroupExpense.collection.updateOne(
    { _id: expense._id },
    { $set: { amountMinor: 1.5 } },
    { bypassDocumentValidation: true },
  );
  const result = await request(`/groups/${groupId}/settlements/${raw._id}/confirm`, {
    method: 'POST',
    body: {},
    headers: { 'If-Match': created.etag },
  });
  assert.equal(result.status, 422);
  assert.equal((await GroupSettlement.findById(raw._id)).status, 'pending');
});
test('delayed create after recovery and deletion cannot resurrect a tombstoned idempotency receipt', async (t) => {
  const pause = gate();
  const { request, groupId } = await setup(t, (deps) => ({
    ...deps,
    groupExpenseRepository: {
      ...deps.groupExpenseRepository,
      async create(...args) {
        await pause.block();
        return deps.groupExpenseRepository.create(...args);
      },
    },
  }));
  const key = randomUUID(),
    delayed = request(`/groups/${groupId}/expenses`, {
      method: 'POST',
      body: expenseInput,
      headers: { 'Idempotency-Key': key },
    });
  await pause.ready;
  const fresh = await invitationApiSetup(t, dependencies(), userRepository);
  assert.equal(
    (await fresh(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} })).status,
    200,
  );
  const created = await fresh(`/groups/${groupId}/expenses`, {
    method: 'POST',
    body: expenseInput,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(created.status, 200);
  assert.equal(
    (
      await fresh(`/groups/${groupId}/expenses/${created.body.data.expense.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': created.etag },
      })
    ).status,
    200,
  );
  pause.release();
  assert.equal((await delayed).body.code, 'EXPENSE_DELETED');
  assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
  assert.equal((await fresh(`/groups/${groupId}/expenses`)).body.data.expenses.length, 0);
});
test('a stale preflight receipt cannot bypass different-payload idempotency conflicts', async (t) => {
  const pause = gate();
  let hold = false;
  const { request, groupId } = await setup(t, (deps) => ({
    ...deps,
    settlementRepository: {
      ...deps.settlementRepository,
      async receipt(...args) {
        const old = await deps.settlementRepository.receipt(...args);
        if (hold) {
          hold = false;
          await pause.block();
        }
        return old;
      },
    },
  }));
  await addExpense(request, groupId);
  hold = true;
  const key = randomUUID();
  const delayed = propose(request, groupId, 3000, { 'Idempotency-Key': key });
  await pause.ready;
  const first = await propose(request, groupId, 2000, { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  pause.release();
  const conflicting = await delayed;
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.code, 'IDEMPOTENCY_CONFLICT');
  const rows = await GroupSettlement.find({ group: groupId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountMinor, 2000);
  assert.equal((await Group.findById(groupId)).financialOperation, undefined);
});
