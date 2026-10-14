import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedInvitations } from './helpers/invitation-repository.js';
import { isolatedGroupExpenses } from './helpers/group-expense-repository.js';
import { isolatedSettlements, isolatedBalances } from './helpers/settlement-repository.js';
import { invitationApiSetup } from './helpers/invitation-api.js';
import { ownerA, ownerB } from './helpers/transaction-api.js';
import { settlementApiContract, addExpense, propose } from './helpers/settlement-api.js';
import { calculateBalances, simplifyDebts, safeBalanceNumber } from '../src/utils/group-balances.js';
async function setup(t, modify = value => value) {
  const data = isolatedInvitations(), expenses = isolatedGroupExpenses(), settlements = isolatedSettlements();
  const deps = modify({ groupRepository: data.groups, membershipRepository: data.memberships, invitationRepository: data.invitations, groupExpenseRepository: expenses, settlementRepository: settlements, groupBalanceRepository: isolatedBalances(expenses, settlements) });
  const request = await invitationApiSetup(t, deps);
  const group = await data.groups.createForOwner(ownerA, { name: 'Shared' }); await data.groups.seedMember(String(group._id), ownerB);
  return { request, groupId: String(group._id), deps, expenses, settlements };
}
settlementApiContract(setup);
test('debt simplification is deterministic, conservative and exactly conserves all signed positions', () => {
  const input = [{ user: 'c', net: -4n }, { user: 'a', net: 7n }, { user: 'b', net: -3n }, { user: 'd', net: 0n }];
  const expected = [{ sender: 'b', recipient: 'a', amountMinor: 3, currency: 'INR' }, { sender: 'c', recipient: 'a', amountMinor: 4, currency: 'INR' }];
  assert.deepEqual(simplifyDebts(input), expected); assert.deepEqual(simplifyDebts(input.toReversed()), expected); assert.equal(input[0].net, -4n);
  for (let total = 1; total < 100; total++) {
    const rows = [{ user: 'a', net: BigInt(total) }, { user: 'b', net: -BigInt(total) }]; assert.equal(simplifyDebts(rows)[0].amountMinor, total);
  }
  assert.deepEqual(simplifyDebts([{ user: 'a', net: BigInt(Number.MAX_SAFE_INTEGER) }, { user: 'b', net: -BigInt(Number.MAX_SAFE_INTEGER) }])[0].amountMinor, Number.MAX_SAFE_INTEGER);
  for (const input of [[{ user: 'a', net: 1n }], [{ user: 'a', net: 1n }, { user: 'a', net: -1n }], [{ user: 'a', net: 1.5 }], [{ user: 'a', net: NaN }], [{ user: 'a', net: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]]) assert.throws(() => simplifyDebts(input), error => error.status === 422);
});
test('balance reducer rejects corrupt, non-reconciled and unsafe aggregation results', () => {
  const make = () => ({ expenses: { invalid: [], paid: [{ _id: ownerA, amount: '100' }], assigned: [{ _id: ownerB, amount: '100' }] }, settlements: { invalid: [], sent: [], received: [], reservedSent: [], reservedReceived: [] } });
  assert.deepEqual(calculateBalances([ownerA, ownerB], make()).map(row => row.net), [100n, -100n]);
  for (const mutate of [r => { r.expenses.invalid = [{ count: 1 }]; }, r => { r.settlements.invalid = [{ count: 1 }]; }, r => { r.expenses.assigned[0].amount = '99'; }, r => { r.expenses.paid[0].amount = '1.1'; }, r => { r.expenses.paid[0].amount = '-100'; }, r => { r.expenses.paid[0]._id = 'outsider'; }, r => { r.expenses.paid.push(r.expenses.paid[0]); }, r => { r.settlements.sent = [{ _id: ownerB, amount: '1' }]; }, r => { r.expenses.paid[0].amount = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n); }]) {
    const result = make(); mutate(result); assert.throws(() => calculateBalances([ownerA, ownerB], result), error => error.status === 422);
  }
  const max = BigInt(Number.MAX_SAFE_INTEGER); assert.equal(safeBalanceNumber(-max), -Number.MAX_SAFE_INTEGER); assert.throws(() => safeBalanceNumber(max + 1n));
});
test('unknown settlement insertion outcome retains a reservation and recovery safely completes once', async t => {
  let fail = true;
  const { request, groupId, deps } = await setup(t, deps => ({ ...deps, settlementRepository: { ...deps.settlementRepository, async create(...args) { const row = await deps.settlementRepository.create(...args); if (fail) { fail = false; throw new Error('private driver failure'); } return row; } } }));
  await addExpense(request, groupId); const result = await propose(request, groupId); assert.equal(result.status, 500); assert.equal(result.body.message, 'Internal server error');
  assert.ok((await deps.groupRepository.findByIdForMember(ownerA, groupId)).financialOperation);
  assert.equal((await request(`/groups/${groupId}/balances`)).body.code, 'FINANCIAL_BUSY');
  const recovered = await request(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} }); assert.equal(recovered.status, 200); assert.equal(recovered.body.data.recovered, true);
  assert.equal((await request(`/groups/${groupId}/settlements`)).body.data.settlements.length, 1);
  assert.equal((await request(`/groups/${groupId}/financial-recovery`, { method: 'POST', body: {} })).body.data.recovered, false);
});
test('balance read detects an intervening group version and returns no partial summary', async t => {
  let change = false;
  const { request, groupId } = await setup(t, deps => ({ ...deps, groupBalanceRepository: { async aggregate(...args) { const result = await deps.groupBalanceRepository.aggregate(...args); if (change) { const group = await deps.groupRepository.findByIdForMember(ownerA, args[0]); await deps.groupRepository.replaceForOwner(ownerA, args[0], group.__v, { name: 'Changed', currency: 'INR' }); } return result; } } }));
  await addExpense(request, groupId); change = true;
  const result = await request(`/groups/${groupId}/balances`); assert.equal(result.status, 409); assert.equal(result.body.code, 'BALANCE_CHANGED'); assert.equal(result.body.data, undefined);
});
