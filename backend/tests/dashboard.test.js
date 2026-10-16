import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createDashboardService, reportingPeriod } from '../src/services/dashboard.service.js';
import { createDashboardRepository } from '../src/repositories/dashboard.repository.js';
import { createApp } from '../app.js';
import { allocateShares, percentageText, plotRatio } from '../../shared/dashboard.js';

const owner = '507f1f77bcf86cd799439011';
const now = () => new Date('2024-03-15T23:00:00.000Z');
const empty = () => ({ integrity: [], totals: [], categories: [], series: [], recent: [] });
const populated = () => ({
  integrity: [{ invalid: 0 }],
  totals: [
    { _id: { currency: 'INR', type: 'income' }, amount: '300', count: 2 },
    { _id: { currency: 'INR', type: 'expense' }, amount: '100', count: 2 },
  ],
  categories: [
    { _id: { currency: 'INR', category: 'food_dining' }, amount: '90' },
    { _id: { currency: 'INR', category: 'other' }, amount: '10' },
  ],
  series: [
    {
      _id: { currency: 'INR', type: 'income', bucket: new Date('2024-03-01T00:00:00.000Z') },
      amount: '300',
      count: 2,
    },
    {
      _id: { currency: 'INR', type: 'expense', bucket: new Date('2024-03-02T00:00:00.000Z') },
      amount: '100',
      count: 2,
    },
  ],
  recent: [],
});
const service = (raw) =>
  createDashboardService({
    repository: {
      async summarize() {
        return raw;
      },
    },
    now,
  });

test('empty account returns genuine zeros and zero-filled daily buckets', async () => {
  const result = await service(empty()).summary(owner, {});
  assert.deepEqual(result.totals, {
    incomeMinor: 0,
    expenseMinor: 0,
    netMinor: 0,
    transactionCount: 0,
  });
  assert.equal(result.cashFlow.length, 31);
  assert.ok(result.cashFlow.every((point) => point.incomeMinor === 0 && point.expenseMinor === 0));
  assert.deepEqual(result.spending, []);
});
test('income, expenses, net, categories and series reconcile with exact integer arithmetic', async () => {
  const result = await service(populated()).summary(owner, {});
  assert.deepEqual(result.totals, {
    incomeMinor: 300,
    expenseMinor: 100,
    netMinor: 200,
    transactionCount: 4,
  });
  assert.deepEqual(result.spending, [
    { category: 'food_dining', amountMinor: 90, shareBasisPoints: 9000 },
    { category: 'other', amountMinor: 10, shareBasisPoints: 1000 },
  ]);
  assert.equal(result.cashFlow[0].incomeMinor, 300);
  assert.equal(result.cashFlow[1].expenseMinor, 100);
});
test('expense-only periods have negative net cash flow', async () => {
  const raw = populated();
  raw.totals = raw.totals.slice(1);
  raw.series = raw.series.slice(1);
  assert.equal((await service(raw).summary(owner, {})).totals.netMinor, -100);
});
test('large safe integer aggregates retain all digits', async () => {
  const raw = empty();
  raw.totals = [
    { _id: { currency: 'INR', type: 'income' }, amount: String(Number.MAX_SAFE_INTEGER), count: 1 },
  ];
  raw.series = [
    {
      _id: { currency: 'INR', type: 'income', bucket: new Date('2024-03-01T00:00:00.000Z') },
      amount: String(Number.MAX_SAFE_INTEGER),
      count: 1,
    },
  ];
  assert.equal((await service(raw).summary(owner, {})).totals.incomeMinor, Number.MAX_SAFE_INTEGER);
  raw.totals[0].amount = '9007199254740992';
  await assert.rejects(
    () => service(raw).summary(owner, {}),
    (error) => error.status === 422 && error.code === 'SUMMARY_OVERFLOW',
  );
});
for (const mutation of [
  (raw) => {
    raw.categories[0].amount = '91';
  },
  (raw) => {
    raw.series[0].amount = '301';
  },
  (raw) => {
    raw.series[0].count = 3;
  },
  (raw) => {
    raw.integrity[0].invalid = 1;
  },
  (raw) => {
    raw.totals[0]._id.currency = 'USD';
  },
]) {
  test('inconsistent or invalid aggregates fail closed', async () => {
    const raw = populated();
    mutation(raw);
    await assert.rejects(
      () => service(raw).summary(owner, {}),
      (error) => error.status === 422,
    );
  });
}
test('period boundaries use full UTC calendar intervals, including leap days and year rollover', () => {
  const feb = reportingPeriod('last_month', now());
  assert.equal(feb.from.toISOString(), '2024-02-01T00:00:00.000Z');
  assert.equal(feb.to.toISOString(), '2024-03-01T00:00:00.000Z');
  const quarter = reportingPeriod('last_3_months', new Date('2026-01-13T00:00:00.000Z'));
  assert.equal(quarter.from.toISOString(), '2025-11-01T00:00:00.000Z');
  assert.equal(quarter.to.toISOString(), '2026-02-01T00:00:00.000Z');
  const year = reportingPeriod('this_year', now());
  assert.equal(year.from.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.equal(year.to.toISOString(), '2025-01-01T00:00:00.000Z');
});
test('percentage shares use deterministic largest remainders and integer visualization ratios', () => {
  const rows = allocateShares(
    ['a', 'b', 'c'].map((category) => ({ category, amountMinor: 1 })),
    3,
  );
  assert.deepEqual(
    rows.map((row) => row.shareBasisPoints),
    [3334, 3333, 3333],
  );
  assert.equal(percentageText(1, 3), '33.33%');
  assert.equal(percentageText(4, 3), '133.33%');
  assert.equal(percentageText(1, 0), null);
  assert.equal(plotRatio(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), 10000);
});
test('repository aggregation matches owner/date before facets and converts long before decimal', async () => {
  let pipeline;
  const repository = createDashboardRepository({
    aggregate(value) {
      pipeline = value;
      return { option: () => ({ exec: async () => [empty()] }) };
    },
  });
  await repository.summarize(owner, reportingPeriod('this_month', now()));
  assert.equal(pipeline[0].$match.owner.toHexString(), owner);
  assert.equal(pipeline[0].$match.transactionDate.$gte.toISOString(), '2024-03-01T00:00:00.000Z');
  assert.equal(pipeline[1].$set.money.$convert.input.$convert.to, 'long');
  assert.equal(pipeline[2].$facet.recent[1].$limit, 5);
  await assert.rejects(() =>
    repository.summarize({ $ne: null }, reportingPeriod('this_month', now())),
  );
});
test('dashboard HTTP endpoint requires auth, strictly validates input, and hides internal failures', async (t) => {
  const secret = '0123456789abcdef'.repeat(4);
  const repository = {
    findById: async () => ({ _id: owner, name: 'Test', email: 'test@example.com' }),
  };
  const dashboardRepository = { summarize: async () => empty() };
  const app = createApp(
    { jwtSecret: secret, nodeEnv: 'test' },
    { repository, dashboardRepository, dashboardNow: now },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = jwt.sign({}, secret, {
    subject: owner,
    algorithm: 'HS256',
    issuer: 'smart-finance-manager',
    audience: 'smart-finance-manager-web',
    expiresIn: 900,
  });
  const request = async (query = '', authenticated = true) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/dashboard/summary${query}`,
      { headers: authenticated ? { Cookie: `sfm_access=${token}` } : {} },
    );
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  assert.equal((await request('', false)).status, 401);
  for (const query of [
    '?period=all',
    '?currency=USD',
    '?owner=' + owner,
    '?period=this_month&period=last_month',
    '?$where=true',
    '?from=bad',
  ])
    assert.equal((await request(query)).status, 400);
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.data.summary.totals.incomeMinor, 0);
  dashboardRepository.summarize = async () => {
    throw new Error('database credentials secret');
  };
  assert.deepEqual((await request()).body, {
    status: 'error',
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});
