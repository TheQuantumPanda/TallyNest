import { z } from 'zod';
import { amountMinorSchema, currencySchema, categorySchema } from './transaction.validator.js';
import { DEFAULT_CURRENCY, isCategoryForType } from '../constants/transaction.constants.js';

// A calendar key, not a local-time timestamp. Years 0001–9999; no rollover/coercion.
export const budgetMonthSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export const expenseCategorySchema = categorySchema.refine(
  (value) => isCategoryForType(value, 'expense'),
  'Budgets require an expense category',
);
const fields = {
  category: expenseCategorySchema,
  currency: currencySchema.default(DEFAULT_CURRENCY),
  amountMinor: amountMinorSchema,
  month: budgetMonthSchema,
};
export const budgetInputSchema = z.object(fields).strict();
export const budgetPatchSchema = z
  .object({
    category: expenseCategorySchema.optional(),
    currency: currencySchema.optional(),
    amountMinor: amountMinorSchema.optional(),
    month: budgetMonthSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Patch must contain a field');
export const budgetQuerySchema = z
  .object({
    month: budgetMonthSchema,
    currency: currencySchema.default(DEFAULT_CURRENCY),
    category: expenseCategorySchema.optional(),
  })
  .strict();

// Summary always includes every category; a category filter would hide spending.
export const budgetSummaryQuerySchema = budgetQuerySchema.omit({ category: true });
