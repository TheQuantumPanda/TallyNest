import { z } from 'zod';
import { api } from './api';
import { monthSchema, expenseCategorySchema, expenseCategories } from '../utils/budgets';
import { ratioBasisPoints } from '../../../shared/dashboard.js';

const money = z.number().int().nonnegative().safe();
const signed = z.number().int().safe();
const fields = {
  id: z.string().regex(/^[a-f0-9]{24}$/i),
  version: money,
  category: expenseCategorySchema,
  currency: z.literal('INR'),
  month: monthSchema,
};
const budgetSchema = z.object({
  ...fields,
  amountMinor: money.positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const progressSchema = z.object({
  ...fields,
  limitMinor: money.positive(),
  spentMinor: money,
  remainingMinor: signed,
  overspentMinor: money,
  utilizationBasisPoints: money,
  status: z.enum(['unused', 'within_budget', 'at_limit', 'over_budget']),
});
const maxCategories = expenseCategories.length;
const summarySchema = z
  .object({
    month: monthSchema,
    currency: z.literal('INR'),
    reportingTimezone: z.literal('UTC'),
    consistency: z.literal('best_effort'),
    // Date parsing supports the backend's exclusive December-9999 boundary.
    period: z.object({ from: z.string(), to: z.string() }),
    budgets: z.array(progressSchema).max(maxCategories),
    unbudgetedCategories: z
      .array(z.object({ category: expenseCategorySchema, spentMinor: money.positive() }))
      .max(maxCategories),
    totals: z.object({
      budgetLimitMinor: money,
      budgetedSpendingMinor: money,
      unbudgetedSpendingMinor: money,
      expenseMinor: money,
      remainingMinor: signed,
      overspentMinor: money,
    }),
    counts: z.object({
      budgetCount: money,
      unbudgetedCategoryCount: money,
      expenseTransactionCount: money,
      statuses: z.object({
        unused: money,
        within_budget: money,
        at_limit: money,
        over_budget: money,
      }),
    }),
  })
  .superRefine((value, context) => {
    // Validate server authority; never derive display totals from transaction pages.
    const invalid = () =>
      context.addIssue({ code: 'custom', message: 'Budget summary does not reconcile' });
    const sum = (rows, key) => rows.reduce((total, row) => total + BigInt(row[key]), 0n);
    const seen = new Set();
    const statuses = { unused: 0, within_budget: 0, at_limit: 0, over_budget: 0 };
    for (const row of value.budgets) {
      const remaining = BigInt(row.limitMinor) - BigInt(row.spentMinor);
      const status =
        row.spentMinor === 0
          ? 'unused'
          : row.spentMinor < row.limitMinor
            ? 'within_budget'
            : row.spentMinor === row.limitMinor
              ? 'at_limit'
              : 'over_budget';
      if (
        seen.has(row.category) ||
        row.month !== value.month ||
        row.currency !== value.currency ||
        row.status !== status ||
        remaining !== BigInt(row.remainingMinor) ||
        (remaining < 0n ? -remaining : 0n) !== BigInt(row.overspentMinor) ||
        ratioBasisPoints(row.spentMinor, row.limitMinor) !== BigInt(row.utilizationBasisPoints)
      )
        invalid();
      seen.add(row.category);
      statuses[row.status] += 1;
    }
    for (const row of value.unbudgetedCategories) {
      if (seen.has(row.category)) invalid();
      seen.add(row.category);
    }
    const total = value.totals;
    if (
      sum(value.budgets, 'limitMinor') !== BigInt(total.budgetLimitMinor) ||
      sum(value.budgets, 'spentMinor') !== BigInt(total.budgetedSpendingMinor) ||
      sum(value.budgets, 'overspentMinor') !== BigInt(total.overspentMinor) ||
      sum(value.unbudgetedCategories, 'spentMinor') !== BigInt(total.unbudgetedSpendingMinor) ||
      BigInt(total.budgetedSpendingMinor) + BigInt(total.unbudgetedSpendingMinor) !==
        BigInt(total.expenseMinor) ||
      BigInt(total.budgetLimitMinor) - BigInt(total.budgetedSpendingMinor) !==
        BigInt(total.remainingMinor) ||
      value.counts.budgetCount !== value.budgets.length ||
      value.counts.unbudgetedCategoryCount !== value.unbudgetedCategories.length ||
      Object.keys(statuses).some((key) => statuses[key] !== value.counts.statuses[key])
    )
      invalid();
    const from = new Date(`${value.month}-01T00:00:00.000Z`),
      to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    if (value.period.from !== from.toISOString() || value.period.to !== to.toISOString()) invalid();
  });
function single(response) {
  const budget = budgetSchema.parse(response.data.data.budget);
  const expected = `"tn-${budget.id}-v${budget.version}"`;
  if (response.headers?.etag && response.headers.etag !== expected)
    throw new Error('Invalid budget version response');
  return { ...budget, etag: expected };
}
export const budgetService = {
  async list(month, signal) {
    monthSchema.parse(month);
    const response = await api.get('/budgets', { params: { month, currency: 'INR' }, signal });
    const budgets = z.array(budgetSchema).max(maxCategories).parse(response.data.data.budgets);
    if (budgets.some((row) => row.month !== month)) throw new Error('Wrong budget month');
    return budgets;
  },
  async summary(month, signal) {
    monthSchema.parse(month);
    const response = await api.get('/budgets/summary', {
      params: { month, currency: 'INR' },
      signal,
    });
    const summary = summarySchema.parse(response.data.data.summary);
    if (summary.month !== month) throw new Error('Wrong reporting month');
    return summary;
  },
  async get(id, signal) {
    return single(await api.get(`/budgets/${id}`, { signal }));
  },
  async create(data) {
    return single(await api.post('/budgets', data));
  },
  async update(budget, data) {
    return single(
      await api.patch(`/budgets/${budget.id}`, data, {
        headers: { 'If-Match': budget.etag || `"tn-${budget.id}-v${budget.version}"` },
      }),
    );
  },
  async remove(id) {
    const response = await api.delete(`/budgets/${id}`);
    z.object({ status: z.literal('ok'), message: z.literal('Budget deleted') }).parse(
      response.data,
    );
  },
};
