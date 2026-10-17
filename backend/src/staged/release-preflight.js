// Read-only release inspection. This module never installs schema, changes markers, or releases a hold.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import {
  definitions,
  migrationModels,
  strictFinancialValidator,
  strictGroupValidator,
} from '../migrations/cycle-v1/preflight.js';
import { canonical, reconcile } from '../migrations/cycle-v1/reconcile.js';
import { migrationMetadataValidators } from '../migrations/cycle-v1/state.js';
import { RUN_ID } from '../migrations/cycle-v1/safety.js';

class PreflightError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new PreflightError(code);
};
const same = (a, b) => canonical(a) === canonical(b);
const objectId = (value) => value?._bsontype === 'ObjectId';
const ids = (values) => {
  if (!Array.isArray(values) || values.some((value) => !objectId(value)))
    fail('MIGRATION_GROUP_SET_INVALID');
  const text = values.map(String);
  if (text.some((value, index) => index && text[index - 1] >= value))
    fail('MIGRATION_GROUP_SET_INVALID');
  return text;
};
const entry = (rows, name) => rows.find((row) => row.name === name);
const verdict = (status, code = null) => ({ status, code });
const errorCode = (error) =>
  error instanceof PreflightError ? error.code : 'PREFLIGHT_QUERY_FAILED';

// Check the fixed migrated set against both durable run and per-group checkpoints before
// using it to reconstruct a strict validator. A database marker alone is not trusted.
export async function verifiedMigrationManifest(db) {
  const runs = await db.collection('cyclemigrationruns').find({}).limit(2).toArray();
  if (!runs.length) return null;
  if (runs.length !== 1 || runs[0]._id !== RUN_ID) fail('MIGRATION_RUN_INVALID');
  const run = runs[0];
  if (run.version !== 1 || !objectId(run.runId) || run.phase !== 4 || run.offlineHeld !== true)
    fail('MIGRATION_INCOMPLETE');
  const groupIds = ids(run.groupIds);
  const strictGroups = ids(run.strictGroups);
  if (groupIds.length > 1000) fail('MIGRATION_GROUP_SET_INVALID');
  const actualGroups = await db
    .collection('groups')
    .find({}, { projection: { _id: 1 } })
    .sort({ _id: 1 })
    .limit(1001)
    .toArray();
  if (
    !isDeepStrictEqual(
      actualGroups.map((row) => String(row._id)),
      groupIds,
    )
  )
    fail('MIGRATION_GROUP_SET_INVALID');
  const checkpoints = await db
    .collection('cyclemigrationgroups')
    .find({})
    .sort({ _id: 1 })
    .limit(1001)
    .toArray();
  if (
    !isDeepStrictEqual(
      checkpoints.map((row) => String(row._id)),
      groupIds,
    )
  )
    fail('MIGRATION_CHECKPOINT_INVALID');
  const expectedStrict = [];
  for (const cp of checkpoints) {
    if (
      cp.version !== 1 ||
      !objectId(cp.runId) ||
      String(cp.runId) !== String(run.runId) ||
      cp.phase !== 8 ||
      cp.quarantineCode ||
      !objectId(cp.cycleId) ||
      !cp.before ||
      !cp.plan ||
      !['empty', 'open_history', 'frozen_history'].includes(cp.plan.classification)
    )
      fail('MIGRATION_CHECKPOINT_INVALID');
    if (cp.plan.classification !== 'empty') expectedStrict.push(String(cp._id));
  }
  if (!isDeepStrictEqual(strictGroups, expectedStrict)) fail('MIGRATION_GROUP_SET_INVALID');
  return { run, checkpoints, strictGroups: run.strictGroups };
}

function expectedIndexMatches(index, key, options) {
  return (
    isDeepStrictEqual(index.key, key) &&
    !!index.unique === !!options.unique &&
    !!index.sparse === !!options.sparse &&
    same(index.partialFilterExpression ?? {}, options.partialFilterExpression ?? {}) &&
    same(index.collation ?? {}, options.collation ?? {}) &&
    index.expireAfterSeconds === undefined
  );
}

export async function verifyCycleSchemaAndIndexes(db) {
  const migration = await verifiedMigrationManifest(db);
  const metadataAt = performance.now();
  const metadata = await db.listCollections().toArray();
  const metadataMs = Number((performance.now() - metadataAt).toFixed(2));
  const validatorAt = performance.now();
  for (const [model, base] of definitions) {
    const name = model.collection.name;
    const row = entry(metadata, name);
    const expected =
      migration && model === definitions[0][0]
        ? strictGroupValidator(base, migration.strictGroups)
        : migration && definitions.slice(1, 3).some(([financial]) => financial === model)
          ? strictFinancialValidator(base, migration.strictGroups)
          : base;
    if (
      !row ||
      row.options.validationLevel !== 'strict' ||
      row.options.validationAction !== 'error' ||
      !same(row.options.validator, expected)
    )
      fail('CYCLE_SCHEMA_NOT_READY');
  }
  if (migration) {
    for (const [name, schema] of Object.entries(migrationMetadataValidators)) {
      const row = entry(metadata, name);
      if (
        !row ||
        row.options.validationLevel !== 'strict' ||
        row.options.validationAction !== 'error' ||
        !same(row.options.validator, { $jsonSchema: schema })
      )
        fail('MIGRATION_METADATA_SCHEMA_INVALID');
    }
  }
  const validatorComparisonMs = Number((performance.now() - validatorAt).toFixed(2));
  const indexAt = performance.now();
  let indexProbes = 0;
  for (const [model] of definitions) {
    const name = model.collection.name;
    const actualIndexes = await db.collection(name).indexes();
    indexProbes++;
    const required = model.schema.indexes();
    if (
      required.some(
        ([key, options]) =>
          !actualIndexes.some((index) => expectedIndexMatches(index, key, options)),
      )
    )
      fail('CYCLE_INDEX_NOT_READY');
    if (
      actualIndexes.some(
        (index) =>
          index.expireAfterSeconds !== undefined ||
          (index.name !== '_id_' &&
            (index.unique || index.partialFilterExpression) &&
            !required.some(([key, options]) => expectedIndexMatches(index, key, options))),
      )
    )
      fail('CYCLE_INDEX_NOT_READY');
  }
  if (migration) {
    for (const name of Object.keys(migrationMetadataValidators)) {
      const indexes = await db.collection(name).indexes();
      indexProbes++;
      if (
        indexes.some(
          (index) =>
            index.expireAfterSeconds !== undefined ||
            (index.name !== '_id_' && (index.unique || index.partialFilterExpression)),
        )
      )
        fail('CYCLE_INDEX_NOT_READY');
    }
  }
  return {
    metadataProbes: 1,
    indexProbes,
    metadataMs,
    validatorComparisonMs,
    indexInspectionMs: Number((performance.now() - indexAt).toFixed(2)),
  };
}

async function verifyAssociations(connection, manifest) {
  const models = migrationModels(connection);
  const { G, C, E, S } = models;
  let reconciled = 0,
    financialReconciliationMs = 0;
  for (const cp of manifest.checkpoints) {
    const group = await G.collection.findOne({ _id: cp._id });
    if (
      !group ||
      !group.cycleMigration ||
      String(group.cycleMigration.runId) !== String(manifest.run.runId) ||
      group.cycleMigration.version !== 1 ||
      group.cycleMigration.state !== 'verified'
    )
      fail('MIGRATION_GROUP_INVALID');
    const empty = cp.plan.classification === 'empty';
    if (empty) {
      if (
        group.financialProtocolVersion !== undefined ||
        group.currentCycleId ||
        group.currentCycleState ||
        group.cycleEpoch ||
        group.financialHistoryAt ||
        group.settlementStartedAt ||
        (await C.collection.findOne({ group: group._id }))
      )
        fail('CYCLE_POINTER_INVALID');
    } else {
      const cycle = await C.collection.findOne({ _id: cp.cycleId, group: group._id });
      if (
        !cycle ||
        group.financialProtocolVersion !== 2 ||
        String(group.currentCycleId) !== String(cp.cycleId) ||
        group.currentCycleState !== cp.plan.state ||
        group.cycleEpoch !== 1 ||
        cycle.status !== cp.plan.state ||
        cycle.sequence !== 1 ||
        cycle.activeSlot !== true ||
        cycle.currency !== group.currency ||
        cycle.migrationVersion !== 1 ||
        String(cycle.migrationRunId) !== String(manifest.run.runId) ||
        !same(cycle.memberIds.map(String), cp.plan.memberIds) ||
        !same(group.members.map((row) => String(row.user)).sort(), cp.plan.memberIds)
      )
        fail('CYCLE_POINTER_INVALID');
      if ((await C.collection.countDocuments({ group: group._id })) !== 1)
        fail('CYCLE_ASSOCIATION_INVALID');
      if (
        !group.financialHistoryAt ||
        (cp.plan.state === 'frozen'
          ? !group.settlementStartedAt || !cycle.frozenAt
          : !!group.settlementStartedAt || !!cycle.frozenAt)
      )
        fail('LEGACY_HISTORY_MARKER_INVALID');
      for (const model of [E, S]) {
        if (await model.collection.findOne({ group: group._id, cycleId: { $ne: cp.cycleId } }))
          fail('CYCLE_ASSOCIATION_INVALID');
      }
    }
    const reconciliationAt = performance.now();
    const actual = await reconcile(models, group, empty ? undefined : cp.cycleId);
    financialReconciliationMs += performance.now() - reconciliationAt;
    if (!isDeepStrictEqual(actual, cp.before)) fail('FINANCIAL_RECONCILIATION_MISMATCH');
    reconciled++;
  }
  if (
    (await C.collection.countDocuments({ migrationRunId: manifest.run.runId })) !==
    manifest.strictGroups.length
  )
    fail('CYCLE_ASSOCIATION_INVALID');
  return {
    reconciled,
    financialReconciliationMs: Number(financialReconciliationMs.toFixed(2)),
  };
}

export async function assessCycleReleasePreflight(connection) {
  const started = performance.now();
  const report = {
    status: 'BLOCKED',
    checks: {
      migration: verdict('NOT_VERIFIED'),
      schema: verdict('NOT_VERIFIED'),
      indexes: verdict('NOT_VERIFIED'),
      associations: verdict('NOT_VERIFIED'),
      reservations: verdict('NOT_VERIFIED'),
      maintenance: verdict('NOT_VERIFIED'),
      backupRestoreEvidence: verdict('NOT_VERIFIED', 'INDEPENDENT_BACKUP_PROOF_REQUIRED'),
      writerFencing: verdict('NOT_VERIFIED', 'OLD_WRITER_FENCING_UNPROVEN'),
      versionCompatibility: verdict('NOT_VERIFIED', 'DEPLOYED_VERSION_COMPATIBILITY_UNTESTED'),
      runtimePrivileges: verdict('NOT_VERIFIED', 'RUNTIME_PRIVILEGES_UNTESTED'),
      operationalRelease: verdict('BLOCKED', 'MAINTENANCE_RELEASE_NOT_IMPLEMENTED'),
    },
    metrics: {
      metadataProbes: 0,
      indexProbes: 0,
      metadataMs: null,
      validatorComparisonMs: null,
      indexInspectionMs: null,
      associationMs: null,
      financialReconciliationMs: null,
      totalMs: null,
      reconciledGroups: 0,
    },
  };
  let manifest;
  try {
    manifest = await verifiedMigrationManifest(connection.db);
    report.checks.migration = manifest
      ? verdict('PASS')
      : verdict('BLOCKED', 'MIGRATION_NOT_PRESENT');
  } catch (error) {
    report.checks.migration = verdict('FAIL', errorCode(error));
  }
  if (report.checks.migration.status !== 'FAIL') {
    try {
      const metrics = await verifyCycleSchemaAndIndexes(connection.db);
      Object.assign(report.metrics, metrics);
      report.checks.schema = verdict('PASS');
      report.checks.indexes = verdict('PASS');
    } catch (error) {
      const code = errorCode(error);
      if (code.includes('INDEX')) {
        report.checks.schema = verdict('PASS');
        report.checks.indexes = verdict('FAIL', code);
      } else report.checks.schema = verdict('FAIL', code);
    }
  }
  try {
    const active = await connection.db
      .collection('groups')
      .findOne({ financialOperation: { $exists: true } }, { projection: { _id: 1 } });
    report.checks.reservations = active
      ? verdict('BLOCKED', 'FINANCIAL_RESERVATION_PENDING')
      : verdict('PASS');
  } catch {
    report.checks.reservations = verdict('FAIL', 'PREFLIGHT_QUERY_FAILED');
  }
  if (
    manifest &&
    report.checks.schema.status === 'PASS' &&
    report.checks.indexes.status === 'PASS'
  ) {
    if (report.checks.reservations.status !== 'PASS')
      report.checks.associations = verdict('BLOCKED', 'FINANCIAL_RESERVATION_PENDING');
    else if (connection.config?.autoIndex !== false || connection.config?.autoCreate !== false)
      report.checks.associations = verdict('FAIL', 'READ_ONLY_CONNECTION_REQUIRED');
    else {
      const at = performance.now();
      try {
        const result = await verifyAssociations(connection, manifest);
        report.metrics.reconciledGroups = result.reconciled;
        report.metrics.financialReconciliationMs = result.financialReconciliationMs;
        report.checks.associations = verdict('PASS');
      } catch (error) {
        report.checks.associations = verdict('FAIL', errorCode(error));
      }
      report.metrics.associationMs = Number((performance.now() - at).toFixed(2));
    }
  }
  try {
    const held = await connection.db
      .collection('cyclemigrationruns')
      .findOne({ offlineHeld: true }, { projection: { _id: 1 } });
    const groupHeld = await connection.db
      .collection('groups')
      .findOne({ cycleMigration: { $exists: true } }, { projection: { _id: 1 } });
    report.checks.maintenance =
      held || groupHeld ? verdict('BLOCKED', 'CYCLE_MIGRATION_MAINTENANCE') : verdict('PASS');
  } catch {
    report.checks.maintenance = verdict('FAIL', 'PREFLIGHT_QUERY_FAILED');
  }
  const states = Object.values(report.checks).map((check) => check.status);
  report.status = states.includes('FAIL')
    ? 'FAIL'
    : states.includes('BLOCKED')
      ? 'BLOCKED'
      : 'NOT_VERIFIED';
  report.metrics.totalMs = Number((performance.now() - started).toFixed(2));
  return report;
}
