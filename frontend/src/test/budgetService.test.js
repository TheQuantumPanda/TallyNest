import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { budgetService } from '../services/budgets';
import { budgetRecord, budgetSummary } from './fixtures/budgets';
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const envelope = (summary) => ({ data: { status: 'ok', data: { summary } } });
const single = (budget = budgetRecord) => ({
  data: { status: 'ok', data: { budget } },
  headers: { etag: `"tn-${budget.id}-v${budget.version}"` },
});
beforeEach(() => vi.resetAllMocks());
it('requests actual summary envelope with month, INR and cancellation signal', async () => {
  const summary = budgetSummary([{}]);
  api.get.mockResolvedValue(envelope(summary));
  const signal = new AbortController().signal;
  expect(await budgetService.summary(summary.month, signal)).toEqual(summary);
  expect(api.get).toHaveBeenCalledWith('/budgets/summary', {
    params: { month: summary.month, currency: 'INR' },
    signal,
  });
});
it('validates currency, safe money, expense categories, month and full reconciliation', async () => {
  for (const mutate of [
    (value) => (value.currency = 'USD'),
    (value) => (value.budgets[0].limitMinor = 0),
    (value) => (value.budgets[0].spentMinor = 1.5),
    (value) => (value.budgets[0].category = 'salary'),
    (value) => (value.totals.expenseMinor = Number.MAX_SAFE_INTEGER + 1),
    (value) => value.totals.remainingMinor++,
    (value) => (value.budgets[0].status = 'at_limit'),
    (value) => value.budgets.push(value.budgets[0]),
    (value) => (value.period.to = value.period.from),
    (value) => (value.month = '2026-09'),
  ]) {
    const summary = budgetSummary([{}]);
    mutate(summary);
    api.get.mockResolvedValue(envelope(summary));
    await expect(budgetService.summary(budgetRecord.month)).rejects.toThrow();
  }
});
it('retains uncapped utilization and negative remaining without precision loss', async () => {
  const summary = budgetSummary([
    {
      limitMinor: 100,
      spentMinor: 150,
      remainingMinor: -50,
      overspentMinor: 50,
      utilizationBasisPoints: 15000,
      status: 'over_budget',
    },
  ]);
  api.get.mockResolvedValue(envelope(summary));
  expect((await budgetService.summary(summary.month)).budgets[0].utilizationBasisPoints).toBe(
    15000,
  );
});
it('fetches a current ETag and sends exactly that If-Match for update', async () => {
  api.get.mockResolvedValue(single());
  const record = await budgetService.get(budgetRecord.id);
  const data = { amountMinor: 15000 };
  api.patch.mockResolvedValue(single({ ...budgetRecord, version: 1 }));
  expect((await budgetService.update(record, data)).version).toBe(1);
  expect(api.patch).toHaveBeenCalledWith(`/budgets/${record.id}`, data, {
    headers: { 'If-Match': record.etag },
  });
  api.patch.mockResolvedValue(single());
  await budgetService.update({ ...budgetRecord, etag: undefined }, data);
  expect(api.patch.mock.calls.at(-1)[2].headers['If-Match']).toBe(budgetRecord.etag);
});
it('creates and deletes through existing Axios client and rejects incompatible version responses', async () => {
  api.post.mockResolvedValue(single());
  await budgetService.create({
    category: 'food_dining',
    amountMinor: 10000,
    currency: 'INR',
    month: budgetRecord.month,
  });
  expect(api.post.mock.calls[0][0]).toBe('/budgets');
  api.delete.mockResolvedValue({ data: { status: 'ok', message: 'Budget deleted' } });
  await budgetService.remove(budgetRecord.id);
  expect(api.delete).toHaveBeenCalledWith(`/budgets/${budgetRecord.id}`);
  api.get.mockResolvedValue({ ...single(), headers: { etag: 'wrong-version' } });
  await expect(budgetService.get(budgetRecord.id)).rejects.toThrow();
});
it('propagates authentication and duplicate errors to shared session and form handling', async () => {
  const error = { response: { status: 401 } };
  api.get.mockRejectedValue(error);
  await expect(budgetService.summary(budgetRecord.month)).rejects.toBe(error);
  const duplicate = { response: { status: 409, data: { code: 'BUDGET_EXISTS' } } };
  api.post.mockRejectedValue(duplicate);
  await expect(budgetService.create({})).rejects.toBe(duplicate);
});

it('retrieves validated saved limits separately for summary repair without invented spending', async () => {
  api.get.mockResolvedValue({ data: { status: 'ok', data: { budgets: [budgetRecord] } } });
  const result = await budgetService.list(budgetRecord.month);
  expect(result[0].amountMinor).toBe(10000);
  expect(result[0].spentMinor).toBeUndefined();
  expect(api.get).toHaveBeenCalledWith('/budgets', {
    params: { month: budgetRecord.month, currency: 'INR' },
    signal: undefined,
  });
});
