import { z } from 'zod';
import { api } from './api';
import { id, minor, timestamp, count, path, single, page, versionHeaders, success } from './groups';
import { allocateSplit } from '../../../shared/split.js';
import { categoriesFor } from '../utils/transactions';
const participant = z.object({ user: id, amountMinor: minor });
export const splitSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('equal'), participants: z.array(id).min(1).max(100) }),
  z.object({ method: z.literal('exact'), participants: z.array(participant).min(1).max(100) }),
  z.object({
    method: z.literal('percentage'),
    participants: z
      .array(z.object({ user: id, basisPoints: count.min(1).max(10000) }))
      .min(1)
      .max(100),
  }),
]);
export const expenseSchema = z
  .object({
    id,
    groupId: id,
    creatorId: id,
    payer: id,
    title: z.string().trim().min(1).max(200),
    amountMinor: minor,
    currency: z.literal('INR'),
    category: z.enum(categoriesFor('expense').map((row) => row.id)),
    expenseDate: timestamp,
    notes: z.string().max(2000).optional(),
    split: splitSchema,
    shares: z.array(participant).min(1).max(100),
    version: count,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .superRefine((row, context) => {
    try {
      if (
        JSON.stringify(allocateSplit(row.amountMinor, row.split).shares) !==
        JSON.stringify(row.shares)
      )
        throw new Error();
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid expense allocation' });
    }
  });
const querySchema = z
  .object({
    limit: count.min(1).max(100).default(20),
    after: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(400)
      .optional(),
  })
  .strict();
export const groupExpensesService = {
  async list(groupId, query = {}, signal) {
    const params = querySchema.parse(query);
    const result = page(
      await api.get(path(groupId) + '/expenses', { params, signal }),
      'expenses',
      expenseSchema,
      params,
    );
    if (result.rows.some((row) => row.groupId !== groupId))
      throw new Error('Invalid group expense scope');
    return result;
  },
  async get(groupId, target, signal) {
    const row = single(
      await api.get(path(groupId) + `/expenses/${id.parse(target)}`, { signal }),
      'expense',
      expenseSchema,
    );
    if (row.groupId !== groupId || row.id !== target) throw new Error('Invalid expense scope');
    return row;
  },
  async create(groupId, data, key) {
    z.uuid().parse(key);
    const response = await api.post(path(groupId) + '/expenses', data, {
      headers: { 'Idempotency-Key': key },
    });
    const row = single(response, 'expense', expenseSchema);
    const replayed = z.boolean().parse(response.data.data.replayed);
    if (row.groupId !== groupId) throw new Error('Invalid expense scope');
    return { ...row, replayed };
  },
  async update(groupId, row, data) {
    const updated = single(
      await api.patch(path(groupId) + `/expenses/${id.parse(row.id)}`, data, {
        headers: versionHeaders(row),
      }),
      'expense',
      expenseSchema,
    );
    if (updated.groupId !== groupId || updated.id !== row.id)
      throw new Error('Invalid expense scope');
    return updated;
  },
  async remove(groupId, row) {
    success(
      await api.delete(path(groupId) + `/expenses/${id.parse(row.id)}`, {
        headers: versionHeaders(row),
      }),
      'Group expense deleted',
    );
  },
};
