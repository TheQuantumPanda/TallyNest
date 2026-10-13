import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { RecurringSchedule } from '../src/models/recurring.model.js';
import { Transaction } from '../src/models/transaction.model.js';
import { User } from '../src/models/user.model.js';
import { Budget } from '../src/models/budget.model.js';
import { createRecurringRepository, ensureRecurringIndexes } from '../src/repositories/recurring.repository.js';
import { createTransactionRepository } from '../src/repositories/transaction.repository.js';
import { createRecurringService } from '../src/services/recurring.service.js';
import { createRecurringEngine } from '../src/services/recurring-engine.service.js';
import { createDashboardService } from '../src/services/dashboard.service.js';
import { createBudgetSummaryService } from '../src/services/budget-summary.service.js';
import { hashPassword } from '../src/services/password.service.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { recurringApiSetup, recurringApiContract, schedule } from '../tests/helpers/recurring-api.js';
import { apiSetup, ownerA, ownerB } from '../tests/helpers/transaction-api.js';

const database = `tallynest_recurring_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const repository = createRecurringRepository(), transactions = createTransactionRepository();
const now = () => new Date('2024-03-31T09:30:00.000Z');
const engine = createRecurringEngine({ repository, transactions, now });
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  await Promise.all([ensureRecurringIndexes(), User.init(), Budget.init()]);
  passwordHash = await hashPassword('disposable recurring integration password');
  console.log(`Disposable database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([RecurringSchedule.deleteMany({}), Transaction.deleteMany({}), User.deleteMany({}), Budget.deleteMany({})]);
  await User.create([{ _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash }, { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash }]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database); await mongoose.connection.dropDatabase();
    const result = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(result.databases.some(row => row.name === database), false);
    await mongoose.disconnect(); console.log(`Dropped disposable database: ${database}`);
  }
});
recurringApiContract(t => recurringApiSetup(t, { repository, transactions, users: userRepository, now }));

test('actual unique occurrence index enforces one record per schedule/date without affecting manual entries', async () => {
  const indexes = await Transaction.collection.indexes();
  assert.ok(indexes.some(index => index.unique && index.key.recurringSchedule === 1 && index.key.scheduledDate === 1 && index.partialFilterExpression));
  const row = await repository.createForOwner(ownerA, schedule);
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 0);
  await engine.processDueSchedules({ owner: ownerA });
  const docs = await transactions.findForOwner(ownerA);
  assert.equal(docs.length, 3); assert.equal(docs[0].amountMinor, 10050);
  assert.deepEqual(docs.map(row => row.transactionDate.toISOString()).reverse(), [schedule.startDate, '2024-02-29T09:30:00.000Z', '2024-03-31T09:30:00.000Z']);
  const duplicate = docs[0].toObject(); delete duplicate._id;
  await assert.rejects(Transaction.create(duplicate), error => error.code === 11000);
  assert.equal((await engine.processDueSchedules({ owner: ownerA })).generated, 0);
  assert.equal((await repository.findByIdForOwner(ownerA, String(row._id))).nextOccurrenceDate.toISOString(), '2024-04-30T09:30:00.000Z');
});
test('four actual workers concurrently catch up with no duplicate dates or lost occurrences', async () => {
  await repository.createForOwner(ownerA, schedule);
  const results = await Promise.all(Array.from({ length: 4 }, () => engine.processDueSchedules({ owner: ownerA })));
  assert.equal(results.reduce((sum, row) => sum + row.generated, 0), 3);
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 3);
  assert.equal((await RecurringSchedule.findOne({ owner: ownerA })).pending, undefined);
});
for (const stage of ['before_insert', 'after_insert', 'before_advance', 'after_advance']) test(`real persistence recovers ${stage} interruption`, async () => {
  const row = await repository.createForOwner(ownerA, { ...schedule, endDate: schedule.startDate });
  const faultRepository = { ...repository }, faultTransactions = { ...transactions };
  if (stage.includes('insert')) faultTransactions.createGeneratedForOwner = async (...args) => {
    if (stage === 'after_insert') await transactions.createGeneratedForOwner(...args);
    throw new Error('secret driver details');
  };
  else faultRepository.advance = async (...args) => { if (stage === 'after_advance') await repository.advance(...args); throw new Error('secret driver details'); };
  const failed = await createRecurringEngine({ repository: faultRepository, transactions: faultTransactions, now }).processDueSchedules();
  assert.equal(failed.errors, 1); assert.equal(JSON.stringify(failed).includes('secret'), false);
  // A fresh engine instance, using only persisted state, models a restarted process.
  await createRecurringEngine({ now }).processDueSchedules();
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 1);
  const recovered = await repository.findByIdForOwner(ownerA, String(row._id));
  assert.equal(recovered.pending, undefined); assert.equal(recovered.nextOccurrenceDate, null);
});
test('deleting an inserted occurrence before advancement leaves a durable hidden receipt and never resurrects', async () => {
  await repository.createForOwner(ownerA, { ...schedule, endDate: schedule.startDate });
  const broken = createRecurringEngine({ repository: { ...repository, async advance() { throw new Error('interrupted'); } }, transactions, now });
  await broken.processDueSchedules();
  const generated = (await transactions.findForOwner(ownerA))[0];
  await transactions.deleteForOwner(ownerA, String(generated._id));
  assert.equal((await transactions.findForOwner(ownerA)).length, 0);
  assert.equal(await transactions.findByIdForOwner(ownerA, String(generated._id)), null);
  const input = { type: schedule.type, title: schedule.title, amountMinor: schedule.amountMinor, currency: schedule.currency, category: schedule.category, transactionDate: schedule.startDate };
  assert.equal(await transactions.replaceForOwner(ownerA, String(generated._id), generated.__v, input), null);
  const retried = await engine.processDueSchedules(); assert.equal(retried.generated, 0); assert.equal(retried.recovered, 1);
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 1);
  assert.ok((await Transaction.findOne({ owner: ownerA })).deletedAt);
  assert.equal((await transactions.findForOwner(ownerA)).length, 0);
});
test('generation reservation atomically blocks owned edits, pause and deletion and invalidates stale ETags', async () => {
  const document = await repository.createForOwner(ownerA, { ...schedule, endDate: schedule.startDate });
  const service = createRecurringService({ repository });
  const claimed = await repository.reserve(document, new mongoose.Types.ObjectId());
  const id = String(document._id);
  await assert.rejects(() => service.update(ownerA, id, { title: 'Stale' }, `"tn-${id}-v0"`), error => error.status === 412);
  for (const patch of [{ status: 'paused' }, { amountMinor: 777 }]) await assert.rejects(
    () => service.update(ownerA, id, patch, `"tn-${id}-v${claimed.__v}"`), error => error.code === 'RECURRING_BUSY');
  await assert.rejects(() => service.remove(ownerA, id), error => error.code === 'RECURRING_BUSY');
  await engine.processDueSchedules();
  const completed = await service.get(ownerA, id);
  await service.update(ownerA, id, { amountMinor: 777, endDate: null, frequency: 'weekly' }, `"tn-${id}-v${completed.version}"`);
  assert.equal((await Transaction.findOne({ owner: ownerA })).amountMinor, 10050);
});
test('manual edits keep immutable provenance; deleting a schedule retains owned transaction history', async () => {
  const service = createRecurringService({ repository });
  const row = await service.create(ownerA, { ...schedule, endDate: schedule.startDate });
  await engine.processDueSchedules();
  const generated = (await transactions.findForOwner(ownerA))[0];
  await transactions.replaceForOwner(ownerA, String(generated._id), generated.__v, { type: 'income', title: 'Historical correction', amountMinor: 777,
    currency: 'INR', category: 'other', transactionDate: '2024-02-01T00:00:00.000Z' });
  await service.remove(ownerA, row.id);
  const history = await transactions.findByIdForOwner(ownerA, String(generated._id));
  assert.equal(history.amountMinor, 777); assert.equal(String(history.recurringSchedule), row.id);
  assert.equal(history.scheduledDate.toISOString(), schedule.startDate);
  assert.equal(await transactions.findByIdForOwner(ownerB, String(generated._id)), null);
});
test('generated expenses count in dashboard and budgets, while schedules and tombstones do not', async () => {
  const row = await repository.createForOwner(ownerA, { ...schedule, startDate: '2024-02-01T00:00:00.000Z', endDate: '2024-02-01T00:00:00.000Z' });
  await Budget.create({ owner: ownerA, month: '2024-02', category: 'food_dining', amountMinor: 20000, currency: 'INR' });
  const dashboard = createDashboardService({ now: () => new Date('2024-02-15T00:00:00.000Z') });
  const budgets = createBudgetSummaryService();
  assert.equal((await dashboard.summary(ownerA, {})).totals.expenseMinor, 0);
  await engine.processDueSchedules();
  assert.equal((await dashboard.summary(ownerA, {})).totals.expenseMinor, 10050);
  assert.equal((await budgets.summary(ownerA, { month: '2024-02' })).budgets[0].spentMinor, 10050);
  const record = (await transactions.findForOwner(ownerA))[0];
  await transactions.deleteForOwner(ownerA, String(record._id));
  assert.equal((await dashboard.summary(ownerA, {})).totals.expenseMinor, 0);
  assert.equal((await budgets.summary(ownerA, { month: '2024-02' })).budgets[0].spentMinor, 0);
  assert.equal((await repository.findByIdForOwner(ownerA, String(row._id))).nextOccurrenceDate, null);
});
test('real daily/weekly/yearly schedules, bounded downtime recovery and exact maximum money', async () => {
  await repository.createForOwner(ownerA, { ...schedule, frequency: 'daily', amountMinor: Number.MAX_SAFE_INTEGER, endDate: schedule.startDate });
  await engine.processDueSchedules({ limit: 1 });
  assert.equal((await Transaction.findOne({ owner: ownerA })).amountMinor, Number.MAX_SAFE_INTEGER);
  for (const frequency of ['weekly', 'yearly']) {
    await repository.createForOwner(ownerA, { ...schedule, frequency, startDate: '2023-02-28T00:00:00.000Z' });
  }
  const result = await engine.processDueSchedules({ limit: 3 });
  assert.equal(result.attempted, 3); assert.equal(result.hasMoreDue, true);
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 4);
});

test('generated HTTP transaction provenance is public/read-only and soft deletion is indistinguishable from missing history', async t => {
  await repository.createForOwner(ownerA, { ...schedule, endDate: schedule.startDate });
  await engine.processDueSchedules();
  const record = (await transactions.findForOwner(ownerA))[0];
  const request = await apiSetup(t, transactions, userRepository);
  const read = await request('/' + record._id);
  assert.deepEqual(read.body.data.transaction.recurrence, { scheduleId: String(record.recurringSchedule), scheduledDate: schedule.startDate });
  for (const body of [{ recurringSchedule: ownerB }, { scheduledDate: schedule.startDate }, { deletedAt: schedule.startDate }, { recurrence: {} }]) {
    assert.equal((await request('/' + record._id, { method: 'PATCH', body, headers: { 'If-Match': read.headers.get('etag') } })).status, 400);
  }
  assert.equal((await request('/' + record._id, { method: 'DELETE', user: ownerB })).status, 404);
  assert.equal((await request('/' + record._id, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/' + record._id)).status, 404);
  assert.equal((await request('/' + record._id, { method: 'DELETE' })).status, 404);
  assert.deepEqual((await request()).body.data.transactions, []);
});
