import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  safeTarget,
  backupEvidence,
  MIGRATION_VERSION,
  RUN_ID,
  MigrationError,
  fail,
  digest,
} from './safety.js';
import {
  migrationModels,
  preflight,
  installCycles,
  definitions,
  strictFinancialValidator,
  strictGroupValidator,
  verifyIndexes,
} from './preflight.js';
import { databaseDigest, reconcile, canonical } from './reconcile.js';
import { createGroupRepository } from '../../repositories/group.repository.js';
import { createGroupBalanceRepository } from '../../repositories/group-balance.repository.js';
import { createCycleFinancialService } from '../../services/cycle-financial.service.js';
import { durableWriteOptions } from '../../utils/durable-write.js';

import { metadata, legacyRecovery, backfill } from './state.js';

const oid = (value) => new mongoose.Types.ObjectId(value);
const options = () => durableWriteOptions();
export async function migrateCycles(input, { fault = async () => {}, batchSize = 50 } = {}) {
  const target = safeTarget(input);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100)
    fail('INVALID_BATCH_SIZE');
  const backup = await backupEvidence(input.backupManifest, target.database);
  const connection = await mongoose
    .createConnection(target.uri, {
      autoIndex: false,
      autoCreate: false,
      appName: 'tallynest-cycle-migrator-v1',
      serverSelectionTimeoutMS: 10000,
    })
    .asPromise();
  let report;
  try {
    const db = connection.db,
      models = migrationModels(connection),
      { G, E, S, C } = models;
    let run = await db.collection('cyclemigrationruns').findOne({ _id: RUN_ID });
    if (
      run &&
      (run.version !== MIGRATION_VERSION ||
        run.maintenanceId !== target.maintenanceId ||
        run.backupHash !== backup.manifestHash)
    )
      fail('MIGRATION_IDENTITY_MISMATCH');
    const checks = await preflight(connection, models, run);
    if (!run && (await databaseDigest(db)) !== backup.sourceDigest) fail('BACKUP_SOURCE_CHANGED');
    await fault('after_preflight');
    await metadata(db);
    const runs = db.collection('cyclemigrationruns'),
      checkpoints = db.collection('cyclemigrationgroups');
    const groupIds = (
      await G.collection
        .find({}, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .limit(1001)
        .toArray()
    ).map((g) => g._id);
    if (groupIds.length > 1000) fail('REHEARSAL_GROUP_LIMIT');
    await runs.updateOne(
      { _id: RUN_ID },
      {
        $setOnInsert: {
          version: 1,
          runId: oid(),
          maintenanceId: target.maintenanceId,
          backupHash: backup.manifestHash,
          sourceDigest: backup.sourceDigest,
          offlineHeld: true,
          phase: 0,
          groupIds,
        },
      },
      { upsert: true, ...options() },
    );
    run = await runs.findOne({ _id: RUN_ID });
    if (run.maintenanceId !== target.maintenanceId || !isDeepStrictEqual(run.groupIds, groupIds))
      fail('UNEXPECTED_GROUP_SET');
    await fault('after_maintenance_marker');
    await db.command({
      collMod: G.collection.name,
      validator: definitions[0][1],
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await installCycles(connection, fault);
    await runs.updateOne({ _id: RUN_ID }, { $max: { phase: 1 } }, options());
    const phase = async (id, value) =>
      checkpoints.updateOne(
        { _id: id, quarantineCode: { $exists: false } },
        { $max: { phase: value } },
        options(),
      );
    const quarantine = async (id, code) => {
      try {
        await G.collection.updateOne(
          { _id: id, 'cycleMigration.runId': run.runId },
          { $set: { 'cycleMigration.state': 'quarantined' } },
          options(),
        );
      } catch (error) {
        if (error.code !== 121) throw error;
      }
      await checkpoints.updateOne({ _id: id }, { $set: { quarantineCode: code } }, options());
    };
    for (const groupId of run.groupIds) {
      await checkpoints.updateOne(
        { _id: groupId },
        {
          $setOnInsert: {
            version: 1,
            runId: run.runId,
            cycleId: oid(),
            openOperationId: oid(),
            freezeOperationId: oid(),
            phase: 0,
          },
        },
        { upsert: true, ...options() },
      );
      let cp = await checkpoints.findOne({ _id: groupId });
      if (String(cp.runId) !== String(run.runId) || cp.version !== 1)
        fail('FOREIGN_MIGRATION_CHECKPOINT');
      if (cp.quarantineCode) continue;
      try {
        let group = await G.collection.findOne({ _id: groupId });
        if (!group) fail('GROUP_DISAPPEARED');
        if (!group.cycleMigration) {
          if (
            group.financialProtocolVersion ||
            group.currentCycleId ||
            group.cycleEpoch ||
            group.currentCycleState
          )
            fail('UNTRACKED_PARTIAL_MIGRATION');
          const marked = await G.collection.updateOne(
            { _id: groupId, __v: group.__v, cycleMigration: { $exists: false } },
            { $set: { cycleMigration: { version: 1, runId: run.runId, state: 'held' } } },
            options(),
          );
          if (!marked.matchedCount) fail('GROUP_CHANGED_BEFORE_FENCE');
        } else if (String(group.cycleMigration.runId) !== String(run.runId) || cp.version !== 1)
          fail('FOREIGN_MIGRATION_GATE');
        group = await G.findById(groupId);
        cp = await checkpoints.findOne({ _id: groupId });
        if (!cp.before) {
          if (await C.exists({ group: groupId, _id: { $ne: cp.cycleId } }))
            fail('UNTRACKED_PARTIAL_MIGRATION');
          await group.validate();
          if (group.financialOperation) {
            const original = group.financialOperation.toObject();
            if (!mongoose.isObjectIdOrHexString(original.payload?.targetId))
              fail('UNRESOLVED_FINANCIAL_OPERATION');
            await checkpoints.updateOne(
              { _id: groupId, recoveryReceipt: { $exists: false } },
              {
                $set: {
                  recoveryReceipt: {
                    operationId: original._id,
                    targetId: oid(original.payload.targetId),
                    kind: original.kind,
                    payloadHash: digest(canonical(original.payload)),
                  },
                },
              },
              options(),
            );
          }
          await legacyRecovery(models, group, run.runId);
          const recovering = await checkpoints.findOne({ _id: groupId });
          if (recovering.recoveryReceipt) {
            const receipt = recovering.recoveryReceipt;
            const target = receipt.kind.startsWith('expense_') ? E : S;
            if (
              !(await target.collection.findOne({
                _id: receipt.targetId,
                group: groupId,
                lastFinancialOperation: receipt.operationId,
              }))
            )
              fail('RECOVERY_EFFECT_UNPROVEN');
          }
          await phase(groupId, 1);
          await fault('after_recovery', String(groupId));
          group = await G.collection.findOne({ _id: groupId });
          const before = await reconcile(models, group, undefined, cp.cycleId);
          const hasHistory = !!group.financialHistoryAt;
          const plan = {
            classification: hasHistory
              ? group.settlementStartedAt
                ? 'frozen_history'
                : 'open_history'
              : 'empty',
            state: group.settlementStartedAt ? 'frozen' : 'open',
            memberIds: before.members,
            openedAt: group.financialHistoryAt ?? group.createdAt,
            ...(group.settlementStartedAt ? { frozenAt: group.settlementStartedAt } : {}),
          };
          if (plan.frozenAt && plan.frozenAt < plan.openedAt) fail('INVALID_LEGACY_MARKER_ORDER');
          await checkpoints.updateOne(
            { _id: groupId, before: { $exists: false } },
            { $set: { before, plan }, $max: { phase: 2 } },
            options(),
          );
          await fault('after_identity_allocation', String(groupId));
        }
        cp = await checkpoints.findOne({ _id: groupId });
        if (cp.plan.classification === 'empty') {
          if (
            !isDeepStrictEqual(
              cp.before,
              await reconcile(models, await G.collection.findOne({ _id: groupId })),
            )
          )
            fail('EMPTY_GROUP_CHANGED');
          await phase(groupId, 6);
          continue;
        }
        let cycle = await C.collection.findOne({ _id: cp.cycleId, group: groupId });
        if (!cycle) {
          if (await C.exists({ group: groupId, _id: { $ne: cp.cycleId } }))
            fail('UNTRACKED_PARTIAL_MIGRATION');
          try {
            await new C({
              _id: cp.cycleId,
              group: groupId,
              sequence: 1,
              migrationVersion: 1,
              migrationRunId: run.runId,
              currency: 'INR',
              status: cp.plan.state,
              activeSlot: true,
              memberIds: cp.plan.memberIds,
              openedAt: cp.plan.openedAt,
              openOperationId: cp.openOperationId,
              ...(cp.plan.state === 'frozen'
                ? { frozenAt: cp.plan.frozenAt, freezeOperationId: cp.freezeOperationId }
                : {}),
              createdAt: cp.plan.openedAt,
              updatedAt: cp.plan.frozenAt ?? cp.plan.openedAt,
              __v: 0,
            }).save(options());
          } catch (error) {
            if (error.code !== 11000) throw error;
          }
          await fault('after_cycle_insert', String(groupId));
        }
        cycle = await C.findOne({ _id: cp.cycleId, group: groupId });
        if (
          !cycle ||
          cycle.status !== cp.plan.state ||
          String(cycle.openOperationId) !== String(cp.openOperationId) ||
          cycle.memberIds.map(String).join(',') !== cp.plan.memberIds.join(',') ||
          cycle.sequence !== 1 ||
          cycle.migrationVersion !== 1 ||
          String(cycle.migrationRunId) !== String(run.runId)
        )
          fail('MIGRATION_CYCLE_MISMATCH');
        await cycle.validate();
        await phase(groupId, 3);
        await backfill(E, groupId, cp.cycleId, checkpoints, 'expenseCursor', batchSize, fault);
        await phase(groupId, 4);
        await fault('after_expense_association', String(groupId));
        await backfill(S, groupId, cp.cycleId, checkpoints, 'settlementCursor', batchSize, fault);
        await phase(groupId, 5);
        await fault('after_settlement_association', String(groupId));
        if (
          !isDeepStrictEqual(
            cp.before,
            await reconcile(models, await G.collection.findOne({ _id: groupId }), cp.cycleId),
          )
        )
          fail('FINANCIAL_RECONCILIATION_MISMATCH');
        await phase(groupId, 6);
        await fault('after_reconciliation', String(groupId));
      } catch (error) {
        if (
          error instanceof MigrationError ||
          error.name === 'ValidationError' ||
          error.code === 121 ||
          error.code === 'BALANCE_DATA_INVALID' ||
          error.code === 'BALANCE_OVERFLOW'
        )
          await quarantine(
            groupId,
            error instanceof MigrationError
              ? error.code
              : error.code?.startsWith('BALANCE_')
                ? error.code
                : 'INVALID_SOURCE_DATA',
          );
        else throw error;
      }
    }
    if (!(await checkpoints.findOne({ quarantineCode: { $exists: true } }))) {
      const actualIds = (
        await G.collection
          .find({}, { projection: { _id: 1 } })
          .sort({ _id: 1 })
          .toArray()
      ).map((row) => row._id);
      if (!isDeepStrictEqual(actualIds, run.groupIds)) fail('UNEXPECTED_GROUP_SET');
      const ready = await checkpoints.find({ runId: run.runId }).sort({ _id: 1 }).toArray();
      const strictGroups = ready
        .filter((cp) => cp.plan.classification !== 'empty')
        .map((cp) => cp._id);
      await runs.updateOne(
        { _id: RUN_ID },
        { $set: { strictGroups }, $max: { phase: 2 } },
        options(),
      );
      for (const [model, base] of definitions.slice(0, 3)) {
        const strict =
          model === definitions[0][0]
            ? strictGroupValidator(base, strictGroups)
            : strictFinancialValidator(base, strictGroups);
        await db.command({
          collMod: model.collection.name,
          validator: strict,
          validationLevel: 'strict',
          validationAction: 'error',
        });
        await fault('during_strict_validator_install');
      }
      for (const cp of ready) {
        try {
          const group = await G.collection.findOne({ _id: cp._id });
          const before = await reconcile(
            models,
            group,
            cp.plan.classification === 'empty' ? undefined : cp.cycleId,
          );
          if (!isDeepStrictEqual(before, cp.before)) {
            await quarantine(cp._id, 'PRE_ACTIVATION_MISMATCH');
            break;
          }
          if (cp.plan.classification !== 'empty' && !group.financialProtocolVersion) {
            const activated = await G.collection.updateOne(
              {
                _id: cp._id,
                __v: group.__v,
                financialOperation: { $exists: false },
                'cycleMigration.runId': run.runId,
                'cycleMigration.state': 'held',
                financialProtocolVersion: { $exists: false },
                currentCycleId: { $exists: false },
              },
              {
                $set: {
                  financialProtocolVersion: 2,
                  currentCycleId: cp.cycleId,
                  currentCycleState: cp.plan.state,
                  cycleEpoch: 1,
                },
              },
              options(),
            );
            if (
              !activated.matchedCount &&
              !(await G.collection.findOne({
                _id: cp._id,
                financialProtocolVersion: 2,
                currentCycleId: cp.cycleId,
              }))
            )
              fail('PROTOCOL_ACTIVATION_CONFLICT');
            await fault('after_protocol_activation', String(cp._id));
          }
          await phase(cp._id, 7);
          const after = await G.collection.findOne({ _id: cp._id });
          if (cp.plan.classification !== 'empty') {
            if (
              String(after.currentCycleId) !== String(cp.cycleId) ||
              after.currentCycleState !== cp.plan.state ||
              after.cycleEpoch !== 1 ||
              after.financialProtocolVersion !== 2 ||
              after.financialOperation
            )
              fail('PROTOCOL_POSTCHECK_FAILED');
            const repos = { ...createGroupRepository(G), offlineMigrationRunId: String(run.runId) };
            await createCycleFinancialService({
              internalEnabled: true,
              groups: repos,
              cycles: { find: (g, c) => C.findOne({ _id: oid(c), group: oid(g) }) },
              balances: createGroupBalanceRepository(E, S),
            }).balances(String(after.creator), String(cp._id), String(cp.cycleId));
          }
          if (
            !isDeepStrictEqual(
              cp.before,
              await reconcile(
                models,
                after,
                cp.plan.classification === 'empty' ? undefined : cp.cycleId,
              ),
            )
          )
            fail('POSTCHECK_RECONCILIATION_FAILED');
          await G.collection.updateOne(
            {
              _id: cp._id,
              'cycleMigration.runId': run.runId,
              'cycleMigration.state': { $in: ['held', 'verified'] },
            },
            { $set: { 'cycleMigration.state': 'verified' } },
            options(),
          );
          await phase(cp._id, 8);
          await fault('after_post_verification', String(cp._id));
        } catch (error) {
          if (
            error instanceof MigrationError ||
            ['BALANCE_DATA_INVALID', 'BALANCE_OVERFLOW'].includes(error.code)
          ) {
            await quarantine(cp._id, error.code);
            break;
          }
          throw error;
        }
      }
      for (const [model] of definitions) await verifyIndexes(db, model);
      const afterRules = await db.listCollections().toArray();
      for (const [model, base] of definitions) {
        const expected =
          model === definitions[0][0]
            ? strictGroupValidator(base, strictGroups)
            : definitions.slice(1, 3).some(([financial]) => financial === model)
              ? strictFinancialValidator(base, strictGroups)
              : base;
        const actual = afterRules.find((row) => row.name === model.collection.name);
        if (
          canonical(actual?.options?.validator) !== canonical(expected) ||
          actual.options.validationLevel !== 'strict' ||
          actual.options.validationAction !== 'error'
        )
          fail('POSTCHECK_VALIDATOR_MISMATCH');
      }
      if (
        !(await checkpoints.findOne({
          $or: [{ quarantineCode: { $exists: true } }, { phase: { $ne: 8 } }],
        }))
      )
        await runs.updateOne({ _id: RUN_ID }, { $max: { phase: 4 } }, options());
    }
    const final = await checkpoints.find({ runId: run.runId }).sort({ _id: 1 }).toArray();
    report = {
      migrationVersion: 1,
      database: target.database,
      offlineHeld: true,
      preflight: checks,
      ok: final.every((cp) => cp.phase === 8 && !cp.quarantineCode),
      groups: final.map((cp) => ({
        groupId: String(cp._id),
        classification: cp.quarantineCode
          ? cp.quarantineCode === 'UNRESOLVED_FINANCIAL_OPERATION'
            ? 'unresolved_operation'
            : 'quarantined'
          : (cp.plan?.classification ?? 'partially_migrated'),
        phase: cp.phase,
        recoveredOriginalIntent: !!cp.recoveryReceipt,
        ...(cp.quarantineCode
          ? { discrepancy: cp.quarantineCode }
          : {
              cycleId: cp.plan?.classification === 'empty' ? null : String(cp.cycleId),
              counts: cp.before?.counters,
              totals: cp.before?.totals,
              reconciled: cp.phase === 8,
              reconciliationDigest: cp.before ? digest(canonical(cp.before)) : null,
            }),
      })),
    };
    return report;
  } finally {
    await connection.close();
  }
}
