import {
  GroupCycleTransition,
  cycleTransitionValidator,
} from '../models/group-cycle-transition.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const id = (value) => ownerIdSchema.parse(String(value));
export function createCycleTransitionRepository(model = GroupCycleTransition) {
  return {
    find(group, key) {
      return model
        .findOne({ group: id(group), intentKey: key })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    create(op) {
      return new model({
        _id: op._id,
        group: op.groupId,
        actor: op.actor,
        intentKey: op.payload.intentKey,
        requestHash: op.payload.requestHash,
        operationHash: op.payloadHash,
        kind: op.kind,
        operation: JSON.parse(JSON.stringify(op)),
        cycleId: op.targetId,
        outcome: op.payload.outcome,
        createdAt: op.createdAt,
        __v: 0,
      }).save(durableWriteOptions());
    },
    complete(group, opId, hash, at) {
      return model
        .findOneAndUpdate(
          { _id: id(opId), group: id(group), operationHash: hash, __v: 0 },
          { $set: { completedAt: at }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
  };
}
export const cycleTransitionRepository = createCycleTransitionRepository();
// Deliberately not installed by public application startup until activation is reviewed.
export async function ensureCycleTransitionIndexes() {
  const db = GroupCycleTransition.db.db,
    name = GroupCycleTransition.collection.name;
  try {
    await db.createCollection(name, {
      validator: cycleTransitionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: cycleTransitionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await GroupCycleTransition.init();
}
