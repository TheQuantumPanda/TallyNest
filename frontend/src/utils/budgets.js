import { z } from 'zod';
import { categoriesFor, positiveMinor } from './transactions';

export const expenseCategories = categoriesFor('expense');
export const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export const expenseCategorySchema = z.enum(expenseCategories.map((item) => item.id));
export const currentUtcMonth = () => new Date().toISOString().slice(0, 7);
export function monthLabel(month) {
  monthSchema.parse(month);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}
export function shiftMonth(month, offset) {
  if (!monthSchema.safeParse(month).success) return null;
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const next = date.toISOString().slice(0, 7);
  return monthSchema.safeParse(next).success ? next : null;
}
export const BUDGET_STATUSES = {
  unused: 'Unused',
  within_budget: 'Within budget',
  at_limit: 'At limit',
  over_budget: 'Over budget',
};
export function utilizationText(points) {
  if (!Number.isSafeInteger(points) || points < 0) throw new RangeError('Invalid utilization');
  const value = BigInt(points);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}%`;
}
const formSchema = z.object({
  category: expenseCategorySchema,
  month: monthSchema,
  amount: z.string().superRefine((value, context) => {
    try {
      positiveMinor(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Enter a positive amount with up to 2 decimals, within the safe limit.',
      });
    }
  }),
});
export function validateBudgetForm(values, configured = [], existing) {
  const result = formSchema.safeParse(values);
  if (!result.success)
    return {
      errors: Object.fromEntries(
        result.error.issues.map((issue) => [
          issue.path[0],
          issue.path[0] === 'month'
            ? 'Choose a valid month (YYYY-MM).'
            : issue.path[0] === 'category'
              ? 'Choose an expense category.'
              : issue.message,
        ]),
      ),
    };
  if (
    configured.some(
      (row) =>
        row.month === values.month && row.category === values.category && row.id !== existing?.id,
    )
  )
    return {
      errors: {
        category:
          'This category already has a budget for this month. Edit the existing limit or choose another slot.',
      },
    };
  return {
    data: {
      category: result.data.category,
      month: result.data.month,
      currency: 'INR',
      amountMinor: positiveMinor(result.data.amount),
    },
    errors: {},
  };
}
export function budgetError(error) {
  const status = error.response?.status,
    code = error.response?.data?.code;
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 404)
    return 'This budget is no longer available. Reload the month to see the latest records.';
  if (code === 'BUDGET_EXISTS')
    return 'A budget already exists for this category and month. Choose another slot or edit its existing limit.';
  if ([409, 412, 428].includes(status))
    return 'This budget needs a fresh version. Your changes are still here. Reload the latest budget before saving.';
  if (status === 422)
    return 'This summary could not be safely calculated. Review your saved limits and expense records.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 403) return 'The request could not be authorized. Reload this page and try again.';
  if (status === 400) return 'Check the category, amount and month, then try again.';
  return 'We could not reach your budgets. Please try again.';
}
