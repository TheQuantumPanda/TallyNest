import { z } from 'zod';
import {
  transactionInputSchema,
  transactionDateSchema,
  ownerIdSchema,
} from './transaction.validator.js';

export const frequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
const fields = { ...transactionInputSchema.shape };
delete fields.transactionDate;
const scheduleFields = {
  ...fields,
  frequency: frequencySchema,
  startDate: transactionDateSchema,
  endDate: transactionDateSchema.optional(),
  status: z.enum(['active', 'paused']).default('active'),
};
function rules(value, context) {
  const transaction = transactionInputSchema.safeParse({
    ...Object.fromEntries(Object.keys(fields).map((key) => [key, value[key]])),
    transactionDate: value.startDate,
  });
  if (!transaction.success)
    context.addIssue({ code: 'custom', path: ['category'], message: 'Invalid financial template' });
  if (value.startDate.startsWith('0000-') || (value.endDate && value.endDate < value.startDate))
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'Invalid scheduling range' });
}
export const recurringInputSchema = z.object(scheduleFields).strict().superRefine(rules);
export const recurringPatchSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(scheduleFields).map(([key, schema]) => [key, schema.optional()]),
    ),
    currency: fields.currency.unwrap().optional(),
    status: z.enum(['active', 'paused']).optional(),
    notes: fields.notes.unwrap().nullable().optional(),
    endDate: transactionDateSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const recurringQuerySchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d{0,2}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(20),
    after: ownerIdSchema.optional(),
  })
  .strict();
export const processInputSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(20) })
  .strict();
export const lifecycleInputSchema = z.object({}).strict();

export const recurringPageSchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    limit: z.number().int().min(1).max(100),
    after: ownerIdSchema.optional(),
  })
  .strict();
