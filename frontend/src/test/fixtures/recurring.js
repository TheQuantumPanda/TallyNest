export const scheduleRecord = {
  id: '507f1f77bcf86cd799439021',
  version: 0,
  type: 'expense',
  title: 'Monthly workspace',
  amountMinor: 125050,
  currency: 'INR',
  category: 'subscriptions',
  frequency: 'monthly',
  startDate: '2026-01-31T09:30:15.123Z',
  nextOccurrenceDate: '2026-10-31T09:30:15.123Z',
  status: 'active',
  exhausted: false,
  processing: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  etag: '"tn-507f1f77bcf86cd799439021-v0"',
};
export const schedulePage = (rows = [scheduleRecord], nextAfter = null) => ({
  schedules: rows,
  pagination: { limit: 20, hasMore: nextAfter !== null, nextAfter },
});
export const processingResult = {
  attempted: 2,
  generated: 1,
  recovered: 1,
  advanced: 2,
  conflicts: 0,
  errors: 0,
  hasMoreDue: false,
};
