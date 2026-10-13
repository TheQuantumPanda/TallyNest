import { expect, it } from 'vitest';
import {
  inputToUtc,
  utcToInput,
  displayUtc,
  initialScheduleValues,
  validateScheduleForm,
  recurringError,
} from '../utils/recurring';
import { scheduleRecord } from './fixtures/recurring';
const initial = () => initialScheduleValues(scheduleRecord);
it('treats wall-clock inputs explicitly as UTC and preserves milliseconds on prefilling', () => {
  expect(inputToUtc('2026-10-13T14:45')).toBe('2026-10-13T14:45:00.000Z');
  expect(inputToUtc('2024-02-29T09:12:13.1')).toBe('2024-02-29T09:12:13.100Z');
  expect(inputToUtc(utcToInput(scheduleRecord.startDate))).toBe(scheduleRecord.startDate);
  expect(displayUtc(scheduleRecord.startDate)).toBe('2026-01-31 · 09:30:15.123 UTC');
  expect(displayUtc('2026-10-13T14:45:00.000Z')).toBe('2026-10-13 · 14:45 UTC');
});
it('rejects impossible dates, browser offsets, missing times, year zero and overprecision', () => {
  for (const value of [
    '2026-02-29T12:00',
    '2026-04-31T12:00',
    '2026-01-01',
    '2026-01-01T24:00',
    '2026-01-01T00:00+05:30',
    '0000-01-01T00:00',
    '2026-01-01T00:00:00.1234',
    'bad',
  ]) {
    expect(() => inputToUtc(value)).toThrow();
    expect(validateScheduleForm({ ...initial(), start: value }).errors.start).toBeTruthy();
  }
  expect(inputToUtc('0001-01-01T00:00')).toBe('0001-01-01T00:00:00.000Z');
});
it('reuses exact conversion up to the maximum safe paise amount and never rounds', () => {
  for (const [amount, minor] of [
    ['100', 10000],
    ['100.5', 10050],
    ['100.50', 10050],
    ['0.01', 1],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])
    expect(validateScheduleForm({ ...initial(), amount }).data.amountMinor).toBe(minor);
  for (const amount of ['0', '-1', '1.001', 'NaN', 'Infinity', '1e3', '12abc', '90071992547409.92'])
    expect(validateScheduleForm({ ...initial(), amount }).errors.amount).toBeTruthy();
});
it('validates compatible categories, supported frequencies, text limits and end boundaries', () => {
  for (const frequency of ['daily', 'weekly', 'monthly', 'yearly'])
    expect(validateScheduleForm({ ...initial(), frequency }).data.frequency).toBe(frequency);
  expect(validateScheduleForm({ ...initial(), type: 'income' }).errors.category).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), type: 'income', category: 'salary' }).data.type).toBe(
    'income',
  );
  expect(validateScheduleForm({ ...initial(), category: '$ne' }).errors.category).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), frequency: 'hourly' }).errors.frequency).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), title: ' '.repeat(10) }).errors.title).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), notes: 'a'.repeat(2001) }).errors.notes).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), end: '2026-01-30T00:00' }).errors.end).toBeTruthy();
  expect(validateScheduleForm({ ...initial(), end: initial().start }).data.endDate).toBe(
    scheduleRecord.startDate,
  );
});
it('clears optional fields only on edits and excludes protected fields and status', () => {
  const create = validateScheduleForm(initial()).data,
    patch = validateScheduleForm(initial(), scheduleRecord).data;
  expect(create).not.toHaveProperty('endDate');
  expect(create).not.toHaveProperty('notes');
  expect(patch.endDate).toBeNull();
  expect(patch.notes).toBeNull();
  expect(create).not.toHaveProperty('owner');
  expect(create).not.toHaveProperty('status');
  expect(
    initialScheduleValues({ ...scheduleRecord, amountMinor: Number.MAX_SAFE_INTEGER }).amount,
  ).toBe('90071992547409.91');
});
it('uses safe error descriptions for session loss, busy work, rate limits and internal failures', () => {
  expect(recurringError({ response: { status: 409, data: { code: 'RECURRING_BUSY' } } })).toContain(
    'occurrence is being completed',
  );
  for (const status of [409, 412, 428])
    expect(recurringError({ response: { status } })).toContain('fresh version');
  expect(recurringError({ response: { status: 429 } })).toContain('wait');
  expect(recurringError({ response: { status: 401 } })).toContain('session has ended');
  expect(recurringError(new Error('secret stack'))).not.toContain('secret');
});
