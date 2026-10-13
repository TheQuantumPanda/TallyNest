export const recent = {
  id: '507f1f77bcf86cd799439033',
  version: 0,
  type: 'expense',
  title: 'Lunch',
  amountMinor: 10000,
  currency: 'INR',
  category: 'food_dining',
  transactionDate: '2026-10-13T00:00:00.000Z',
  createdAt: '2026-10-13T01:00:00.000Z',
  updatedAt: '2026-10-13T01:00:00.000Z',
};
export function dashboardFixture(empty = false) {
  return {
    currency: 'INR',
    reportingTimezone: 'UTC',
    period: {
      id: 'this_month',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
      grouping: 'day',
    },
    totals: {
      incomeMinor: empty ? 0 : 50000,
      expenseMinor: empty ? 0 : 10000,
      netMinor: empty ? 0 : 40000,
      transactionCount: empty ? 0 : 2,
    },
    cashFlow: [
      {
        date: '2026-10-13T00:00:00.000Z',
        incomeMinor: empty ? 0 : 50000,
        expenseMinor: empty ? 0 : 10000,
        transactionCount: empty ? 0 : 2,
      },
    ],
    spending: empty
      ? []
      : [{ category: 'food_dining', amountMinor: 10000, shareBasisPoints: 10000 }],
    recentTransactions: empty ? [] : [recent],
  };
}
