import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { recurringService } from '../services/recurring';
import { transactionService } from '../services/transactions';
import { scheduleRecord, processingResult } from './fixtures/recurring';
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const single = (row = scheduleRecord) => ({
  data: { status: 'ok', data: { schedule: row } },
  headers: { etag: `"tn-${row.id}-v${row.version}"` },
});
const page = (rows = [scheduleRecord]) => ({
  data: {
    status: 'ok',
    data: { schedules: rows },
    pagination: { limit: 20, hasMore: false, nextAfter: null },
  },
});
beforeEach(() => vi.resetAllMocks());
it('requests bounded owner-scoped status pages with after and cancellation', async () => {
  api.get.mockResolvedValue(page());
  const signal = new AbortController().signal;
  await recurringService.list({ status: 'active', after: scheduleRecord.id }, signal);
  expect(api.get).toHaveBeenCalledWith('/recurring', {
    params: { limit: 20, status: 'active', after: scheduleRecord.id },
    signal,
  });
  for (const query of [
    { owner: scheduleRecord.id },
    { status: 'exhausted' },
    { limit: 101 },
    { after: '$ne' },
  ])
    await expect(recurringService.list(query)).rejects.toThrow();
});
it('validates financial values, actual UTC dates, categories, status and pagination', async () => {
  for (const change of [
    { amountMinor: 0 },
    { amountMinor: 1.1 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' },
    { category: 'salary' },
    { startDate: '2026-02-30T09:00:00.000Z' },
    { exhausted: true },
    { status: 'done' },
    { nextOccurrenceDate: '2025-01-01T09:00:00.000Z' },
  ]) {
    api.get.mockResolvedValue(page([{ ...scheduleRecord, ...change }]));
    await expect(recurringService.list({})).rejects.toThrow();
  }
  api.get.mockResolvedValue({
    data: { ...page().data, pagination: { limit: 20, hasMore: true, nextAfter: null } },
  });
  await expect(recurringService.list({})).rejects.toThrow();
  api.get.mockResolvedValue(page());
  await expect(recurringService.list({ status: 'paused' })).rejects.toThrow();
});
it('retains the server ETag and sends it for updates and explicit lifecycle operations', async () => {
  api.get.mockResolvedValue(single());
  const record = await recurringService.get(scheduleRecord.id);
  api.patch.mockResolvedValue(single({ ...scheduleRecord, version: 1 }));
  await recurringService.update(record, { amountMinor: 10001 });
  expect(api.patch).toHaveBeenCalledWith(
    `/recurring/${record.id}`,
    { amountMinor: 10001 },
    { headers: { 'If-Match': record.etag } },
  );
  api.post.mockResolvedValue(single({ ...scheduleRecord, status: 'paused', version: 1 }));
  await recurringService.lifecycle(record, 'pause');
  expect(api.post).toHaveBeenLastCalledWith(
    `/recurring/${record.id}/pause`,
    {},
    { headers: { 'If-Match': record.etag } },
  );
  api.post.mockResolvedValue(single({ ...scheduleRecord, version: 2 }));
  await recurringService.lifecycle(record, 'resume');
  expect(api.post.mock.calls.at(-1)[0]).toBe(`/recurring/${record.id}/resume`);
  await expect(recurringService.update({ ...record, etag: undefined }, {})).rejects.toThrow();
  await expect(recurringService.lifecycle(record, 'delete')).rejects.toThrow();
});
it('rejects missing or incompatible server ETags and malformed identifiers before mutation', async () => {
  for (const headers of [{}, { etag: 'wrong' }]) {
    api.get.mockResolvedValue({ ...single(), headers });
    await expect(recurringService.get(scheduleRecord.id)).rejects.toThrow();
  }
  await expect(recurringService.get('$ne')).rejects.toThrow();
  await expect(recurringService.remove('invalid')).rejects.toThrow();
});
it('creates, removes and performs exactly one fixed bounded processing request', async () => {
  api.post.mockResolvedValue(single());
  await recurringService.create({ title: 'One' });
  expect(api.post.mock.calls[0][0]).toBe('/recurring');
  api.delete.mockResolvedValue({ data: { status: 'ok', message: 'Recurring schedule deleted' } });
  await recurringService.remove(scheduleRecord.id);
  api.post.mockResolvedValue({
    data: { status: 'ok', data: { processing: { ...processingResult, hasMoreDue: true } } },
  });
  expect((await recurringService.process()).hasMoreDue).toBe(true);
  expect(api.post).toHaveBeenLastCalledWith('/recurring/process', { limit: 20 });
  expect(api.post).toHaveBeenCalledTimes(2);
});
it('validates processing counts and propagates 401, busy and 429 errors unchanged', async () => {
  api.post.mockResolvedValue({
    data: { status: 'ok', data: { processing: { ...processingResult, generated: 101 } } },
  });
  await expect(recurringService.process()).rejects.toThrow();
  for (const status of [401, 409, 429]) {
    const error = { response: { status } };
    api.post.mockRejectedValue(error);
    await expect(recurringService.process()).rejects.toBe(error);
  }
});
it('preserves generated transaction provenance through the existing ledger service', async () => {
  const row = {
    ...scheduleRecord,
    transactionDate: scheduleRecord.startDate,
    recurrence: { scheduleId: scheduleRecord.id, scheduledDate: scheduleRecord.startDate },
  };
  api.get.mockResolvedValue({ data: { data: { transaction: row } }, headers: {} });
  expect((await transactionService.get(row.id)).recurrence).toEqual(row.recurrence);
});
