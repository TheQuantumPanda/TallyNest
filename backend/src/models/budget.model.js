import mongoose from 'mongoose';
import { ownerIdSchema, amountMinorSchema, currencySchema } from '../validators/transaction.validator.js';
import { budgetMonthSchema, expenseCategorySchema } from '../validators/budget.validator.js';
import { DEFAULT_CURRENCY } from '../constants/transaction.constants.js';

function field(type, schema, options = {}) {
  return { type, required: true,
    set(value) { return value === undefined ? value : schema.parse(value); },
    validate: { validator: value => schema.safeParse(value).success, message: 'Invalid budget field' },
    ...options };
}
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true,
    set(value) {
      if (value === undefined) return value;
      return ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value);
    } },
  category: field(String, expenseCategorySchema),
  currency: field(String, currencySchema, { default: DEFAULT_CURRENCY }),
  amountMinor: field(Number, amountMinorSchema),
  month: field(String, budgetMonthSchema),
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
// Also serves owner/month/currency listings, ordered by category.
schema.index({ owner: 1, month: 1, currency: 1, category: 1 }, { unique: true });
export const Budget = mongoose.model('Budget', schema);
