import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ownerA, ownerB } from './transaction-api.js';
import { ownerC } from './invitation-api.js';
export const expenseInput = { payer: ownerA, title: 'Shared lunch', amountMinor: 10000, currency: 'INR', category: 'food_dining', expenseDate: '2026-10-14T12:00:00.000Z', split: { method: 'equal', participants: [ownerB, ownerA] } };
export function groupExpenseApiContract(setup) {
  test('shared expenses create exact allocations with scoped metadata and idempotency replay', async t => {
    const { request, groupId } = await setup(t), path = `/groups/${groupId}/expenses`, key = randomUUID();
    const create = await request(path, { method: 'POST', body: expenseInput, user: ownerB, headers: { 'Idempotency-Key': key } });
    assert.equal(create.status, 201); const row = create.body.data.expense;
    assert.equal(row.creatorId, ownerB); assert.equal(row.payer, ownerA); assert.deepEqual(row.shares, [{ user: ownerA, amountMinor: 5000 }, { user: ownerB, amountMinor: 5000 }]);
    assert.equal(row.version, 0); assert.equal(create.etag, `"tn-${row.id}-v0"`); assert.equal(row.creationKey, undefined);
    const replay = await request(path, { method: 'POST', body: { ...expenseInput, split: { method: 'equal', participants: [ownerA, ownerB] } }, user: ownerB, headers: { 'Idempotency-Key': key } });
    assert.equal(replay.status, 200); assert.equal(replay.body.data.expense.id, row.id); assert.equal(replay.body.data.replayed, true);
    assert.equal((await request(path, { method: 'POST', body: { ...expenseInput, title: 'Different' }, user: ownerB, headers: { 'Idempotency-Key': key } })).body.code, 'IDEMPOTENCY_CONFLICT');
  });
  test('shared expenses support excluding members and all split methods with positive exact shares', async t => {
    const { request, groupId } = await setup(t);
    for (const split of [{ method: 'equal', participants: [ownerB] }, { method: 'exact', participants: [{ user: ownerA, amountMinor: 7000 }, { user: ownerB, amountMinor: 3000 }] }, { method: 'percentage', participants: [{ user: ownerA, basisPoints: 3333 }, { user: ownerB, basisPoints: 6667 }] }]) {
      const result = await request(`/groups/${groupId}/expenses`, { method: 'POST', body: { ...expenseInput, split }, headers: { 'Idempotency-Key': randomUUID() } });
      assert.equal(result.status, 201); assert.equal(result.body.data.expense.shares.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n), 10000n);
    }
  });
  test('shared expense validation rejects protected fields, invalid money, payer, participants and dates', async t => {
    const { request, groupId } = await setup(t), path = `/groups/${groupId}/expenses`;
    for (const changes of [{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 0.5 }, { amountMinor: '100' }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'USD' }, { category: 'salary' }, { payer: ownerC }, { payer: { $ne: null } }, { expenseDate: '2026-02-30T00:00:00.000Z' }, { group: groupId }, { creator: ownerC }, { owner: ownerC }, { _id: ownerC }, { shares: [] }, { __v: 1 }, { financialHistoryAt: new Date() }, { $set: {} }, { split: { method: 'equal', participants: [ownerC] } }, { split: { method: 'equal', participants: [ownerA, ownerA] } }, { split: { method: 'percentage', participants: [{ user: ownerA, basisPoints: 9999 }] } }, { split: { method: 'exact', participants: [{ user: ownerA, amountMinor: 9999 }] } }, { amountMinor: 1 }]) {
      const result = await request(path, { method: 'POST', body: { ...expenseInput, ...changes }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(result.status, 400, JSON.stringify(changes));
    }
    assert.equal((await request(path, { method: 'POST', body: expenseInput })).status, 400);
    assert.equal((await request(path)).body.data.expenses.length, 0);
    assert.equal((await request(`/groups/${groupId}`)).body.data.group.financialHistoryLocked, undefined);
  });
  test('group history lock protects deletion/removal/leave and persists after deleting every expense', async t => {
    const { request, groupId } = await setup(t), path = `/groups/${groupId}/expenses`;
    const created = await request(path, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } });
    assert.equal(created.status, 201);
    const group = await request(`/groups/${groupId}`); assert.equal(group.body.data.group.financialHistoryLocked, true);
    for (const [method, path, body, user] of [['DELETE', `/groups/${groupId}`, undefined, ownerA], ['DELETE', `/groups/${groupId}/members/${ownerB}`, undefined, ownerA], ['POST', `/groups/${groupId}/leave`, {}, ownerB]]) {
      const result = await request(path, { method, body, user, headers: { 'If-Match': group.etag } }); assert.equal(result.status, 409); assert.equal(result.body.code, 'FINANCIAL_HISTORY_LOCKED');
    }
    assert.equal((await request(path + '/' + created.body.data.expense.id, { method: 'DELETE', headers: { 'If-Match': created.etag } })).status, 200);
    assert.equal((await request(path)).body.data.expenses.length, 0);
    assert.equal((await request(`/groups/${groupId}`, { method: 'DELETE' })).body.code, 'FINANCIAL_HISTORY_LOCKED');
  });
  test('nonmembers cannot read or write expenses and cross-group IDs have identical missing semantics', async t => {
    const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`;
    const created = await request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } });
    const expenseId = created.body.data.expense.id;
    for (const [method, path, body] of [['GET', base], ['GET', base + '/' + expenseId], ['POST', base, expenseInput], ['PATCH', base + '/' + expenseId, { title: 'No' }], ['DELETE', base + '/' + expenseId]]) assert.equal((await request(path, { method, body, user: ownerC, headers: { 'If-Match': created.etag, 'Idempotency-Key': randomUUID() } })).status, 404);
    const other = await request('/groups', { method: 'POST', body: { name: 'Other' } });
    const foreign = await request(`/groups/${other.body.data.group.id}/expenses/${expenseId}`), missing = await request(`/groups/${other.body.data.group.id}/expenses/${ownerC}`);
    assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
    assert.equal((await request(base + '/bad')).status, 400);
  });
  test('expense creator/group owner authorization and atomic versioned full-document splitting', async t => {
    const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`;
    const created = await request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } });
    const path = base + '/' + created.body.data.expense.id;
    assert.equal((await request(path, { method: 'PATCH', body: { title: 'No' }, user: ownerB, headers: { 'If-Match': created.etag } })).status, 403);
    assert.equal((await request(path, { method: 'DELETE', user: ownerB, headers: { 'If-Match': created.etag } })).status, 403);
    assert.equal((await request(path, { method: 'PATCH', body: { amountMinor: 10001 } })).status, 428);
    assert.equal((await request(path, { method: 'PATCH', body: { amountMinor: 0 }, headers: { 'If-Match': created.etag } })).status, 400);
    const update = await request(path, { method: 'PATCH', body: { amountMinor: 10001, notes: 'Review' }, headers: { 'If-Match': created.etag } });
    assert.equal(update.status, 200); assert.deepEqual(update.body.data.expense.shares.map(row => row.amountMinor), [5001, 5000]);
    assert.equal((await request(path, { method: 'PATCH', body: { title: 'Stale' }, headers: { 'If-Match': created.etag } })).status, 412);
    const exact = await request(path, { method: 'PATCH', body: { split: { method: 'exact', participants: [{ user: ownerA, amountMinor: 10001 }] }, notes: null }, headers: { 'If-Match': update.etag } });
    assert.equal(exact.status, 200);
    assert.equal((await request(path, { method: 'PATCH', body: { amountMinor: 10002 }, headers: { 'If-Match': exact.etag } })).status, 400);
    const byMember = await request(base, { method: 'POST', body: expenseInput, user: ownerB, headers: { 'Idempotency-Key': randomUUID() } });
    assert.equal((await request(base + '/' + byMember.body.data.expense.id, { method: 'PATCH', body: { title: 'Owner reviewed' }, headers: { 'If-Match': byMember.etag } })).status, 200);
  });
  test('expense concurrent updates and deletions retain version checks', async t => {
    const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`;
    const created = await request(base, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': randomUUID() } }), path = base + '/' + created.body.data.expense.id;
    const results = await Promise.all(['One', 'Two'].map(title => request(path, { method: 'PATCH', body: { title }, headers: { 'If-Match': created.etag } })));
    assert.equal(results.filter(row => row.status === 200).length, 1); assert.ok([409, 412].includes(results.find(row => row.status !== 200).status));
    const latest = await request(path);
    assert.equal((await request(path, { method: 'DELETE' })).status, 428);
    assert.equal((await request(path, { method: 'DELETE', headers: { 'If-Match': created.etag } })).status, 412);
    assert.equal((await request(path, { method: 'DELETE', headers: { 'If-Match': latest.etag } })).status, 200);
    assert.equal((await request(path)).status, 404);
  });
  test('expense pagination is bounded, deterministic on equal dates and group-bound', async t => {
    const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`, ids = [];
    for (let i = 0; i < 4; i++) ids.push((await request(base, { method: 'POST', body: { ...expenseInput, title: 'Entry ' + i }, headers: { 'Idempotency-Key': randomUUID() } })).body.data.expense.id);
    const first = await request(base + '?limit=2'), next = await request(base + '?limit=2&after=' + first.body.pagination.nextAfter);
    assert.deepEqual([...first.body.data.expenses, ...next.body.data.expenses].map(row => row.id), ids.sort().reverse()); assert.equal(next.body.pagination.nextAfter, null);
    assert.equal((await request(base)).body.pagination.limit, 20);
    for (const query of ['?limit=101', '?limit=0', '?limit=1.5', '?owner=x', '?$where=x', '?after=bad', '?limit=20&limit=10']) assert.equal((await request(base + query)).status, 400);
    const other = await request('/groups', { method: 'POST', body: { name: 'Other' } });
    assert.equal((await request(`/groups/${other.body.data.group.id}/expenses?after=${first.body.pagination.nextAfter}`)).status, 400);
  });
  test('deleted expense idempotency receipts prevent resurrection', async t => {
    const { request, groupId } = await setup(t), path = `/groups/${groupId}/expenses`, key = randomUUID();
    const created = await request(path, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } });
    await request(path + '/' + created.body.data.expense.id, { method: 'DELETE', headers: { 'If-Match': created.etag } });
    assert.equal((await request(path, { method: 'POST', body: expenseInput, headers: { 'Idempotency-Key': key } })).body.code, 'EXPENSE_DELETED');
  });
  test('expense endpoints preserve authentication, CSRF, JSON and safe errors', async t => {
    const { request, groupId } = await setup(t), base = `/groups/${groupId}/expenses`;
    for (const [method, path, body] of [['POST', base, expenseInput], ['GET', base], ['GET', base + '/' + ownerA], ['PATCH', base + '/' + ownerA, { title: 'x' }], ['DELETE', base + '/' + ownerA]]) {
      assert.equal((await request(path, { method, body, user: null })).status, 401);
      if (method === 'GET') continue;
      for (const headers of [{ Origin: '' }, { Origin: 'http://evil.test' }, { 'X-CSRF-Protection': '' }]) assert.equal((await request(path, { method, body, headers })).status, 403);
    }
    assert.equal((await request(base, { method: 'POST', body: expenseInput, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  });
}
