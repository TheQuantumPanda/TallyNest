import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { GroupSettlement } from '../src/models/group-settlement.model.js';
import { createGroupRepository, ensureGroupIndexes } from '../src/repositories/group.repository.js';
import {
  createGroupFinancialCycleRepository,
  ensureGroupFinancialCycleIndexes,
} from '../src/repositories/group-financial-cycle.repository.js';
import {
  createGroupExpenseRepository,
  ensureGroupExpenseIndexes,
} from '../src/repositories/group-expense.repository.js';
import {
  createSettlementRepository,
  ensureSettlementIndexes,
} from '../src/repositories/settlement.repository.js';
import { createGroupBalanceRepository } from '../src/repositories/group-balance.repository.js';
import { createCycleFinancialService } from '../src/services/cycle-financial.service.js';
import { createGroupFinancialService } from '../src/services/group-financial.service.js';
import { createGroupExpenseService } from '../src/services/group-expense.service.js';
import { createSettlementService } from '../src/services/settlement.service.js';
import { ownerA, ownerB } from '../tests/helpers/transaction-api.js';

const database = `tallynest_cycle_write_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const oid = () => new mongoose.Types.ObjectId();
const groupId = (value) => String(value._id);
const input = (
  amountMinor = 10000,
  split = { method: 'equal', participants: [ownerA, ownerB] },
) => ({
  payer: ownerA,
  title: 'Cycle expense',
  amountMinor,
  currency: 'INR',
  category: 'food_dining',
  expenseDate: '2026-10-01T12:00:00.000Z',
  split,
});
let group, cycle;
function service(extra = {}) {
  return createCycleFinancialService({ internalEnabled: true, ...extra });
}
function gate(stage) {
  let release,
    entered,
    armed = true;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  return {
    ready,
    release,
    async fault(at) {
      if (armed && at === stage) {
        armed = false;
        entered();
        await waiting;
      }
    },
  };
}
async function independentWorker(fault) {
  const connection = await mongoose
    .createConnection(`mongodb://127.0.0.1:27017/${database}`)
    .asPromise();
  const G = connection.model('Group', Group.schema);
  const C = connection.model('GroupFinancialCycle', GroupFinancialCycle.schema);
  const E = connection.model('GroupExpense', GroupExpense.schema);
  const S = connection.model('GroupSettlement', GroupSettlement.schema);
  return {
    connection,
    api: service({
      groups: createGroupRepository(G),
      cycles: createGroupFinancialCycleRepository(C),
      expenses: createGroupExpenseRepository(E),
      settlements: createSettlementRepository(S),
      balances: createGroupBalanceRepository(E, S),
      ...(fault ? { fault } : {}),
    }),
  };
}
async function fixture() {
  group = await createGroupRepository().createForOwner(ownerA, { name: 'Internal cycle fixture' });
  group.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await group.save();
  cycle = await GroupFinancialCycle.create({
    group: group._id,
    sequence: 1,
    currency: 'INR',
    status: 'open',
    activeSlot: true,
    memberIds: [ownerA, ownerB].sort(),
    openedAt: new Date(),
    openOperationId: oid(),
  });
  await Group.collection.updateOne(
    { _id: group._id },
    {
      $set: {
        financialHistoryAt: new Date(),
        financialProtocolVersion: 2,
        currentCycleId: cycle._id,
        cycleEpoch: 1,
        currentCycleState: 'open',
      },
    },
  );
  group = await Group.findById(group._id);
}
async function nextCycleFixture() {
  const now = new Date();
  await GroupFinancialCycle.collection.updateOne(
    { _id: cycle._id },
    {
      $set: {
        status: 'closed',
        frozenAt: now,
        closedAt: now,
        freezeOperationId: oid(),
        closeOperationId: oid(),
      },
      $unset: { activeSlot: '' },
      $inc: { __v: 1 },
    },
  );
  const next = await GroupFinancialCycle.create({
    group: group._id,
    sequence: 2,
    previousCycleId: cycle._id,
    currency: 'INR',
    status: 'open',
    activeSlot: true,
    memberIds: [ownerA, ownerB].sort(),
    openedAt: new Date(),
    openOperationId: oid(),
  });
  await Group.collection.updateOne(
    { _id: group._id, financialOperation: { $exists: false } },
    {
      $set: { currentCycleId: next._id, cycleEpoch: 2, currentCycleState: 'open' },
      $inc: { __v: 1 },
    },
  );
  return next;
}
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
    Group.deleteMany({}),
    GroupFinancialCycle.deleteMany({}),
    GroupExpense.deleteMany({}),
    GroupSettlement.deleteMany({}),
  ]);
  await fixture();
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

test('internal gate is disabled by default and legacy reservations cannot target a version-2 group', async () => {
  await assert.rejects(
    createCycleFinancialService().run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'expense_create',
      {},
    ),
    (e) => e.code === 'CYCLE_PROTOCOL_INACTIVE',
  );
  await assert.rejects(
    createGroupFinancialService().run(ownerA, groupId(group), 'expense_create', {}),
    (e) => e.code === 'CYCLE_PROTOCOL_INACTIVE',
  );
  assert.equal(
    await createGroupRepository().reserveFinancial(ownerA, groupId(group), group.__v, {
      _id: oid(),
      actor: ownerA,
      kind: 'expense_create',
      payload: {},
      createdAt: new Date(),
    }),
    null,
  );
  assert.equal(await GroupExpense.countDocuments({}), 0);
  await assert.rejects(
    createGroupExpenseService().create(ownerA, groupId(group), input(), randomUUID()),
    (e) => e.code === 'CYCLE_PROTOCOL_INACTIVE',
  );
  await assert.rejects(
    createSettlementService().balances(ownerA, groupId(group), {}),
    (e) => e.code === 'CYCLE_PROTOCOL_INACTIVE',
  );
});

test('cycle history indexes install and MongoDB rejects malformed reservation state', async () => {
  const expenseIndexes = await GroupExpense.collection.indexes();
  const settlementIndexes = await GroupSettlement.collection.indexes();
  assert.ok(
    expenseIndexes.some(
      (index) =>
        JSON.stringify(index.key) ===
        JSON.stringify({ group: 1, cycleId: 1, expenseDate: -1, _id: -1 }),
    ),
  );
  assert.ok(
    settlementIndexes.some(
      (index) => JSON.stringify(index.key) === JSON.stringify({ group: 1, cycleId: 1, _id: -1 }),
    ),
  );
  const stopped = service({
    fault: async (stage) => {
      if (stage === 'after_reserve') throw new Error('Injected stop');
    },
  });
  await assert.rejects(
    stopped.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    }),
    /Injected stop/,
  );
  await assert.rejects(
    Group.collection.updateOne(
      { _id: group._id },
      {
        $set: { 'financialOperation.phase': 'invalid' },
      },
    ),
    (error) => error.code === 121,
  );
  await assert.rejects(
    Group.collection.updateOne(
      { _id: group._id },
      {
        $set: { 'financialOperation.groupId': oid() },
      },
    ),
    (error) => error.code === 121,
  );
  assert.equal((await service().recover(ownerA, groupId(group))).recovered, true);
});

test('cycle expense writes bind ID, preserve exact split and group-wide receipt uniqueness', async () => {
  const api = service(),
    key = randomUUID();
  const created = await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
    data: input(10001),
    key,
  });
  assert.equal(created.replayed, false);
  assert.equal(String(created.row.cycleId), String(cycle._id));
  assert.deepEqual(
    created.row.shares.map((r) => r.amountMinor),
    [5001, 5000],
  );
  assert.equal(created.row.amountMinor, 10001);
  const replay = await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
    data: input(10001),
    key,
  });
  assert.equal(replay.replayed, true);
  assert.equal(String(replay.row._id), String(created.row._id));
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(20000),
      key,
    }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(await GroupExpense.countDocuments({}), 1);
  const edited = await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_update', {
    targetId: String(created.row._id),
    version: 0,
    data: { ...input(10001), title: 'Edited' },
  });
  assert.equal(edited.row.__v, 1);
  assert.equal(edited.row.title, 'Edited');
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_update', {
      targetId: String(created.row._id),
      version: 0,
      data: input(10001),
    }),
    (e) => e.code === 'GROUP_EXPENSE_CONFLICT',
  );
  const deleted = await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_delete', {
    targetId: String(created.row._id),
    version: 1,
  });
  assert.ok(deleted.row.deletedAt);
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(10001),
      key,
    }),
    (e) => e.code === 'EXPENSE_DELETED',
  );
  const totals = await api.balances(ownerA, groupId(group), String(cycle._id));
  assert.equal(
    totals.rows.every((r) => r.net === 0n),
    true,
  );
});

test('first proposal freezes only its cycle; recipient decisions and pending capacity are cycle-scoped', async () => {
  const api = service();
  await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
    data: input(),
    key: randomUUID(),
  });
  const proposal = await api.run(
    ownerB,
    groupId(group),
    String(cycle._id),
    1,
    'settlement_create',
    {
      data: { recipient: ownerA, amountMinor: 3000, currency: 'INR' },
      key: randomUUID(),
    },
  );
  assert.equal(proposal.row.status, 'pending');
  assert.equal(String(proposal.row.cycleId), String(cycle._id));
  assert.equal((await Group.findById(group._id)).currentCycleState, 'frozen');
  assert.equal((await GroupFinancialCycle.findById(cycle._id)).status, 'frozen');
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    }),
    (e) => e.code === 'EXPENSES_FROZEN',
  );
  const first = await api.balances(ownerA, groupId(group), String(cycle._id));
  assert.equal(first.rows.find((r) => r.user === ownerB).reservedSent, 3000n);
  const confirmed = await api.run(
    ownerA,
    groupId(group),
    String(cycle._id),
    1,
    'settlement_confirm',
    {
      targetId: String(proposal.row._id),
      version: 0,
    },
  );
  assert.equal(confirmed.row.status, 'confirmed');
  const final = await api.balances(ownerA, groupId(group), String(cycle._id));
  assert.equal(final.rows.find((r) => r.user === ownerB).net, -2000n);
  assert.equal(
    final.rows.reduce((sum, row) => sum + row.net, 0n),
    0n,
  );
});

test('checking cancellation and injected write-boundary faults recover one fixed expense intent', async () => {
  const api = service();
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: {
        ...input(),
        payer: ownerB,
        split: { method: 'equal', participants: [ownerA, ownerA] },
      },
      key: randomUUID(),
    }),
  );
  assert.equal((await Group.findById(group._id)).financialOperation, undefined);
  for (const stage of [
    'after_reserve',
    'after_check',
    'after_promote',
    'before_target_write',
    'after_target_write',
    'before_release',
  ]) {
    const key = randomUUID();
    let armed = true;
    const interrupted = service({
      fault: async (at) => {
        if (armed && at === stage) {
          armed = false;
          throw new Error(`Injected ${stage}`);
        }
      },
    });
    await assert.rejects(
      interrupted.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
        data: input(100 + stage.length),
        key,
      }),
      /Injected/,
    );
    const pending = await Group.findById(group._id);
    assert.equal(
      pending.financialOperation.phase,
      ['after_reserve', 'after_check'].includes(stage) ? 'checking' : 'applying',
    );
    const recovered = await api.recover(ownerA, groupId(group));
    assert.equal(recovered.recovered, true);
    assert.equal(String(recovered.row.cycleId), String(cycle._id));
    assert.equal((await Group.findById(group._id)).financialOperation, undefined);
    const replay = await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(100 + stage.length),
      key,
    });
    assert.equal(replay.replayed, true);
    assert.equal(String(replay.row._id), String(recovered.row._id));
  }
  assert.equal(await GroupExpense.countDocuments({ group: group._id }), 6);
});

test('first-proposal faults recover between cycle freeze, group mirror, insertion and release', async () => {
  const api = service();
  for (const stage of [
    'after_cycle_freeze',
    'after_group_mirror',
    'after_target_write',
    'before_release',
  ]) {
    if (stage !== 'after_cycle_freeze') {
      await Promise.all([
        Group.deleteMany({}),
        GroupFinancialCycle.deleteMany({}),
        GroupExpense.deleteMany({}),
        GroupSettlement.deleteMany({}),
      ]);
      await fixture();
    }
    await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    });
    let armed = true;
    const interrupted = service({
      fault: async (at) => {
        if (armed && at === stage) {
          armed = false;
          throw new Error(`Injected ${stage}`);
        }
      },
    });
    const key = randomUUID();
    await assert.rejects(
      interrupted.run(ownerB, groupId(group), String(cycle._id), 1, 'settlement_create', {
        data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
        key,
      }),
      /Injected/,
    );
    assert.equal((await Group.findById(group._id)).financialOperation.phase, 'applying');
    const recovered = await api.recover(ownerB, groupId(group));
    assert.equal(recovered.row.status, 'pending');
    assert.equal((await Group.findById(group._id)).currentCycleState, 'frozen');
    assert.equal((await GroupFinancialCycle.findById(cycle._id)).status, 'frozen');
    assert.equal(await GroupSettlement.countDocuments({ group: group._id }), 1);
    assert.equal((await Group.findById(group._id)).financialOperation, undefined);
  }
});

test('independent MongoDB clients contend on one reservation and identical key creates once', async () => {
  const first = await independentWorker(),
    second = await independentWorker();
  try {
    const key = randomUUID();
    const results = await Promise.allSettled(
      [first.api, second.api].map((api) =>
        api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
          data: input(),
          key,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length >= 1, true);
    assert.equal(await GroupExpense.countDocuments({ group: group._id }), 1);
    const replay = await second.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'expense_create',
      {
        data: input(),
        key,
      },
    );
    assert.equal(replay.replayed, true);
    assert.equal((await Group.findById(group._id)).financialOperation, undefined);
  } finally {
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('expense update and first freeze serialize across independent MongoDB clients', async () => {
  const pause = gate('before_target_write');
  const first = await independentWorker(pause.fault),
    second = await independentWorker();
  try {
    const created = await second.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'expense_create',
      {
        data: input(),
        key: randomUUID(),
      },
    );
    const writing = first.api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_update', {
      targetId: String(created.row._id),
      version: 0,
      data: { ...input(), title: 'Concurrent edit' },
    });
    await pause.ready;
    await assert.rejects(
      second.api.run(ownerB, groupId(group), String(cycle._id), 1, 'settlement_create', {
        data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
        key: randomUUID(),
      }),
      (e) => e.code === 'FINANCIAL_BUSY',
    );
    pause.release();
    assert.equal((await writing).row.title, 'Concurrent edit');
    assert.equal(
      (
        await second.api.run(ownerB, groupId(group), String(cycle._id), 1, 'settlement_create', {
          data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
          key: randomUUID(),
        })
      ).row.status,
      'pending',
    );
    assert.equal((await GroupExpense.findById(created.row._id)).title, 'Concurrent edit');
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('two independent first proposals serialize and only one freeze receipt is established', async () => {
  const first = await independentWorker(),
    second = await independentWorker();
  try {
    await first.api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    });
    const results = await Promise.allSettled(
      [first.api, second.api].map((api) =>
        api.run(ownerB, groupId(group), String(cycle._id), 1, 'settlement_create', {
          data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
          key: randomUUID(),
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length >= 1, true);
    const stored = await GroupFinancialCycle.findById(cycle._id);
    assert.equal(stored.status, 'frozen');
    assert.ok(stored.freezeOperationId);
    assert.equal((await Group.findById(group._id)).currentCycleState, 'frozen');
    const proposals = await GroupSettlement.find({ group: group._id });
    assert.equal(proposals.length >= 1 && proposals.length <= 2, true);
    assert.equal(
      proposals.every((row) => String(row.cycleId) === String(cycle._id)),
      true,
    );
    assert.equal((await Group.findById(group._id)).financialOperation, undefined);
  } finally {
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('confirmation and another proposal contend; rejection retains history without changing net', async () => {
  const pause = gate('before_target_write');
  const first = await independentWorker(pause.fault),
    second = await independentWorker();
  try {
    await second.api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    });
    const proposed = await second.api.run(
      ownerB,
      groupId(group),
      String(cycle._id),
      1,
      'settlement_create',
      {
        data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
        key: randomUUID(),
      },
    );
    const confirming = first.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'settlement_confirm',
      {
        targetId: String(proposed.row._id),
        version: 0,
      },
    );
    await pause.ready;
    await assert.rejects(
      second.api.run(ownerB, groupId(group), String(cycle._id), 1, 'settlement_create', {
        data: { recipient: ownerA, amountMinor: 1000, currency: 'INR' },
        key: randomUUID(),
      }),
      (e) => e.code === 'FINANCIAL_BUSY',
    );
    pause.release();
    assert.equal((await confirming).row.status, 'confirmed');
    const rejectedProposal = await second.api.run(
      ownerB,
      groupId(group),
      String(cycle._id),
      1,
      'settlement_create',
      {
        data: { recipient: ownerA, amountMinor: 500, currency: 'INR' },
        key: randomUUID(),
      },
    );
    const before = (await second.api.balances(ownerB, groupId(group), String(cycle._id))).rows;
    const rejected = await second.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'settlement_reject',
      {
        targetId: String(rejectedProposal.row._id),
        version: 0,
      },
    );
    assert.equal(rejected.row.status, 'rejected');
    const after = (await second.api.balances(ownerB, groupId(group), String(cycle._id))).rows;
    assert.deepEqual(
      after.map((r) => r.net),
      before.map((r) => r.net),
    );
    assert.equal(
      after.every((r) => r.reservedSent === 0n && r.reservedReceived === 0n),
      true,
    );
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('recovery wins against a delayed worker; old key and target cannot move into a new cycle', async () => {
  const pause = gate('before_target_write');
  const oldWorker = await independentWorker(pause.fault),
    recoveryWorker = await independentWorker();
  try {
    const key = randomUUID();
    const pending = oldWorker.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'expense_create',
      {
        data: input(100, { method: 'equal', participants: [ownerA] }),
        key,
      },
    );
    await pause.ready;
    const recovered = await recoveryWorker.api.recover(ownerA, groupId(group));
    assert.equal(recovered.recovered, true);
    const next = await nextCycleFixture();
    pause.release();
    const stale = await pending;
    assert.equal(String(stale.row._id), String(recovered.row._id));
    assert.equal(String(stale.row.cycleId), String(cycle._id));
    const replay = await recoveryWorker.api.run(
      ownerA,
      groupId(group),
      String(cycle._id),
      1,
      'expense_create',
      {
        data: input(100, { method: 'equal', participants: [ownerA] }),
        key,
      },
    );
    assert.equal(replay.replayed, true);
    await assert.rejects(
      recoveryWorker.api.run(ownerA, groupId(group), String(next._id), 2, 'expense_create', {
        data: input(100, { method: 'equal', participants: [ownerA] }),
        key,
      }),
      (e) => e.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(await GroupExpense.countDocuments({ group: group._id }), 1);
    assert.equal(await GroupExpense.countDocuments({ cycleId: next._id }), 0);
    await assert.rejects(
      recoveryWorker.api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_delete', {
        targetId: String(recovered.row._id),
        version: 0,
      }),
      (e) => e.code === 'CYCLE_EPOCH_STALE',
    );
  } finally {
    pause.release();
    await Promise.all([oldWorker.connection.close(), recoveryWorker.connection.close()]);
  }
});

test('cycle aggregation excludes other cycles and fails closed on corrupt matched source', async () => {
  const api = service();
  await api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
    data: input(100, { method: 'equal', participants: [ownerA] }),
    key: randomUUID(),
  });
  const next = await nextCycleFixture();
  const second = await api.run(ownerA, groupId(group), String(next._id), 2, 'expense_create', {
    data: input(101),
    key: randomUUID(),
  });
  const prior = await api.balances(ownerA, groupId(group), String(cycle._id));
  assert.equal(
    prior.rows.every((row) => row.net === 0n),
    true,
  );
  const current = await api.balances(ownerA, groupId(group), String(next._id));
  assert.equal(current.rows.find((row) => row.user === ownerA).paid, 101n);
  assert.equal(
    current.rows.reduce((sum, row) => sum + row.net, 0n),
    0n,
  );
  await GroupExpense.collection.updateOne(
    { _id: second.row._id },
    { $set: { amountMinor: 1.5 } },
    { bypassDocumentValidation: true },
  );
  await assert.rejects(
    api.balances(ownerA, groupId(group), String(next._id)),
    (e) => e.code === 'BALANCE_DATA_INVALID',
  );
  assert.equal(
    (await api.balances(ownerA, groupId(group), String(cycle._id))).rows.every((r) => r.net === 0n),
    true,
  );
});

test('tampered applying payload stays reserved and cannot be recovered into a different amount', async () => {
  let armed = true;
  const api = service({
    fault: async (stage) => {
      if (armed && stage === 'after_promote') {
        armed = false;
        throw new Error('Injected promotion stop');
      }
    },
  });
  await assert.rejects(
    api.run(ownerA, groupId(group), String(cycle._id), 1, 'expense_create', {
      data: input(),
      key: randomUUID(),
    }),
    /Injected/,
  );
  await Group.collection.updateOne(
    { _id: group._id },
    { $set: { 'financialOperation.payload.data.amountMinor': 90000 } },
  );
  await assert.rejects(
    service().recover(ownerA, groupId(group)),
    (e) => e.code === 'CYCLE_OPERATION_INVALID',
  );
  assert.equal((await Group.findById(group._id)).financialOperation.phase, 'applying');
  assert.equal(await GroupExpense.countDocuments({ group: group._id }), 0);
});
