import { describe, it, expect } from 'vitest';
import {
  allocateSplit,
  expenseForm,
  expenseValues,
  validateGroup,
  capacity,
} from '../utils/groups';
import { invitationReturn } from '../utils/invitations';
import { a, b, c, expense, members, token } from './fixtures/groups';
import { majorToMinor } from '../../../shared/money.js';
describe('shared splitting and input integrity', () => {
  it('equal splits preserve deterministic one-paisa remainders independent of request order', () => {
    for (const ids of [
      [a, b, c],
      [c, b, a],
    ])
      expect(
        allocateSplit(10000, { method: 'equal', participants: ids }).shares.map(
          (s) => s.amountMinor,
        ),
      ).toEqual([3334, 3333, 3333]);
  });
  it('exact amounts reconcile and selected members can exclude the payer', () => {
    expect(
      allocateSplit(10001, {
        method: 'exact',
        participants: [
          { user: b, amountMinor: 1 },
          { user: c, amountMinor: 10000 },
        ],
      }).shares,
    ).toEqual([
      { user: b, amountMinor: 1 },
      { user: c, amountMinor: 10000 },
    ]);
    expect(() =>
      allocateSplit(10, { method: 'exact', participants: [{ user: b, amountMinor: 9 }] }),
    ).toThrow();
  });
  it('percentage uses largest remainders and stable ID ties without floating point', () => {
    expect(
      allocateSplit(101, {
        method: 'percentage',
        participants: [
          { user: b, basisPoints: 5000 },
          { user: a, basisPoints: 5000 },
        ],
      }).shares.map((s) => s.amountMinor),
    ).toEqual([51, 50]);
    expect(majorToMinor('33.33')).toBe(3333);
  });
  it('maximum safe totals are preserved exactly', () => {
    const { shares } = allocateSplit(Number.MAX_SAFE_INTEGER, {
      method: 'equal',
      participants: [a, b, c],
    });
    expect(shares.reduce((s, row) => s + BigInt(row.amountMinor), 0n)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
  });
  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid total %s',
    (amount) =>
      expect(() => allocateSplit(amount, { method: 'equal', participants: [a] })).toThrow(),
  );
  it('rejects duplicates, zero shares, incomplete percentages and zero-paisa beneficiaries', () => {
    for (const split of [
      { method: 'equal', participants: [a, a] },
      { method: 'equal', participants: [a, b, c] },
      { method: 'percentage', participants: [{ user: a, basisPoints: 9999 }] },
      { method: 'exact', participants: [{ user: a, amountMinor: 0 }] },
    ])
      expect(() => allocateSplit(1, split)).toThrow();
  });
  it.each(['0', '-1', '1.001', 'NaN', '1e3', '90071992547409.92'])(
    'rejects amount text %s',
    (amount) =>
      expect(
        expenseForm({ ...expenseValues(expense, members, a), amount }, members, expense).errors
          .amount,
      ).toBeTruthy(),
  );
  it('validates current members, expense categories and real UTC dates', () => {
    const input = expenseValues(expense, members, a);
    for (const patch of [
      { payer: 'foreign' },
      { category: 'salary' },
      { date: '2026-02-30' },
      { participants: ['foreign'] },
    ])
      expect(
        Object.keys(expenseForm({ ...input, ...patch }, members).errors).length,
      ).toBeGreaterThan(0);
  });
  it('preserves unchanged timestamps and exact prefilled amounts', () => {
    const result = expenseForm(expenseValues(expense, members, a), members, expense);
    expect(result.data.amountMinor).toBe(10001);
    expect(result.data.expenseDate).toBe(expense.expenseDate);
    expect(result.shares).toEqual(expense.shares);
  });
  it('validates group metadata bounds without accepting internal fields', () => {
    expect(validateGroup({ name: ' ', description: '' }).errors.name).toBeTruthy();
    expect(validateGroup({ name: ' Group ', description: ' note ' }).data).toEqual({
      name: 'Group',
      description: 'note',
      currency: 'INR',
    });
  });
  it('shows debt and credit after pending reservations with exact subtraction', () => {
    expect(capacity({ netMinor: -Number.MAX_SAFE_INTEGER, pendingSentMinor: 1 }, true)).toBe(
      Number.MAX_SAFE_INTEGER - 1,
    );
    expect(capacity({ netMinor: 100, pendingReceivedMinor: 30 }, false)).toBe(70);
  });
  it('restores only constrained invitation fragments', () => {
    expect(invitationReturn('#join=' + token)).toBe('/app/join/' + token);
    expect(invitationReturn('#join=bad')).toBeNull();
    expect(invitationReturn('#join=https://attacker.test')).toBeNull();
  });
});
