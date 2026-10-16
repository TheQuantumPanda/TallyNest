import {
  GroupFinancialCycle,
  groupFinancialCycleCollectionValidator,
} from '../models/group-financial-cycle.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';

const id = (value) => ownerIdSchema.parse(String(value));
export function createGroupFinancialCycleRepository(model = GroupFinancialCycle) {
  return {
    find(groupId, cycleId) {
      return model
        .findOne({ _id: id(cycleId), group: id(groupId) })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    existsForGroup(groupId) {
      return model
        .exists({ group: id(groupId) })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    active(groupId) {
      return model
        .findOne({ group: id(groupId), activeSlot: true })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    createForTransition(op) {
      if (!['cycle_open_first', 'cycle_open_next'].includes(op.kind))
        throw new TypeError('Invalid cycle creation kind');
      return new model({
        _id: op.targetId,
        group: op.groupId,
        sequence: op.payload.sequence,
        ...(op.kind === 'cycle_open_next' ? { previousCycleId: op.cycleId } : {}),
        currency: 'INR',
        status: 'open',
        activeSlot: true,
        memberIds: op.payload.memberIds,
        openedAt: op.payload.effectiveAt,
        openOperationId: op._id,
        createdAt: op.payload.effectiveAt,
        updatedAt: op.payload.effectiveAt,
        __v: 0,
      }).save(durableWriteOptions());
    },
    transition(op) {
      if (!['cycle_freeze', 'cycle_close'].includes(op.kind))
        throw new TypeError('Invalid cycle transition kind');
      const close = op.kind === 'cycle_close';
      return model
        .findOneAndUpdate(
          {
            _id: id(op.cycleId),
            group: id(op.groupId),
            status: close ? 'frozen' : 'open',
            activeSlot: true,
            __v: op.expectedCycleVersion,
            [close ? 'closeOperationId' : 'freezeOperationId']: { $exists: false },
          },
          {
            $set: {
              status: close ? 'closed' : 'frozen',
              [close ? 'closedAt' : 'frozenAt']: new Date(op.payload.effectiveAt),
              updatedAt: new Date(op.payload.effectiveAt),
              [close ? 'closeOperationId' : 'freezeOperationId']: id(op._id),
            },
            ...(close ? { $unset: { activeSlot: 1 } } : {}),
            $inc: { __v: 1 },
          },
          {
            returnDocument: 'after',
            overwriteImmutable: true,
            timestamps: false,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
    freezeForProposal(groupId, cycleId, expected, opId) {
      if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Invalid cycle version');
      return model
        .findOneAndUpdate(
          {
            _id: id(cycleId),
            group: id(groupId),
            status: 'open',
            activeSlot: true,
            __v: expected,
            freezeOperationId: { $exists: false },
          },
          {
            $set: { status: 'frozen', frozenAt: new Date(), freezeOperationId: id(opId) },
            $inc: { __v: 1 },
          },
          {
            returnDocument: 'after',
            overwriteImmutable: true,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
  };
}
export const groupFinancialCycleRepository = createGroupFinancialCycleRepository();

// Installation only. Cycle reads/writes stay private to later protocol milestones.
export async function ensureGroupFinancialCycleIndexes() {
  const db = GroupFinancialCycle.db.db;
  const name = GroupFinancialCycle.collection.name;
  try {
    await db.createCollection(name, {
      validator: groupFinancialCycleCollectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: groupFinancialCycleCollectionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await GroupFinancialCycle.init();
}
