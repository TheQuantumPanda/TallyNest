import { beforeEach, expect, it, vi } from 'vitest';
import { dashboardService } from '../services/dashboard';
import { api } from '../services/api';
import { dashboardFixture } from './fixtures/dashboard';
import { cashFlowPlot, axisMoney } from '../utils/dashboard';
import { formatINR } from '../utils/transactions';
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => api.get.mockResolvedValue({ data: { data: { summary: dashboardFixture() } } }));
it('extracts actual API envelope and sends server period and signal', async () => {
  const signal = new AbortController().signal;
  expect((await dashboardService.summary('this_month', signal)).totals.netMinor).toBe(40000);
  expect(api.get).toHaveBeenCalledWith('/dashboard/summary', {
    params: { period: 'this_month', currency: 'INR' },
    signal,
  });
});
it('rejects inconsistent and unsafe API summaries', async () => {
  for (const totals of [
    { ...dashboardFixture().totals, netMinor: 1 },
    { ...dashboardFixture().totals, incomeMinor: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    api.get.mockResolvedValue({ data: { data: { summary: { ...dashboardFixture(), totals } } } });
    await expect(dashboardService.summary('this_month')).rejects.toBeDefined();
  }
});
it('transforms chart geometry deterministically while retaining exact money, including zeros', () => {
  const plot = cashFlowPlot([
    { date: 'today', incomeMinor: Number.MAX_SAFE_INTEGER, expenseMinor: 1 },
  ]);
  expect(plot.points[0].incomePlot).toBe(10000);
  expect(plot.points[0].expenseMinor).toBe(1);
  expect(cashFlowPlot([{ incomeMinor: 0, expenseMinor: 0 }]).points[0].incomePlot).toBe(0);
  expect(axisMoney(100000, 10000)).toBe('₹1k');
  expect(axisMoney(1, 10000)).toBe('₹0.01');
  expect(axisMoney(Number.MAX_SAFE_INTEGER, 10000)).toBe('₹90T');
  expect(formatINR(-125050)).toBe('−₹1,250.50');
});
