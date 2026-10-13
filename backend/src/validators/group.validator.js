import { z } from 'zod';
import { ownerIdSchema, currencySchema } from './transaction.validator.js';

export const GROUP_MEMBER_LIMIT = 100;
export const groupNameSchema = z.string().trim().min(1).max(100);
export const groupDescriptionSchema = z.string().trim().max(2000);
export const groupRoleSchema = z.enum(['owner', 'member']);
export const groupInputSchema = z.object({ name: groupNameSchema,
  description: groupDescriptionSchema.optional(), currency: currencySchema.default('INR') }).strict();
export const groupPatchSchema = z.object({ name: groupNameSchema.optional(),
  description: groupDescriptionSchema.nullable().optional(), currency: currencySchema.optional() })
  .strict().refine(value => Object.keys(value).length > 0);
export const groupQuerySchema = z.object({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(20),
  after: ownerIdSchema.optional(),
}).strict();
export const groupPageSchema = z.object({ limit: z.number().int().min(1).max(100), after: ownerIdSchema.optional() }).strict();
