import { budgetSummaryRepository, budgetMonthRange } from '../repositories/budget-summary.repository.js';
import { budgetInputSchema, budgetSummaryQuerySchema } from '../validators/budget.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { isCategoryForType } from '../constants/transaction.constants.js';
import { ratioBasisPoints } from '../../../shared/dashboard.js';
import { HttpError } from '../utils/httpError.js';

const max = BigInt(Number.MAX_SAFE_INTEGER);
function fail(code = 'SUMMARY_INCONSISTENT') {
  return new HttpError(422, code === 'SUMMARY_OVERFLOW' ? 'Summary exceeds the supported integer range'
    : code === 'SUMMARY_DATA_INVALID' ? 'Summary contains invalid financial records'
      : 'Summary data could not be reconciled', code);
}
function safeNumber(value) {
  if (value > max || value < -max) throw fail('SUMMARY_OVERFLOW');
  return Number(value);
}
function aggregateAmount(value) {
  const text = value?.toString();
  if (!text || !/^\d+$/.test(text)) throw fail('SUMMARY_DATA_INVALID');
  const amount = BigInt(text);
  safeNumber(amount);
  return amount;
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail('SUMMARY_OVERFLOW');
  return value;
}
function progress(limit, spent) {
  const remaining = BigInt(limit) - BigInt(spent);
  return { remainingMinor: safeNumber(remaining), overspentMinor: safeNumber(remaining < 0n ? -remaining : 0n),
    utilizationBasisPoints: safeNumber(ratioBasisPoints(spent, limit)),
    status: spent === 0 ? 'unused' : spent < limit ? 'within_budget' : spent === limit ? 'at_limit' : 'over_budget' };
}
export function createBudgetSummaryService({ repository = budgetSummaryRepository } = {}) {
  return {
    async summary(owner, query) {
      const input = budgetSummaryQuerySchema.safeParse(query);
      if (!input.success) throw new HttpError(400, 'Invalid budget summary query', 'INVALID_QUERY');
      const { month, currency } = input.data;
      const result = await repository.summarize(owner, input.data);
      const expenses = result?.expenses;
      if (!Array.isArray(result?.budgets) || !expenses || !Array.isArray(expenses.integrity) || expenses.integrity.length > 1 ||
        expenses.integrity.some(item => item.invalid !== 0)) throw fail('SUMMARY_DATA_INVALID');
      if (!Array.isArray(expenses.totals) || expenses.totals.length > 1 || !Array.isArray(expenses.categories)) throw fail();
      const total = expenses.totals[0];
      const expense = total ? aggregateAmount(total.amount) : 0n;
      const expenseCount = total ? count(total.count) : 0;
      if (expenseCount > 0 && expenses.integrity.length !== 1) throw fail('SUMMARY_DATA_INVALID');
      const spending = new Map();
      let categoryTotal = 0n, categoryCount = 0n;
      for (const row of expenses.categories) {
        if (!isCategoryForType(row._id, 'expense') || spending.has(row._id)) throw fail('SUMMARY_DATA_INVALID');
        const amount = aggregateAmount(row.amount);
        if (amount === 0n || count(row.count) === 0) throw fail('SUMMARY_DATA_INVALID');
        spending.set(row._id, Number(amount)); categoryTotal += amount; categoryCount += BigInt(row.count);
      }
      if (categoryTotal !== expense || categoryCount !== BigInt(expenseCount)) throw fail();
      const seen = new Set();
      let limitTotal = 0n, budgeted = 0n, overspent = 0n;
      const statuses = { unused: 0, within_budget: 0, at_limit: 0, over_budget: 0 };
      const budgets = result.budgets.map(row => {
        const data = budgetInputSchema.safeParse({ category: row.category, currency: row.currency, amountMinor: row.amountMinor, month: row.month });
        if (!data.success || Array.isArray(row.owner) || row.currency !== currency || row.month !== month || String(row.owner).toLowerCase() !== owner.toLowerCase() ||
          !ownerIdSchema.safeParse(String(row._id)).success || !Number.isSafeInteger(row.__v) || row.__v < 0 || seen.has(row.category)) throw fail('SUMMARY_DATA_INVALID');
        seen.add(row.category);
        const spent = spending.get(row.category) ?? 0;
        const state = progress(row.amountMinor, spent);
        limitTotal += BigInt(row.amountMinor); budgeted += BigInt(spent); overspent += BigInt(state.overspentMinor);
        statuses[state.status] += 1;
        return { id: String(row._id), version: row.__v, category: row.category, currency, month,
          limitMinor: row.amountMinor, spentMinor: spent, ...state };
      }).sort((a, b) => a.category.localeCompare(b.category));
      let unbudgeted = 0n;
      const unbudgetedCategories = [...spending].filter(([category]) => !seen.has(category))
        .sort(([a], [b]) => a.localeCompare(b)).map(([category, spentMinor]) => {
          unbudgeted += BigInt(spentMinor); return { category, spentMinor };
        });
      if (budgeted + unbudgeted !== expense) throw fail();
      const { from, to } = budgetMonthRange(month);
      return { month, currency, reportingTimezone: 'UTC', consistency: 'best_effort',
        period: { from: from.toISOString(), to: to.toISOString() }, budgets, unbudgetedCategories,
        totals: { budgetLimitMinor: safeNumber(limitTotal), budgetedSpendingMinor: safeNumber(budgeted),
          unbudgetedSpendingMinor: safeNumber(unbudgeted), expenseMinor: safeNumber(expense),
          remainingMinor: safeNumber(limitTotal - budgeted), overspentMinor: safeNumber(overspent) },
        counts: { budgetCount: budgets.length, unbudgetedCategoryCount: unbudgetedCategories.length,
          expenseTransactionCount: expenseCount, statuses },
      };
    },
  };
}
