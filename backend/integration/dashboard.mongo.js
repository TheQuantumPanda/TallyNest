import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Transaction } from '../src/models/transaction.model.js';
import { createDashboardService } from '../src/services/dashboard.service.js';

const database = `tallynest_dashboard_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const owner = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const other = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
const service = createDashboardService({ now: () => new Date('2024-03-15T12:00:00.000Z') });
before(async () => { await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`); await Transaction.init(); console.log(`Disposable database: ${database}`); });
beforeEach(async () => { assert.equal(mongoose.connection.name, database); await Transaction.deleteMany({}); });
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database); await mongoose.connection.dropDatabase();
    const result = await mongoose.connection.db.admin().listDatabases({ nameOnly: true }); assert.ok(!result.databases.some(item => item.name === database));
    await mongoose.disconnect(); console.log(`Dropped disposable database: ${database}`);
  }
});
const create = (amountMinor, type = 'expense', category = 'other', date = '2024-03-01T00:00:00.000Z', user = owner) => Transaction.create({ owner: user, title: 'Integration fixture', type, category, amountMinor, currency: 'INR', transactionDate: date });
test('real empty aggregation returns zeros', async () => { assert.equal((await service.summary(String(owner), {})).totals.transactionCount, 0); });
test('real aggregates reconcile income, expenses, net, categories and weekly/monthly series', async () => {
  await create(20000, 'income', 'salary'); await create(3000, 'expense', 'food_dining'); await create(1000);
  const summary = await service.summary(String(owner), {});
  assert.deepEqual(summary.totals, { incomeMinor: 20000, expenseMinor: 4000, netMinor: 16000, transactionCount: 3 });
  assert.deepEqual(summary.spending.map(row => row.shareBasisPoints), [7500, 2500]);
  assert.equal(summary.recentTransactions.length, 3);
  for (const period of ['last_3_months', 'this_year']) assert.equal((await service.summary(String(owner), { period })).totals.netMinor, 16000);
});
test('UTC half-open dates exclude the next month and another owner', async () => {
  await create(5, 'income', 'other', '2024-02-29T23:59:59.999Z');
  await create(7); await create(11, 'expense', 'other', '2024-03-31T23:59:59.999Z');
  await create(13, 'expense', 'other', '2024-04-01T00:00:00.000Z'); await create(999, 'income', 'other', undefined, other);
  assert.equal((await service.summary(String(owner), {})).totals.expenseMinor, 18);
  assert.equal((await service.summary(String(owner), { period: 'last_month' })).totals.incomeMinor, 5);
  assert.equal((await service.summary(String(other), {})).totals.incomeMinor, 999);
});
test('MongoDB preserves MAX_SAFE_INTEGER and rejects overflowing sums explicitly', async () => {
  await create(Number.MAX_SAFE_INTEGER, 'income');
  assert.equal((await service.summary(String(owner), {})).totals.incomeMinor, Number.MAX_SAFE_INTEGER);
  await create(1, 'income');
  await assert.rejects(() => service.summary(String(owner), {}), error => error.code === 'SUMMARY_OVERFLOW');
});
test('raw invalid precision and mixed currencies cannot be silently summarized', async () => {
  await Transaction.collection.insertOne({ owner, type: 'expense', title: 'Invalid fixture', amountMinor: 1.5, currency: 'INR', category: 'other', transactionDate: new Date('2024-03-01T00:00:00.000Z') });
  await assert.rejects(() => service.summary(String(owner), {}), error => error.code === 'SUMMARY_DATA_INVALID');
  await Transaction.deleteMany({});
  await create(100);
  await Transaction.collection.insertOne({ owner, type: 'expense', title: 'Foreign currency fixture', amountMinor: 1, currency: 'USD', category: 'other', transactionDate: new Date('2024-03-01T00:00:00.000Z') });
  await assert.rejects(() => service.summary(String(owner), {}), error => error.code === 'SUMMARY_DATA_INVALID');
});
