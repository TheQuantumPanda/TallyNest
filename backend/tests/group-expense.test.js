import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { allocateSplit } from '../src/utils/split.js';
import { GroupExpense, persistedSplit } from '../src/models/group-expense.model.js';
import { ownerA, ownerB } from './helpers/transaction-api.js';
import { ownerC, invitationApiSetup } from './helpers/invitation-api.js';
import { isolatedInvitations } from './helpers/invitation-repository.js';
import { isolatedGroupExpenses } from './helpers/group-expense-repository.js';
import { expenseInput, groupExpenseApiContract } from './helpers/group-expense-api.js';
async function setup(t, modify = (value) => value) {
  const data = isolatedInvitations(),
    expenses = isolatedGroupExpenses();
  const request = await invitationApiSetup(
    t,
    modify({
      groupRepository: data.groups,
      membershipRepository: data.memberships,
      invitationRepository: data.invitations,
      groupExpenseRepository: expenses,
    }),
  );
  const group = await data.groups.createForOwner(ownerA, { name: 'Shared' });
  await data.groups.seedMember(String(group._id), ownerB);
  return { request, groupId: String(group._id), data, expenses };
}
groupExpenseApiContract(setup);
test('equal split deterministically distributes indivisible paise independently of request order', () => {
  for (const participants of [
    [ownerA, ownerB, ownerC],
    [ownerC, ownerA, ownerB],
    [ownerB, ownerC, ownerA],
  ]) {
    assert.deepEqual(allocateSplit(10000, { method: 'equal', participants }).shares, [
      { user: ownerA, amountMinor: 3334 },
      { user: ownerB, amountMinor: 3333 },
      { user: ownerC, amountMinor: 3333 },
    ]);
    assert.deepEqual(
      allocateSplit(4, { method: 'equal', participants }).shares.map((row) => row.amountMinor),
      [2, 1, 1],
    );
  }
});
test('percentage uses exact largest remainders and stable ID ties at maximum safe totals', () => {
  const participants = [
    { user: ownerA, basisPoints: 3333 },
    { user: ownerB, basisPoints: 3333 },
    { user: ownerC, basisPoints: 3334 },
  ];
  const expected = allocateSplit(Number.MAX_SAFE_INTEGER, { method: 'percentage', participants });
  assert.equal(
    expected.shares.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n),
    BigInt(Number.MAX_SAFE_INTEGER),
  );
  assert.deepEqual(
    allocateSplit(Number.MAX_SAFE_INTEGER, {
      method: 'percentage',
      participants: participants.toReversed(),
    }),
    expected,
  );
  assert.deepEqual(
    allocateSplit(101, {
      method: 'percentage',
      participants: [
        { user: ownerB, basisPoints: 5000 },
        { user: ownerA, basisPoints: 5000 },
      ],
    }).shares.map((row) => row.amountMinor),
    [51, 50],
  );
  assert.deepEqual(
    allocateSplit(7, { method: 'percentage', participants }).shares.map((row) => row.amountMinor),
    [2, 2, 3],
  );
});
test('split validation rejects duplicate/invalid IDs, incomplete exact shares, invalid basis points and zero allocations', () => {
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100'])
    assert.throws(() => allocateSplit(amount, { method: 'equal', participants: [ownerA] }));
  for (const split of [
    { method: 'equal', participants: [] },
    { method: 'equal', participants: [ownerA, ownerA.toUpperCase()] },
    { method: 'equal', participants: ['bad'] },
    { method: 'exact', participants: [{ user: ownerA, amountMinor: 99 }] },
    { method: 'exact', participants: [{ user: ownerA, amountMinor: 0 }] },
    { method: 'percentage', participants: [{ user: ownerA, basisPoints: 99.5 }] },
    { method: 'percentage', participants: [{ user: ownerA, basisPoints: 9999 }] },
    {
      method: 'percentage',
      participants: [
        { user: ownerA, basisPoints: 0 },
        { user: ownerB, basisPoints: 10000 },
      ],
    },
  ])
    assert.throws(() => allocateSplit(100, split));
  assert.throws(() => allocateSplit(1, { method: 'equal', participants: [ownerA, ownerB] }));
  assert.throws(() =>
    allocateSplit(1, {
      method: 'percentage',
      participants: [
        { user: ownerA, basisPoints: 1 },
        { user: ownerB, basisPoints: 9999 },
      ],
    }),
  );
});
test('deterministic split sweeps conserve integer amounts and canonical ordering', () => {
  for (let amount = 3; amount < 250; amount++)
    for (const split of [
      { method: 'equal', participants: [ownerC, ownerB, ownerA] },
      {
        method: 'percentage',
        participants: [
          { user: ownerA, basisPoints: 2500 },
          { user: ownerB, basisPoints: 2500 },
          { user: ownerC, basisPoints: 5000 },
        ],
      },
    ]) {
      const { shares } = allocateSplit(amount, split);
      assert.equal(
        shares.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n),
        BigInt(amount),
      );
      assert.ok(
        shares.every((row) => Number.isSafeInteger(row.amountMinor) && row.amountMinor > 0),
      );
    }
});
test('full model rejects non-reconciled allocations and unsafe assignments', async () => {
  const allocation = allocateSplit(expenseInput.amountMinor, expenseInput.split),
    base = {
      ...expenseInput,
      group: ownerC,
      creator: ownerA,
      split: persistedSplit(allocation.split),
      shares: allocation.shares,
      creationKey: 'a'.repeat(64),
      creationHash: 'b'.repeat(64),
    };
  await new GroupExpense(base).validate();
  for (const patch of [
    { amountMinor: 1.5 },
    { shares: [{ user: ownerA, amountMinor: 10000 }] },
    {
      shares: [
        { user: ownerA, amountMinor: 5001 },
        { user: ownerB, amountMinor: 4999 },
      ],
    },
    { payer: 'bad' },
    { category: 'salary' },
    { expenseDate: '2026-02-29T00:00:00.000Z' },
    { group: undefined },
  ])
    await assert.rejects(new GroupExpense({ ...base, ...patch }).validate());
  assert.throws(() => new GroupExpense({ ...base, owner: ownerB }));
});
test('failure after history protection retains a conservative lock and safe idempotent retries', async (t) => {
  let failed = true;
  const { request, groupId, expenses } = await setup(t, (deps) => {
    const create = deps.groupExpenseRepository.create;
    return {
      ...deps,
      groupExpenseRepository: {
        ...deps.groupExpenseRepository,
        async create(...args) {
          if (failed) {
            failed = false;
            throw new Error('private insertion failure');
          }
          return create(...args);
        },
      },
    };
  });
  const path = `/groups/${groupId}/expenses`,
    key = randomUUID();
  const first = await request(path, {
    method: 'POST',
    body: expenseInput,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(first.status, 500);
  assert.equal(first.body.message, 'Internal server error');
  assert.equal(expenses.records.size, 0);
  assert.equal((await request(`/groups/${groupId}`)).body.data.group.financialHistoryLocked, true);
  assert.equal((await request(`/groups/${groupId}`, { method: 'DELETE' })).status, 409);
  assert.equal(
    (await request(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} })).status,
    200,
  );
  assert.equal(
    (
      await request(path, {
        method: 'POST',
        body: expenseInput,
        headers: { 'Idempotency-Key': key },
      })
    ).status,
    200,
  );
});
