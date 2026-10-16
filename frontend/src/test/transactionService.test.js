import { beforeEach, expect, it, vi } from 'vitest';
import { transactionService } from '../services/transactions';
import { api } from '../services/api';
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const row = {
  id: '507f1f77bcf86cd799439033',
  version: 7,
  type: 'expense',
  title: 'Lunch',
  amountMinor: 125050,
  currency: 'INR',
  category: 'food_dining',
  transactionDate: '2026-10-13T07:00:00.000Z',
  createdAt: '2026-10-13T07:01:00.000Z',
  updatedAt: '2026-10-13T07:01:00.000Z',
};
beforeEach(() => {
  for (const method of ['get', 'post', 'patch'])
    api[method].mockResolvedValue({
      data: { data: { transaction: row, replayed: false } },
      headers: { etag: '"actual-server-tag"' },
    });
});
it('extracts actual listing envelope and sends cursor/query with cancellation', async () => {
  const pagination = { limit: 20, hasMore: true, nextCursor: 'opaque' };
  api.get.mockResolvedValue({ data: { data: { transactions: [row] }, pagination } });
  const signal = new AbortController().signal;
  expect(await transactionService.list({ limit: 20, cursor: 'opaque' }, signal)).toEqual({
    transactions: [row],
    pagination,
  });
  expect(api.get).toHaveBeenCalledWith('/transactions', {
    params: { limit: 20, cursor: 'opaque' },
    signal,
  });
});
it('uses all mutation endpoints and sends the retrieved If-Match exactly', async () => {
  const fetched = await transactionService.get(row.id);
  expect(fetched.etag).toBe('"actual-server-tag"');
  await transactionService.update(fetched, { title: 'Edited' });
  expect(api.patch).toHaveBeenCalledWith(
    `/transactions/${row.id}`,
    { title: 'Edited' },
    { headers: { 'If-Match': '"actual-server-tag"' } },
  );
  await transactionService.create({ title: 'New' }, 'ab62cc0f-82f3-4d45-bd03-e347e047493a');
  expect(api.post).toHaveBeenCalledWith(
    '/transactions',
    { title: 'New' },
    { headers: { 'Idempotency-Key': 'ab62cc0f-82f3-4d45-bd03-e347e047493a' } },
  );
  await transactionService.remove(row.id);
  expect(api.delete).toHaveBeenCalledWith(`/transactions/${row.id}`);
});
it('constructs only the documented resource/version tag when no header is returned', async () => {
  api.get.mockResolvedValue({
    data: { data: { transaction: { ...row, owner: 'secret', passwordHash: 'secret' } } },
    headers: {},
  });
  const result = await transactionService.get(row.id);
  expect(result.etag).toBe(`"tn-${row.id}-v7"`);
  expect(result.owner).toBeUndefined();
  await transactionService.update(row, {});
  expect(api.patch.mock.calls.at(-1)[2].headers['If-Match']).toBe(`"tn-${row.id}-v7"`);
});
it('rejects unsafe or malformed API data instead of displaying rounded money', async () => {
  api.get.mockResolvedValue({ data: { data: { transaction: { ...row, amountMinor: 1.5 } } } });
  await expect(transactionService.get(row.id)).rejects.toBeDefined();
});
