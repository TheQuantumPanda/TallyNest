import { dashboardRepository } from '../repositories/dashboard.repository.js';
import { dashboardQuerySchema } from '../validators/dashboard.validator.js';
import { isCategoryForType } from '../constants/transaction.constants.js';
import { HttpError } from '../utils/httpError.js';
import { toPublicTransaction } from './transaction.service.js';
import { DASHBOARD_PERIODS, allocateShares } from '../../../shared/dashboard.js';

const max = BigInt(Number.MAX_SAFE_INTEGER);
function failure(code = 'SUMMARY_INCONSISTENT') {
  return new HttpError(
    422,
    code === 'SUMMARY_OVERFLOW'
      ? 'Summary exceeds the supported integer range'
      : 'Summary data could not be reconciled',
    code,
  );
}
function exact(value) {
  const text = value.toString();
  if (!/^\d+$/.test(text)) throw failure('SUMMARY_OVERFLOW');
  const amount = BigInt(text);
  if (amount > max) throw failure('SUMMARY_OVERFLOW');
  return amount;
}
export function reportingPeriod(id, now) {
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth();
  const from = new Date(
    Date.UTC(
      year,
      id === 'this_year' ? 0 : month - (id === 'last_month' ? 1 : id === 'last_3_months' ? 2 : 0),
      1,
    ),
  );
  const to = new Date(
    Date.UTC(
      id === 'this_year' ? year + 1 : year,
      id === 'this_year' ? 0 : month + (id === 'last_month' ? 0 : 1),
      1,
    ),
  );
  return { id, from, to, grouping: DASHBOARD_PERIODS.find((period) => period.id === id).grouping };
}
export function bucketStart(date, grouping) {
  const bucket = new Date(date);
  if (grouping === 'month') bucket.setUTCDate(1);
  if (grouping === 'week') bucket.setUTCDate(bucket.getUTCDate() - ((bucket.getUTCDay() + 6) % 7));
  bucket.setUTCHours(0, 0, 0, 0);
  return bucket;
}
export function createDashboardService({
  repository = dashboardRepository,
  now = () => new Date(),
} = {}) {
  return {
    async summary(owner, query) {
      const input = dashboardQuerySchema.safeParse(query);
      if (!input.success) throw new HttpError(400, 'Invalid dashboard query', 'INVALID_QUERY');
      const period = reportingPeriod(input.data.period, now());
      const result = await repository.summarize(owner, period);
      if (!result || result.integrity?.some((item) => item.invalid !== 0))
        throw failure('SUMMARY_DATA_INVALID');
      let income = 0n,
        expense = 0n,
        count = 0;
      for (const item of result.totals) {
        if (item._id.currency !== 'INR' || !['income', 'expense'].includes(item._id.type))
          throw failure();
        if (!Number.isSafeInteger(item.count) || item.count < 0) throw failure('SUMMARY_OVERFLOW');
        count += item.count;
        if (item._id.type === 'income') income += exact(item.amount);
        else expense += exact(item.amount);
      }
      if (income > max || expense > max || !Number.isSafeInteger(count))
        throw failure('SUMMARY_OVERFLOW');
      const net = income - expense;
      if (net > max || net < -max) throw failure('SUMMARY_OVERFLOW');
      let categorySum = 0n;
      const categories = result.categories
        .map((item) => {
          if (item._id.currency !== 'INR' || !isCategoryForType(item._id.category, 'expense'))
            throw failure();
          const amount = exact(item.amount);
          categorySum += amount;
          return { category: item._id.category, amountMinor: Number(amount) };
        })
        .sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category));
      if (categorySum !== expense) throw failure();
      const points = new Map();
      for (let date = bucketStart(period.from, period.grouping); date < period.to;) {
        points.set(date.toISOString(), {
          date: date.toISOString(),
          incomeMinor: 0,
          expenseMinor: 0,
          transactionCount: 0,
        });
        const next = new Date(date);
        if (period.grouping === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
        else next.setUTCDate(next.getUTCDate() + (period.grouping === 'week' ? 7 : 1));
        date = next;
      }
      let seriesIncome = 0n,
        seriesExpense = 0n,
        seriesCount = 0;
      for (const item of result.series) {
        const point = points.get(item._id.bucket.toISOString());
        if (!point || item._id.currency !== 'INR' || !['income', 'expense'].includes(item._id.type))
          throw failure();
        const amount = exact(item.amount);
        if (item._id.type === 'income') {
          point.incomeMinor = Number(amount);
          seriesIncome += amount;
        } else {
          point.expenseMinor = Number(amount);
          seriesExpense += amount;
        }
        if (!Number.isSafeInteger(item.count) || item.count < 0) throw failure();
        point.transactionCount += item.count;
        seriesCount += item.count;
      }
      if (seriesIncome !== income || seriesExpense !== expense || seriesCount !== count)
        throw failure();
      return {
        currency: 'INR',
        reportingTimezone: 'UTC',
        period: {
          id: period.id,
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          grouping: period.grouping,
        },
        totals: {
          incomeMinor: Number(income),
          expenseMinor: Number(expense),
          netMinor: Number(net),
          transactionCount: count,
        },
        cashFlow: [...points.values()],
        spending: allocateShares(categories, Number(expense)),
        recentTransactions: result.recent.map(toPublicTransaction),
      };
    },
  };
}
