import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/cycle-migration-fixture.js';
import { migrateCycles } from '../src/migrations/cycle-v1/migrate.js';
import { assertNoCycleMaintenance } from '../src/config/cycle-maintenance.js';
import { createCycleFinancialService } from '../src/services/cycle-financial.service.js';
import { createGroupFinancialCycleRepository } from '../src/repositories/group-financial-cycle.repository.js';
import { canonical } from '../src/migrations/cycle-v1/reconcile.js';

test('offline migration preserves realistic open/frozen financial history, tombstones, receipts and exact balances', async () => {
  const f = await fixture();
  let directory;
  try {
    const { Transaction } = await import('../src/models/transaction.model.js');
    const { Budget } = await import('../src/models/budget.model.js');
    const { RecurringSchedule } = await import('../src/models/recurring.model.js');
    const personal = [];
    const base = {
      owner: f.a,
      type: 'expense',
      title: 'Personal synthetic sentinel',
      amountMinor: 12345,
      currency: 'INR',
      category: 'food_dining',
    };
    for (const [original, data] of [
      [Transaction, { ...base, transactionDate: '2026-10-01T00:00:00.000Z' }],
      [
        Budget,
        {
          owner: f.a,
          amountMinor: 50000,
          currency: 'INR',
          category: 'food_dining',
          month: '2026-10',
        },
      ],
      [
        RecurringSchedule,
        {
          ...base,
          frequency: 'monthly',
          startDate: '2026-10-01T00:00:00.000Z',
          nextOccurrenceDate: '2026-10-01T00:00:00.000Z',
        },
      ],
    ]) {
      const model = f.connection.model(original.modelName, original.schema);
      const created = await model.create(data);
      personal.push({
        model,
        id: created._id,
        before: await model.collection.findOne({ _id: created._id }),
      });
    }
    const empty = await f.group('Empty'),
      open = await f.group('Open'),
      confirmed = await f.group('Confirmed'),
      pending = await f.group('Pending'),
      rejected = await f.group('Rejected'),
      deleted = await f.group('Deleted'),
      max = await f.group('Maximum'),
      mixed = await f.group('Mixed');
    const openKey = randomUUID();
    const openExpense = await f.expense(open, undefined, undefined, openKey);
    await f.expenseService.update(
      f.a,
      String(open._id),
      openExpense.expense.id,
      { title: 'Edited historical title' },
      `"tn-${openExpense.expense.id}-v0"`,
    );
    const legacyProposals = new Map();
    for (const [g, status] of [
      [confirmed, 'confirmed'],
      [pending, 'pending'],
      [rejected, 'rejected'],
    ]) {
      await f.expense(g);
      legacyProposals.set(String(g._id), await f.proposal(g, status));
    }
    const key = randomUUID(),
      created = await f.expense(deleted, 100, undefined, key);
    await f.expenseService.remove(
      f.a,
      String(deleted._id),
      created.expense.id,
      `"tn-${created.expense.id}-v0"`,
    );
    await f.expense(max, Number.MAX_SAFE_INTEGER, { method: 'equal', participants: [f.a] });
    await f.expense(mixed, 10001, { method: 'equal', participants: [f.c, f.b, f.a] });
    await f.expense(mixed, 100, {
      method: 'exact',
      participants: [
        { user: f.a, amountMinor: 25 },
        { user: f.b, amountMinor: 75 },
      ],
    });
    await f.expense(mixed, 101, {
      method: 'percentage',
      participants: [
        { user: f.a, basisPoints: 3333 },
        { user: f.b, basisPoints: 6667 },
      ],
    });
    const before = await f.models.G.collection.find({}).sort({ _id: 1 }).toArray();
    const proof = await f.backup();
    directory = proof.directory;
    const input = f.input(proof.manifest),
      report = await migrateCycles(input, { batchSize: 1 });
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.groups.length, 8);
    assert.equal(report.groups.filter((r) => r.classification === 'frozen_history').length, 3);
    assert.equal(
      report.groups.find((r) => r.groupId === String(max._id)).totals.expenseMinor,
      String(Number.MAX_SAFE_INTEGER),
    );
    assert.equal(await f.models.C.countDocuments({}), 7);
    assert.equal((await f.models.G.findById(empty._id)).currentCycleId, undefined);
    for (const original of before) {
      const after = await f.models.G.collection.findOne({ _id: original._id });
      for (const field of [
        '__v',
        'members',
        'financialHistoryAt',
        'settlementStartedAt',
        'name',
        'creator',
        'createdAt',
        'updatedAt',
      ])
        assert.equal(canonical(after[field]), canonical(original[field]));
    }
    for (const original of [confirmed, pending, rejected]) {
      const group = await f.models.G.findById(original._id);
      assert.equal(group.currentCycleState, 'frozen');
      assert.equal((await f.models.C.findById(group.currentCycleId)).status, 'frozen');
      await assert.rejects(
        f.expenseService.create(f.a, String(group._id), f.data(), randomUUID()),
        { code: 'CYCLE_MIGRATION_MAINTENANCE' },
      );
      const historicalExpense = await f.models.E.findOne({ group: group._id });
      const etag = `"tn-${historicalExpense._id}-v${historicalExpense.__v}"`;
      await assert.rejects(
        f.expenseService.update(
          f.a,
          String(group._id),
          String(historicalExpense._id),
          { title: 'Blocked historical change' },
          etag,
        ),
        { code: 'CYCLE_MIGRATION_MAINTENANCE' },
      );
      await assert.rejects(
        f.expenseService.remove(f.a, String(group._id), String(historicalExpense._id), etag),
        { code: 'CYCLE_MIGRATION_MAINTENANCE' },
      );
      await assert.rejects(
        f
          .financial({
            groups: { ...f.groups, offlineMigrationRunId: String(group.cycleMigration.runId) },
          })
          .run(f.a, String(group._id), 'expense_create', {}),
        { code: 'CYCLE_PROTOCOL_INACTIVE' },
      );
      const internal = createCycleFinancialService({
        internalEnabled: true,
        groups: { ...f.groups, offlineMigrationRunId: String(group.cycleMigration.runId) },
        cycles: createGroupFinancialCycleRepository(f.models.C),
        expenses: f.expenses,
        settlements: f.settlements,
        balances: f.balances,
      });
      const originalProposal = legacyProposals.get(String(group._id));
      const proposalReplay = await internal.run(
        f.b,
        String(group._id),
        String(group.currentCycleId),
        1,
        'settlement_create',
        {
          data: { recipient: f.a, amountMinor: 1000, currency: 'INR' },
          key: originalProposal.key,
        },
      );
      assert.equal(proposalReplay.replayed, true);
      assert.equal(String(proposalReplay.row._id), originalProposal.settlement.id);
      for (const kind of ['expense_update', 'expense_delete']) {
        await assert.rejects(
          internal.run(f.a, String(group._id), String(group.currentCycleId), 1, kind, {
            targetId: String(historicalExpense._id),
            version: historicalExpense.__v,
            ...(kind === 'expense_update' ? { data: f.data() } : {}),
          }),
          { code: 'FINANCIAL_BUSY' },
        );
      }
      await assert.rejects(
        internal.run(f.a, String(group._id), String(group.currentCycleId), 1, 'expense_create', {
          data: f.data(),
          key: randomUUID(),
        }),
        { code: 'FINANCIAL_BUSY' },
      );
    }
    const openGroup = await f.models.G.findById(open._id);
    const internal = createCycleFinancialService({
      internalEnabled: true,
      groups: { ...f.groups, offlineMigrationRunId: String(openGroup.cycleMigration.runId) },
      cycles: createGroupFinancialCycleRepository(f.models.C),
      expenses: f.expenses,
      settlements: f.settlements,
      balances: f.balances,
    });
    const receipt = await internal.run(
      f.a,
      String(open._id),
      String(openGroup.currentCycleId),
      1,
      'expense_create',
      { data: f.data(), key: openKey },
    );
    assert.equal(receipt.replayed, true);
    assert.equal(receipt.row.title, 'Edited historical title');
    const deletedGroup = await f.models.G.findById(deleted._id);
    await assert.rejects(
      internal.run(
        f.a,
        String(deleted._id),
        String(deletedGroup.currentCycleId),
        1,
        'expense_create',
        { data: f.data(100), key },
      ),
      { code: 'EXPENSE_DELETED' },
    );
    for (const { model, id, before } of personal)
      assert.equal(canonical(await model.collection.findOne({ _id: id })), canonical(before));
    const replay = await migrateCycles(input, { batchSize: 1 });
    assert.deepEqual(replay.groups, report.groups);
    assert.equal(await f.models.C.countDocuments({}), 7);
    await assert.rejects(assertNoCycleMaintenance(f.uri));
    assert.equal(JSON.stringify(report).includes('Private financial note'), false);
    console.log(JSON.stringify({ rehearsalReport: report }));
  } finally {
    await f.cleanup(directory);
  }
});

test('legacy fixed reservations recover before association; corrupt reservations remain held and quarantined', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Recover fixed intent');
    await f.models.G.collection.updateOne(
      { _id: group._id },
      { $set: { financialHistoryAt: new Date() } },
    );
    const target = new f.connection.base.Types.ObjectId(),
      operationKey = 'a'.repeat(64),
      hash = 'b'.repeat(64);
    await assert.rejects(
      f
        .financial({
          expenses: {
            ...f.expenses,
            async create(...args) {
              await f.expenses.create(...args);
              throw new Error('Unknown committed acknowledgement');
            },
          },
        })
        .run(f.a, String(group._id), 'expense_create', {
          targetId: String(target),
          data: f.data(),
          key: operationKey,
          hash,
        }),
      /Unknown/,
    );
    const before = await f.models.E.collection.findOne({ _id: target });
    const proof = await f.backup();
    directory = proof.directory;
    const result = await migrateCycles(f.input(proof.manifest));
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await f.models.E.collection.findOne({ _id: target });
    const { cycleId: _id, ...unchanged } = after;
    assert.equal(canonical(unchanged), canonical(before));
    assert.equal(await f.models.E.countDocuments({ group: group._id }), 1);
    assert.equal((await f.models.G.findById(group._id)).financialOperation, undefined);
  } finally {
    await f.cleanup(directory);
  }
});

test('unresolved reservation never force-clears or activates any group', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Unresolved');
    await f.models.G.collection.updateOne(
      { _id: group._id },
      {
        $set: {
          financialHistoryAt: new Date(),
          financialOperation: {
            _id: new f.connection.base.Types.ObjectId(),
            actor: group.creator,
            kind: 'expense_create',
            payload: { targetId: 'invalid' },
            createdAt: new Date(),
          },
        },
      },
    );
    const proof = await f.backup();
    directory = proof.directory;
    const result = await migrateCycles(f.input(proof.manifest));
    assert.equal(result.ok, false);
    assert.equal(result.groups[0].discrepancy, 'UNRESOLVED_FINANCIAL_OPERATION');
    assert.ok((await f.models.G.findById(group._id)).financialOperation);
    assert.equal(await f.models.G.countDocuments({ financialProtocolVersion: 2 }), 0);
  } finally {
    await f.cleanup(directory);
  }
});

for (const variant of ['invalid_money', 'missing_member', 'untracked_partial']) {
  test(`${variant} quarantines rather than repairing financial history`, async () => {
    const f = await fixture();
    let directory;
    try {
      const group = await f.group('Quarantine');
      const created = await f.expense(group);
      if (variant === 'invalid_money')
        await f.models.E.collection.updateOne(
          { _id: new f.connection.base.Types.ObjectId(created.expense.id) },
          { $set: { amountMinor: 1.5 } },
          { bypassDocumentValidation: true },
        );
      if (variant === 'missing_member')
        await f.models.U.collection.deleteOne({ _id: new f.connection.base.Types.ObjectId(f.b) });
      if (variant === 'untracked_partial')
        await f.models.E.collection.updateOne(
          { _id: new f.connection.base.Types.ObjectId(created.expense.id) },
          { $set: { cycleId: new f.connection.base.Types.ObjectId() } },
        );
      const proof = await f.backup();
      directory = proof.directory;
      const result = await migrateCycles(f.input(proof.manifest));
      assert.equal(result.ok, false);
      assert.ok(result.groups[0].discrepancy);
      assert.equal(await f.models.G.countDocuments({ financialProtocolVersion: 2 }), 0);
      assert.equal(await f.models.C.countDocuments({}), 0);
    } finally {
      await f.cleanup(directory);
    }
  });
}

test('missing receipt indexes, altered validators, absent backup and changed backup source block preflight', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Preflight');
    await f.expense(group);
    const proof = await f.backup();
    directory = proof.directory;
    const input = f.input(proof.manifest);
    await assert.rejects(migrateCycles({ ...input, backupManifest: undefined }), {
      code: 'VERIFIED_BACKUP_REQUIRED',
    });
    await f.models.E.collection.dropIndex('group_1_creator_1_creationKey_1');
    await assert.rejects(migrateCycles(input), { code: 'REQUIRED_INDEX_MISSING' });
    await f.models.E.createIndexes();
    await f.connection.db.command({
      collMod: f.models.E.collection.name,
      validator: { title: { $type: 'string' } },
    });
    await assert.rejects(migrateCycles(input), { code: 'COLLECTION_VALIDATOR_MISMATCH' });
    const { groupExpenseCollectionValidator } =
      await import('../src/models/group-expense.model.js');
    await f.connection.db.command({
      collMod: f.models.E.collection.name,
      validator: groupExpenseCollectionValidator,
    });
    await f.models.G.collection.updateOne(
      { _id: group._id },
      { $set: { name: 'Changed after backup' } },
    );
    await assert.rejects(migrateCycles(input), { code: 'BACKUP_SOURCE_CHANGED' });
    assert.equal(await f.connection.db.collection('cyclemigrationruns').countDocuments({}), 0);
  } finally {
    await f.cleanup(directory);
  }
});

test('all migration boundaries and bounded batches resume the same cycle and immutable receipts', async () => {
  const stages = [
    'after_preflight',
    'after_maintenance_marker',
    'during_index_install',
    'after_recovery',
    'after_identity_allocation',
    'after_cycle_insert',
    'during_expense_batch',
    'after_expense_association',
    'during_settlement_batch',
    'after_settlement_association',
    'after_reconciliation',
    'during_strict_validator_install',
    'after_protocol_activation',
    'after_post_verification',
  ];
  for (const stage of stages) {
    const f = await fixture();
    let directory;
    try {
      const group = await f.group(`Interrupted ${stage}`);
      await f.expense(group);
      await f.expense(group, 100);
      await f.proposal(group, 'pending');
      const proof = await f.backup();
      directory = proof.directory;
      const input = f.input(proof.manifest);
      let armed = true;
      await assert.rejects(
        migrateCycles(input, {
          batchSize: 1,
          fault: async (at) => {
            if (armed && at === stage) {
              armed = false;
              throw new Error(`Injected ${stage}`);
            }
          },
        }),
        /Injected/,
      );
      const cp = await f.connection.db
        .collection('cyclemigrationgroups')
        .findOne({ _id: group._id });
      if (cp && cp.phase < 7) {
        assert.equal(
          (await f.models.G.findById(group._id)).financialProtocolVersion,
          stage === 'after_protocol_activation' ? 2 : undefined,
        );
        await assert.rejects(
          f.expenseService.create(f.a, String(group._id), f.data(), randomUUID()),
          { code: 'CYCLE_MIGRATION_MAINTENANCE' },
        );
      }
      const result = await migrateCycles(input, { batchSize: 1 });
      assert.equal(result.ok, true, `${stage}: ${JSON.stringify(result)}`);
      if (cp) assert.equal(result.groups[0].cycleId, String(cp.cycleId));
      assert.equal(await f.models.C.countDocuments({ group: group._id }), 1);
      assert.equal(await f.models.E.countDocuments({ group: group._id }), 2);
      assert.equal(await f.models.S.countDocuments({ group: group._id }), 1);
      assert.deepEqual((await migrateCycles(input)).groups, result.groups);
    } finally {
      await f.cleanup(directory);
    }
  }
});

test('current writer predicates reject maintenance writes; an unfenced old writer is detected, not claimed fenced', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Writer stopped');
    await f.expense(group);
    const proof = await f.backup();
    directory = proof.directory;
    let checked = false;
    const report = await migrateCycles(f.input(proof.manifest), {
      fault: async (stage) => {
        if (stage !== 'after_reconciliation' || checked) return;
        checked = true;
        const held = await f.models.G.findById(group._id);
        assert.equal(
          await f.groups.replaceForOwner(f.a, String(group._id), held.__v, {
            name: 'Blocked mutation',
          }),
          null,
        );
        assert.equal(
          await f.groups.reserveFinancial(f.a, String(group._id), held.__v, {
            _id: new f.connection.base.Types.ObjectId(),
            actor: f.a,
            kind: 'expense_create',
            payload: {},
            createdAt: new Date(),
          }),
          null,
        );
        await assert.rejects(f.expense(group), { code: 'CYCLE_MIGRATION_MAINTENANCE' });
        // Emulate a pre-upgrade raw binary which ignores the new group maintenance predicate.
        // This is precisely why actual shutdown and credential/network isolation are mandatory.
        const row = await f.models.E.collection.findOne({ group: group._id });
        await f.models.E.collection.updateOne(
          { _id: row._id },
          { $set: { title: 'Unfenced old writer changed data' } },
        );
      },
    });
    assert.equal(report.ok, false);
    assert.equal(report.groups[0].discrepancy, 'PRE_ACTIVATION_MISMATCH');
    assert.equal((await f.models.G.findById(group._id)).financialProtocolVersion, undefined);
  } finally {
    await f.cleanup(directory);
  }
});

test('two OS migration workers share durable identities and reconcile concurrent execution', async () => {
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  const f = await fixture();
  let directory, first;
  try {
    const group = await f.group('Two independent migrators');
    await f.expense(group);
    const proof = await f.backup();
    directory = proof.directory;
    const input = f.input(proof.manifest);
    const env = { ...process.env, TALLYNEST_MIGRATION_INPUT: JSON.stringify(input) };
    first = fork(new URL('./helpers/cycle-migration-worker.js', import.meta.url), [], {
      env: { ...env, TALLYNEST_MIGRATION_STOP: 'after_identity_allocation' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const pause = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker boundary timeout')), 15000);
      first.once('message', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      first.once('error', reject);
      first.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('First worker exited early'));
      });
    });
    assert.equal(pause.stage, 'after_identity_allocation');
    const second = fork(new URL('./helpers/cycle-migration-worker.js', import.meta.url), [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const firstExit = once(first, 'exit');
    first.send({ resume: true });
    let message;
    second.on('message', (value) => {
      message = value;
    });
    const [code] = await once(second, 'exit');
    assert.equal(code, 0, JSON.stringify(message));
    assert.equal(message.ok, true);
    const [firstCode] = await firstExit;
    assert.equal(firstCode, 0);
    // Both independent processes were allowed to finish the same group concurrently.
    const result = await migrateCycles(input);
    assert.equal(result.ok, true);
    assert.equal(await f.models.C.countDocuments({ group: group._id }), 1);
  } finally {
    if (first && !first.killed) first.kill('SIGKILL');
    await f.cleanup(directory);
  }
});

test('SIGKILL during bounded backfill resumes in a fresh OS process with the same cycle and receipts', async () => {
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  const f = await fixture();
  let directory, child;
  try {
    const group = await f.group('Kill after one document');
    await f.expense(group);
    await f.expense(group, 100);
    const proof = await f.backup();
    directory = proof.directory;
    const input = f.input(proof.manifest);
    const env = { ...process.env, TALLYNEST_MIGRATION_INPUT: JSON.stringify(input) };
    child = fork(new URL('./helpers/cycle-migration-worker.js', import.meta.url), [], {
      env: { ...env, TALLYNEST_MIGRATION_STOP: 'during_expense_batch' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kill boundary timeout')), 15000);
      child.once('message', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Child exited before backfill'));
      });
    });
    assert.equal(message.stage, 'during_expense_batch');
    const checkpoint = await f.connection.db
      .collection('cyclemigrationgroups')
      .findOne({ _id: group._id });
    assert.equal(
      await f.models.E.countDocuments({ group: group._id, cycleId: checkpoint.cycleId }),
      1,
    );
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    const [_code, signal] = await exit;
    assert.equal(signal, 'SIGKILL');
    const fresh = fork(new URL('./helpers/cycle-migration-worker.js', import.meta.url), [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let result;
    fresh.on('message', (value) => {
      result = value;
    });
    const [code] = await once(fresh, 'exit');
    assert.equal(code, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal(
      String((await f.models.G.findById(group._id)).currentCycleId),
      String(checkpoint.cycleId),
    );
    assert.equal(
      await f.models.E.countDocuments({ group: group._id, cycleId: checkpoint.cycleId }),
      2,
    );
    assert.equal(await f.models.C.countDocuments({ group: group._id }), 1);
  } finally {
    if (child && !child.killed) child.kill('SIGKILL');
    await f.cleanup(directory);
  }
});

test('recovery before insertion reuses original target and durable operation proof across another interruption', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Recover uninserted fixed target');
    await f.models.G.collection.updateOne(
      { _id: group._id },
      { $set: { financialHistoryAt: new Date() } },
    );
    const target = new f.connection.base.Types.ObjectId();
    await assert.rejects(
      f
        .financial({
          expenses: {
            ...f.expenses,
            async create() {
              throw new Error('Interrupted before insert');
            },
          },
        })
        .run(f.a, String(group._id), 'expense_create', {
          targetId: String(target),
          data: f.data(),
          key: 'c'.repeat(64),
          hash: 'd'.repeat(64),
        }),
      /Interrupted/,
    );
    const operation = (await f.models.G.findById(group._id)).financialOperation._id;
    const proof = await f.backup();
    directory = proof.directory;
    const input = f.input(proof.manifest);
    await assert.rejects(
      migrateCycles(input, {
        fault: async (stage) => {
          if (stage === 'after_recovery') throw new Error('Stop after recovery');
        },
      }),
      /Stop/,
    );
    const checkpoint = await f.connection.db
      .collection('cyclemigrationgroups')
      .findOne({ _id: group._id });
    assert.equal(String(checkpoint.recoveryReceipt.operationId), String(operation));
    assert.equal(String(checkpoint.recoveryReceipt.targetId), String(target));
    assert.equal((await f.models.G.findById(group._id)).financialOperation, undefined);
    const report = await migrateCycles(input);
    assert.equal(report.ok, true);
    assert.equal(await f.models.E.countDocuments({ group: group._id }), 1);
    assert.equal(
      String((await f.models.E.findById(target)).lastFinancialOperation),
      String(operation),
    );
  } finally {
    await f.cleanup(directory);
  }
});

test('post-migration validators reject missing cycle IDs and invalid verified pointers', async () => {
  const f = await fixture();
  let directory;
  try {
    const group = await f.group('Strict staging');
    await f.expense(group);
    await f.proposal(group, 'pending');
    const proof = await f.backup();
    directory = proof.directory;
    const report = await migrateCycles(f.input(proof.manifest));
    assert.equal(report.ok, true);
    const expense = await f.models.E.collection.findOne({ group: group._id });
    const settlement = await f.models.S.collection.findOne({ group: group._id });
    await assert.rejects(
      f.models.E.collection.updateOne({ _id: expense._id }, { $unset: { cycleId: 1 } }),
      (error) => error.code === 121,
    );
    await assert.rejects(
      f.models.S.collection.updateOne({ _id: settlement._id }, { $unset: { cycleId: 1 } }),
      (error) => error.code === 121,
    );
    await assert.rejects(
      f.models.G.collection.updateOne({ _id: group._id }, { $unset: { currentCycleId: 1 } }),
      (error) => error.code === 121,
    );
    const cycle = await f.models.C.findOne({ group: group._id });
    assert.equal(cycle.migrationVersion, 1);
    assert.equal(
      String(cycle.migrationRunId),
      String((await f.models.G.findById(group._id)).cycleMigration.runId),
    );
  } finally {
    await f.cleanup(directory);
  }
});

test('actual backup and migration CLIs accept only explicit disposable offline inputs and replay successfully', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { name } = await import('./helpers/cycle-migration-fixture.js');
  const f = await fixture();
  let directory;
  try {
    await f.expense(await f.group('Actual command line'));
    directory = await mkdtemp(join(tmpdir(), 'tallynest-cycle-backup-'));
    const args = [
      '--uri',
      f.uri,
      '--database',
      f.database,
      '--maintenance-id',
      randomUUID(),
      '--offline',
      '--writers-stopped',
      '--disposable',
    ];
    const execute = promisify(execFile);
    const backup = await execute(process.execPath, [
      new URL('../scripts/rehearse-cycle-backup.js', import.meta.url).pathname,
      ...args,
      '--restore-database',
      name(),
      '--directory',
      directory,
    ]);
    const proof = JSON.parse(backup.stdout);
    assert.equal(proof.ok, true);
    assert.equal(proof.restored, true);
    const command = [
      new URL('../scripts/rehearse-cycle-migration.js', import.meta.url).pathname,
      ...args,
      '--backup-manifest',
      proof.manifest,
    ];
    const result = JSON.parse((await execute(process.execPath, command)).stdout);
    assert.equal(result.ok, true);
    assert.deepEqual(
      JSON.parse((await execute(process.execPath, command)).stdout).groups,
      result.groups,
    );
  } finally {
    await f.cleanup(directory);
  }
});

test('backup refusal never drops or modifies a nonempty disposable restore target', async () => {
  const mongoose = await import('mongoose');
  const { mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { rehearsalBackup } = await import('../src/migrations/cycle-v1/backup.js');
  const { name } = await import('./helpers/cycle-migration-fixture.js');
  const f = await fixture();
  let directory, restore;
  try {
    await f.expense(await f.group('Source remains untouched'));
    const restoreDatabase = name();
    restore = await mongoose.default
      .createConnection(`mongodb://127.0.0.1:27017/${restoreDatabase}`)
      .asPromise();
    await restore.db.collection('sentinel').insertOne({ _id: 'existing', value: 'must remain' });
    directory = await mkdtemp(join(tmpdir(), 'tallynest-cycle-backup-'));
    await assert.rejects(
      rehearsalBackup({ db: f.connection.db, database: f.database, restoreDatabase, directory }),
      { code: 'RESTORE_TARGET_NOT_EMPTY' },
    );
    assert.deepEqual(await restore.db.collection('sentinel').findOne({ _id: 'existing' }), {
      _id: 'existing',
      value: 'must remain',
    });
    assert.equal(await f.models.E.countDocuments({}), 1);
  } finally {
    if (restore) {
      await restore.dropDatabase();
      await restore.close();
    }
    await f.cleanup(directory);
  }
});
