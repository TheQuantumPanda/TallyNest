import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RecurringSchedule } from '../src/models/recurring.model.js';
import { recurringInputSchema } from '../src/validators/recurring.validator.js';
import { occurrenceDate, cursorAfter } from '../src/utils/recurrence.js';
import { createRecurringService } from '../src/services/recurring.service.js';
import { createRecurringEngine } from '../src/services/recurring-engine.service.js';
import { startRecurringJob } from '../src/jobs/recurring.job.js';
import { isolatedRecurring } from './helpers/recurring-repository.js';
import { recurringApiSetup, recurringApiContract, schedule } from './helpers/recurring-api.js';
import { ownerA } from './helpers/transaction-api.js';

recurringApiContract(async (t) => {
  const store = isolatedRecurring();
  return recurringApiSetup(t, store);
});
for (const [start, frequency, expected] of [
  ['2023-01-29T09:30:00.123Z', 'monthly', ['2023-02-28', '2023-03-29']],
  ['2023-01-30T09:30:00.123Z', 'monthly', ['2023-02-28', '2023-03-30']],
  ['2024-01-31T09:30:00.123Z', 'monthly', ['2024-02-29', '2024-03-31']],
  ['2024-02-29T09:30:00.123Z', 'yearly', ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']],
  ['2024-12-31T09:30:00.123Z', 'daily', ['2025-01-01', '2025-01-02']],
  ['2024-12-31T09:30:00.123Z', 'weekly', ['2025-01-07', '2025-01-14']],
])
  test(`${frequency} UTC anchor ${start} preserves calendar intent without drift`, () => {
    let last = new Date(start);
    expected.forEach((date, index) => {
      const next = occurrenceDate(start, frequency, index + 1);
      assert.equal(next.toISOString(), `${date}T09:30:00.123Z`);
      assert.ok(next > last);
      last = next;
    });
  });
test('calendar limits, invalid dates/frequencies and inclusive end dates are deterministic', () => {
  assert.throws(() => occurrenceDate('2024-02-30T00:00:00.000Z', 'monthly', 1));
  assert.throws(() => occurrenceDate(schedule.startDate, 'hourly', 1));
  assert.throws(() => occurrenceDate(schedule.startDate, 'daily', 1.5));
  assert.equal(occurrenceDate('9999-12-31T00:00:00.000Z', 'daily', 1), null);
  assert.equal(
    occurrenceDate('0001-01-31T00:00:00.000Z', 'monthly', 1).toISOString(),
    '0001-02-28T00:00:00.000Z',
  );
  const data = { ...schedule, endDate: '2024-02-29T09:30:00.000Z' };
  assert.equal(
    cursorAfter(data, new Date(schedule.startDate)).nextOccurrenceDate.toISOString(),
    data.endDate,
  );
  assert.equal(cursorAfter(data, new Date(data.endDate)).nextOccurrenceDate, null);
});
test('schedule model enforces ownership, currency/category, exact amounts and cursor invariants', async () => {
  for (const changes of [
    { owner: undefined },
    { owner: 'bad' },
    { amountMinor: NaN },
    { amountMinor: Infinity },
    { amountMinor: '100' },
    { amountMinor: 0 },
    { amountMinor: -1 },
    { amountMinor: 1.5 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { category: 'salary' },
    { currency: 'USD' },
  ]) {
    const data = { ...schedule, owner: ownerA, ...cursorAfter(schedule), ...changes };
    await assert.rejects(new RecurringSchedule(data).validate());
  }
  assert.equal(recurringInputSchema.safeParse({ ...schedule, owner: ownerA }).success, false);
  await new RecurringSchedule({
    ...schedule,
    owner: ownerA,
    amountMinor: Number.MAX_SAFE_INTEGER,
    ...cursorAfter(schedule),
  }).validate();
  await assert.rejects(
    new RecurringSchedule({
      ...schedule,
      owner: ownerA,
      nextOccurrenceDate: '2024-02-01T00:00:00.000Z',
    }).validate(),
  );
});
test('bounded catch-up, no early generation, pause/resume and end exhaustion work without a timer', async () => {
  const store = isolatedRecurring(),
    service = createRecurringService(store);
  const { schedule: created } = await service.create(
    ownerA,
    { ...schedule, endDate: '2024-03-31T09:30:00.000Z' },
    randomUUID(),
  );
  let now = new Date('2024-01-31T09:29:59.999Z');
  const engine = createRecurringEngine({ ...store, now: () => now });
  assert.equal((await engine.processDueSchedules()).generated, 0);
  now = new Date('2024-03-31T09:30:00.000Z');
  assert.equal((await engine.processDueSchedules({ limit: 2 })).generated, 2);
  let row = await service.get(ownerA, created.id);
  await service.update(ownerA, row.id, { status: 'paused' }, `"tn-${row.id}-v${row.version}"`);
  assert.equal((await engine.processDueSchedules()).generated, 0);
  row = await service.get(ownerA, created.id);
  await service.update(ownerA, row.id, { status: 'active' }, `"tn-${row.id}-v${row.version}"`);
  assert.equal((await engine.processDueSchedules()).generated, 1);
  assert.equal((await service.get(ownerA, row.id)).exhausted, true);
  assert.equal((await engine.processDueSchedules()).generated, 0);
  assert.equal(store.ledger.size, 3);
});
for (const stage of ['before_insert', 'after_insert', 'before_advance', 'after_advance'])
  test(`durable pending state recovers safely after ${stage}`, async () => {
    const store = isolatedRecurring();
    await store.repository.createForOwner(ownerA, schedule);
    const repository = { ...store.repository },
      transactions = { ...store.transactions };
    if (stage.includes('insert'))
      transactions.createGeneratedForOwner = async (...args) => {
        if (stage === 'after_insert') await store.transactions.createGeneratedForOwner(...args);
        throw new Error('sensitive simulated failure');
      };
    else
      repository.advance = async (...args) => {
        if (stage === 'after_advance') await store.repository.advance(...args);
        throw new Error('sensitive simulated failure');
      };
    const now = () => new Date(schedule.startDate);
    const failed = await createRecurringEngine({
      repository,
      transactions,
      now,
    }).processDueSchedules();
    assert.equal(failed.errors, 1);
    assert.equal(JSON.stringify(failed).includes('sensitive'), false);
    await createRecurringEngine({ ...store, now }).processDueSchedules();
    assert.equal(store.ledger.size, 1);
    assert.equal([...store.schedules.values()][0].pending, undefined);
  });
test('concurrent workers and retries insert once; a deleted receipt cannot be resurrected', async () => {
  const store = isolatedRecurring();
  await store.repository.createForOwner(ownerA, schedule);
  const engine = createRecurringEngine({ ...store, now: () => new Date(schedule.startDate) });
  await Promise.all(Array.from({ length: 4 }, () => engine.processDueSchedules()));
  assert.equal(store.ledger.size, 1);
  const row = [...store.ledger.values()][0];
  row.deletedAt = new Date();
  assert.equal((await engine.processDueSchedules()).generated, 0);
  assert.equal(row.deletedAt instanceof Date, true);
});
test('edit/start/frequency changes rebase strictly after completed watermark and preserve history', async () => {
  const store = isolatedRecurring(),
    service = createRecurringService(store);
  const { schedule: row } = await service.create(ownerA, schedule, randomUUID());
  await createRecurringEngine({
    ...store,
    now: () => new Date('2024-02-29T09:30:00.000Z'),
  }).processDueSchedules();
  const current = await service.get(ownerA, row.id);
  const changed = await service.update(
    ownerA,
    row.id,
    { startDate: '2023-01-01T00:00:00.000Z', frequency: 'weekly', amountMinor: 777 },
    `"tn-${row.id}-v${current.version}"`,
  );
  assert.ok(new Date(changed.nextOccurrenceDate) > new Date('2024-02-29T09:30:00.000Z'));
  assert.ok([...store.ledger.values()].every((record) => record.amountMinor === 10050));
});
test('processing reservation blocks edit, pause and delete until recovered', async () => {
  const store = isolatedRecurring(),
    service = createRecurringService(store);
  const document = await store.repository.createForOwner(ownerA, schedule);
  const claimed = await store.repository.reserve(document, document._id);
  for (const patch of [{ title: 'Edited' }, { status: 'paused' }])
    await assert.rejects(
      () =>
        service.update(ownerA, String(claimed._id), patch, `"tn-${claimed._id}-v${claimed.__v}"`),
      (error) => error.code === 'RECURRING_BUSY',
    );
  await assert.rejects(
    () => service.remove(ownerA, String(claimed._id)),
    (error) => error.code === 'RECURRING_BUSY',
  );
});
test('batch time budget and invalid persisted data are bounded and sanitized', async () => {
  const store = isolatedRecurring();
  await store.repository.createForOwner(ownerA, schedule);
  let ticks = 0;
  const result = await createRecurringEngine({
    ...store,
    now: () => new Date('2025-01-01T00:00:00.000Z'),
    clock: () => ++ticks * 3000,
  }).processDueSchedules({ limit: 100 });
  assert.ok(result.attempted <= 1);
  assert.equal(result.hasMoreDue, true);
  const row = [...store.schedules.values()][0];
  store.schedules.set(
    String(row._id),
    RecurringSchedule.hydrate({ ...row.toObject(), amountMinor: 0 }),
  );
  const invalid = await createRecurringEngine({
    ...store,
    now: () => new Date('2025-01-01T00:00:00.000Z'),
  }).processDueSchedules();
  assert.equal(invalid.errors, 1);
  assert.equal(invalid.attempted, 1);
});

test('startup job starts immediately, waits for in-flight work on stop and does not restart after shutdown', async () => {
  let release,
    calls = 0;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const stop = startRecurringJob({
    process: async () => {
      calls++;
      await ready;
      return { errors: 0 };
    },
    report: () => {},
  });
  assert.equal(calls, 1);
  const stopped = stop();
  release();
  await stopped;
  assert.equal(calls, 1);
});
test('Gregorian century leap rules retain original February 29 across non-leap centuries', () => {
  assert.equal(
    occurrenceDate('2096-02-29T12:00:00.000Z', 'yearly', 4).toISOString(),
    '2100-02-28T12:00:00.000Z',
  );
  assert.equal(
    occurrenceDate('2096-02-29T12:00:00.000Z', 'yearly', 304).toISOString(),
    '2400-02-29T12:00:00.000Z',
  );
});
test('recurring HTTP errors and engine failures reveal no sensitive internal details; processing rate is bounded', async (t) => {
  const store = isolatedRecurring();
  const request = await recurringApiSetup(t, {
    ...store,
    repository: {
      ...store.repository,
      async findByIdForOwner() {
        throw new Error('sensitive secret');
      },
    },
  });
  assert.deepEqual((await request('/' + ownerA)).body, {
    status: 'error',
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
  for (let index = 0; index < 10; index++)
    assert.equal((await request('/process', { method: 'POST', body: {} })).status, 200);
  assert.equal((await request('/process', { method: 'POST', body: {} })).status, 429);
});
