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
