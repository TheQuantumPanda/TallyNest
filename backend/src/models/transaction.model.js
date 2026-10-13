import mongoose from 'mongoose';
import { DEFAULT_CURRENCY, isCategoryForType } from '../constants/transaction.constants.js';
import { ownerIdSchema, transactionTypeSchema, amountMinorSchema, currencySchema, categorySchema,
  titleSchema, notesSchema, transactionDateSchema } from '../validators/transaction.validator.js';

// Parse BEFORE Mongoose casts: strings/booleans must not become monetary numbers.
function constrainedField(type, schema, options = {}) {
  return {
    type,
    set(value) { return value === undefined ? value : schema.parse(value); },
    validate: { validator: value => schema.safeParse(value).success, message: 'Invalid transaction field' },
    ...options,
  };
}

const transactionSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true,
    set(value) {
      if (value === undefined) return value;
      const id = value instanceof mongoose.Types.ObjectId ? value.toHexString() : value;
      return ownerIdSchema.parse(id);
    },
  },
  type: constrainedField(String, transactionTypeSchema, { required: true }),
  title: constrainedField(String, titleSchema, { required: true }),
  amountMinor: constrainedField(Number, amountMinorSchema, { required: true }),
  currency: constrainedField(String, currencySchema, { required: true, default: DEFAULT_CURRENCY }),
  category: constrainedField(String, categorySchema, {
    required: true,
    validate: {
      validator(value) { return categorySchema.safeParse(value).success && isCategoryForType(value, this.type); },
      message: 'Category is incompatible with transaction type',
    },
  }),
  transactionDate: {
    type: Date, required: true,
    set(value) {
      if (value === undefined) return value;
      const timestamp = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value;
      return new Date(transactionDateSchema.parse(timestamp));
    },
    validate: {
      validator: value => value instanceof Date && Number.isFinite(value.getTime()) &&
        transactionDateSchema.safeParse(value.toISOString()).success,
      message: 'Invalid transaction date',
    },
  },
  notes: constrainedField(String, notesSchema),
}, { timestamps: true, strict: 'throw' });

// Owner prefix covers owner-only reads; date + _id supports deterministic history ordering.
transactionSchema.index({ owner: 1, transactionDate: -1, _id: -1 });

export const Transaction = mongoose.model('Transaction', transactionSchema);
