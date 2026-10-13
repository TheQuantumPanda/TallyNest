import { z } from 'zod';
import { transactionTypeSchema, currencySchema, categorySchema, transactionDateSchema, ownerIdSchema, amountMinorSchema } from './transaction.validator.js';
import { DEFAULT_CURRENCY, isCategoryForType } from '../constants/transaction.constants.js';

const queryFields = {
  type: transactionTypeSchema.optional(),
  category: categorySchema.optional(),
  currency: currencySchema.default(DEFAULT_CURRENCY),
  from: transactionDateSchema.optional(),
  to: transactionDateSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  sortBy: z.enum(['transactionDate', 'amountMinor']).default('transactionDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
};
function queryRules(query, context) {
  if (query.type && query.category && !isCategoryForType(query.category, query.type)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Category is incompatible with type' });
  }
  if (query.from && query.to && query.from >= query.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'Date range must be increasing' });
  }
}
const pageLimit = z.number().int().min(1).max(100);
export const transactionQuerySchema = z.object({
  ...queryFields,
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(pageLimit).default(20),
  cursor: z.string().min(1).max(2048).regex(/^v1\.[A-Za-z0-9_-]+$/).optional(),
}).strict().superRefine(queryRules);

export const cursorPositionSchema = z.object({
  id: ownerIdSchema,
  value: z.union([transactionDateSchema, amountMinorSchema]),
}).strict();

// Repository accepts normalized values only; arbitrary Mongo filters are impossible.
export const transactionPageSchema = z.object({
  ...queryFields, limit: pageLimit, after: cursorPositionSchema.optional(),
}).strict().superRefine(queryRules).superRefine((query, context) => {
  if (query.after && typeof query.after.value !== (query.sortBy === 'transactionDate' ? 'string' : 'number')) {
    context.addIssue({ code: 'custom', path: ['after'], message: 'Cursor sort value mismatch' });
  }
});

export const cursorPayloadSchema = cursorPositionSchema.extend({
  v: z.literal(1), owner: ownerIdSchema, binding: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive().safe(),
}).strict();

export const ifMatchSchema = z.string().max(100).regex(/^"tn-[a-fA-F0-9]{24}-v(0|[1-9]\d*)"$/)
  .transform(value => {
    const match = /^"tn-([a-fA-F0-9]{24})-v(\d+)"$/.exec(value);
    return { id: match[1].toLowerCase(), version: Number(match[2]) };
  }).pipe(z.object({ id: ownerIdSchema, version: z.number().int().nonnegative().safe() }));
