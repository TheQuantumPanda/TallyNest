import { z } from 'zod';
import { api } from './api';
import { transactionSchema } from './transactions';
import { DASHBOARD_PERIODS } from '../../../shared/dashboard.js';
import { TRANSACTION_CATEGORIES } from '../../../shared/transaction.constants.js';
const money = z.number().int().nonnegative().safe();
const summarySchema = z
  .object({
    currency: z.literal('INR'),
    reportingTimezone: z.literal('UTC'),
    period: z.object({
      id: z.enum(DASHBOARD_PERIODS.map((item) => item.id)),
      from: z.string().datetime(),
      to: z.string().datetime(),
      grouping: z.enum(['day', 'week', 'month']),
    }),
    totals: z.object({
      incomeMinor: money,
      expenseMinor: money,
      netMinor: z.number().int().safe(),
      transactionCount: money,
    }),
    cashFlow: z
      .array(
        z.object({
          date: z.string().datetime(),
          incomeMinor: money,
          expenseMinor: money,
          transactionCount: money,
        }),
      )
      .max(32),
    spending: z
      .array(
        z.object({
          category: z.enum(
            TRANSACTION_CATEGORIES.filter((item) => item.types.includes('expense')).map(
              (item) => item.id,
            ),
          ),
          amountMinor: money,
          shareBasisPoints: z.number().int().min(0).max(10000),
        }),
      )
      .max(11),
    recentTransactions: z.array(transactionSchema).max(5),
  })
  .superRefine((data, context) => {
    const income = BigInt(data.totals.incomeMinor),
      expense = BigInt(data.totals.expenseMinor);
    const sum = (rows, field) => rows.reduce((total, row) => total + BigInt(row[field]), 0n);
    if (
      income - expense !== BigInt(data.totals.netMinor) ||
      sum(data.spending, 'amountMinor') !== expense ||
      sum(data.cashFlow, 'incomeMinor') !== income ||
      sum(data.cashFlow, 'expenseMinor') !== expense ||
      sum(data.cashFlow, 'transactionCount') !== BigInt(data.totals.transactionCount) ||
      (expense > 0n &&
        data.spending.reduce((total, row) => total + row.shareBasisPoints, 0) !== 10000)
    ) {
      context.addIssue({ code: 'custom', message: 'Summary does not reconcile' });
    }
  });
export const dashboardService = {
  async summary(period, signal) {
    const response = await api.get('/dashboard/summary', {
      params: { period, currency: 'INR' },
      signal,
    });
    return summarySchema.parse(response.data.data.summary);
  },
};
