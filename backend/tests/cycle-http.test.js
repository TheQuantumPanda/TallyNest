import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expected,
  currentVersion,
  pageQuery,
  parse,
  publicHead,
  publicCycle,
} from '../src/staged/contract.js';
import { createDisposableCycleApp } from '../integration/helpers/staged-cycle-app.js';
const group = '507f1f77bcf86cd799439011';
const cycle = '507f1f77bcf86cd799439012';
test('staged construction cannot target an ordinary database or production configuration', async () => {
  for (const [name, nodeEnv] of [
    ['smart_finance_manager', 'test'],
    ['tallynest_cycle_http_test_1792217000000_123456abcdef', 'production'],
  ]) {
    await assert.rejects(
      createDisposableCycleApp({ connection: { name }, config: { nodeEnv } }),
      /disposable test database/,
    );
  }
});
test('staged ETags bind expected versions to a specific resource and preserve safe boundaries', () => {
  assert.equal(expected(`"tn-${cycle}-v3"`, cycle), 3);
  assert.throws(() => expected(undefined, cycle), { status: 428 });
  for (const value of ['*', 'W/"weak"', `"tn-${group}-v3"`, `"tn-${cycle}-v9007199254740992"`]) {
    assert.throws(() => expected(value, cycle), { status: 400 });
  }
  assert.throws(() => currentVersion(`"tn-${cycle}-v2"`, { _id: cycle, __v: 3 }), { status: 412 });
});
test('staged query validation rejects operators, arrays and unlimited page sizes', () => {
  assert.deepEqual(parse(pageQuery, {}), { limit: 20 });
  assert.equal(parse(pageQuery, { limit: '100' }).limit, 100);
  for (const query of [
    { limit: '0' },
    { limit: '101' },
    { limit: ['1', '2'] },
    { $where: 'x' },
    { cycleId: { $ne: null } },
  ]) {
    assert.throws(() => parse(pageQuery, query), { status: 400 });
  }
});
test('cycle and group DTOs explicitly omit private journals, maintenance and operation payloads', () => {
  const now = new Date('2026-10-17T00:00:00.000Z');
  const data = publicCycle({
    _id: cycle,
    group,
    sequence: 1,
    currency: 'INR',
    status: 'open',
    memberIds: [group],
    openedAt: now,
    __v: 0,
    migrationRunId: 'private',
    payloadHash: 'private',
  });
  assert.deepEqual(
    Object.keys(data).sort(),
    [
      'currency',
      'etag',
      'groupId',
      'id',
      'memberIds',
      'openedAt',
      'sequence',
      'state',
      'version',
    ].sort(),
  );
  const head = publicHead({
    _id: group,
    __v: 0,
    financialOperation: { payload: 'private' },
    cycleMigration: { runId: 'private' },
  });
  assert.equal(head.busy, true);
  assert.equal(JSON.stringify(head).includes('private'), false);
});
