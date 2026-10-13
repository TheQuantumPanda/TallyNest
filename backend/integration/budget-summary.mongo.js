import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Budget } from '../src/models/budget.model.js';
import { Transaction } from '../src/models/transaction.model.js';
import { User } from '../src/models/user.model.js';
import { createBudgetSummaryService } from '../src/services/budget-summary.service.js';
import { createBudgetSummaryRepository } from '../src/repositories/budget-summary.repository.js';
import { createApp } from '../app.js';
import { hashPassword } from '../src/services/password.service.js';
import { ownerA, ownerB, secret } from '../tests/helpers/transaction-api.js';

const database = `tallynest_budget_summary_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const service = createBudgetSummaryService();
const owner = new mongoose.Types.ObjectId(ownerA);
const month = '2024-02';
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, database);
  await Promise.all([Budget.init(), Transaction.init(), User.init()]);
  passwordHash = await hashPassword('disposable budget summary integration password');
  console.log(`Disposable database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([Budget.deleteMany({}), Transaction.deleteMany({}), User.deleteMany({})]);
  await User.create([{ _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash },
    { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash }]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const remaining = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(remaining.databases.some(item => item.name === database), false);
    await mongoose.disconnect(); console.log(`Dropped disposable database: ${database}`);
  }
});
const budget = (category = 'food_dining', amountMinor = 100, changes = {}) => Budget.create({ owner: ownerA, category, amountMinor, currency: 'INR', month, ...changes });
const expense = (amountMinor, category = 'food_dining', changes = {}) => Transaction.create({
  owner: ownerA, type: 'expense', title: 'Summary fixture', category, currency: 'INR', amountMinor,
  transactionDate: '2024-02-01T00:00:00.000Z', ...changes,
});
const summarize = () => service.summary(ownerA, { month });

test('real empty month and configured zero-spending budget return genuine zeros', async () => {
  assert.equal((await summarize()).totals.expenseMinor, 0);
  await budget();
  const result = await summarize();
  assert.equal(result.budgets[0].status, 'unused'); assert.equal(result.budgets[0].utilizationBasisPoints, 0);
  assert.equal(result.budgets[0].remainingMinor, 100);
});
test('real within, equal, over and unbudgeted category totals reconcile exactly', async () => {
  await Promise.all([budget(), budget('shopping'), budget('other')]);
  await Promise.all([expense(25), expense(100, 'shopping'), expense(150, 'other'), expense(50, 'travel')]);
  const result = await summarize();
  assert.deepEqual(result.budgets.map(row => row.status), ['within_budget', 'over_budget', 'at_limit']);
  assert.deepEqual(result.totals, { budgetLimitMinor: 300, budgetedSpendingMinor: 275, unbudgetedSpendingMinor: 50,
    expenseMinor: 325, remainingMinor: 25, overspentMinor: 50 });
  assert.equal(result.budgets.find(row => row.category === 'other').utilizationBasisPoints, 15000);
  assert.deepEqual(result.unbudgetedCategories, [{ category: 'travel', spentMinor: 50 }]);
  assert.equal(result.counts.expenseTransactionCount, 4);
});
test('real UTC leap-month boundaries exclude income, other owners, months and currencies', async () => {
  await budget(); await budget('other', 999, { owner: ownerB }); await budget('shopping', 999, { month: '2024-03' });
  await expense(7); await expense(11, 'food_dining', { transactionDate: '2024-02-29T23:59:59.999Z' });
  await expense(100, 'food_dining', { transactionDate: '2024-01-31T23:59:59.999Z' });
  await expense(100, 'food_dining', { transactionDate: '2024-03-01T00:00:00.000Z' });
  await expense(100, 'salary', { type: 'income' }); await expense(100, 'other', { owner: ownerB });
  await Transaction.collection.insertOne({ owner, type: 'expense', category: 'food_dining', currency: 'USD', amountMinor: 100, transactionDate: new Date('2024-02-01T00:00:00.000Z') });
  await Budget.collection.insertOne({ owner, category: 'travel', currency: 'USD', amountMinor: 999, month, __v: 0 });
  const result = await summarize();
  assert.equal(result.totals.expenseMinor, 18); assert.equal(result.counts.expenseTransactionCount, 2);
  assert.equal(result.budgets.length, 1); assert.equal(result.budgets[0].spentMinor, 18);
  assert.equal((await service.summary(ownerB, { month })).totals.expenseMinor, 100);
});
test('real maximum safe integer stays exact; expense, budget and ratio overflow are rejected', async () => {
  await budget('food_dining', Number.MAX_SAFE_INTEGER); await expense(Number.MAX_SAFE_INTEGER);
  assert.equal((await summarize()).totals.expenseMinor, Number.MAX_SAFE_INTEGER);
  assert.equal((await summarize()).budgets[0].utilizationBasisPoints, 10000);
  await expense(1, 'other');
  await assert.rejects(summarize, error => error.code === 'SUMMARY_OVERFLOW');
  await Transaction.deleteMany({}); await budget('other', 1);
  await assert.rejects(summarize, error => error.code === 'SUMMARY_OVERFLOW');
  await Budget.deleteMany({}); await budget('food_dining', 1); await expense(Number.MAX_SAFE_INTEGER);
  await assert.rejects(summarize, error => error.code === 'SUMMARY_OVERFLOW');
});
test('raw malformed monetary and category records fail closed instead of rounding or disappearing', async () => {
  for (const amountMinor of [0, -1, 1.5, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    mongoose.Types.Decimal128.fromString('1.0000000000000001')]) {
    await Transaction.deleteMany({});
    await Transaction.collection.insertOne({ owner, type: 'expense', category: 'food_dining', currency: 'INR', amountMinor, transactionDate: new Date('2024-02-01T00:00:00.000Z') });
    await assert.rejects(summarize, error => error.code === 'SUMMARY_DATA_INVALID', String(amountMinor));
  }
  await Transaction.deleteMany({});
  await Transaction.collection.insertOne({ owner, type: 'expense', category: 'salary', currency: 'INR', amountMinor: 100, transactionDate: new Date('2024-02-01T00:00:00.000Z') });
  await assert.rejects(summarize, error => error.code === 'SUMMARY_DATA_INVALID');
});
test('raw array owner/date references and invalid stored budget limits are rejected', async () => {
  for (const changes of [{ owner: [owner, new mongoose.Types.ObjectId(ownerB)] }, { transactionDate: [new Date('2024-02-01T00:00:00.000Z')] }]) {
    await Transaction.deleteMany({});
    await Transaction.collection.insertOne({ owner, type: 'expense', category: 'other', currency: 'INR', amountMinor: 1,
      transactionDate: new Date('2024-02-01T00:00:00.000Z'), ...changes });
    await assert.rejects(summarize, error => error.code === 'SUMMARY_DATA_INVALID');
  }
  await Transaction.deleteMany({});
  await Budget.collection.insertOne({ owner, month, currency: 'INR', category: 'other', amountMinor: '100', __v: 0 });
  await assert.rejects(summarize, error => error.code === 'SUMMARY_DATA_INVALID');
});
test('best-effort two-read view can use an old budget and newer expenses without losing reconciliation', async () => {
  const record = await budget();
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const repository = createBudgetSummaryRepository({
    budgetModel: { find(filter) {
      const query = Budget.find(filter); const exec = query.exec.bind(query);
      query.exec = async () => {
        const rows = await exec();
        await Budget.findOneAndUpdate({ owner, _id: record._id, __v: 0 }, { $set: { amountMinor: 200 }, $inc: { __v: 1 } });
        await expense(150); release(); return rows;
      }; return query;
    } },
    transactionModel: { aggregate(pipeline) {
      const query = Transaction.aggregate(pipeline); const exec = query.exec.bind(query);
      query.exec = async () => { await ready; return exec(); }; return query;
    } },
  });
  const mixed = await createBudgetSummaryService({ repository }).summary(ownerA, { month });
  assert.equal(mixed.budgets[0].status, 'over_budget'); assert.equal(mixed.budgets[0].limitMinor, 100);
  assert.equal(mixed.totals.expenseMinor, 150); assert.equal(mixed.consistency, 'best_effort');
  const next = await summarize(); assert.equal(next.budgets[0].limitMinor, 200); assert.equal(next.budgets[0].status, 'within_budget');
});
test('real HTTP summary uses authenticated account lookup, static routing and safe validation errors', async t => {
  await budget(); await expense(50);
  const server = createApp({ nodeEnv: 'test', jwtSecret: secret }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const token = jwt.sign({}, secret, { subject: ownerA, algorithm: 'HS256', issuer: 'smart-finance-manager', audience: 'smart-finance-manager-web', expiresIn: 900 });
  const request = async (query, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/budgets/summary${query}`, { headers: authenticated ? { Cookie: `sfm_access=${token}` } : {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  assert.equal((await request('?month=' + month, false)).status, 401);
  assert.equal((await request('?month=2024-13')).status, 400);
  const result = await request('?month=' + month);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.data.summary.budgets[0].spentMinor, 50);
  for (const key of ['owner', '_id', '__v', 'passwordHash', 'token', 'stack']) assert.equal(JSON.stringify(result.body).includes(`"${key}"`), false);
  await User.deleteOne({ _id: owner, email: 'a@example.test' });
  assert.equal((await request('?month=' + month)).status, 401);
});
