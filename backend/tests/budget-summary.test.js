import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createBudgetSummaryService } from '../src/services/budget-summary.service.js';
import {
  createBudgetSummaryRepository,
  budgetMonthRange,
} from '../src/repositories/budget-summary.repository.js';
import { createApp } from '../app.js';
import { ratioBasisPoints } from '../../shared/dashboard.js';
import { ownerA, ownerB, secret } from './helpers/transaction-api.js';

const month = '2026-10';
const budget = (category = 'food_dining', amountMinor = 100) => ({
  _id: category === 'food_dining' ? ownerA : ownerB,
  owner: ownerA,
  __v: 0,
  category,
  amountMinor,
  month,
  currency: 'INR',
});
const expenses = (rows = []) => ({
  integrity: rows.length ? [{ invalid: 0 }] : [],
  categories: rows.map(([category, amount, count = 1]) => ({
    _id: category,
    amount: String(amount),
    count,
  })),
  totals: rows.length
    ? [
        {
          _id: null,
          amount: String(rows.reduce((sum, row) => sum + BigInt(row[1]), 0n)),
          count: rows.reduce((sum, row) => sum + (row[2] ?? 1), 0),
        },
      ]
    : [],
});
const summary = (budgets = [], spending = expenses()) =>
  createBudgetSummaryService({
    repository: { summarize: async () => ({ budgets, expenses: spending }) },
  }).summary(ownerA, { month });

test('empty budget month has genuine zero totals and status counts', async () => {
  const result = await summary();
  assert.deepEqual(result.budgets, []);
  assert.deepEqual(result.unbudgetedCategories, []);
  assert.deepEqual(result.totals, {
    budgetLimitMinor: 0,
    budgetedSpendingMinor: 0,
    unbudgetedSpendingMinor: 0,
    expenseMinor: 0,
    remainingMinor: 0,
    overspentMinor: 0,
  });
  assert.deepEqual(result.counts, {
    budgetCount: 0,
    unbudgetedCategoryCount: 0,
    expenseTransactionCount: 0,
    statuses: { unused: 0, within_budget: 0, at_limit: 0, over_budget: 0 },
  });
});
for (const [spent, status, remaining, overspent, points] of [
  [0, 'unused', 100, 0, 0],
  [25, 'within_budget', 75, 0, 2500],
  [100, 'at_limit', 0, 0, 10000],
  [150, 'over_budget', -50, 50, 15000],
]) {
  test(`budget spending ${spent} has exact ${status} semantics and uncapped utilization`, async () => {
    const row = (await summary([budget()], expenses(spent ? [['food_dining', spent]] : [])))
      .budgets[0];
    assert.equal(row.status, status);
    assert.equal(row.remainingMinor, remaining);
    assert.equal(row.overspentMinor, overspent);
    assert.equal(row.utilizationBasisPoints, points);
  });
}
test('multiple budgets and unbudgeted spending reconcile; surplus does not hide category overspending', async () => {
  const result = await summary(
    [budget(), budget('other', 200)],
    expenses([
      ['food_dining', 150, 2],
      ['shopping', 30],
      ['other', 50],
    ]),
  );
  assert.deepEqual(result.totals, {
    budgetLimitMinor: 300,
    budgetedSpendingMinor: 200,
    unbudgetedSpendingMinor: 30,
    expenseMinor: 230,
    remainingMinor: 100,
    overspentMinor: 50,
  });
  assert.deepEqual(result.unbudgetedCategories, [{ category: 'shopping', spentMinor: 30 }]);
  assert.equal(result.counts.expenseTransactionCount, 4);
  assert.equal(result.counts.statuses.over_budget, 1);
  assert.equal(result.counts.statuses.within_budget, 1);
});
test('with no budgets every expense remains visible as unbudgeted', async () => {
  const result = await summary([], expenses([['other', 99]]));
  assert.equal(result.totals.unbudgetedSpendingMinor, 99);
  assert.equal(result.totals.expenseMinor, 99);
  assert.equal(result.totals.remainingMinor, 0);
});
test('maximum-safe limits and spending preserve exact digits', async () => {
  const result = await summary(
    [budget('food_dining', Number.MAX_SAFE_INTEGER)],
    expenses([['food_dining', Number.MAX_SAFE_INTEGER]]),
  );
  assert.equal(result.totals.expenseMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(result.totals.budgetLimitMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(result.budgets[0].utilizationBasisPoints, 10000);
});
test('unsafe limits, expense sums and utilization ratios fail explicitly', async () => {
  for (const operation of [
    () => summary([budget('food_dining', Number.MAX_SAFE_INTEGER), budget('other', 1)]),
    () =>
      summary(
        [],
        expenses([
          ['food_dining', Number.MAX_SAFE_INTEGER],
          ['other', 1],
        ]),
      ),
    () => summary([budget('food_dining', 1)], expenses([['food_dining', Number.MAX_SAFE_INTEGER]])),
  ])
    await assert.rejects(
      operation,
      (error) => error.status === 422 && error.code === 'SUMMARY_OVERFLOW',
    );
});
test('invalid stored budget/transaction records and duplicate categories are rejected', async () => {
  for (const changes of [
    { amountMinor: 0 },
    { amountMinor: '100' },
    { currency: 'USD' },
    { month: '2026-09' },
    { owner: ownerB },
    { category: 'salary' },
    { __v: -1 },
  ]) {
    await assert.rejects(
      () => summary([{ ...budget(), ...changes }]),
      (error) => error.code === 'SUMMARY_DATA_INVALID',
    );
  }
  await assert.rejects(
    () => summary([budget(), budget()]),
    (error) => error.code === 'SUMMARY_DATA_INVALID',
  );
  for (const changes of [
    (raw) => {
      raw.integrity[0].invalid = 1;
    },
    (raw) => {
      raw.categories[0]._id = 'salary';
    },
    (raw) => {
      raw.categories[0].amount = '1.5';
    },
    (raw) => {
      raw.categories.push(raw.categories[0]);
    },
  ]) {
    const raw = expenses([['other', 5]]);
    changes(raw);
    await assert.rejects(
      () => summary([], raw),
      (error) => error.status === 422,
    );
  }
});
test('mismatched category sums and counts never produce partial summaries', async () => {
  for (const key of ['amount', 'count']) {
    const raw = expenses([['other', 5]]);
    raw.totals[0][key] = key === 'amount' ? '6' : 2;
    await assert.rejects(
      () => summary([], raw),
      (error) => error.code === 'SUMMARY_INCONSISTENT',
    );
  }
});
test('UTC month boundaries handle leap months, years 1–99 and year rollover', () => {
  for (const [month, from, to] of [
    ['2024-02', '2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
    ['2026-12', '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ['0001-01', '0001-01-01T00:00:00.000Z', '0001-02-01T00:00:00.000Z'],
    ['9999-12', '9999-12-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z'],
  ]) {
    const range = budgetMonthRange(month);
    assert.equal(range.from.toISOString(), from);
    assert.equal(range.to.toISOString(), to);
  }
});
test('utilization rounds half up deterministically, allows >100% and zero spending', () => {
  for (const [spent, limit, points] of [
    [0, 1, 0n],
    [1, 3, 3333n],
    [2, 3, 6667n],
    [4, 3, 13333n],
    [1, 32, 313n],
  ]) {
    assert.equal(ratioBasisPoints(spent, limit), points);
  }
  assert.throws(() => ratioBasisPoints(1, 0));
});
test('summary repository uses two owner-scoped bounded queries and expense-only exact facets', async () => {
  const calls = [];
  const chain = {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit(value) {
      calls.push(['limit', value]);
      return this;
    },
    maxTimeMS() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => [],
  };
  const repository = createBudgetSummaryRepository({
    budgetModel: {
      find(filter) {
        calls.push(['find', filter]);
        return chain;
      },
    },
    transactionModel: {
      aggregate(pipeline) {
        calls.push(['aggregate', pipeline]);
        return { option: () => ({ exec: async () => [expenses()] }) };
      },
    },
  });
  await repository.summarize(ownerA, { month });
  const filter = calls.find((row) => row[0] === 'find')[1];
  assert.equal(filter.owner.toHexString(), ownerA);
  assert.equal(filter.month, month);
  assert.equal(filter.currency, 'INR');
  const pipeline = calls.find((row) => row[0] === 'aggregate')[1];
  assert.equal(pipeline[0].$match.owner.toHexString(), ownerA);
  assert.equal(pipeline[0].$match.type, 'expense');
  assert.equal(pipeline[0].$match.currency, 'INR');
  assert.equal(pipeline[0].$match.transactionDate.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(pipeline[0].$match.transactionDate.$lt.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(pipeline[1].$set.money.$convert.input.$convert.to, 'long');
  assert.equal(calls.find((row) => row[0] === 'limit')[1], 12);
  await assert.rejects(() => repository.summarize({ $ne: null }, { month }));
  await assert.rejects(() => repository.summarize(ownerA, { month, owner: ownerB }));
});
test('best-effort summary reflects changed inputs on subsequent reads while each result reconciles', async () => {
  let raw = { budgets: [budget()], expenses: expenses([['food_dining', 20]]) };
  const service = createBudgetSummaryService({
    repository: { summarize: async () => structuredClone(raw) },
  });
  assert.equal((await service.summary(ownerA, { month })).totals.budgetedSpendingMinor, 20);
  raw = { budgets: [], expenses: expenses([['food_dining', 25]]) };
  const next = await service.summary(ownerA, { month });
  assert.equal(next.totals.unbudgetedSpendingMinor, 25);
  assert.equal(next.totals.expenseMinor, 25);
  assert.equal(next.consistency, 'best_effort');
});
test('summary HTTP route is not shadowed, validates strict queries, requires auth, and sanitizes failures', async (t) => {
  const repository = { summarize: async () => ({ budgets: [], expenses: expenses() }) };
  const app = createApp(
    { nodeEnv: 'test', jwtSecret: secret },
    {
      budgetSummaryRepository: repository,
      repository: {
        findById: async () => ({ _id: ownerA, name: 'Owner', email: 'a@example.test' }),
      },
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = jwt.sign({}, secret, {
    subject: ownerA,
    algorithm: 'HS256',
    issuer: 'smart-finance-manager',
    audience: 'smart-finance-manager-web',
    expiresIn: 900,
  });
  const request = async (query = '?month=2026-10', authenticated = true) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/budgets/summary${query}`,
      { headers: authenticated ? { Cookie: `sfm_access=${token}` } : {} },
    );
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  assert.equal((await request('', false)).status, 401);
  for (const query of [
    '',
    '?month=2026-1',
    '?month=0000-01',
    '?month=2026-13',
    '?month=2026-10&currency=USD',
    '?month=2026-10&category=other',
    '?month=2026-10&owner=' + ownerB,
    '?month=2026-10&month=2026-11',
    '?month[$ne]=x',
    '?month=2026-10&$where=x',
  ]) {
    const response = await request(query);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.code, 'INVALID_QUERY');
  }
  const valid = await request();
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('cache-control'), 'no-store');
  assert.equal(valid.body.data.summary.month, month);
  repository.summarize = async () => {
    throw new Error('secret driver details');
  };
  assert.deepEqual((await request()).body, {
    status: 'error',
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
  repository.summarize = async () => ({
    budgets: [],
    expenses: expenses([['other', '9007199254740992']]),
  });
  const overflow = await request();
  assert.equal(overflow.status, 422);
  assert.equal(overflow.body.code, 'SUMMARY_OVERFLOW');
});
