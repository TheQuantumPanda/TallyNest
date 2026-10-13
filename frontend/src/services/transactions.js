import { z } from 'zod';
import { api } from './api';
import {
  TRANSACTION_CATEGORIES,
  isCategoryForType,
} from '../../../shared/transaction.constants.js';

export const transactionSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/i),
    version: z.number().int().nonnegative().safe(),
    type: z.enum(['income', 'expense']),
    title: z.string().min(1).max(200),
    amountMinor: z.number().int().positive().safe(),
    currency: z.literal('INR'),
    category: z.enum(TRANSACTION_CATEGORIES.map((item) => item.id)),
    transactionDate: z.string().datetime(),
    notes: z.string().max(2000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((value) => isCategoryForType(value.category, value.type));
const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .refine((value) => value.hasMore === (value.nextCursor !== null));
const single = (response) => {
  const transaction = transactionSchema.parse(response.data.data.transaction);
  const etag = response.headers?.etag || `"tn-${transaction.id}-v${transaction.version}"`;
  return { ...transaction, etag };
};
export const transactionService = {
  async list(query, signal) {
    const response = await api.get('/transactions', { params: query, signal });
    return {
      transactions: z.array(transactionSchema).parse(response.data.data.transactions),
      pagination: paginationSchema.parse(response.data.pagination),
    };
  },
  async get(id, signal) {
    return single(await api.get(`/transactions/${id}`, { signal }));
  },
  async create(data) {
    return single(await api.post('/transactions', data));
  },
  async update(transaction, data) {
    return single(
      await api.patch(`/transactions/${transaction.id}`, data, {
        headers: {
          'If-Match': transaction.etag || `"tn-${transaction.id}-v${transaction.version}"`,
        },
      }),
    );
  },
  async remove(id) {
    await api.delete(`/transactions/${id}`);
  },
};
