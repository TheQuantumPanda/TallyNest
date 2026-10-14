import {
  GroupSettlement,
  settlementCollectionValidator,
} from '../models/group-settlement.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const id = (value) => ownerIdSchema.parse(String(value));
export function createSettlementRepository(model = GroupSettlement) {
  return {
    find(group, target) {
      return model
        .findOne({ group: id(group), _id: id(target) })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    receipt(group, sender, key) {
      return model
        .findOne({ group: id(group), sender: id(sender), creationKey: key })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    list(group, { limit, after }) {
      return model
        .find({
          group: id(group),
          ...(after ? { _id: { $lt: id(after) } } : {}),
        })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .maxTimeMS(1000)
        .exec();
    },
    async create(group, op) {
      const p = op.payload;
      return new model({
        _id: p.targetId,
        group: id(group),
        sender: id(op.actor),
        recipient: p.recipient,
        amountMinor: p.amountMinor,
        currency: 'INR',
        status: 'pending',
        createdAt: op.createdAt,
        __v: 0,
        creationKey: p.key,
        creationHash: p.hash,
        lastFinancialOperation: op._id,
      }).save(durableWriteOptions());
    },
    decide(group, op) {
      const p = op.payload,
        confirmed = op.kind === 'settlement_confirm';
      return model
        .findOneAndUpdate(
          {
            group: id(group),
            _id: id(p.targetId),
            recipient: id(op.actor),
            status: 'pending',
            __v: p.version,
          },
          {
            $set: {
              status: confirmed ? 'confirmed' : 'rejected',
              [confirmed ? 'confirmedAt' : 'rejectedAt']: new Date(),
              decisionBy: id(op.actor),
              lastFinancialOperation: op._id,
            },
            $inc: { __v: 1 },
          },
          {
            returnDocument: 'after',
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
  };
}
export const settlementRepository = createSettlementRepository();
export async function ensureSettlementIndexes() {
  const db = GroupSettlement.db.db,
    name = GroupSettlement.collection.name;
  try {
    await db.createCollection(name, {
      validator: settlementCollectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: settlementCollectionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await GroupSettlement.init();
}
