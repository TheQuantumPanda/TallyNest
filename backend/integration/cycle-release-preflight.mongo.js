import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { fixture } from './helpers/cycle-migration-fixture.js';
import { migrateCycles } from '../src/migrations/cycle-v1/migrate.js';
import {
  assessCycleReleasePreflight,
  verifyCycleSchemaAndIndexes,
} from '../src/staged/release-preflight.js';
import { assertCycleHttpReadiness } from '../src/staged/readiness.js';
import { databaseDigest, databaseSchemaDigest } from '../src/migrations/cycle-v1/reconcile.js';
import { RUN_ID } from '../src/migrations/cycle-v1/safety.js';

const runFile = promisify(execFile);

async function migratedFixture() {
  const f = await fixture();
  const open = await f.group('Open legacy group');
  const frozen = await f.group('Frozen legacy group');
  const pending = await f.group('Pending legacy group');
  const rejected = await f.group('Rejected legacy group');
  const deleted = await f.group('Deleted legacy expense group');
  await f.group('Empty legacy group');
  await f.expense(open);
  await f.expense(frozen);
  await f.expense(pending);
  await f.expense(rejected);
  await f.proposal(frozen, 'confirmed');
  await f.proposal(pending, 'pending');
  await f.proposal(rejected, 'rejected');
  const tombstone = await f.expense(deleted);
  await f.expenseService.remove(
    f.a,
    String(deleted._id),
    tombstone.expense.id,
    `"tn-${tombstone.expense.id}-v0"`,
  );
  const proof = await f.backup();
  const migrated = await migrateCycles(f.input(proof.manifest));
  assert.equal(migrated.ok, true);
  assert.equal(migrated.groups.length, 6);
  assert.equal(migrated.groups.filter((row) => row.classification === 'frozen_history').length, 3);
  assert.equal(
    migrated.groups.find((row) => row.groupId === String(deleted._id)).counts.tombstones,
    1,
  );
  return { f, open, frozen };
}

test('read-only preflight recognizes exact migrated validators while maintenance remains held', async () => {
  const { f } = await migratedFixture();
  try {
    const before = await databaseDigest(f.connection.db);
    const schemaBefore = await databaseSchemaDigest(f.connection.db);
    const report = await assessCycleReleasePreflight(f.connection);
    assert.equal((await verifyCycleSchemaAndIndexes(f.connection.db)).indexProbes, 7);
    await assert.rejects(assertCycleHttpReadiness(f.connection.db), {
      code: 'CYCLE_MIGRATION_MAINTENANCE',
    });
    assert.equal(report.status, 'BLOCKED', JSON.stringify(report));
    for (const key of ['migration', 'schema', 'indexes', 'associations', 'reservations'])
      assert.equal(report.checks[key].status, 'PASS', JSON.stringify(report));
    assert.deepEqual(report.checks.maintenance, {
      status: 'BLOCKED',
      code: 'CYCLE_MIGRATION_MAINTENANCE',
    });
    assert.equal(report.checks.runtimePrivileges.status, 'NOT_VERIFIED');
    assert.equal(report.metrics.reconciledGroups, 6);
    assert.equal(await databaseDigest(f.connection.db), before);
    assert.equal(await databaseSchemaDigest(f.connection.db), schemaBefore);
    const cli = await runFile(
      process.execPath,
      ['scripts/preflight-cycle-release.js', '--database', f.database],
      { cwd: fileURLToPath(new URL('../', import.meta.url)) },
    ).catch((error) => error);
    assert.equal(cli.code, 2);
    assert.equal(JSON.parse(cli.stdout).checks.maintenance.status, 'BLOCKED');
    assert.equal(await databaseDigest(f.connection.db), before);
    assert.equal(await databaseSchemaDigest(f.connection.db), schemaBefore);
    console.log(JSON.stringify({ measuredPreflight: report }));
  } finally {
    await f.cleanup();
  }
});

test('read-only preflight fails closed on isolated strict-schema, index, and financial drift', async (t) => {
  const { f, open, frozen } = await migratedFixture();
  const db = f.connection.db;
  const collection = (name) => db.collection(name);
  const rule = async (name) => (await db.listCollections({ name }).toArray())[0].options.validator;
  const savedGroupRule = await rule('groups');
  const savedExpenseRule = await rule('groupexpenses');
  const savedMarkerRule = await rule('cyclemigrationruns');
  const originalRun = await collection('cyclemigrationruns').findOne({ _id: RUN_ID });
  const openGroup = await collection('groups').findOne({ _id: open._id });
  const frozenGroup = await collection('groups').findOne({ _id: frozen._id });
  const openExpense = await collection('groupexpenses').findOne({ group: open._id });
  const frozenCycle = await collection('groupfinancialcycles').findOne({
    _id: frozenGroup.currentCycleId,
  });
  const index = async (name, predicate) => (await collection(name).indexes()).find(predicate);
  const drift = async (label, check, code, apply) => {
    await t.test(label, async () => {
      const undo = await apply();
      try {
        const report = await assessCycleReleasePreflight(f.connection);
        assert.deepEqual(
          report.checks[check],
          { status: check === 'reservations' ? 'BLOCKED' : 'FAIL', code },
          JSON.stringify(report),
        );
        assert.equal(report.status, check === 'reservations' ? 'BLOCKED' : 'FAIL');
      } finally {
        await undo();
      }
      const restored = await assessCycleReleasePreflight(f.connection);
      assert.equal(restored.checks.migration.status, 'PASS', JSON.stringify(restored));
      assert.equal(restored.checks.schema.status, 'PASS', JSON.stringify(restored));
      assert.equal(restored.checks.indexes.status, 'PASS', JSON.stringify(restored));
      assert.equal(restored.checks.associations.status, 'PASS', JSON.stringify(restored));
      assert.equal(restored.checks.reservations.status, 'PASS', JSON.stringify(restored));
    });
  };
  try {
    await drift('weakened expense validator', 'schema', 'CYCLE_SCHEMA_NOT_READY', async () => {
      await db.command({
        collMod: 'groupexpenses',
        validator: {},
        validationLevel: 'strict',
        validationAction: 'error',
      });
      return () =>
        db.command({
          collMod: 'groupexpenses',
          validator: savedExpenseRule,
          validationLevel: 'strict',
          validationAction: 'error',
        });
    });
    await drift(
      'unexpected metadata validator',
      'schema',
      'MIGRATION_METADATA_SCHEMA_INVALID',
      async () => {
        await db.command({
          collMod: 'cyclemigrationruns',
          validator: {},
          validationLevel: 'strict',
          validationAction: 'error',
        });
        return () =>
          db.command({
            collMod: 'cyclemigrationruns',
            validator: savedMarkerRule,
            validationLevel: 'strict',
            validationAction: 'error',
          });
      },
    );
    await drift(
      'missing group-wide receipt unique index',
      'indexes',
      'CYCLE_INDEX_NOT_READY',
      async () => {
        const old = await index('groupexpenses', (row) => row.unique && row.key.creationKey === 1);
        await collection('groupexpenses').dropIndex(old.name);
        return () =>
          collection('groupexpenses').createIndex(old.key, { name: old.name, unique: true });
      },
    );
    await drift(
      'duplicate creation receipt after unique-index loss',
      'indexes',
      'CYCLE_INDEX_NOT_READY',
      async () => {
        const old = await index('groupexpenses', (row) => row.unique && row.key.creationKey === 1);
        const duplicateId = new mongoose.Types.ObjectId();
        await collection('groupexpenses').dropIndex(old.name);
        await collection('groupexpenses').insertOne({ ...openExpense, _id: duplicateId });
        return async () => {
          await collection('groupexpenses').deleteOne({ _id: duplicateId });
          await collection('groupexpenses').createIndex(old.key, { name: old.name, unique: true });
        };
      },
    );
    await drift(
      'unexpected active-slot partial filter',
      'indexes',
      'CYCLE_INDEX_NOT_READY',
      async () => {
        const old = await index(
          'groupfinancialcycles',
          (row) => row.partialFilterExpression?.activeSlot === true,
        );
        await collection('groupfinancialcycles').dropIndex(old.name);
        await collection('groupfinancialcycles').createIndex(old.key, {
          name: old.name,
          unique: true,
          partialFilterExpression: { activeSlot: false },
        });
        return async () => {
          await collection('groupfinancialcycles').dropIndex(old.name);
          await collection('groupfinancialcycles').createIndex(old.key, {
            name: old.name,
            unique: true,
            partialFilterExpression: old.partialFilterExpression,
          });
        };
      },
    );
    await drift(
      'missing transition receipt index',
      'indexes',
      'CYCLE_INDEX_NOT_READY',
      async () => {
        const old = await index(
          'groupcycletransitions',
          (row) => row.unique && row.key.intentKey === 1,
        );
        await collection('groupcycletransitions').dropIndex(old.name);
        return () =>
          collection('groupcycletransitions').createIndex(old.key, {
            name: old.name,
            unique: true,
          });
      },
    );
    await drift(
      'unexpected TTL on financial receipt collection',
      'indexes',
      'CYCLE_INDEX_NOT_READY',
      async () => {
        await collection('groupcycletransitions').createIndex(
          { createdAt: 1 },
          { name: 'forbidden_receipt_ttl', expireAfterSeconds: 60 },
        );
        return () => collection('groupcycletransitions').dropIndex('forbidden_receipt_ttl');
      },
    );
    await drift(
      'missing migration checkpoint',
      'migration',
      'MIGRATION_CHECKPOINT_INVALID',
      async () => {
        await collection('cyclemigrationgroups').updateOne(
          { _id: open._id },
          { $set: { phase: 7 } },
        );
        return () =>
          collection('cyclemigrationgroups').updateOne({ _id: open._id }, { $set: { phase: 8 } });
      },
    );
    await drift(
      'tampered strict migration group set',
      'migration',
      'MIGRATION_GROUP_SET_INVALID',
      async () => {
        await collection('cyclemigrationruns').updateOne(
          { _id: RUN_ID },
          { $set: { strictGroups: [] } },
        );
        return () =>
          collection('cyclemigrationruns').updateOne(
            { _id: RUN_ID },
            { $set: { strictGroups: originalRun.strictGroups } },
          );
      },
    );
    await drift(
      'removed expense cycle association',
      'associations',
      'CYCLE_ASSOCIATION_INVALID',
      async () => {
        await collection('groupexpenses').updateOne(
          { _id: openExpense._id },
          { $unset: { cycleId: 1 } },
          { bypassDocumentValidation: true },
        );
        return () =>
          collection('groupexpenses').updateOne(
            { _id: openExpense._id },
            { $set: { cycleId: openExpense.cycleId } },
          );
      },
    );
    await drift('mismatched cycle epoch', 'associations', 'CYCLE_POINTER_INVALID', async () => {
      await collection('groups').updateOne(
        { _id: open._id },
        { $set: { cycleEpoch: 2 } },
        { bypassDocumentValidation: true },
      );
      return () =>
        collection('groups').updateOne(
          { _id: open._id },
          { $set: { cycleEpoch: openGroup.cycleEpoch } },
        );
    });
    await drift(
      'incorrect current cycle pointer',
      'associations',
      'CYCLE_POINTER_INVALID',
      async () => {
        await collection('groups').updateOne(
          { _id: open._id },
          { $set: { currentCycleId: new mongoose.Types.ObjectId() } },
          { bypassDocumentValidation: true },
        );
        return () =>
          collection('groups').updateOne(
            { _id: open._id },
            { $set: { currentCycleId: openGroup.currentCycleId } },
          );
      },
    );
    await drift(
      'incorrect current cycle state mirror',
      'associations',
      'CYCLE_POINTER_INVALID',
      async () => {
        await collection('groups').updateOne(
          { _id: open._id },
          { $set: { currentCycleState: 'frozen' } },
          { bypassDocumentValidation: true },
        );
        return () =>
          collection('groups').updateOne(
            { _id: open._id },
            { $set: { currentCycleState: openGroup.currentCycleState } },
          );
      },
    );
    await drift(
      'historical frozen cycle marked open',
      'associations',
      'CYCLE_POINTER_INVALID',
      async () => {
        await collection('groupfinancialcycles').updateOne(
          { _id: frozenCycle._id },
          { $set: { status: 'open' } },
          { bypassDocumentValidation: true },
        );
        return () =>
          collection('groupfinancialcycles').updateOne(
            { _id: frozenCycle._id },
            { $set: { status: frozenCycle.status } },
          );
      },
    );
    await drift(
      'unresolved financial operation',
      'reservations',
      'FINANCIAL_RESERVATION_PENDING',
      async () => {
        await collection('groups').updateOne(
          { _id: open._id },
          {
            $set: { financialOperation: { _id: new mongoose.Types.ObjectId(), phase: 'applying' } },
          },
          { bypassDocumentValidation: true },
        );
        return () =>
          collection('groups').updateOne({ _id: open._id }, { $unset: { financialOperation: 1 } });
      },
    );
  } finally {
    await db.command({
      collMod: 'groups',
      validator: savedGroupRule,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await f.cleanup();
  }
});
