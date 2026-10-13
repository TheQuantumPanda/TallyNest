import mongoose from 'mongoose';
import { Transaction } from '../models/transaction.model.js';
import { ownerIdSchema, transactionDateSchema } from '../validators/transaction.validator.js';

function objectId(value) {
  return ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value);
}

// Only scoped reads are exposed at this stage. No arbitrary query filters or writes.
export function createTransactionRepository(model = Transaction) {
  return {
    findByIdForOwner(ownerId, transactionId) {
      return model.findOne({ owner: objectId(ownerId), _id: objectId(transactionId) }).exec();
    },
    findForOwner(ownerId, { from, to, limit = 50 } = {}) {
      const filter = { owner: objectId(ownerId) };
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Limit must be 1–100');
      if (from !== undefined || to !== undefined) {
        filter.transactionDate = {};
        if (from !== undefined) filter.transactionDate.$gte = new Date(transactionDateSchema.parse(from));
        if (to !== undefined) filter.transactionDate.$lt = new Date(transactionDateSchema.parse(to));
        if (from !== undefined && to !== undefined && from >= to) throw new RangeError('Date range must be increasing');
      }
      return model.find(filter).sort({ transactionDate: -1, _id: -1 }).limit(limit).exec();
    },
  };
}

export const transactionRepository = createTransactionRepository();
