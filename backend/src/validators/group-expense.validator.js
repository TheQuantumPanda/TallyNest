import { z } from 'zod';
import {
  ownerIdSchema,
  amountMinorSchema,
  currencySchema,
  titleSchema,
  notesSchema,
  transactionDateSchema,
} from './transaction.validator.js';
import { expenseCategorySchema } from './budget.validator.js';
const userId = ownerIdSchema.transform((value) => value.toLowerCase());
export const splitSchema = z
  .discriminatedUnion('method', [
    z
      .object({ method: z.literal('equal'), participants: z.array(userId).min(1).max(100) })
      .strict(),
    z
      .object({
        method: z.literal('exact'),
        participants: z
          .array(z.object({ user: userId, amountMinor: amountMinorSchema }).strict())
          .min(1)
          .max(100),
      })
      .strict(),
    z
      .object({
        method: z.literal('percentage'),
        participants: z
          .array(
            z.object({ user: userId, basisPoints: z.number().int().min(1).max(10000) }).strict(),
          )
          .min(1)
          .max(100),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    const ids = value.participants.map((row) => (typeof row === 'string' ? row : row.user));
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Duplicate participants' });
    if (
      value.method === 'percentage' &&
      value.participants.reduce((sum, row) => sum + BigInt(row.basisPoints), 0n) !== 10000n
    )
      context.addIssue({ code: 'custom', message: 'Basis points must total 10000' });
  });
const fields = {
  payer: userId,
  title: titleSchema,
  amountMinor: amountMinorSchema,
  currency: currencySchema.default('INR'),
  category: expenseCategorySchema,
  expenseDate: transactionDateSchema,
  notes: notesSchema.optional(),
  split: splitSchema,
};
export const groupExpenseInputSchema = z.object(fields).strict();
export const groupExpensePatchSchema = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])),
    currency: currencySchema.optional(),
    notes: notesSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const idempotencyKeySchema = z.string().uuid();
export const expenseCursorSchema = z
  .object({ v: z.literal(1), group: userId, expenseDate: transactionDateSchema, id: userId })
  .strict();
export const groupExpenseQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9]\d{0,2}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(20),
    after: z
      .string()
      .min(1)
      .max(400)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export const expensePageSchema = z
  .object({ limit: z.number().int().min(1).max(100), after: expenseCursorSchema.optional() })
  .strict();
