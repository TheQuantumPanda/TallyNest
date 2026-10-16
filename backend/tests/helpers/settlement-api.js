import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ownerA, ownerB } from './transaction-api.js';
import { ownerC } from './invitation-api.js';
import { expenseInput } from './group-expense-api.js';
export async function addExpense(request, groupId, input = expenseInput) {
  const result = await request(`/groups/${groupId}/expenses`, {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
export async function propose(request, groupId, amountMinor = 5000, headers = {}) {
  return request(`/groups/${groupId}/settlements`, {
    method: 'POST',
    user: ownerB,
    body: { recipient: ownerA, amountMinor },
    headers: { 'Idempotency-Key': randomUUID(), ...headers },
  });
}
export function settlementApiContract(setup) {
  test('empty balances are genuine zeros and outsiders cannot inspect financial history', async (t) => {
    const { request, groupId } = await setup(t),
      path = `/groups/${groupId}`;
    const result = await request(path + '/balances');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.body.data.balances.netTotalMinor, 0);
    assert.deepEqual(
      result.body.data.balances.members.map((row) => row.netMinor),
      [0, 0],
    );
    assert.deepEqual(result.body.data.balances.suggestions, []);
    for (const suffix of ['/balances', '/settlements', '/settlements/' + ownerA])
      assert.equal((await request(path + suffix, { user: ownerC })).status, 404);
    assert.equal((await request(path + '/balances', { user: null })).status, 401);
    assert.equal((await request(path + '/balances?currency=USD')).status, 400);
    assert.equal((await propose(request, groupId)).body.code, 'SETTLEMENT_EXCESS');
  });
  test('balances reconcile real equal, exact and percentage expenses with deterministic suggestions', async (t) => {
    const { request, groupId } = await setup(t);
    await addExpense(request, groupId);
    await addExpense(request, groupId, {
      ...expenseInput,
      amountMinor: 101,
      split: {
        method: 'percentage',
        participants: [
          { user: ownerB, basisPoints: 5000 },
          { user: ownerA, basisPoints: 5000 },
        ],
      },
    });
    await addExpense(request, groupId, {
      ...expenseInput,
      payer: ownerB,
      amountMinor: 100,
      split: { method: 'exact', participants: [{ user: ownerA, amountMinor: 100 }] },
    });
    const data = (await request(`/groups/${groupId}/balances`)).body.data.balances;
    assert.deepEqual(
      data.members.map((row) => [row.paidMinor, row.assignedMinor, row.netMinor]),
      [
        [10101, 5151, 4950],
        [100, 5050, -4950],
      ],
    );
    assert.deepEqual(data.suggestions, [
      { sender: ownerB, recipient: ownerA, amountMinor: 4950, currency: 'INR' },
    ]);
    assert.equal(
      data.members.reduce((sum, row) => sum + BigInt(row.netMinor), 0n),
      0n,
    );
  });
  test('pending reserves capacity without changing net and recipient confirmation records exact audit totals', async (t) => {
    const { request, groupId } = await setup(t);
    await addExpense(request, groupId);
    const created = await propose(request, groupId, 3000);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = created.body.data.settlement,
      path = `/groups/${groupId}/settlements/${row.id}`;
    assert.equal(row.sender, ownerB);
    assert.equal(row.recipient, ownerA);
    assert.equal(row.status, 'pending');
    assert.equal(row.version, 0);
    const pending = (await request(`/groups/${groupId}/balances`)).body.data.balances;
    assert.deepEqual(
      pending.members.map((row) => row.netMinor),
      [5000, -5000],
    );
    assert.deepEqual(
      pending.members.map((row) => row.pendingSentMinor),
      [0, 3000],
    );
    assert.equal((await propose(request, groupId, 2001)).body.code, 'SETTLEMENT_EXCESS');
    assert.equal(
      (
        await request(path + '/confirm', {
          method: 'POST',
          body: {},
          user: ownerB,
          headers: { 'If-Match': created.etag },
        })
      ).status,
      403,
    );
    assert.equal((await request(path + '/confirm', { method: 'POST', body: {} })).status, 428);
    assert.equal(
      (
        await request(path + '/confirm', {
          method: 'POST',
          body: {},
          headers: { 'If-Match': `"tn-${row.id}-v1"` },
        })
      ).status,
      412,
    );
    const confirmed = await request(path + '/confirm', {
      method: 'POST',
      body: {},
      headers: { 'If-Match': created.etag },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.settlement.decisionBy, ownerA);
    assert.ok(confirmed.body.data.settlement.confirmedAt);
    assert.equal(confirmed.etag, `"tn-${row.id}-v1"`);
    const final = (await request(`/groups/${groupId}/balances`)).body.data.balances;
    assert.deepEqual(
      final.members.map((row) => [
        row.netMinor,
        row.confirmedSentMinor,
        row.confirmedReceivedMinor,
      ]),
      [
        [2000, 0, 3000],
        [-2000, 3000, 0],
      ],
    );
    for (const action of ['confirm', 'reject'])
      assert.equal(
        (
          await request(path + '/' + action, {
            method: 'POST',
            body: {},
            headers: { 'If-Match': confirmed.etag },
          })
        ).body.code,
        'SETTLEMENT_DECIDED',
      );
  });
  test('rejected proposals release reserved capacity but never unfreeze expenses', async (t) => {
    const { request, groupId } = await setup(t);
    const expense = await addExpense(request, groupId);
    const created = await propose(request, groupId),
      row = created.body.data.settlement;
    const rejected = await request(`/groups/${groupId}/settlements/${row.id}/reject`, {
      method: 'POST',
      body: {},
      headers: { 'If-Match': created.etag },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.settlement.status, 'rejected');
    assert.ok(rejected.body.data.settlement.rejectedAt);
    const data = (await request(`/groups/${groupId}/balances`)).body.data.balances;
    assert.equal(data.settlementMode, true);
    assert.deepEqual(
      data.members.map((row) => row.netMinor),
      [5000, -5000],
    );
    assert.deepEqual(
      data.members.map((row) => row.pendingSentMinor),
      [0, 0],
    );
    for (const [method, suffix, body] of [
      ['POST', '', expenseInput],
      ['PATCH', '/' + expense.body.data.expense.id, { title: 'Rewrite' }],
      ['DELETE', '/' + expense.body.data.expense.id],
    ]) {
      const result = await request(`/groups/${groupId}/expenses${suffix}`, {
        method,
        body,
        headers: { 'If-Match': expense.etag, 'Idempotency-Key': randomUUID() },
      });
      assert.equal(result.body.code, 'EXPENSES_FROZEN');
    }
    assert.equal((await propose(request, groupId)).status, 201);
  });
  test('creation receipts are retry-safe and private; competing proposals cannot reserve too much', async (t) => {
    const { request, groupId } = await setup(t);
    await addExpense(request, groupId);
    const key = randomUUID();
    const first = await propose(request, groupId, 2000, { 'Idempotency-Key': key });
    const retry = await propose(request, groupId, 2000, { 'Idempotency-Key': key });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.replayed, true);
    assert.equal(retry.body.data.settlement.id, first.body.data.settlement.id);
    assert.equal(
      (await propose(request, groupId, 2001, { 'Idempotency-Key': key })).body.code,
      'IDEMPOTENCY_CONFLICT',
    );
    const results = await Promise.all([
      propose(request, groupId, 3000),
      propose(request, groupId, 3000),
    ]);
    assert.equal(results.filter((row) => row.status === 201).length, 1);
    assert.ok(results.some((row) => row.status === 409));
    const list = await request(`/groups/${groupId}/settlements?limit=1`);
    assert.equal(list.body.data.settlements.length, 1);
    assert.equal(list.body.pagination.hasMore, true);
    const second = await request(
      `/groups/${groupId}/settlements?limit=1&after=${list.body.pagination.nextAfter}`,
    );
    assert.equal(second.body.pagination.hasMore, false);
    assert.notEqual(second.body.data.settlements[0].id, list.body.data.settlements[0].id);
    assert.equal(JSON.stringify(list.body).includes('creationHash'), false);
    assert.equal(JSON.stringify(list.body).includes('lastFinancialOperation'), false);
  });
  test('settlement validation rejects impersonation, operators, unsafe amounts and unsupported queries', async (t) => {
    const { request, groupId } = await setup(t);
    await addExpense(request, groupId);
    const path = `/groups/${groupId}/settlements`;
    for (const patch of [
      { sender: ownerA },
      { owner: ownerA },
      { status: 'confirmed' },
      { __v: 0 },
      { group: groupId },
      { $set: {} },
      { recipient: ownerB },
      { recipient: ownerC },
      { recipient: { $ne: null } },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.1 },
      { amountMinor: '100' },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { currency: 'USD' },
    ])
      assert.equal(
        (
          await request(path, {
            method: 'POST',
            user: ownerB,
            body: { recipient: ownerA, amountMinor: 100, ...patch },
            headers: { 'Idempotency-Key': randomUUID() },
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          user: ownerB,
          body: { recipient: ownerA, amountMinor: 100 },
        })
      ).status,
      400,
    );
    for (const query of [
      'limit=101',
      'limit=0',
      'after=bad',
      'group[$ne]=null',
      'status=confirmed',
    ])
      assert.equal((await request(path + '?' + query)).status, 400);
    for (const headers of [{ 'X-CSRF-Protection': '' }, { Origin: 'https://attacker.test' }])
      assert.equal((await propose(request, groupId, 100, headers)).status, 403);
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          user: null,
          body: { recipient: ownerA, amountMinor: 100 },
          headers: { 'Idempotency-Key': randomUUID() },
        })
      ).status,
      401,
    );
    assert.equal((await request(path + '/bad')).status, 400);
  });
  test('settlement decisions are group-scoped, reject cross-resource ETags and concurrent confirmation', async (t) => {
    const { request, groupId } = await setup(t);
    await addExpense(request, groupId);
    const created = await propose(request, groupId),
      row = created.body.data.settlement;
    const other = await request('/groups', { method: 'POST', body: { name: 'Other' } });
    assert.equal(
      (await request(`/groups/${other.body.data.group.id}/settlements/${row.id}`)).status,
      404,
    );
    const path = `/groups/${groupId}/settlements/${row.id}/confirm`;
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          body: {},
          headers: { 'If-Match': `"tn-${ownerA}-v0"` },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(path, {
          method: 'POST',
          body: {},
          user: ownerC,
          headers: { 'If-Match': created.etag },
        })
      ).status,
      404,
    );
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(path, { method: 'POST', body: {}, headers: { 'If-Match': created.etag } }),
      ),
    );
    assert.equal(results.filter((row) => row.status === 200).length, 1);
    assert.ok(results.every((row) => [200, 409].includes(row.status)));
    assert.deepEqual(
      (await request(`/groups/${groupId}/balances`)).body.data.balances.members.map(
        (row) => row.netMinor,
      ),
      [0, 0],
    );
  });
}
