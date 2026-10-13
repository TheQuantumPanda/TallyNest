import { describe, expect, it } from 'vitest';
import {
  positiveMinor,
  formatINR,
  decimalAmount,
  validateTransactionForm,
  transactionQuery,
  DEFAULT_FILTERS,
  utcDate,
  categoriesFor,
} from '../utils/transactions';

const valid = {
  type: 'expense',
  title: ' Lunch ',
  amount: '100.50',
  category: 'food_dining',
  date: '2024-02-29',
  notes: ' memo ',
};
describe('transaction financial and calendar integrity', () => {
  it.each([
    ['100', 10000],
    ['100.5', 10050],
    ['100.50', 10050],
    ['0.01', 1],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('converts %s exactly', (text, minor) => {
    expect(positiveMinor(text)).toBe(minor);
    expect(positiveMinor(decimalAmount(minor))).toBe(minor);
  });
  it.each([
    '0',
    '-1',
    '1.001',
    '1.000',
    'NaN',
    'Infinity',
    '1e3',
    '1,000',
    ' 1',
    '.01',
    '90071992547409.92',
    100.5,
  ])('rejects invalid amount %s without rounding', (value) =>
    expect(() => positiveMinor(value)).toThrow(),
  );
  it('formats minor units using exact Indian grouping including maximum safe amounts', () => {
    expect(formatINR(125050)).toBe('₹1,250.50');
    expect(formatINR(1)).toBe('₹0.01');
    expect(formatINR(Number.MAX_SAFE_INTEGER)).toBe('₹9,00,71,99,25,47,409.91');
  });
  it('normalizes input, checks categories and preserves existing timestamps when day is unchanged', () => {
    const result = validateTransactionForm(valid, { transactionDate: '2024-02-29T19:25:30.123Z' });
    expect(result.data).toEqual({
      type: 'expense',
      title: 'Lunch',
      amountMinor: 10050,
      currency: 'INR',
      category: 'food_dining',
      transactionDate: '2024-02-29T19:25:30.123Z',
      notes: 'memo',
    });
    expect(
      validateTransactionForm(
        { ...valid, notes: '' },
        { transactionDate: '2024-02-28T00:00:00.000Z' },
      ).data.notes,
    ).toBeNull();
    expect(validateTransactionForm({ ...valid, type: 'income' }).errors.category).toBeTruthy();
    expect(categoriesFor('income').some((item) => item.id === 'salary')).toBe(true);
    expect(categoriesFor('income').some((item) => item.id === 'food_dining')).toBe(false);
  });
  it('rejects bad calendar dates, title and notes boundaries', () => {
    expect(() => utcDate('2023-02-29')).toThrow();
    expect(() => utcDate('2024-04-31')).toThrow();
    for (const data of [
      { title: '' },
      { title: 'a'.repeat(201) },
      { notes: 'a'.repeat(2001) },
      { date: '2023-02-29' },
    ]) {
      expect(validateTransactionForm({ ...valid, ...data }).data).toBeUndefined();
    }
  });
  it('maps inclusive UI end day to an exclusive UTC boundary and rejects reversed ranges', () => {
    const result = transactionQuery(
      {
        ...DEFAULT_FILTERS,
        from: '2024-02-29',
        to: '2024-02-29',
        type: 'expense',
        sort: 'amountMinor:asc',
      },
      ' Lunch ',
    );
    expect(result.query).toMatchObject({
      from: '2024-02-29T00:00:00.000Z',
      to: '2024-03-01T00:00:00.000Z',
      search: 'Lunch',
      sortBy: 'amountMinor',
      sortOrder: 'asc',
      limit: 20,
    });
    expect(
      transactionQuery({ ...DEFAULT_FILTERS, from: '2024-03-02', to: '2024-03-01' }, '').errors.to,
    ).toBeTruthy();
  });
});
