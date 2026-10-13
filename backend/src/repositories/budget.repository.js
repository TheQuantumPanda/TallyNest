import mongoose from 'mongoose';
import { Budget } from '../models/budget.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { budgetInputSchema, budgetQuerySchema } from '../validators/budget.validator.js';
import { TRANSACTION_CATEGORIES } from '../constants/transaction.constants.js';

function objectId(value) {
  return ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value);
}
export function createBudgetRepository(model = Budget) {
  async function validatedDocument(owner, input) {
    const document = new model({ ...budgetInputSchema.parse(input), owner: objectId(owner) });
    await document.validate();
    return document;
  }
  return {
    async createForOwner(owner, input) {
      return (await validatedDocument(owner, input)).save();
    },
    findByIdForOwner(owner, id) {
      return model.findOne({ owner: objectId(owner), _id: objectId(id) }).exec();
    },
    findForOwner(owner, query) {
      const filter = { ...budgetQuerySchema.parse(query), owner: objectId(owner) };
      // Uniqueness bounds one month to the number of expense categories.
      return model.find(filter).sort({ category: 1 }).limit(TRANSACTION_CATEGORIES.length)
        .maxTimeMS(1000).exec();
    },
    async replaceForOwner(owner, id, version, input) {
      if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Invalid budget version');
      }
      const document = await validatedDocument(owner, input);
      const values = Object.fromEntries(['category', 'currency', 'amountMinor', 'month'].map(key => [key, document[key]]));
      return model.findOneAndUpdate({ owner: objectId(owner), _id: objectId(id), __v: version },
        { $set: values, $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: false }).exec();
    },
    deleteForOwner(owner, id) {
      return model.findOneAndDelete({ owner: objectId(owner), _id: objectId(id) }).exec();
    },
  };
}
export const budgetRepository = createBudgetRepository();
export async function ensureBudgetIndexes() { await Budget.init(); }
