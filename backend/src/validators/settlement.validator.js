import { z } from 'zod';
import { ownerIdSchema, amountMinorSchema, currencySchema } from './transaction.validator.js';
export const settlementInputSchema = z
  .object({
    recipient: ownerIdSchema.transform((value) => value.toLowerCase()),
    amountMinor: amountMinorSchema,
    currency: currencySchema.default('INR'),
  })
  .strict();
export const settlementQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9]\d{0,2}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(20),
    after: ownerIdSchema.optional(),
  })
  .strict();
