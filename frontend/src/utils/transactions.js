import { creationError } from './creationErrors';
import { z } from 'zod';
import { majorToMinor, minorToMajor } from '../../../shared/money.js';
import {
  TRANSACTION_CATEGORIES,
  isCategoryForType,
} from '../../../shared/transaction.constants.js';

export { TRANSACTION_CATEGORIES };
export const categoriesFor = (type) =>
  TRANSACTION_CATEGORIES.filter((item) => !type || item.types.includes(type));
export const categoryLabel = (id) =>
  TRANSACTION_CATEGORIES.find((item) => item.id === id)?.label ?? id;
export const decimalAmount = minorToMajor;

export function formatINR(minor) {
  const decimal = minorToMajor(minor);
  const [whole, fraction] = decimal.replace(/^-/, '').split('.');
  const tail = whole.slice(-3);
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${minor < 0 ? '−' : ''}₹${head ? head + ',' : ''}${tail}.${fraction}`;
}
export function positiveMinor(text) {
  const result = majorToMinor(text);
  if (result <= 0) throw new RangeError('Amount must be greater than zero');
  return result;
}
export function utcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid date.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Choose a valid calendar date.');
  return date.toISOString();
}
export function displayDate(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}
const formSchema = z
  .object({
    type: z.enum(['income', 'expense']),
    title: z.string().trim().min(1, 'Enter a title.').max(200, 'Use 200 characters or fewer.'),
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
    category: z.string(),
    date: z.string().superRefine((value, context) => {
      try {
        utcDate(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Choose a valid calendar date.' });
      }
    }),
    notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
  })
  .superRefine((value, context) => {
    if (!isCategoryForType(value.category, value.type))
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Choose a category for this transaction type.',
      });
  });
export function validateTransactionForm(values, existing) {
  const result = formSchema.safeParse(values);
  if (!result.success)
    return {
      errors: Object.fromEntries(
        result.error.issues.map((issue) => [issue.path[0], issue.message]),
      ),
    };
  const data = result.data;
  return {
    data: {
      type: data.type,
      title: data.title,
      amountMinor: positiveMinor(data.amount),
      currency: 'INR',
      category: data.category,
      transactionDate:
        existing && data.date === existing.transactionDate.slice(0, 10)
          ? existing.transactionDate
          : utcDate(data.date),
      ...(existing ? { notes: data.notes || null } : data.notes ? { notes: data.notes } : {}),
    },
    errors: {},
  };
}
export const DEFAULT_FILTERS = {
  type: '',
  category: '',
  from: '',
  to: '',
  search: '',
  sort: 'transactionDate:desc',
};
export function transactionQuery(filters, search) {
  const errors = {};
  let from, to;
  try {
    if (filters.from) from = utcDate(filters.from);
  } catch {
    errors.from = 'Choose a valid start date.';
  }
  try {
    if (filters.to) {
      const date = new Date(utcDate(filters.to));
      date.setUTCDate(date.getUTCDate() + 1);
      to = date.toISOString();
      if (!/^\d{4}-/.test(to)) throw new Error();
    }
  } catch {
    errors.to = 'Choose a valid end date.';
  }
  if (from && to && from >= to) errors.to = 'End date must be on or after start date.';
  if (search.trim().length > 80) errors.search = 'Search must be 80 characters or fewer.';
  const [sortBy, sortOrder] = filters.sort.split(':');
  return {
    errors,
    query: {
      limit: 20,
      currency: 'INR',
      sortBy,
      sortOrder,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    },
  };
}
export function transactionError(error) {
  const receiptError = creationError(error);
  if (receiptError) return receiptError;
  const status = error.response?.status;
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 404)
    return 'This transaction is no longer available. Reload the list to see the latest records.';
  if ([409, 412, 428].includes(status))
    return 'This record needs a fresh version. Your changes are still here. Reload the latest transaction before saving.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 403) return 'The request could not be authorized. Reload this page and try again.';
  if (status === 400)
    return 'The request could not be accepted. Check the fields or reload the list.';
  return 'We could not reach your transactions. Please try again.';
}
