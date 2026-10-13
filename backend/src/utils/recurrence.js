import { recurringInputSchema, frequencySchema } from '../validators/recurring.validator.js';
import { transactionDateSchema } from '../validators/transaction.validator.js';

// All calendar calculations retain the original UTC clock and intended day.
export function occurrenceDate(start, frequency, number) {
  transactionDateSchema.parse(start); frequencySchema.parse(frequency);
  if (start.startsWith('0000-') || !Number.isSafeInteger(number) || number < 0) throw new RangeError('Invalid occurrence');
  const anchor = new Date(start), result = new Date(anchor);
  if (frequency === 'daily' || frequency === 'weekly') result.setUTCDate(anchor.getUTCDate() + number * (frequency === 'weekly' ? 7 : 1));
  else {
    result.setUTCDate(1);
    if (frequency === 'monthly') result.setUTCMonth(anchor.getUTCMonth() + number);
    else result.setUTCFullYear(anchor.getUTCFullYear() + number);
    if (!Number.isFinite(result.getTime())) return null;
    const last = new Date(result); last.setUTCMonth(last.getUTCMonth() + 1, 0);
    result.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
  }
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() > 9999) return null;
  return result;
}
export function cursorAfter(input, lastDate = null) {
  const data = recurringInputSchema.parse(input), anchor = new Date(data.startDate);
  let number = 0;
  if (lastDate && lastDate >= anchor) {
    if (['daily', 'weekly'].includes(data.frequency)) number = Math.floor((lastDate - anchor) / (86400000 * (data.frequency === 'weekly' ? 7 : 1)));
    else if (data.frequency === 'monthly') number = (lastDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + lastDate.getUTCMonth() - anchor.getUTCMonth();
    else number = lastDate.getUTCFullYear() - anchor.getUTCFullYear();
  }
  let next = occurrenceDate(data.startDate, data.frequency, number);
  while (next && lastDate && next <= lastDate) next = occurrenceDate(data.startDate, data.frequency, ++number);
  if (next && data.endDate && next > new Date(data.endDate)) next = null;
  return { occurrenceNumber: number, nextOccurrenceDate: next };
}
export function scheduleValues(document) {
  return { type: document.type, title: document.title, amountMinor: document.amountMinor, currency: document.currency,
    category: document.category, frequency: document.frequency, startDate: document.startDate.toISOString(), status: document.status,
    ...(document.endDate ? { endDate: document.endDate.toISOString() } : {}), ...(document.notes !== undefined ? { notes: document.notes } : {}) };
}
