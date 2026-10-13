import { z } from 'zod';
import { DEFAULT_CURRENCY, CURRENCIES, TRANSACTION_TYPES, TRANSACTION_CATEGORIES, isCategoryForType } from '../constants/transaction.constants.js';

export const ownerIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid owner ObjectId');
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);
export const amountMinorSchema = z.number().refine(value => Number.isSafeInteger(value) && value > 0,
  'Amount must be a positive safe integer in minor units');
export const currencySchema = z.enum(Object.keys(CURRENCIES));
export const categorySchema = z.enum(TRANSACTION_CATEGORIES.map(category => category.id));
export const titleSchema = z.string().trim().min(1).max(200);
export const notesSchema = z.string().trim().max(2000);

// Canonical UTC milliseconds only. Round-trip checking also rejects calendar rollover.
export const transactionDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }, 'Expected a real calendar timestamp in UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');

const fields = {
  type: transactionTypeSchema,
  title: titleSchema,
  amountMinor: amountMinorSchema,
  currency: currencySchema.default(DEFAULT_CURRENCY),
  category: categorySchema,
  transactionDate: transactionDateSchema,
  notes: notesSchema.optional(),
};

function compatibleCategory(value, context) {
  if (!isCategoryForType(value.category, value.type)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Category is incompatible with transaction type' });
  }
}

// Future HTTP input deliberately excludes owner: derive it from the authenticated user.
export const transactionInputSchema = z.object(fields).strict().superRefine(compatibleCategory);
export const transactionDocumentSchema = z.object({ owner: ownerIdSchema, ...fields })
  .strict().superRefine(compatibleCategory);
