import { expect, it } from 'vitest';
import {
  expenseCategories,
  validateBudgetForm,
  shiftMonth,
  monthLabel,
  utilizationText,
} from '../utils/budgets';
import { formatINR } from '../utils/transactions';
const values = { category: 'food_dining', month: '2026-10', amount: '100.50' };
it('converts decimal budget strings exactly through existing money utilities', () => {
  for (const [amount, minor] of [
    ['100', 10000],
    ['100.5', 10050],
    ['100.50', 10050],
    ['0.01', 1],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])
    expect(validateBudgetForm({ ...values, amount }).data.amountMinor).toBe(minor);
  expect(formatINR(Number.MAX_SAFE_INTEGER)).toBe('₹9,00,71,99,25,47,409.91');
  expect(formatINR(-50)).toBe('−₹0.50');
});
it('rejects zero, negatives, overprecision, malformed values and unsafe conversions', () => {
  for (const amount of [
    '0',
    '-1',
    '1.001',
    'NaN',
    'Infinity',
    '1e3',
    '1,000',
    '100abc',
    '',
    '90071992547409.92',
  ])
    expect(validateBudgetForm({ ...values, amount }).errors.amount).toBeTruthy();
});
it('uses shared expense categories and marks duplicate slots without blocking existing edits', () => {
  expect(expenseCategories.some((row) => row.id === 'salary')).toBe(false);
  expect(validateBudgetForm({ ...values, category: 'salary' }).errors.category).toBeTruthy();
  const configured = [{ id: 'existing', month: values.month, category: values.category }];
  expect(validateBudgetForm(values, configured).errors.category).toBeTruthy();
  expect(validateBudgetForm(values, configured, configured[0]).data.amountMinor).toBe(10050);
});
it('uses canonical UTC months across years and bounded calendar extremes', () => {
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('0001-01', -1)).toBeNull();
  expect(shiftMonth('9999-12', 1)).toBeNull();
  expect(monthLabel('0001-01')).toBe('January 1');
  for (const month of ['2026-1', '2026-13', '0000-01', ''])
    expect(validateBudgetForm({ ...values, month }).errors.month).toBeTruthy();
});
it('formats exact utilization above 100% and large basis-point values', () => {
  expect(utilizationText(15000)).toBe('150.00%');
  expect(utilizationText(0)).toBe('0.00%');
  expect(utilizationText(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91%');
});
