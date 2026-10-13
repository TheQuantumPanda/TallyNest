import { z } from 'zod';
import { categoriesFor, decimalAmount, positiveMinor } from './transactions';
import { isCategoryForType } from '../../../shared/transaction.constants.js';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
export const frequencyLabel = (frequency) => frequency[0].toUpperCase() + frequency.slice(1);
export const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) && date.toISOString() === value && !value.startsWith('0000-')
    );
  }, 'Enter a real UTC calendar date and time.');

// datetime-local is a wall-clock editor, explicitly interpreted as UTC here.
// Never parse its raw value through browser-local Date construction.
export function inputToUtc(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new Error('Enter a valid UTC date and time.');
  return utcTimestampSchema.parse(
    `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(3, '0')}Z`,
  );
}
export const utcToInput = (value) => utcTimestampSchema.parse(value).slice(0, -1);
export function displayUtc(value) {
  utcTimestampSchema.parse(value);
  // Keep seconds/milliseconds visible when present, including exact edit anchors.
  return `${value.slice(0, 10)} · ${value
    .slice(11, 23)
    .replace(/:00\.000$/, '')
    .replace(/\.000$/, '')} UTC`;
}
export function initialScheduleValues(schedule) {
  return {
    type: schedule?.type ?? 'expense',
    title: schedule?.title ?? '',
    amount: schedule ? decimalAmount(schedule.amountMinor) : '',
    category: schedule?.category ?? categoriesFor('expense')[0].id,
    frequency: schedule?.frequency ?? 'monthly',
    start: schedule ? utcToInput(schedule.startDate) : new Date().toISOString().slice(0, 16),
    end: schedule?.endDate ? utcToInput(schedule.endDate) : '',
    notes: schedule?.notes ?? '',
  };
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
    frequency: z.enum(FREQUENCIES),
    start: z.string(),
    end: z.string(),
    notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
  })
  .superRefine((value, context) => {
    if (!isCategoryForType(value.category, value.type))
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Choose a category for this transaction type.',
      });
    let start, end;
    for (const key of ['start', 'end']) {
      if (key === 'end' && !value.end) continue;
      try {
        const date = inputToUtc(value[key]);
        if (key === 'start') start = date;
        else end = date;
      } catch {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Enter a real UTC calendar date and time.',
        });
      }
    }
    if (start && end && end < start)
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'End must be on or after the start (UTC).',
      });
  });
export function validateScheduleForm(values, existing) {
  const result = formSchema.safeParse(values);
  if (!result.success)
    return {
      errors: Object.fromEntries(
        result.error.issues.map((issue) => [issue.path[0], issue.message]),
      ),
    };
  const data = result.data;
  return {
    errors: {},
    data: {
      type: data.type,
      title: data.title,
      amountMinor: positiveMinor(data.amount),
      currency: 'INR',
      category: data.category,
      frequency: data.frequency,
      startDate: inputToUtc(data.start),
      ...(data.end ? { endDate: inputToUtc(data.end) } : existing ? { endDate: null } : {}),
      ...(data.notes ? { notes: data.notes } : existing ? { notes: null } : {}),
    },
  };
}
export function recurringError(error) {
  const status = error.response?.status,
    code = error.response?.data?.code;
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 404)
    return 'This schedule is no longer available. Reload to see the latest records.';
  if (code === 'RECURRING_BUSY')
    return 'An occurrence is being completed. Your draft is still here. Check due entries, then reload the latest schedule before retrying.';
  if ([409, 412, 428].includes(status))
    return 'This schedule needs a fresh version. Your changes are still here. Reload the latest schedule and review before retrying.';
  if (status === 429)
    return 'Too many requests. Please wait before checking due entries or trying again.';
  if (status === 403) return 'The request could not be authorized. Reload this page and try again.';
  if (status === 400) return 'Check the fields, UTC dates and category, or reload the list.';
  return 'We could not reach your recurring schedules. Please try again.';
}
