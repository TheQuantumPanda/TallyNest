import { currentUtcMonth } from '../../utils/budgets';
export const budgetRecord = {
  id: '507f1f77bcf86cd799439033',
  version: 0,
  category: 'food_dining',
  currency: 'INR',
  month: currentUtcMonth(),
  amountMinor: 10000,
  createdAt: '2026-10-13T07:00:00.000Z',
  updatedAt: '2026-10-13T07:00:00.000Z',
  etag: '"tn-507f1f77bcf86cd799439033-v0"',
};
export function budgetSummary(rows = [], unbudgetedCategories = [], month = currentUtcMonth()) {
  const budgets = rows.map((row, index) => ({
    id: `507f1f77bcf86cd7994390${String(33 + index).padStart(2, '0')}`,
    version: 0,
    category: row.category ?? 'food_dining',
    currency: 'INR',
    month,
    limitMinor: 10000,
    spentMinor: 0,
    remainingMinor: 10000,
    overspentMinor: 0,
    utilizationBasisPoints: 0,
    status: 'unused',
    ...row,
  }));
  const sum = (rows, key) => Number(rows.reduce((value, row) => value + BigInt(row[key]), 0n));
  const budgetLimitMinor = sum(budgets, 'limitMinor'),
    budgetedSpendingMinor = sum(budgets, 'spentMinor'),
    unbudgetedSpendingMinor = sum(unbudgetedCategories, 'spentMinor');
  const from = new Date(`${month}-01T00:00:00.000Z`),
    to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const statuses = { unused: 0, within_budget: 0, at_limit: 0, over_budget: 0 };
  budgets.forEach((row) => statuses[row.status]++);
  return {
    month,
    currency: 'INR',
    reportingTimezone: 'UTC',
    consistency: 'best_effort',
    period: { from: from.toISOString(), to: to.toISOString() },
    budgets,
    unbudgetedCategories,
    totals: {
      budgetLimitMinor,
      budgetedSpendingMinor,
      unbudgetedSpendingMinor,
      expenseMinor: Number(BigInt(budgetedSpendingMinor) + BigInt(unbudgetedSpendingMinor)),
      remainingMinor: Number(BigInt(budgetLimitMinor) - BigInt(budgetedSpendingMinor)),
      overspentMinor: sum(budgets, 'overspentMinor'),
    },
    counts: {
      budgetCount: budgets.length,
      unbudgetedCategoryCount: unbudgetedCategories.length,
      expenseTransactionCount:
        budgets.filter((row) => row.spentMinor > 0).length + unbudgetedCategories.length,
      statuses,
    },
  };
}
