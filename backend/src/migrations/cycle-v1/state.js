import mongoose from 'mongoose';
import { RUN_ID, fail } from './safety.js';
import { createGroupRepository } from '../../repositories/group.repository.js';
import { createGroupExpenseRepository } from '../../repositories/group-expense.repository.js';
import { createSettlementRepository } from '../../repositories/settlement.repository.js';
import { createGroupBalanceRepository } from '../../repositories/group-balance.repository.js';
import { createGroupFinancialService } from '../../services/group-financial.service.js';
import { durableWriteOptions } from '../../utils/durable-write.js';
const oid = (value) => new mongoose.Types.ObjectId(value);
const options = () => durableWriteOptions();
export async function metadata(db) {
  const validators = {
    cyclemigrationruns: {
      bsonType: 'object',
      required: [
        '_id',
        'version',
        'runId',
        'maintenanceId',
        'backupHash',
        'sourceDigest',
        'offlineHeld',
        'phase',
        'groupIds',
      ],
      properties: {
        _id: { enum: [RUN_ID] },
        version: { enum: [1] },
        runId: { bsonType: 'objectId' },
        maintenanceId: { bsonType: 'string' },
        backupHash: { bsonType: 'string' },
        sourceDigest: { bsonType: 'string' },
        offlineHeld: { enum: [true] },
        phase: { enum: [0, 1, 2, 3, 4] },
        groupIds: { bsonType: 'array', items: { bsonType: 'objectId' } },
        strictGroups: { bsonType: 'array', items: { bsonType: 'objectId' } },
      },
    },
    cyclemigrationgroups: {
      bsonType: 'object',
      required: [
        '_id',
        'version',
        'runId',
        'cycleId',
        'openOperationId',
        'freezeOperationId',
        'phase',
      ],
      properties: {
        _id: { bsonType: 'objectId' },
        version: { enum: [1] },
        runId: { bsonType: 'objectId' },
        cycleId: { bsonType: 'objectId' },
        openOperationId: { bsonType: 'objectId' },
        freezeOperationId: { bsonType: 'objectId' },
        phase: { enum: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
        quarantineCode: { bsonType: 'string' },
        before: { bsonType: 'object' },
        plan: { bsonType: 'object' },
        expenseCursor: { bsonType: 'objectId' },
        settlementCursor: { bsonType: 'objectId' },
      },
    },
  };
  for (const [name, schema] of Object.entries(validators)) {
    if (!(await db.listCollections({ name }).toArray()).length) {
      try {
        await db.createCollection(name, {
          validator: { $jsonSchema: schema },
          validationLevel: 'strict',
          validationAction: 'error',
        });
      } catch (error) {
        if (error.code !== 48) throw error;
      }
    }
  }
}
export async function legacyRecovery(models, group, runId) {
  const { G, E, S } = models;
  const base = createGroupRepository(G);
  const gated = {
    ...base,
    offlineMigrationRunId: String(runId),
    async beginSettlementMode(id, operationId) {
      return G.collection.findOneAndUpdate(
        {
          _id: oid(id),
          'financialOperation._id': oid(operationId),
          'cycleMigration.runId': runId,
          'cycleMigration.state': 'held',
          settlementStartedAt: { $exists: false },
        },
        { $set: { settlementStartedAt: new Date() } },
        { returnDocument: 'after', ...options() },
      );
    },
    async finishFinancial(id, operationId) {
      const current = await G.collection.findOne({
        _id: oid(id),
        'financialOperation._id': oid(operationId),
        'cycleMigration.runId': runId,
      });
      if (!current) fail('RECOVERY_RESERVATION_MISSING');
      const op = current.financialOperation;
      const target = op.kind.startsWith('expense_') ? E : S;
      const proof = await target.collection.findOne({
        _id: oid(op.payload.targetId),
        group: oid(id),
        lastFinancialOperation: oid(operationId),
      });
      if (!proof) fail('RECOVERY_EFFECT_UNPROVEN');
      return G.collection.findOneAndUpdate(
        {
          _id: oid(id),
          'financialOperation._id': oid(operationId),
          'cycleMigration.runId': runId,
          'cycleMigration.state': 'held',
          financialProtocolVersion: { $exists: false },
        },
        { $unset: { financialOperation: 1 }, $inc: { __v: 1 } },
        { returnDocument: 'after', ...options() },
      );
    },
  };
  if (!group.financialOperation) return;
  const op = group.financialOperation;
  if (
    op.protocolVersion ||
    !op.payload?.targetId ||
    !mongoose.isObjectIdOrHexString(op.payload.targetId)
  )
    fail('UNRESOLVED_FINANCIAL_OPERATION');
  try {
    await createGroupFinancialService({
      groups: gated,
      expenses: createGroupExpenseRepository(E),
      settlements: createSettlementRepository(S),
      balances: createGroupBalanceRepository(E, S),
    }).recover(String(group.creator), String(group._id));
  } catch {
    // A second offline reconciler may have completed the identical fixed operation.
    const latest = await G.collection.findOne({ _id: group._id });
    const target = op.kind.startsWith('expense_') ? E : S;
    const proof = await target.collection.findOne({
      _id: oid(op.payload.targetId),
      group: group._id,
      lastFinancialOperation: op._id,
    });
    if (latest?.financialOperation || !proof) fail('UNRESOLVED_FINANCIAL_OPERATION');
  }
  if ((await G.collection.findOne({ _id: group._id })).financialOperation)
    fail('UNRESOLVED_FINANCIAL_OPERATION');
}
export async function backfill(model, groupId, cycleId, checkpoint, field, batchSize, fault) {
  while (true) {
    const rows = await model.collection
      .find({ group: groupId, cycleId: { $exists: false } })
      .sort({ _id: 1 })
      .limit(batchSize)
      .toArray();
    if (!rows.length) break;
    for (const row of rows) {
      const result = await model.collection.updateOne(
        { _id: row._id, group: groupId, cycleId: { $exists: false }, __v: row.__v },
        { $set: { cycleId } },
        options(),
      );
      if (
        !result.matchedCount &&
        !(await model.collection.findOne({ _id: row._id, group: groupId, cycleId }))
      )
        fail('BACKFILL_DOCUMENT_CHANGED');
    }
    await checkpoint.updateOne(
      { _id: groupId, quarantineCode: { $exists: false } },
      { $max: { [field]: rows.at(-1)._id } },
      options(),
    );
    await fault(
      field === 'expenseCursor' ? 'during_expense_batch' : 'during_settlement_batch',
      String(groupId),
    );
  }
}
