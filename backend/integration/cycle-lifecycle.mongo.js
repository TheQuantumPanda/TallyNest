import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { GroupSettlement } from '../src/models/group-settlement.model.js';
import { GroupCycleTransition } from '../src/models/group-cycle-transition.model.js';
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
import {
  createCycleTransitionRepository,
  ensureCycleTransitionIndexes,
} from '../src/repositories/group-cycle-transition.repository.js';
import { createGroupBalanceRepository } from '../src/repositories/group-balance.repository.js';
import { createCycleFinancialService } from '../src/services/cycle-financial.service.js';
import { createCycleLifecycleService } from '../src/services/cycle-lifecycle.service.js';
import { createGroupExpenseService } from '../src/services/group-expense.service.js';
import { createSettlementService } from '../src/services/settlement.service.js';
import { ownerA, ownerB } from '../tests/helpers/transaction-api.js';

const database = `tallynest_lifecycle_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const uri = `mongodb://127.0.0.1:27017/${database}`;
let groupId;
const api = (extra = {}) => createCycleLifecycleService({ internalEnabled: true, ...extra });
const money = (extra = {}) => createCycleFinancialService({ internalEnabled: true, ...extra });
const models = [Group, GroupFinancialCycle, GroupExpense, GroupSettlement, GroupCycleTransition];
async function fixture() {
  const group = await createGroupRepository().createForOwner(ownerA, {
    name: 'Disposable lifecycle',
  });
  group.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await group.save();
  await Group.collection.updateOne({ _id: group._id }, { $set: { financialProtocolVersion: 2 } });
  groupId = String(group._id);
}
async function state() {
  const group = await Group.findById(groupId);
  const cycle = group.currentCycleId
    ? await GroupFinancialCycle.findById(group.currentCycleId)
    : null;
  return { group, cycle };
}
async function input(intent = randomUUID()) {
  const { group, cycle } = await state();
  return {
    intent,
    groupVersion: group.__v,
    ...(cycle
      ? {
          cycleId: String(cycle._id),
          cycleVersion: cycle.__v,
          epoch: group.cycleEpoch,
        }
      : {}),
  };
}
async function open() {
  await api().openFirst(ownerA, groupId, await input());
  return state();
}
async function freeze() {
  await api().freeze(ownerA, groupId, await input());
}
async function close() {
  await api().close(ownerA, groupId, await input());
}
const expense = (amountMinor = 10000, participants = [ownerA, ownerB]) => ({
  payer: ownerA,
  title: 'Real cycle expense',
  amountMinor,
  currency: 'INR',
  category: 'food_dining',
  expenseDate: '2026-10-16T00:00:00.000Z',
  split: { method: 'equal', participants },
});
async function createExpense(amount = 10000, participants) {
  const { group, cycle } = await state();
  const key = randomUUID(),
    data = expense(amount, participants);
  return {
    ...(await money().run(ownerA, groupId, String(cycle._id), group.cycleEpoch, 'expense_create', {
      data,
      key,
    })),
    key,
    data,
  };
}
async function proposal(amount = 5000) {
  const { group, cycle } = await state();
  return money().run(ownerB, groupId, String(cycle._id), group.cycleEpoch, 'settlement_create', {
    key: randomUUID(),
    data: { recipient: ownerA, amountMinor: amount, currency: 'INR' },
  });
}
async function confirm(row, coordinator = money()) {
  const { group, cycle } = await state();
  return coordinator.run(
    ownerA,
    groupId,
    String(cycle._id),
    group.cycleEpoch,
    'settlement_confirm',
    {
      targetId: String(row._id),
      version: row.__v,
    },
  );
}
function gate(stage) {
  let release, entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  const waiting = new Promise((r) => {
    release = r;
  });
  let armed = true;
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
async function worker(fault) {
  const connection = await mongoose.createConnection(uri).asPromise();
  const [G, C, E, S, R] = models.map((m) => connection.model(m.modelName, m.schema));
  const repos = {
    groups: createGroupRepository(G),
    cycles: createGroupFinancialCycleRepository(C),
    receipts: createCycleTransitionRepository(R),
    expenses: createGroupExpenseRepository(E),
    settlements: createSettlementRepository(S),
    balances: createGroupBalanceRepository(E, S),
  };
  return { connection, life: api({ ...repos, fault }), financial: money({ ...repos, fault }) };
}
before(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await ensureGroupIndexes();
  await ensureGroupFinancialCycleIndexes();
  await ensureGroupExpenseIndexes();
  await ensureSettlementIndexes();
  await ensureCycleTransitionIndexes();
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
  await fixture();
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    // Drain automatic model initialization even if setup failed before an ensure call.
    await Promise.allSettled(models.map((model) => model.init()));
    await mongoose.connection.dropDatabase();
    const { databases } = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(
      databases.some((d) => d.name === database),
      false,
    );
    await mongoose.disconnect();
    console.log(`Dropped disposable database: ${database}`);
  }
});

test('first empty cycle bootstraps once, exact replay retains receipt, public paths stay inactive', async () => {
  const request = await input();
  const result = await api().openFirst(ownerA, groupId, request);
  const { group, cycle } = await state();
  assert.equal(cycle.sequence, 1);
  assert.equal(group.cycleEpoch, 1);
  assert.equal(group.currentCycleState, 'open');
  assert.ok(group.financialHistoryAt);
  assert.equal(group.financialOperation, undefined);
  assert.deepEqual(cycle.memberIds.map(String), [ownerA, ownerB].sort());
  assert.equal((await api().openFirst(ownerA, groupId, request)).replayed, true);
  assert.equal(String(result.receipt.cycleId), String(cycle._id));
  assert.equal(await GroupFinancialCycle.countDocuments({ group: groupId }), 1);
  await assert.rejects(api().openFirst(ownerA, groupId, { ...request, groupVersion: 99 }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(
    createGroupExpenseService().create(ownerA, groupId, expense(), randomUUID()),
    { code: 'CYCLE_PROTOCOL_INACTIVE' },
  );
  await assert.rejects(createSettlementService().balances(ownerA, groupId, {}), {
    code: 'CYCLE_PROTOCOL_INACTIVE',
  });
  await assert.rejects(createCycleLifecycleService().openFirst(ownerA, groupId, request), {
    code: 'CYCLE_PROTOCOL_INACTIVE',
  });
});
test('empty cycle freezes and closes monotonically; next cycle starts at genuine zero', async () => {
  const first = await open();
  await freeze();
  const frozen = await state(),
    stamp = frozen.group.settlementStartedAt;
  assert.ok(stamp);
  assert.equal(frozen.cycle.status, 'frozen');
  await close();
  const closed = await state();
  assert.equal(closed.cycle.status, 'closed');
  assert.equal(closed.cycle.activeSlot, undefined);
  assert.ok(closed.cycle.closedAt >= frozen.cycle.frozenAt);
  await api().openNext(ownerA, groupId, await input());
  const next = await state();
  assert.equal(next.group.cycleEpoch, 2);
  assert.equal(next.cycle.sequence, 2);
  assert.equal(String(next.cycle.previousCycleId), String(first.cycle._id));
  assert.equal(next.group.settlementStartedAt.getTime(), stamp.getTime());
  const result = await money().balances(ownerA, groupId, String(next.cycle._id));
  assert.ok(result.rows.every((row) => row.paid === 0n && row.assigned === 0n && row.net === 0n));
});
test('two complete financial cycles preserve historical settlements, tombstones and old creation keys', async () => {
  await open();
  const first = await state();
  const original = await createExpense();
  const removed = await createExpense(100, [ownerA]);
  await money().run(ownerA, groupId, String(first.cycle._id), 1, 'expense_delete', {
    targetId: String(removed.row._id),
    version: 0,
  });
  await confirm((await proposal()).row);
  await close();
  await api().openNext(ownerA, groupId, await input());
  const second = await state();
  const replay = await money().run(ownerA, groupId, String(first.cycle._id), 1, 'expense_create', {
    data: original.data,
    key: original.key,
  });
  assert.equal(replay.replayed, true);
  assert.equal(String(replay.row._id), String(original.row._id));
  await assert.rejects(
    money().run(ownerA, groupId, String(second.cycle._id), 2, 'expense_create', {
      data: original.data,
      key: original.key,
    }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  await assert.rejects(
    money().run(ownerA, groupId, String(first.cycle._id), 1, 'expense_update', {
      targetId: String(original.row._id),
      version: 0,
      data: expense(200),
    }),
    { code: 'CYCLE_EPOCH_STALE' },
  );
  await createExpense(202);
  await confirm((await proposal(101)).row);
  await close();
  assert.equal(await GroupSettlement.countDocuments({ status: 'confirmed' }), 2);
  assert.ok((await GroupExpense.findById(removed.row._id)).deletedAt);
  for (const cycle of [first.cycle, second.cycle]) {
    const balances = await money().balances(ownerA, groupId, String(cycle._id));
    assert.ok(balances.rows.every((r) => r.net === 0n));
  }
});
test('close refuses nonzero balances, pending proposals, corrupt records and overflow', async () => {
  await open();
  const created = await createExpense();
  await freeze();
  await assert.rejects(api().close(ownerA, groupId, await input()), { code: 'CYCLE_NOT_SETTLED' });
  assert.equal((await state()).group.financialOperation, undefined);
  const proposed = await proposal();
  await assert.rejects(api().close(ownerA, groupId, await input()), {
    code: 'CYCLE_PENDING_SETTLEMENTS',
  });
  await confirm(proposed.row);
  await GroupExpense.collection.updateOne(
    { _id: created.row._id },
    { $set: { amountMinor: 0.5 } },
    { bypassDocumentValidation: true },
  );
  await assert.rejects(api().close(ownerA, groupId, await input()), {
    code: 'BALANCE_DATA_INVALID',
  });
  assert.equal((await state()).cycle.status, 'frozen');
});
test('safe-boundary source totals fail closure on overflow even if net positions are zero', async () => {
  await open();
  await createExpense(Number.MAX_SAFE_INTEGER, [ownerA]);
  await createExpense(1, [ownerA]);
  await freeze();
  await assert.rejects(api().close(ownerA, groupId, await input()), { code: 'BALANCE_OVERFLOW' });
  assert.equal((await state()).cycle.status, 'frozen');
});
test('only current authoritative owner can transition; legacy, stale version and epoch input fail closed', async () => {
  await assert.rejects(api().openFirst(ownerB, groupId, await input()), {
    code: 'GROUP_OWNER_REQUIRED',
  });
  await assert.rejects(api().openFirst('aaaaaaaaaaaaaaaaaaaaaaaa', groupId, await input()), {
    code: 'GROUP_NOT_FOUND',
  });
  const request = await input();
  await assert.rejects(api().openFirst(ownerA, groupId, { ...request, actor: ownerA }), {
    code: 'INVALID_CYCLE_TRANSITION',
  });
  await open();
  await assert.rejects(api().freeze(ownerA, groupId, { ...(await input()), groupVersion: 0 }), {
    code: 'VERSION_MISMATCH',
  });
  await assert.rejects(api().freeze(ownerA, groupId, { ...(await input()), epoch: 2 }), {
    code: 'CYCLE_STATE_INVALID',
  });
  await assert.rejects(api().openNext(ownerA, groupId, await input()), {
    code: 'CYCLE_STATE_INVALID',
  });
  await freeze();
  await assert.rejects(api().freeze(ownerA, groupId, await input()), {
    code: 'CYCLE_STATE_INVALID',
  });
  await close();
  await assert.rejects(api().close(ownerA, groupId, await input()), {
    code: 'CYCLE_STATE_INVALID',
  });
  const legacy = await createGroupRepository().createForOwner(ownerA, {
    name: 'Legacy stays legacy',
  });
  await assert.rejects(
    api().openFirst(ownerA, String(legacy._id), { intent: randomUUID(), groupVersion: 0 }),
    { code: 'CYCLE_PROTOCOL_INACTIVE' },
  );
  assert.equal((await Group.findById(legacy._id)).currentCycleId, undefined);
});

for (const operation of ['openFirst', 'freeze', 'close', 'openNext']) {
  test(`${operation}: every durable boundary recovers its fixed identity with independent clients`, async () => {
    for (const stage of [
      'after_reserve',
      'after_check',
      'after_promote',
      'after_receipt_insert',
      'before_cycle_write',
      'after_cycle_write',
      'before_group_mirror',
      'after_group_mirror',
      'after_receipt_complete',
      'before_release',
      'after_release',
    ]) {
      await Promise.all(models.map((m) => m.deleteMany({})));
      await fixture();
      if (operation !== 'openFirst') await open();
      if (['close', 'openNext'].includes(operation)) await freeze();
      if (operation === 'openNext') await close();
      const request = await input();
      let armed = true;
      const interrupted = api({
        fault: async (at) => {
          if (armed && stage === at) {
            armed = false;
            throw new Error(`Injected ${stage}`);
          }
        },
      });
      await assert.rejects(interrupted[operation](ownerA, groupId, request), /Injected/);
      const reserved = (await state()).group.financialOperation;
      const target = reserved ? String(reserved.targetId) : String((await state()).cycle._id);
      const first = await worker(),
        second = await worker();
      try {
        const recovery = await Promise.allSettled([
          first.life.recover(ownerA, groupId),
          second.life.recover(ownerA, groupId),
        ]);
        assert.ok(
          recovery.some((r) => r.status === 'fulfilled'),
          `${operation} ${stage}`,
        );
        // A check/promotion contender can safely lose, but must never replace an applying slot.
        if ((await state()).group.financialOperation) await first.life.recover(ownerA, groupId);
      } finally {
        await Promise.all([first.connection.close(), second.connection.close()]);
      }
      const after = await state();
      assert.equal(String(after.cycle._id), target, `${operation} ${stage}`);
      assert.equal(after.group.financialOperation, undefined);
      assert.equal(
        after.group.currentCycleState,
        operation === 'freeze' ? 'frozen' : operation === 'close' ? 'closed' : 'open',
      );
      const replay = await api()[operation](ownerA, groupId, request);
      assert.equal(replay.replayed, true);
      assert.ok(replay.receipt.completedAt);
      assert.equal(
        await GroupCycleTransition.countDocuments({ group: groupId, _id: replay.receipt._id }),
        1,
      );
    }
  });
}

test('independent sessions contend on freeze, duplicate freeze, close and next open without split brain', async () => {
  await open();
  const first = await worker(),
    second = await worker();
  try {
    for (const [operation, duplicates] of [
      ['freeze', false],
      ['close', false],
      ['openNext', false],
      ['freeze', true],
    ]) {
      const request = await input();
      const results = await Promise.allSettled([
        first.life[operation](ownerA, groupId, request),
        second.life[operation](
          ownerA,
          groupId,
          duplicates ? request : { ...request, intent: randomUUID() },
        ),
      ]);
      assert.ok(results.some((r) => r.status === 'fulfilled'));
      assert.ok(
        results.every(
          (r) =>
            r.status === 'fulfilled' ||
            [
              'FINANCIAL_BUSY',
              'CYCLE_OPERATION_STALE',
              'VERSION_MISMATCH',
              'CYCLE_STATE_INVALID',
              'CYCLE_VERSION_STALE',
            ].includes(r.reason.code),
        ),
        results.map((r) => r.reason?.code).join(','),
      );
      if ((await state()).group.financialOperation) await first.life.recover(ownerA, groupId);
      assert.equal(
        await GroupFinancialCycle.countDocuments({ group: groupId, activeSlot: true }),
        operation === 'close' ? 0 : 1,
      );
    }
    const rows = await GroupFinancialCycle.find({ group: groupId });
    assert.deepEqual(rows.map((r) => r.sequence).sort(), [1, 2]);
  } finally {
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('expense creation and explicit freeze serialize through the same group slot', async () => {
  await open();
  const pause = gate('before_target_write'),
    first = await worker(pause.fault),
    second = await worker();
  try {
    const { group, cycle } = await state();
    const writing = first.financial.run(ownerA, groupId, String(cycle._id), 1, 'expense_create', {
      data: expense(100, [ownerA]),
      key: randomUUID(),
    });
    await pause.ready;
    await assert.rejects(second.life.freeze(ownerA, groupId, await input()), {
      code: 'FINANCIAL_BUSY',
    });
    pause.release();
    await writing;
    await second.life.freeze(ownerA, groupId, await input());
    await assert.rejects(
      second.financial.run(ownerA, groupId, String(cycle._id), group.cycleEpoch, 'expense_create', {
        data: expense(),
        key: randomUUID(),
      }),
      { code: 'EXPENSES_FROZEN' },
    );
    assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('confirmation racing with close is fenced; closure recomputes after confirmation completes', async () => {
  await open();
  await createExpense();
  const proposed = await proposal();
  const pause = gate('before_target_write'),
    first = await worker(pause.fault),
    second = await worker();
  try {
    const confirming = confirm(proposed.row, first.financial);
    await pause.ready;
    await assert.rejects(second.life.close(ownerA, groupId, await input()), {
      code: 'FINANCIAL_BUSY',
    });
    pause.release();
    await confirming;
    await second.life.close(ownerA, groupId, await input());
    assert.equal((await state()).cycle.status, 'closed');
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

for (const operation of ['freeze', 'close', 'openNext']) {
  test(`delayed ${operation} worker cannot change historical state after recovery and next cycle`, async () => {
    await open();
    if (operation !== 'freeze') await freeze();
    if (operation === 'openNext') await close();
    const pause = gate('before_cycle_write'),
      first = await worker(pause.fault),
      second = await worker();
    try {
      const request = await input(),
        pending = first.life[operation](ownerA, groupId, request);
      await pause.ready;
      const recovered = await second.life.recover(ownerA, groupId);
      assert.equal(recovered.recovered, true);
      if (operation === 'freeze') await close();
      if (operation !== 'openNext') await second.life.openNext(ownerA, groupId, await input());
      else {
        await freeze();
        await close();
        await second.life.openNext(ownerA, groupId, await input());
      }
      const before = await state();
      pause.release();
      const delayed = await pending;
      assert.equal(String(delayed.receipt._id), String(recovered.receipt._id));
      const after = await state();
      assert.equal(String(after.cycle._id), String(before.cycle._id));
      assert.equal(after.group.__v, before.group.__v);
      assert.equal(
        await GroupFinancialCycle.countDocuments({ group: groupId, activeSlot: true }),
        1,
      );
    } finally {
      pause.release();
      await Promise.all([first.connection.close(), second.connection.close()]);
    }
  });
}

test('new-cycle expenses are unavailable until pointer commitment and reservation release', async () => {
  await open();
  await freeze();
  await close();
  const pause = gate('after_cycle_write'),
    first = await worker(pause.fault),
    second = await worker();
  try {
    const pending = first.life.openNext(ownerA, groupId, await input());
    await pause.ready;
    const held = (await state()).group;
    const target = String(held.financialOperation.targetId);
    assert.notEqual(String(held.currentCycleId), target);
    await assert.rejects(
      second.financial.run(ownerA, groupId, target, held.cycleEpoch + 1, 'expense_create', {
        data: expense(),
        key: randomUUID(),
      }),
      (e) => ['CYCLE_EPOCH_STALE', 'FINANCIAL_BUSY'].includes(e.code),
    );
    await second.life.recover(ownerA, groupId);
    await second.financial.run(ownerA, groupId, target, 2, 'expense_create', {
      data: expense(),
      key: randomUUID(),
    });
    pause.release();
    await pending;
    assert.equal(await GroupExpense.countDocuments({ cycleId: target }), 1);
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('bootstrap rejects existing legacy financial history rather than silently migrating it', async () => {
  await open();
  await createExpense();
  // Deliberately damaged fixture: remove pointer fields while retaining real financial history.
  await Group.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(groupId) },
    { $unset: { currentCycleId: 1, currentCycleState: 1, cycleEpoch: 1 } },
  );
  await assert.rejects(api().openFirst(ownerA, groupId, await input()), {
    code: 'CYCLE_BOOTSTRAP_NOT_EMPTY',
  });
  assert.equal((await state()).group.financialOperation, undefined);
  assert.equal(await GroupFinancialCycle.countDocuments({ group: groupId }), 1);
});

test('unreconcilable applying corruption retains reservation and rejects safe-looking retries', async () => {
  await open();
  const request = await input();
  await assert.rejects(
    api({
      fault: async (stage) => {
        if (stage === 'after_promote') throw new Error('Injected');
      },
    }).freeze(ownerA, groupId, request),
    /Injected/,
  );
  await Group.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(groupId) },
    { $set: { 'financialOperation.payload.outcome': 'open' } },
  );
  await assert.rejects(api().recover(ownerA, groupId), { code: 'CYCLE_OPERATION_INVALID' });
  assert.equal((await state()).group.financialOperation.phase, 'applying');
});

test('actual SIGKILL after next-cycle insertion recovers with a fresh OS worker and fixed target', async () => {
  await open();
  await freeze();
  await close();
  const request = await input();
  const child = fork(new URL('./helpers/cycle-lifecycle-worker.js', import.meta.url), [], {
    env: {
      ...process.env,
      TALLYNEST_LIFECYCLE_DB: database,
      TALLYNEST_LIFECYCLE_GROUP: groupId,
      TALLYNEST_LIFECYCLE_REQUEST: JSON.stringify(request),
      TALLYNEST_LIFECYCLE_MODE: 'interrupt',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  try {
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Child did not reach durable boundary')),
        15000,
      );
      child.once('message', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Child exited ${code}`));
      });
      child.once('error', reject);
    });
    assert.equal(message.stage, 'after_cycle_write');
    const held = (await state()).group,
      target = String(held.financialOperation.targetId);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    const fresh = fork(new URL('./helpers/cycle-lifecycle-worker.js', import.meta.url), [], {
      env: {
        ...process.env,
        TALLYNEST_LIFECYCLE_DB: database,
        TALLYNEST_LIFECYCLE_GROUP: groupId,
        TALLYNEST_LIFECYCLE_MODE: 'recover',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    fresh.stderr.on('data', (data) => {
      output += data;
    });
    const [status] = await once(fresh, 'exit');
    assert.equal(status, 0, output);
    const completed = await state();
    assert.equal(String(completed.cycle._id), target);
    assert.equal(completed.group.financialOperation, undefined);
    assert.equal(completed.cycle.sequence, 2);
    assert.equal((await api().openNext(ownerA, groupId, request)).replayed, true);
    assert.equal(await GroupFinancialCycle.countDocuments({ group: groupId }), 2);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('transition receipt and cycle indexes enforce uniqueness; malformed raw receipts fail closed', async () => {
  const request = await input(),
    result = await api().openFirst(ownerA, groupId, request);
  const indexes = await GroupCycleTransition.collection.indexes();
  assert.ok(
    indexes.some(
      (entry) =>
        entry.unique && JSON.stringify(entry.key) === JSON.stringify({ group: 1, intentKey: 1 }),
    ),
  );
  const raw = await GroupCycleTransition.collection.findOne({ _id: result.receipt._id });
  await assert.rejects(
    GroupCycleTransition.collection.insertOne({ ...raw, _id: new mongoose.Types.ObjectId() }),
    (error) => error.code === 11000,
  );
  await assert.rejects(
    GroupCycleTransition.collection.updateOne({ _id: raw._id }, { $set: { __v: 1.5 } }),
    (error) => error.code === 121,
  );
  const { cycle } = await state(),
    cycleRaw = await GroupFinancialCycle.collection.findOne({ _id: cycle._id });
  await assert.rejects(
    GroupFinancialCycle.collection.insertOne({ ...cycleRaw, _id: new mongoose.Types.ObjectId() }),
    (error) => error.code === 11000,
  );
  await assert.rejects(
    GroupFinancialCycle.collection.insertOne({
      ...cycleRaw,
      _id: new mongoose.Types.ObjectId(),
      sequence: 2,
      previousCycleId: cycle._id,
    }),
    (error) => error.code === 11000,
  );
  await GroupCycleTransition.collection.updateOne(
    { _id: raw._id },
    { $set: { 'operation.payload.effectiveAt': 'tampered' } },
  );
  await assert.rejects(api().openFirst(ownerA, groupId, request), {
    code: 'CYCLE_RECEIPT_INVALID',
  });
});

test('UUID reuse conflicts across transitions and after later cycles, not just while reserved', async () => {
  const opening = await input();
  await api().openFirst(ownerA, groupId, opening);
  const freezeRequest = await input(opening.intent);
  await assert.rejects(api().freeze(ownerA, groupId, freezeRequest), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const frozenIntent = await input();
  await api().freeze(ownerA, groupId, frozenIntent);
  await close();
  await api().openNext(ownerA, groupId, await input());
  assert.equal((await api().freeze(ownerA, groupId, frozenIntent)).replayed, true);
  assert.equal((await state()).cycle.status, 'open');
  await assert.rejects(
    api().freeze(ownerA, groupId, { ...(await input()), intent: frozenIntent.intent }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
});

test('unknown journal and pointer acknowledgement outcomes recover without allocating new identities', async () => {
  for (const boundary of ['journal', 'pointer']) {
    await Promise.all(models.map((m) => m.deleteMany({})));
    await fixture();
    const receipts = createCycleTransitionRepository(),
      groups = createGroupRepository();
    let armed = true;
    const service = api({
      receipts: {
        ...receipts,
        async create(op) {
          const row = await receipts.create(op);
          if (boundary === 'journal' && armed) {
            armed = false;
            throw new Error('Unknown journal acknowledgement');
          }
          return row;
        },
      },
      groups: {
        ...groups,
        async mirrorLifecycle(id, op) {
          const row = await groups.mirrorLifecycle(id, op);
          if (boundary === 'pointer' && armed) {
            armed = false;
            throw new Error('Unknown pointer acknowledgement');
          }
          return row;
        },
      },
    });
    const request = await input();
    await assert.rejects(service.openFirst(ownerA, groupId, request), /Unknown/);
    const target = String((await state()).group.financialOperation.targetId);
    await api().recover(ownerA, groupId);
    assert.equal(String((await state()).cycle._id), target);
    assert.equal((await api().openFirst(ownerA, groupId, request)).replayed, true);
    assert.equal(await GroupFinancialCycle.countDocuments({ group: groupId }), 1);
  }
});

test('checking is cancellable only before effects; stale owner edits and invalid cycle data cannot promote', async () => {
  await open();
  const request = await input();
  await assert.rejects(
    api({
      fault: async (stage) => {
        if (stage === 'after_reserve') throw new Error('Injected');
      },
    }).freeze(ownerA, groupId, request),
    /Injected/,
  );
  const held = await state();
  await createGroupRepository().replaceForOwner(ownerA, groupId, held.group.__v, {
    name: 'Concurrent metadata',
  });
  await assert.rejects(api().recover(ownerA, groupId), { code: 'CYCLE_OPERATION_STALE' });
  assert.equal((await state()).group.financialOperation, undefined);
  assert.equal((await state()).cycle.status, 'open');
  const { cycle } = await state();
  await GroupFinancialCycle.collection.updateOne(
    { _id: cycle._id },
    {
      $set: {
        memberIds: [new mongoose.Types.ObjectId(ownerA), new mongoose.Types.ObjectId(ownerA)],
      },
    },
    { bypassDocumentValidation: true },
  );
  await assert.rejects(api().freeze(ownerA, groupId, await input()), {
    code: 'CYCLE_DATA_INVALID',
  });
});

test('maximum safe sequence cannot wrap and personal records are untouched', async () => {
  await open();
  await freeze();
  await close();
  const { cycle } = await state();
  await GroupFinancialCycle.collection.updateOne(
    { _id: cycle._id },
    {
      $set: { sequence: Number.MAX_SAFE_INTEGER, previousCycleId: new mongoose.Types.ObjectId() },
    },
  );
  await assert.rejects(api().openNext(ownerA, groupId, await input()), {
    code: 'CYCLE_SEQUENCE_EXHAUSTED',
  });
  for (const name of ['transactions', 'budgets', 'recurringschedules'])
    assert.equal(await mongoose.connection.db.collection(name).countDocuments({}), 0);
  assert.equal((await state()).group.financialOperation, undefined);
});

test('lifecycle recovery dispatches existing financial intents through the same injected repositories', async () => {
  await open();
  const pause = gate('before_target_write'),
    first = await worker(pause.fault),
    second = await worker();
  try {
    const { group, cycle } = await state();
    const pending = first.financial.run(
      ownerA,
      groupId,
      String(cycle._id),
      group.cycleEpoch,
      'expense_create',
      {
        data: expense(100, [ownerA]),
        key: randomUUID(),
      },
    );
    await pause.ready;
    assert.equal((await second.life.recover(ownerA, groupId)).recovered, true);
    pause.release();
    await pending;
    assert.equal(await GroupExpense.countDocuments({ group: groupId }), 1);
  } finally {
    pause.release();
    await Promise.all([first.connection.close(), second.connection.close()]);
  }
});

test('full lifecycle leaves existing personal transaction, budget and recurring documents byte-for-byte unchanged', async () => {
  const { Transaction } = await import('../src/models/transaction.model.js');
  const { Budget } = await import('../src/models/budget.model.js');
  const { RecurringSchedule } = await import('../src/models/recurring.model.js');
  const startDate = '2026-10-16T00:00:00.000Z';
  const base = {
    owner: ownerA,
    type: 'expense',
    title: 'Personal sentinel',
    amountMinor: 12345,
    currency: 'INR',
    category: 'food_dining',
  };
  const transaction = await Transaction.create({ ...base, transactionDate: startDate });
  const budget = await Budget.create({
    owner: ownerA,
    category: 'food_dining',
    amountMinor: 50000,
    currency: 'INR',
    month: '2026-10',
  });
  const schedule = await RecurringSchedule.create({
    ...base,
    frequency: 'monthly',
    startDate,
    nextOccurrenceDate: startDate,
  });
  const docs = [
    [Transaction, transaction._id],
    [Budget, budget._id],
    [RecurringSchedule, schedule._id],
  ];
  const before = await Promise.all(
    docs.map(([model, id]) => model.collection.findOne({ _id: id })),
  );
  await open();
  await createExpense();
  await confirm((await proposal()).row);
  await close();
  await api().openNext(ownerA, groupId, await input());
  await freeze();
  await close();
  const after = await Promise.all(docs.map(([model, id]) => model.collection.findOne({ _id: id })));
  assert.deepEqual(after, before);
});
