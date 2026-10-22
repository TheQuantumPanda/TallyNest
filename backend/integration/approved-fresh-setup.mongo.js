// No hosted URI is accepted or used by this suite.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import mongoose from 'mongoose';
import {
  approvedSchemaDigest,
  approvalDigest,
  provisionApprovedFresh,
} from '../src/config/approved-fresh-setup.js';
import { FRESH_MANIFEST_COLLECTION, freshCollections } from '../src/config/fresh-cycle-schema.js';
import {
  assertFreshCycleReadiness,
  installFreshCycleSchema,
} from '../src/config/fresh-cycle-setup.js';

const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', {
  maxPoolSize: 2,
  serverSelectionTimeoutMS: 10000,
});
const owned = new Set();
after(async () => {
  try {
    await client.connect();
    for (const name of owned) {
      assert.match(name, /^tn_rehearsal_[a-f0-9]{12}$/);
      await client.db(name).dropDatabase();
    }
    const names = (
      await client.db('admin').admin().listDatabases({ nameOnly: true })
    ).databases.map((row) => row.name);
    assert.ok([...owned].every((name) => !names.includes(name)));
    process.stdout.write(`Verified ${owned.size} owned operator-setup database cleanups\n`);
  } finally {
    await client.close();
  }
});
async function fixture() {
  await client.connect();
  const name = 'tn_rehearsal_' + randomBytes(6).toString('hex');
  const existing = (await client.db('admin').admin().listDatabases({ nameOnly: true })).databases;
  assert.ok(!existing.some((row) => row.name === name), 'Generated target must not already exist');
  owned.add(name);
  process.stdout.write('Disposable operator setup database: ' + name + '\n');
  const plan = {
    formatVersion: 1,
    setupId: randomUUID(),
    purpose: 'generated-data-only',
    target: {
      srvHost: 'cluster0.fixture.mongodb.net',
      database: name,
      replicaSet: 'atlas-fixture-shard-0',
    },
    schemaDigest: approvedSchemaDigest,
    writersStopped: true,
    runtimeCredentialWithheld: true,
  };
  const db = client.db(name);
  let receipt;
  const run = (extra = {}) =>
    provisionApprovedFresh({
      db,
      plan,
      approval: approvalDigest(plan),
      receipt,
      saveReceipt: async (value) => {
        receipt = structuredClone(value);
      },
      ...extra,
    });
  return { db, plan, run, receipt: () => receipt };
}
async function snapshot(db) {
  const rows = await db.listCollections().toArray();
  return Promise.all(
    rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (row) => ({
        row,
        documents: await db.collection(row.name).find({}).sort({ _id: 1 }).toArray(),
        indexes: await db.collection(row.name).indexes(),
      })),
  );
}
test('approved empty setup and every owned interrupted checkpoint resume the same schema without adoption', async () => {
  for (const point of [
    'after_ownership_receipt',
    'after_manifest_insert',
    'after_collection',
    'after_indexes',
    'after_checkpoint',
    'after_ready',
  ]) {
    const f = await fixture();
    let stopped = false;
    await assert.rejects(
      f.run({
        fault: async (stage) => {
          if (stage === point && !stopped) {
            stopped = true;
            throw new Error('LOCAL_TEST_STOP');
          }
        },
      }),
      /LOCAL_TEST_STOP/,
    );
    const uuid = f.receipt().manifestUuid;
    await f.run();
    assert.equal(f.receipt().manifestUuid, uuid);
    assert.equal(f.receipt().phase, 'ready');
    await assertFreshCycleReadiness(f.db);
  }
});
test('ambiguous pre-receipt crash and unrelated even-valid empty schemas cannot be adopted', async () => {
  const f = await fixture();
  await assert.rejects(
    f.run({
      fault: async (stage) => {
        if (stage === 'before_ownership_receipt') throw new Error('STOP');
      },
    }),
    /STOP/,
  );
  const before = await snapshot(f.db);
  await assert.rejects(f.run(), /OPERATOR_OWNERSHIP_UNPROVEN/);
  assert.deepEqual(await snapshot(f.db), before);
  const other = await fixture();
  await installFreshCycleSchema(other.db);
  const installed = await snapshot(other.db);
  await assert.rejects(other.run(), /OPERATOR_OWNERSHIP_UNPROVEN/);
  assert.deepEqual(await snapshot(other.db), installed);
});
test('unknown/legacy/migration targets, ownership mismatch, data and schema drift are rejected unchanged', async () => {
  for (const prepare of [
    (db) => db.collection('unknown').insertOne({ fixture: true }),
    (db) => db.collection('groups').insertOne({ legacy: true }),
    (db) => db.collection('cyclemigrationruns').insertOne({ offlineHeld: true }),
  ]) {
    const f = await fixture();
    await prepare(f.db);
    const before = await snapshot(f.db);
    await assert.rejects(f.run(), /OPERATOR_(UNKNOWN_COLLECTION|DATABASE_NOT_EMPTY)/);
    assert.deepEqual(await snapshot(f.db), before);
  }
  const f = await fixture();
  await f.run();
  const good = f.receipt();
  const before = await snapshot(f.db);
  await assert.rejects(
    f.run({ receipt: { ...good, setupId: randomUUID() } }),
    /OPERATOR_RECEIPT_MISMATCH/,
  );
  assert.deepEqual(await snapshot(f.db), before);
  const name = freshCollections[0].name;
  await f.db.command({ collMod: name, validator: {} });
  const drifted = await snapshot(f.db);
  await assert.rejects(f.run(), /FRESH_VALIDATOR_MISMATCH/);
  assert.deepEqual(await snapshot(f.db), drifted);
  await f.db.collection(name).insertOne({ generated: true });
  const used = await snapshot(f.db);
  await assert.rejects(f.run(), /OPERATOR_DATABASE_NOT_EMPTY/);
  assert.deepEqual(await snapshot(f.db), used);
  assert.ok((await f.db.collection(FRESH_MANIFEST_COLLECTION).findOne({})).state === 'ready');
});

test('fresh backup audit reconciles two cycles, settlements and tombstones after an isolated copy; corruption fails closed', async () => {
  const { auditFreshBackup } = await import('../src/config/fresh-backup-audit.js');
  const { User } = await import('../src/models/user.model.js');
  const { Group } = await import('../src/models/group.model.js');
  const { GroupFinancialCycle } = await import('../src/models/group-financial-cycle.model.js');
  const { createGroupRepository } = await import('../src/repositories/group.repository.js');
  const { createCycleFinancialService } =
    await import('../src/services/cycle-financial.service.js');
  const { createCycleLifecycleService } =
    await import('../src/services/cycle-lifecycle.service.js');
  const source = await fixture();
  await source.run();
  await mongoose.connect(`mongodb://127.0.0.1:27017/${source.plan.target.database}`, {
    autoCreate: false,
    autoIndex: false,
  });
  try {
    const users = await User.create(
      ['owner', 'member'].map((name) => ({
        name,
        email: name + '@backup.invalid',
        passwordHash: '$2b$12$' + 'A'.repeat(53),
      })),
    );
    const [owner, member] = users.map((user) => String(user._id));
    const group = await createGroupRepository().createForOwnerV2(owner, {
      name: 'Fresh backup fixture',
    });
    group.members.push({ user: users[1]._id, role: 'member', createdAt: new Date() });
    await group.save();
    const id = String(group._id),
      money = createCycleFinancialService({ internalEnabled: true }),
      life = createCycleLifecycleService({ internalEnabled: true });
    const state = async () => {
      const g = await Group.findById(id);
      const cycle = g.currentCycleId ? await GroupFinancialCycle.findById(g.currentCycleId) : null;
      return { g, cycle };
    };
    const transition = async (action) => {
      const { g, cycle } = await state();
      return life[action](owner, id, {
        intent: randomUUID(),
        groupVersion: g.__v,
        ...(cycle
          ? { cycleId: String(cycle._id), cycleVersion: cycle.__v, epoch: g.cycleEpoch }
          : {}),
      });
    };
    const expense = async (amountMinor, participants = [owner, member]) => {
      const { g, cycle } = await state();
      return money.run(owner, id, String(cycle._id), g.cycleEpoch, 'expense_create', {
        key: randomUUID(),
        data: {
          payer: owner,
          title: 'Generated backup expense',
          amountMinor,
          currency: 'INR',
          category: 'food_dining',
          expenseDate: '2026-10-20T00:00:00.000Z',
          split: { method: 'equal', participants },
        },
      });
    };
    await transition('openFirst');
    const first = (await state()).cycle;
    const original = await expense(10001),
      tombstone = await expense(100, [owner]);
    await money.run(owner, id, String(first._id), 1, 'expense_delete', {
      targetId: String(tombstone.row._id),
      version: 0,
    });
    const proposal = await money.run(member, id, String(first._id), 1, 'settlement_create', {
      key: randomUUID(),
      data: { recipient: owner, amountMinor: owner < member ? 5000 : 5001, currency: 'INR' },
    });
    await money.run(owner, id, String(first._id), 1, 'settlement_confirm', {
      targetId: String(proposal.row._id),
      version: 0,
    });
    await transition('close');
    await transition('openNext');
    await expense(7);
    const before = await snapshot(source.db),
      proof = await auditFreshBackup(source.db);
    assert.deepEqual(
      proof.cycles.map((c) => c.members.map((m) => m.net)),
      [['0', '0'], owner < member ? ['3', '-3'] : ['-4', '4']],
    );
    assert.equal(proof.counts.groupexpenses, 3);
    assert.equal(proof.counts.groupsettlements, 1);
    assert.deepEqual(await snapshot(source.db), before);
    const target = await fixture();
    await target.run();
    for (const spec of freshCollections) {
      const rows = await source.db.collection(spec.name).find({}).toArray();
      if (rows.length) await target.db.collection(spec.name).insertMany(rows);
    }
    assert.deepEqual(await auditFreshBackup(target.db), proof);
    // Deliberate corruption of this generated restore fixture only: internally
    // valid expense amounts but a closed cycle that is no longer settled.
    await target.db.collection('groupexpenses').updateOne(
      { _id: original.row._id },
      {
        $set: { amountMinor: 10003, 'shares.0.amountMinor': 5002, 'shares.1.amountMinor': 5001 },
      },
    );
    await assert.rejects(auditFreshBackup(target.db), { code: 'CYCLE_NOT_SETTLED' });
  } finally {
    await mongoose.disconnect();
  }
});
